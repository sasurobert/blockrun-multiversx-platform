import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { backupSettlements } from "../../scripts/backup_settlements.js";

describe("backupSettlements (Disaster Recovery & SQLite WAL Backup)", () => {
  const testDir = path.resolve("./data/test_backup_suite");
  const testDbPath = path.join(testDir, "test_settlements.db");
  const testBackupDir = path.join(testDir, "backups");

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });

    // Initialize source database with WAL mode and test table
    const db = new Database(testDbPath);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE test_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL,
        value TEXT NOT NULL
      );
      INSERT INTO test_records (key, value) VALUES ('tx-1', 'confirmed-devnet');
      INSERT INTO test_records (key, value) VALUES ('tx-2', 'settled-intra-shard');
    `);
    db.close();
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should checkpoint WAL, create online backup, and verify snapshot integrity", async () => {
    const result = await backupSettlements({
      dbPath: testDbPath,
      backupDir: testBackupDir,
      retentionDays: 7,
    });

    expect(result.success).toBe(true);
    expect(result.integrity).toBe("ok");
    expect(fs.existsSync(result.backupPath)).toBe(true);
    expect(result.sizeBytes).toBeGreaterThan(0);

    // Open backup and verify data was preserved
    const backupDb = new Database(result.backupPath, { readonly: true });
    const rows = backupDb.prepare("SELECT * FROM test_records").all() as any[];
    expect(rows.length).toBe(2);
    expect(rows[0].key).toBe("tx-1");
    expect(rows[1].value).toBe("settled-intra-shard");
    backupDb.close();
  });

  it("should throw error when source database does not exist", async () => {
    await expect(
      backupSettlements({
        dbPath: path.join(testDir, "non_existent.db"),
        backupDir: testBackupDir,
      })
    ).rejects.toThrow("Source database file not found");
  });

  it("should prune old backups beyond retention days", async () => {
    fs.mkdirSync(testBackupDir, { recursive: true });
    const oldBackupPath = path.join(testBackupDir, "settlements-backup-2020-01-01T00-00-00-000Z.db");
    fs.writeFileSync(oldBackupPath, "mock-old-backup");

    // Set mtime to 30 days ago
    const thirtyDaysAgo = (Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000;
    fs.utimesSync(oldBackupPath, thirtyDaysAgo, thirtyDaysAgo);

    const result = await backupSettlements({
      dbPath: testDbPath,
      backupDir: testBackupDir,
      retentionDays: 7,
    });

    expect(result.cleanedBackupsCount).toBe(1);
    expect(fs.existsSync(oldBackupPath)).toBe(false);
    expect(fs.existsSync(result.backupPath)).toBe(true);
  });
});
