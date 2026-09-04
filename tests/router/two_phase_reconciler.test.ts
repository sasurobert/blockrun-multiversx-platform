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
});
