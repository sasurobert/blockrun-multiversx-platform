import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

export interface BackupOptions {
  dbPath?: string;
  backupDir?: string;
  retentionDays?: number;
}

export interface BackupResult {
  success: boolean;
  backupPath: string;
  sizeBytes: number;
  integrity: string;
  cleanedBackupsCount: number;
}

export async function backupSettlements(options: BackupOptions = {}): Promise<BackupResult> {
  const dbPath = path.resolve(options.dbPath || process.env.SQLITE_DB_PATH || "./data/settlements.db");
  const backupDir = path.resolve(options.backupDir || process.env.BACKUP_DIR || "./data/backups");
  const retentionDays = options.retentionDays ?? 7;

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Source database file not found at: ${dbPath}`);
  }

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFilename = `settlements-backup-${timestamp}.db`;
  const backupPath = path.join(backupDir, backupFilename);

  // Open database connection in read-write mode
  const db = new Database(dbPath);

  try {
    // 1. Force WAL checkpoint and truncate log frames into primary database
    const checkpointResult = db.pragma("wal_checkpoint(TRUNCATE)") as any;
    console.log(`[Backup] Executed PRAGMA wal_checkpoint(TRUNCATE):`, checkpointResult);

    // 2. Perform online snapshot using better-sqlite3 backup API
    console.log(`[Backup] Initiating online backup to: ${backupPath}...`);
    await db.backup(backupPath);
    console.log(`[Backup] Online snapshot completed successfully.`);
  } finally {
    db.close();
  }

  // 3. Verify integrity of newly created snapshot
  const verifyDb = new Database(backupPath, { readonly: true });
  let integrity = "unknown";
  try {
    const result = verifyDb.pragma("integrity_check") as Array<{ integrity_check: string }>;
    integrity = result?.[0]?.integrity_check || "unknown";
    if (integrity !== "ok") {
      throw new Error(`Backup snapshot integrity check failed: ${integrity}`);
    }
    console.log(`[Backup] Snapshot integrity check passed: ${integrity}`);
  } finally {
    verifyDb.close();
  }

  const stats = fs.statSync(backupPath);

  // 4. Prune old backups past retention threshold
  let cleanedBackupsCount = 0;
  const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const existingFiles = fs.readdirSync(backupDir);

  for (const file of existingFiles) {
    if (file.startsWith("settlements-backup-") && file.endsWith(".db")) {
      const filePath = path.join(backupDir, file);
      try {
        const fileStat = fs.statSync(filePath);
        if (fileStat.mtimeMs < cutoffTime) {
          fs.unlinkSync(filePath);
          cleanedBackupsCount++;
          console.log(`[Backup] Pruned aged backup: ${file}`);
        }
      } catch {
        // Ignore removal error for race conditions
      }
    }
  }

  return {
    success: true,
    backupPath,
    sizeBytes: stats.size,
    integrity,
    cleanedBackupsCount,
  };
}

if (process.argv[1]?.includes("backup_settlements")) {
  backupSettlements()
    .then((res) => {
      console.log(`============================================================`);
      console.log(`       Settlements SQLite WAL Backup Completed              `);
      console.log(`============================================================`);
      console.log(`Backup File:  ${res.backupPath}`);
      console.log(`File Size:    ${res.sizeBytes} bytes`);
      console.log(`Integrity:    ${res.integrity}`);
      console.log(`Pruned Files: ${res.cleanedBackupsCount}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("[Backup] Fatal backup error:", err);
      process.exit(1);
    });
}
