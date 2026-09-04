export interface ReconcileParams {
  clientAddress: string;
  preAuthorizedMicroUsdc: number;
  actualMicroUsdc: number;
}

export class TwoPhaseReconciler {
  private creditLedger = new Map<string, number>();

  public getCredit(clientAddress: string): number {
    return this.creditLedger.get(clientAddress) ?? 0;
  }

  public reconcile(params: ReconcileParams): number {
    const unspent = Math.max(0, params.preAuthorizedMicroUsdc - params.actualMicroUsdc);
    if (unspent > 0) {
      const current = this.getCredit(params.clientAddress);
      this.creditLedger.set(params.clientAddress, current + unspent);
    }
    return unspent;
  }

  public applyCredit(clientAddress: string, requiredMicroUsdc: number): number {
    const available = this.getCredit(clientAddress);
    if (available === 0) return requiredMicroUsdc;

    if (available >= requiredMicroUsdc) {
      this.creditLedger.set(clientAddress, available - requiredMicroUsdc);
      return 0;
    } else {
      this.creditLedger.set(clientAddress, 0);
      return requiredMicroUsdc - available;
    }
  }

  public clearCredit(clientAddress: string): void {
    this.creditLedger.delete(clientAddress);
  }
}
