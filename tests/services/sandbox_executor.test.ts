import { describe, it, expect } from "vitest";
import { SandboxExecutor } from "../../src/services/sandbox_executor.js";

describe("SandboxExecutor (Node.js vm isolation)", () => {
  const sandbox = new SandboxExecutor({ timeoutMs: 500 });

  it("should safely evaluate mathematical expressions", () => {
    const res = sandbox.execute("Math.sqrt(144) + 10 * 2");
    expect(res.isError).toBe(false);
    expect(res.result).toBe(32);
    expect(res.executionTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("should evaluate complex algorithmic JS code", () => {
    const code = `
      function fib(n) {
        let a = 0, b = 1;
        for (let i = 0; i < n; i++) {
          let tmp = a + b;
          a = b;
          b = tmp;
        }
        return a;
      }
      return fib(10);
    `;
    const res = sandbox.execute(code);
    expect(res.isError).toBe(false);
    expect(res.result).toBe(55);
  });

  it("should block access to process and runtime primitives", () => {
    const maliciousCode = "process.exit(1)";
    const res = sandbox.execute(maliciousCode);
    expect(res.isError).toBe(true);
    expect(res.error).toContain("Security Violation");
  });

  it("should block require and import statements", () => {
    const res1 = sandbox.execute("const fs = require('fs')");
    expect(res1.isError).toBe(true);
    expect(res1.error).toContain("Security Violation");

    const res2 = sandbox.execute("import('node:fs')");
    expect(res2.isError).toBe(true);
  });

  it("should block prototype pollution and constructor escapes", () => {
    const escapeCode = "this.constructor.constructor('return process')()";
    const res = sandbox.execute(escapeCode);
    expect(res.isError).toBe(true);
    expect(res.error).toBeDefined();
  });

  it("should enforce execution timeout on infinite loops", () => {
    const loopCode = "while(true) {}";
    const res = sandbox.execute(loopCode, { timeoutMs: 100 });
    expect(res.isError).toBe(true);
    expect(res.error).toMatch(/timed out|execution failed/i);
  });

  it("should correctly evaluate multi-statement code without explicit return keyword", () => {
    const code = `
      const x = 10;
      const y = 25;
      x + y;
    `;
    const res = sandbox.execute(code);
    expect(res.isError).toBe(false);
    expect(res.result).toBe(35);
  });

  it("should block indirect constructor escapes via Array or Object", () => {
    const code = "Array.prototype.constructor.constructor('return process')()";
    const res = sandbox.execute(code);
    expect(res.isError).toBe(true);
    expect(res.error).toContain("Security Violation");
  });

  it("should correctly evaluate scripts with internal functions containing return statements", () => {
    const code = `
      function add(a, b) {
        return a + b;
      }
      add(15, 27);
    `;
    const res = sandbox.execute(code);
    expect(res.isError).toBe(false);
    expect(res.result).toBe(42);
  });

  it("should evaluate array callbacks with return without wrapping entire script into undefined", () => {
    const code = "[1, 2, 3].map(x => { return x * 10; })";
    const res = sandbox.execute(code);
    expect(res.isError).toBe(false);
    expect(res.result).toEqual([10, 20, 30]);
  });

  it("should handle strings containing the word return without breaking script completion", () => {
    const code = `
      const msg = "Please return this item";
      msg.toUpperCase();
    `;
    const res = sandbox.execute(code);
    expect(res.isError).toBe(false);
    expect(res.result).toBe("PLEASE RETURN THIS ITEM");
  });

  it("should preserve host Array.prototype.constructor without prototype pollution", () => {
    expect([].constructor).toBe(Array);
    const res = sandbox.execute("1 + 1");
    expect(res.isError).toBe(false);
    expect([].constructor).toBe(Array);
  });

  it("should reject scripts exceeding maximum length boundary (64KB)", () => {
    const hugeCode = "1 + ".repeat(25000) + "1";
    const res = sandbox.execute(hugeCode);
    expect(res.isError).toBe(true);
    expect(res.error).toContain("code exceeds maximum permitted length");
  });

  it("should block timer primitives and async scheduling", () => {
    const resTimeout = sandbox.execute("setTimeout(() => {}, 100)");
    expect(resTimeout.isError).toBe(true);
    expect(resTimeout.error).toContain("Security Violation");

    const resMicrotask = sandbox.execute("queueMicrotask(() => {})");
    expect(resMicrotask.isError).toBe(true);
    expect(resMicrotask.error).toContain("Security Violation");
  });

  it("should block shared memory and concurrency primitives", () => {
    const resSab = sandbox.execute("new SharedArrayBuffer(1024)");
    expect(resSab.isError).toBe(true);
    expect(resSab.error).toContain("Security Violation");

    const resAtomics = sandbox.execute("Atomics.wait(new Int32Array(4), 0, 0)");
    expect(resAtomics.isError).toBe(true);
    expect(resAtomics.error).toContain("Security Violation");
  });
});

