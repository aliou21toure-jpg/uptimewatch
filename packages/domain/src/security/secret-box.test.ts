import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { open, seal } from "./secret-box";

const key = randomBytes(32);

describe("secret box", () => {
  it("round-trips and does not contain the plaintext", () => {
    const box = seal('{"Authorization":"Bearer s3cret"}', key, "org:mon");
    expect(box.toString("latin1")).not.toContain("s3cret");
    expect(open(box, key, "org:mon")).toBe('{"Authorization":"Bearer s3cret"}');
  });

  it("uses a fresh IV every time", () => {
    expect(seal("x", key, "a").equals(seal("x", key, "a"))).toBe(false);
  });

  it("refuses a ciphertext moved to another row or organization", () => {
    const box = seal("secret", key, "org-a:mon-1");
    expect(() => open(box, key, "org-b:mon-1")).toThrow();
    expect(() => open(box, key, "org-a:mon-2")).toThrow();
  });

  it("detects tampering and wrong keys", () => {
    const box = seal("secret", key, "a");
    const tampered = Buffer.from(box);
    tampered[tampered.length - 1]! ^= 1;
    expect(() => open(tampered, key, "a")).toThrow();
    expect(() => open(box, randomBytes(32), "a")).toThrow();
  });
});
