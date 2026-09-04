import {
  ISettlementStorage,
  SettlementFilter,
  SettlementRecord,
  SettlementStatus,
  SettlementSummary,
  StatusUpdateDetails,
} from "./types.js";

/**
 * In-memory implementation of ISettlementStorage.
 * Designed for high-speed unit tests and ephemeral environments.
 */
export class MemorySettlementStorage implements ISettlementStorage {
  private readonly records: Map<string, SettlementRecord> = new Map();
  private readonly sigHashIndex: Map<string, string> = new Map();

  async save(record: SettlementRecord): Promise<void> {
    const clone: SettlementRecord = { ...record };
    this.records.set(clone.id, clone);
    this.sigHashIndex.set(clone.signatureHash, clone.id);
  }

  async getById(id: string): Promise<SettlementRecord | null> {
    const record = this.records.get(id);
    if (!record) {
      return null;
    }
    return { ...record };
  }

  async getBySignatureHash(signatureHash: string): Promise<SettlementRecord | null> {
    const id = this.sigHashIndex.get(signatureHash);
    if (!id) {
      return null;
    }
    return this.getById(id);
  }

  async updateStatus(
    id: string,
    status: SettlementStatus,
    details?: StatusUpdateDetails
  ): Promise<void> {
    const record = this.records.get(id);
    if (!record) {
      return;
    }

    const updated: SettlementRecord = {
      ...record,
      status,
      updatedAt: Date.now(),
      txHash: details?.txHash !== undefined ? details.txHash : record.txHash,
      errorReason: details?.errorReason !== undefined ? details.errorReason : record.errorReason,
      errorCode: details?.errorCode !== undefined ? details.errorCode : record.errorCode,
    };

    this.records.set(id, updated);
  }

  async list(filter?: SettlementFilter): Promise<SettlementRecord[]> {
    let results = Array.from(this.records.values());

    if (filter?.payer) {
      results = results.filter((r) => r.payer === filter.payer);
    }
    if (filter?.receiver) {
      results = results.filter((r) => r.receiver === filter.receiver);
    }
    if (filter?.status) {
      results = results.filter((r) => r.status === filter.status);
    }
    if (filter?.asset) {
      results = results.filter((r) => r.asset === filter.asset);
    }
    if (filter?.fromDate !== undefined) {
      results = results.filter((r) => r.createdAt >= filter.fromDate!);
    }
    if (filter?.toDate !== undefined) {
      results = results.filter((r) => r.createdAt <= filter.toDate!);
    }

    const offset = filter?.offset ?? 0;
    const limit = filter?.limit ?? results.length;

    return results.slice(offset, offset + limit).map((r) => ({ ...r }));
  }

  async count(filter?: SettlementFilter): Promise<number> {
    const list = await this.list({ ...filter, limit: undefined, offset: undefined });
    return list.length;
  }

  async getSummary(filter?: SettlementFilter): Promise<SettlementSummary> {
    const all = await this.list({ ...filter, limit: undefined, offset: undefined });
    const revenueByAsset: Record<string, string> = {};
    let totalMicroUsdc = 0n;
    let completed = 0;
    let failed = 0;
    let pending = 0;

    for (const r of all) {
      if (r.status === "completed") {
        completed++;
        const current = BigInt(revenueByAsset[r.asset] || "0");
        const added = BigInt(r.amount || "0");
        revenueByAsset[r.asset] = (current + added).toString();
        if (r.asset.includes("USDC")) {
          totalMicroUsdc += added;
        }
      } else if (r.status === "failed") {
        failed++;
      } else if (r.status === "pending") {
        pending++;
      }
    }

    return {
      totalCount: all.length,
      completedCount: completed,
      failedCount: failed,
      pendingCount: pending,
      totalCompletedRevenueMicroUsdc: totalMicroUsdc.toString(),
      totalCompletedRevenueUsd: `$${(Number(totalMicroUsdc) / 1e6).toFixed(4)}`,
      revenueByAsset,
    };
  }

  async close(): Promise<void> {
    this.records.clear();
    this.sigHashIndex.clear();
  }
}
