import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";
import { TwoPhaseReconciler } from "../../src/router/two_phase_reconciler.js";

describe("TwoPhaseReconciler (TDD)", () => {
  it("should calculate unused token credit and update session ledger", () => {
    const reconciler = new TwoPhaseReconciler();
    const client = "erd1client000000000000000000000000000000000000000000000000000000";

    // 1. Initial credit is 0
    expect(reconciler.getCredit(client)).toBe(0);

    // 2. Pre-authorized 2000 micro-USDC, but actual consumption was only 1200 micro-USDC
    const credited = reconciler.reconcile({
      clientAddress: client,
      preAuthorizedMicroUsdc: 2000,
      actualMicroUsdc: 1200,
    });

    expect(credited).toBe(800);
    expect(reconciler.getCredit(client)).toBe(800);

    // 3. Apply credit to next call requiring 1000 micro-USDC
    const remainingToPay = reconciler.applyCredit(client, 1000);
    expect(remainingToPay).toBe(200);
    expect(reconciler.getCredit(client)).toBe(0);
  });

  it("should persist session credits in SQLite across restarts", () => {
    const tmpDir = path.resolve("./data/test_tmp");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const dbPath = path.resolve(tmpDir, `reconciler_test_${Date.now()}.db`);

    try {
      const client = "erd1clientpersisted000000000000000000000000000000000000000000000";
      // 1. First instance writes credit
      const reconciler1 = new TwoPhaseReconciler(dbPath);
      reconciler1.reconcile({
        clientAddress: client,
        preAuthorizedMicroUsdc: 5000,
        actualMicroUsdc: 2500,
      });
      expect(reconciler1.getCredit(client)).toBe(2500);
      reconciler1.close();

      // 2. Second instance simulates restart and reads credit from database
      const reconciler2 = new TwoPhaseReconciler(dbPath);
      expect(reconciler2.getCredit(client)).toBe(2500);

      // 3. Apply partial credit
      const remaining = reconciler2.applyCredit(client, 1000);
      expect(remaining).toBe(0);
      expect(reconciler2.getCredit(client)).toBe(1500);
      reconciler2.close();

      // 4. Third instance verifies updated credit
      const reconciler3 = new TwoPhaseReconciler(dbPath);
      expect(reconciler3.getCredit(client)).toBe(1500);
      reconciler3.close();
    } finally {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    }
  });
});

