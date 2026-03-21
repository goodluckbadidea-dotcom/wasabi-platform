// ─── Security Unit Tests ───
// Tests for XSS prevention, password hashing, and code validation.

import { describe, it, expect } from "vitest";
import { escapeHtml } from "../utils/security.js";
import { validatePluginCode } from "../agent/toolExecutor.js";
import { hashPassword, verifyPassword } from "../utils/crypto.js";

// ── escapeHtml ──

describe("escapeHtml", () => {
  it("escapes HTML tags", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;"
    );
  });

  it("escapes ampersands", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  it("escapes double quotes", () => {
    expect(escapeHtml('" onclick="alert(1)"')).toBe(
      '&quot; onclick=&quot;alert(1)&quot;'
    );
  });

  it("escapes single quotes", () => {
    expect(escapeHtml("it's")).toBe("it&#x27;s");
  });

  it("handles nested XSS payloads", () => {
    const payload = '</script><img src=x onerror=alert(1)>';
    const result = escapeHtml(payload);
    expect(result).not.toContain("<");
    expect(result).not.toContain(">");
  });

  it("handles empty string", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("handles non-string input", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
    expect(escapeHtml(42)).toBe("");
  });

  it("preserves safe text", () => {
    expect(escapeHtml("Hello world")).toBe("Hello world");
  });
});

// ── validatePluginCode ──

describe("validatePluginCode", () => {
  it("allows safe code", () => {
    const errors = validatePluginCode("const x = 1 + 2; return x;");
    expect(errors).toEqual([]);
  });

  it("blocks eval()", () => {
    const errors = validatePluginCode("eval('alert(1)')");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("eval"))).toBe(true);
  });

  it("blocks new Function()", () => {
    const errors = validatePluginCode("new Function('alert(1)')");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("blocks window access", () => {
    const errors = validatePluginCode("window.location.href");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("blocks document access", () => {
    const errors = validatePluginCode("document.cookie");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("blocks dynamic import", () => {
    const errors = validatePluginCode("import('malicious-module')");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("blocks fetch()", () => {
    const errors = validatePluginCode("fetch('https://evil.com')");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("blocks indirect eval via (0, eval)", () => {
    const errors = validatePluginCode("(0, eval)('alert(1)')");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("blocks .constructor access", () => {
    const errors = validatePluginCode("''.constructor.constructor('alert(1)')()");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("blocks Reflect", () => {
    const errors = validatePluginCode("Reflect.apply(eval, null, ['alert(1)'])");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("blocks Proxy", () => {
    const errors = validatePluginCode("new Proxy({}, {})");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("blocks __proto__ access", () => {
    const errors = validatePluginCode("obj.__proto__.polluted = true");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("blocks WebSocket", () => {
    const errors = validatePluginCode("new WebSocket('wss://evil.com')");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("blocks self access", () => {
    const errors = validatePluginCode("self.eval('x')");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("blocks globalThis", () => {
    const errors = validatePluginCode("globalThis.eval");
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ── Password Hashing ──

describe("hashPassword / verifyPassword", () => {
  it("hashes and verifies correctly", async () => {
    const hash = await hashPassword("MyPassword123");
    expect(hash).toContain(":");
    expect(await verifyPassword("MyPassword123", hash)).toBe(true);
  });

  it("rejects wrong password", async () => {
    const hash = await hashPassword("correct-password");
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("produces different hashes for same password (random salt)", async () => {
    const h1 = await hashPassword("same-pass");
    const h2 = await hashPassword("same-pass");
    expect(h1).not.toBe(h2); // different salts
    expect(await verifyPassword("same-pass", h1)).toBe(true);
    expect(await verifyPassword("same-pass", h2)).toBe(true);
  });

  it("handles empty password", async () => {
    const hash = await hashPassword("");
    expect(await verifyPassword("", hash)).toBe(true);
    expect(await verifyPassword("not-empty", hash)).toBe(false);
  });

  it("handles unicode passwords", async () => {
    const hash = await hashPassword("p@$$wörd🔐");
    expect(await verifyPassword("p@$$wörd🔐", hash)).toBe(true);
    expect(await verifyPassword("p@$$word", hash)).toBe(false);
  });

  it("hash format is salt:hash with base64url encoding", async () => {
    const hash = await hashPassword("test");
    const parts = hash.split(":");
    expect(parts.length).toBe(2);
    // base64url: no +, /, or = characters
    expect(parts[0]).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(parts[1]).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
