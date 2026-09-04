import { describe, it, expect } from "vitest";
import { MarkdownExtractor } from "../../src/tollbooth/markdown_extractor.js";

describe("MarkdownExtractor (TDD)", () => {
  const extractor = new MarkdownExtractor();

  it("should convert HTML with headers, paragraphs, and lists to clean Markdown", () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head><title>MultiversX Sharding</title></head>
        <body>
          <nav><a href="/">Home</a> <a href="/docs">Docs</a></nav>
          <header><h1>MultiversX Sharding Explained</h1></header>
          <main>
            <p>MultiversX achieves <strong>high throughput</strong> via Adaptive State Sharding.</p>
            <h2>Key Shard Types</h2>
            <ul>
              <li>Shard 0</li>
              <li>Shard 1</li>
              <li>Shard 2</li>
            </ul>
            <p>Code example:</p>
            <pre><code>let amount = 5000;</code></pre>
          </main>
          <aside class="advertisement">Buy crypto now!</aside>
          <footer>Copyright 2026</footer>
        </body>
      </html>
    `;

    const result = extractor.extract(html);

    expect(result.title).toContain("MultiversX Sharding");
    expect(result.markdown).toContain("# MultiversX Sharding Explained");
    expect(result.markdown).toContain("**high throughput**");
    expect(result.markdown).toContain("## Key Shard Types");
    expect(result.markdown).toContain("- Shard 0");
    expect(result.markdown).toContain("```\nlet amount = 5000;\n```");
    expect(result.markdown).not.toContain("Home");
    expect(result.markdown).not.toContain("Buy crypto now!");
    expect(result.markdown).not.toContain("Copyright 2026");
    expect(result.reductionPercentage).toBeGreaterThan(40);
    expect(result.estimatedTokens).toBeGreaterThan(0);
  });

  it("should preserve images in markdown format", () => {
    const html = `
      <html>
        <body>
          <h1>Architecture Diagram</h1>
          <p>Below is the system design:</p>
          <img src="https://cdn.example.com/arch.png" alt="System Architecture">
          <img alt="Relayer Pool" src="https://cdn.example.com/relayers.png">
        </body>
      </html>
    `;

    const result = extractor.extract(html);
    expect(result.markdown).toContain("![System Architecture](https://cdn.example.com/arch.png)");
    expect(result.markdown).toContain("![Relayer Pool](https://cdn.example.com/relayers.png)");
  });

  it("should convert HTML tables to GitHub-flavored Markdown tables and handle uneven rows", () => {
    const html = `
      <html>
        <body>
          <h1>Shard Comparison</h1>
          <table>
            <thead>
              <tr><th>Shard</th><th>TPS</th><th>Gas</th></tr>
            </thead>
            <tbody>
              <tr><td>Shard 0</td><td>10000</td></tr>
              <tr><td>Shard 1</td><td>12000</td><td>Low</td></tr>
            </tbody>
          </table>
        </body>
      </html>
    `;

    const result = extractor.extract(html);
    expect(result.markdown).toContain("| Shard | TPS | Gas |");
    expect(result.markdown).toContain("|---|---|---|");
    expect(result.markdown).toContain("| Shard 0 | 10000 |  |");
    expect(result.markdown).toContain("| Shard 1 | 12000 | Low |");
  });

  it("should handle adversarial and malformed HTML safely", () => {
    const adversarialHtml = `
      <div>
        <p>Unclosed paragraph
        <script>alert('malicious');</script>
        <svg><text>evil</text></svg>
        <table>
          <tr><td>Deeply</td><td>Nested</td>
          <table><tr><td>Inner</td></tr></table>
        </table>
        <span>Special &amp; &lt;escaped&gt; &quot;chars&quot;</span>
      </div>
    `;

    const result = extractor.extract(adversarialHtml);
    expect(result.markdown).not.toContain("malicious");
    expect(result.markdown).not.toContain("evil");
    expect(result.markdown).toContain("Special & <escaped> \"chars\"");
  });

  it("should handle empty or minimal input safely", () => {
    const result = extractor.extract("");
    expect(result.markdown).toBe("");
    expect(result.estimatedTokens).toBe(0);
  });
});
