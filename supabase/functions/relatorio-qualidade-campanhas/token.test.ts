import { describe, expect, it } from "vitest";
import { tokensIguais } from "./token";

describe("tokensIguais", () => {
  it("aceita só o token exato", () => {
    expect(tokensIguais("abc123", "abc123")).toBe(true);
    expect(tokensIguais("abc124", "abc123")).toBe(false);
    expect(tokensIguais("abc12", "abc123")).toBe(false);
  });

  it("vazio nunca autentica, nem contra vazio", () => {
    expect(tokensIguais("", "abc")).toBe(false);
    expect(tokensIguais("", "")).toBe(false);
  });
});
