import Database, { Database as DatabaseType } from "better-sqlite3";
import fs from "fs";
import path from "path";

export interface ReconcileParams {
  clientAddress: string;
  preAuthorizedMicroUsdc: number;
  actualMicroUsdc: number;
}

export class TwoPhaseReconciler {
  private creditLedger = new Map<string, number>();
  private db?: DatabaseType;

  constructor(dbOrPath?: string | DatabaseType) {
    if (dbOrPath) {
      if (typeof dbOrPath === "string") {
        if (dbOrPath !== ":memory:") {
          const dir = path.dirname(dbOrPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
        }
        this.db = new Database(dbOrPath);
      } else {
        this.db = dbOrPath;
      }
      this.initDb();
    }
  }

  private initDb(): void {
    if (!this.db) return;
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_credits (
        client_address TEXT PRIMARY KEY,
        credit INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    // Load existing credits into cache
    const rows = this.db
      .prepare("SELECT client_address, credit FROM session_credits")
      .all() as Array<{ client_address: string; credit: number }>;
    for (const row of rows) {
      this.creditLedger.set(row.client_address, row.credit);
    }
  }

  private persistCredit(clientAddress: string, credit: number): void {
    if (!this.db) return;
    if (credit <= 0) {
      this.db.prepare("DELETE FROM session_credits WHERE client_address = ?").run(clientAddress);
    } else {
      this.db
        .prepare(
          `
        INSERT INTO session_credits (client_address, credit, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(client_address) DO UPDATE SET
          credit = excluded.credit,
          updated_at = excluded.updated_at
      `
        )
        .run(clientAddress, credit, Date.now());
    }
  }

  public getCredit(clientAddress: string): number {
    return this.creditLedger.get(clientAddress) ?? 0;
  }

  public reconcile(params: ReconcileParams): number {
    const unspent = Math.max(0, params.preAuthorizedMicroUsdc - params.actualMicroUsdc);
    if (unspent > 0) {
      const current = this.getCredit(params.clientAddress);
      const newCredit = current + unspent;
      this.creditLedger.set(params.clientAddress, newCredit);
      this.persistCredit(params.clientAddress, newCredit);
    }
    return unspent;
  }

  public applyCredit(clientAddress: string, requiredMicroUsdc: number): number {
    const available = this.getCredit(clientAddress);
    if (available === 0) return requiredMicroUsdc;

    if (available >= requiredMicroUsdc) {
      const remaining = available - requiredMicroUsdc;
      this.creditLedger.set(clientAddress, remaining);
      this.persistCredit(clientAddress, remaining);
      return 0;
    } else {
      this.creditLedger.set(clientAddress, 0);
      this.persistCredit(clientAddress, 0);
      return requiredMicroUsdc - available;
    }
  }

  public clearCredit(clientAddress: string): void {
    this.creditLedger.delete(clientAddress);
    if (this.db) {
      this.db.prepare("DELETE FROM session_credits WHERE client_address = ?").run(clientAddress);
    }
  }

  public close(): void {
    if (this.db) {
      this.db.close();
    }
  }
}
