import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { Express } from "express";
import { createBlockRunGateway } from "../../src/gateway/blockrun_gateway.js";
import { MemorySettlementStorage } from "../../src/storage/memory_storage.js";
import { SettlementRecord } from "../../src/storage/types.js";
import { IVerifierService } from "../../src/services/verifier.js";

describe("Merchant Settlement History & Invoicing API (TDD)", () => {
  let app: Express;
  let storage: MemorySettlementStorage;

  const merchantA = "erd1spyavw0956vq68xj8ymmxtxws2ah0mgr2ww05nv2gl35dp9xnseq6lvd30";
  const merchantB = "erd1qqqqqqqqqqqqqpgqhe8t5jewej70zupmh44eurgn29psua5l2jps3ntjj3";
  const payer1 = "erd1n2tunlzeqdezy3nz4cdz0a2r056wlsrdew8atsmst7cpd2l0fjxqsgrc6a";
  const payer2 = "erd1tswfs5f472p88lhmge99l22e952m4sfe7307jugzz0578usqdnyqdf9cwj";

  const records: SettlementRecord[] = [
    {
      id: "settle-1",
      signatureHash: "sig-hash-1",
      payer: payer1,
      receiver: merchantA,
      asset: "USDC-350c4e",
      amount: "10000", // $0.01
      status: "completed",
      txHash: "0xtx1",
      createdAt: 1714000000000,
      updatedAt: 1714000001000,
    },
    {
      id: "settle-2",
      signatureHash: "sig-hash-2",
      payer: payer2,
      receiver: merchantA,
      asset: "USDC-350c4e",
      amount: "25000", // $0.025
      status: "completed",
      txHash: "0xtx2",
      createdAt: 1714000500000,
      updatedAt: 1714000501000,
    },
    {
      id: "settle-3",
      signatureHash: "sig-hash-3",
      payer: payer1,
      receiver: merchantA,
      asset: "USDC-350c4e",
      amount: "5000",
      status: "failed",
      errorCode: "INSUFFICIENT_BALANCE",
      errorReason: "User has insufficient balance",
      createdAt: 1714001000000,
      updatedAt: 1714001001000,
    },
    {
      id: "settle-4",
      signatureHash: "sig-hash-4",
      payer: payer2,
      receiver: merchantB,
      asset: "USDC-350c4e",
      amount: "15000",
      status: "completed",
      txHash: "0xtx4",
      createdAt: 1714002000000,
      updatedAt: 1714002001000,
    },
  ];

  beforeEach(async () => {
    storage = new MemorySettlementStorage();
    for (const r of records) {
      await storage.save(r);
    }

    const mockVerifier: IVerifierService = {
      verify: vi.fn(),
    } as any;

    app = createBlockRunGateway({
      verifier: mockVerifier,
      storage,
      payTo: merchantA,
      rateLimit: { enabled: false },
    });
  });

  describe("GET /api/v1/settlements", () => {
    it("should return all settlements with pagination and summary", async () => {
      const res = await request(app).get("/api/v1/settlements");
      expect(res.status).toBe(200);
      expect(res.body.settlements.length).toBe(4);
      expect(res.body.pagination.total).toBe(4);
      expect(res.body.pagination.hasMore).toBe(false);

      // Aggregated summary
      expect(res.body.summary.totalCount).toBe(4);
      expect(res.body.summary.completedCount).toBe(3);
      expect(res.body.summary.failedCount).toBe(1);
      expect(res.body.summary.totalCompletedRevenueMicroUsdc).toBe("50000"); // 10000 + 25000 + 15000
      expect(res.body.summary.totalCompletedRevenueUsd).toBe("$0.0500");
      expect(res.body.summary.revenueByAsset["USDC-350c4e"]).toBe("50000");
    });

    it("should filter settlements by merchant / receiver address", async () => {
      const res = await request(app).get(`/api/v1/settlements?merchant=${merchantA}`);
      expect(res.status).toBe(200);
      expect(res.body.settlements.length).toBe(3);
      expect(res.body.settlements.every((s: any) => s.receiver === merchantA)).toBe(true);

      // Summary scoped to merchant A
      expect(res.body.summary.totalCount).toBe(3);
      expect(res.body.summary.completedCount).toBe(2);
      expect(res.body.summary.totalCompletedRevenueMicroUsdc).toBe("35000"); // 10000 + 25000
      expect(res.body.summary.totalCompletedRevenueUsd).toBe("$0.0350");
    });

    it("should filter by status (completed vs failed)", async () => {
      const res = await request(app).get("/api/v1/settlements?status=failed");
      expect(res.status).toBe(200);
      expect(res.body.settlements.length).toBe(1);
      expect(res.body.settlements[0].id).toBe("settle-3");
      expect(res.body.settlements[0].errorCode).toBe("INSUFFICIENT_BALANCE");
    });

    it("should support pagination with limit and offset", async () => {
      const res = await request(app).get("/api/v1/settlements?limit=2&offset=1");
      expect(res.status).toBe(200);
      expect(res.body.settlements.length).toBe(2);
      expect(res.body.settlements[0].id).toBe("settle-2");
      expect(res.body.settlements[1].id).toBe("settle-3");
      expect(res.body.pagination.limit).toBe(2);
      expect(res.body.pagination.offset).toBe(1);
      expect(res.body.pagination.total).toBe(4);
      expect(res.body.pagination.hasMore).toBe(true);
    });

    it("should filter by date ranges", async () => {
      // From 1714000400000 to 1714001500000 (includes settle-2 and settle-3)
      const res = await request(app).get(
        "/api/v1/settlements?from=1714000400000&to=1714001500000"
      );
      expect(res.status).toBe(200);
      expect(res.body.settlements.length).toBe(2);
      expect(res.body.settlements.map((s: any) => s.id)).toEqual(["settle-2", "settle-3"]);
    });
  });

  describe("GET /api/v1/settlements/export.csv", () => {
    it("should export settlement records in standard CSV format with correct headers", async () => {
      const res = await request(app).get("/api/v1/settlements/export.csv");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/csv");
      expect(res.headers["content-disposition"]).toContain("attachment; filename=");

      const lines = res.text.trim().split("\r\n");
      expect(lines.length).toBe(5); // Header + 4 records

      expect(lines[0]).toBe(
        "id,signatureHash,payer,receiver,asset,amount,status,txHash,createdAt,date,errorCode,errorReason"
      );

      // Verify row 1 contains expected data
      expect(lines[1]).toContain("settle-1");
      expect(lines[1]).toContain(merchantA);
      expect(lines[1]).toContain("USDC-350c4e");
      expect(lines[1]).toContain("10000");
      expect(lines[1]).toContain("completed");
    });

    it("should apply merchant filter to CSV export", async () => {
      const res = await request(app).get(`/api/v1/settlements/export.csv?merchant=${merchantB}`);
      expect(res.status).toBe(200);

      const lines = res.text.trim().split("\r\n");
      expect(lines.length).toBe(2); // Header + 1 record
      expect(lines[1]).toContain("settle-4");
      expect(lines[1]).toContain(merchantB);
      expect(lines[1]).toContain("15000");
    });

    it("should properly escape CSV special characters (commas, quotes, newlines)", async () => {
      await storage.save({
        id: "settle-escaped",
        signatureHash: "sig-hash-escaped",
        payer: payer1,
        receiver: merchantA,
        asset: "USDC-350c4e",
        amount: "1000",
        status: "failed",
        errorCode: "SPECIAL_ERR",
        errorReason: 'Failed with "quoted" error, comma, and\nnewline',
        createdAt: 1714003000000,
        updatedAt: 1714003000000,
      });

      const res = await request(app).get("/api/v1/settlements/export.csv?status=failed");
      expect(res.status).toBe(200);
      expect(res.text).toContain('""quoted""');
    });
  });
});
