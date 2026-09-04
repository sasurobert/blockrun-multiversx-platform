import { MarkdownExtractionResult } from "./types.js";

export class MarkdownExtractor {
  public extract(html: string): MarkdownExtractionResult {
    if (!html || !html.trim()) {
      return {
        markdown: "",
        title: "",
        estimatedTokens: 0,
        reductionPercentage: 0,
      };
    }

    const rawLength = html.length;

    // 1. Extract Title
    let title = "";
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) {
      title = this.cleanText(titleMatch[1]);
    }

    // 2. Strip head and non-content blocks
    let content = html
      .replace(/<head\b[^<]*(?:(?!<\/head>)<[^<]*)*<\/head>/gi, "")
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
      .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, "")
      .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, "")
      .replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, "")
      .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, "")
      .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, "")
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "");

    // 3. Process Code Blocks before inline formatting: <pre><code>...</code></pre>
    content = content.replace(
      /<pre[^>]*><code(?:\s+class="language-([^"]*)")?[^>]*>([\s\S]*?)<\/code><\/pre>/gi,
      (_match, lang, code) => {
        const cleanCode = this.unescapeHtml(code.trim());
        const language = lang ? lang.trim() : "";
        return `\n\n\`\`\`${language}\n${cleanCode}\n\`\`\`\n\n`;
      }
    );

    // 4. Tables: <table>...</table>
    content = content.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_match, tableBody) => {
      return this.convertTableToMarkdown(tableBody);
    });

    // 5. Headings: <h1> to <h6>
    content = content
      .replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, "\n\n# $1\n\n")
      .replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, "\n\n## $1\n\n")
      .replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, "\n\n### $1\n\n")
      .replace(/<h4\b[^>]*>([\s\S]*?)<\/h4>/gi, "\n\n#### $1\n\n")
      .replace(/<h5\b[^>]*>([\s\S]*?)<\/h5>/gi, "\n\n##### $1\n\n")
      .replace(/<h6\b[^>]*>([\s\S]*?)<\/h6>/gi, "\n\n###### $1\n\n");

    // 6. Lists: <ul>, <ol>, <li>
    content = content
      .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, "\n- $1")
      .replace(/<\/?(?:ul|ol)\b[^>]*>/gi, "\n");

    // 7. Inline Formatting & Media (Preserve Images and Links)
    content = content
      .replace(/<img\b[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*>/gi, "\n\n![$2]($1)\n\n")
      .replace(/<img\b[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*>/gi, "\n\n![$1]($2)\n\n")
      .replace(/<img\b[^>]*src="([^"]*)"[^>]*>/gi, "\n\n![]($1)\n\n")
      .replace(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, "**$1**")
      .replace(/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, "*$1*")
      .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
      .replace(/<a\b\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");

    // 8. Block elements to newlines
    content = content
      .replace(/<(?:p|div|section|article|blockquote)[^>]*>/gi, "\n\n")
      .replace(/<\/(?:p|div|section|article|blockquote)>/gi, "\n\n")
      .replace(/<br\s*\/?>/gi, "\n");

    // 9. Strip remaining HTML tags
    content = content.replace(/<[^>]+>/g, "");

    // 10. Unescape HTML entities
    content = this.unescapeHtml(content);

    // 11. Normalize Whitespace
    content = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line, i, arr) => line !== "" || (i > 0 && arr[i - 1] !== ""))
      .join("\n")
      .trim();

    const markdownLength = content.length;
    const estimatedTokens = Math.ceil(markdownLength / 4);
    const reductionPercentage = Math.round(
      Math.max(0, ((rawLength - markdownLength) / rawLength) * 100)
    );

    return {
      markdown: content,
      title,
      estimatedTokens,
      reductionPercentage,
    };
  }

  private convertTableToMarkdown(tableHtml: string): string {
    const rows: string[][] = [];
    const rowMatches = tableHtml.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
    if (!rowMatches) return "";

    for (const row of rowMatches) {
      const cellMatches = row.match(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi);
      if (cellMatches) {
        const rowData = cellMatches.map((cell) =>
          this.cleanText(cell.replace(/<[^>]+>/g, ""))
        );
        rows.push(rowData);
      }
    }

    if (rows.length === 0) return "";

    const numCols = Math.max(...rows.map((r) => r.length));
    if (numCols === 0) return "";

    const normalizedRows = rows.map((r) => {
      const row = [...r];
      while (row.length < numCols) {
        row.push("");
      }
      return row;
    });

    const header = normalizedRows[0];
    const separator = new Array(numCols).fill("---");
    const formattedRows = [
      `| ${header.join(" | ")} |`,
      `|${separator.join("|")}|`,
      ...normalizedRows.slice(1).map((r) => `| ${r.join(" | ")} |`),
    ];

    return `\n\n${formattedRows.join("\n")}\n\n`;
  }

  private unescapeHtml(text: string): string {
    return text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ");
  }

  private cleanText(text: string): string {
    return this.unescapeHtml(text).replace(/\s+/g, " ").trim();
  }
}
