import { BlockRunMvxClient } from "./blockrun_mvx_client.js";

export interface ScraperClientOptions {
  client: BlockRunMvxClient;
  concurrency?: number;
  timeoutMs?: number;
}

export interface ScrapeResult {
  url: string;
  markdown?: string;
  status: number;
  paymentReceipt?: string;
  success: boolean;
  error?: string;
}

export class ScraperClient {
  private client: BlockRunMvxClient;
  private concurrency: number;
  private timeoutMs: number;

  constructor(options: ScraperClientOptions) {
    this.client = options.client;
    this.concurrency = Math.max(1, options.concurrency ?? 5);
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  public async scrapeUrl(url: string): Promise<ScrapeResult> {
    try {
      const res = await this.client.fetchWithPayment(url, {
        headers: {
          Accept: "text/markdown, application/json",
          "User-Agent": "BlockRun-Scraper/1.0 (Autonomous Web Scraper; +https://blockrun.ai)",
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      const receipt = (res as any).paymentReceipt;
      if (res.ok || res.status === 200) {
        const text = await res.text();
        return {
          url,
          markdown: text,
          status: res.status,
          paymentReceipt: receipt,
          success: true,
        };
      }

      return {
        url,
        status: res.status,
        success: false,
        error: `HTTP ${res.status}: ${res.statusText}`,
        paymentReceipt: receipt,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        url,
        status: 0,
        success: false,
        error: message,
      };
    }
  }

  public async scrapeBatch(urls: string[]): Promise<ScrapeResult[]> {
    const results: ScrapeResult[] = new Array(urls.length);
    let index = 0;

    const worker = async () => {
      while (index < urls.length) {
        const currentIndex = index++;
        const url = urls[currentIndex];
        results[currentIndex] = await this.scrapeUrl(url);
      }
    };

    const workers = Array.from(
      { length: Math.min(this.concurrency, urls.length) },
      () => worker()
    );

    await Promise.all(workers);
    return results;
  }
}
