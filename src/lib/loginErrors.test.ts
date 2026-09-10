import { describe, expect, it } from "vitest";
import { classifyLoginError } from "@/lib/loginErrors";

/**
 * O caso que motivou o módulo: sem rede, a tela acusava a credencial.
 * Um teste que só cobrisse "senha errada → credencial" passaria com o defeito.
 */
describe("classifyLoginError", () => {
  it("falha de rede não vira recusa de credencial", () => {
    expect(classifyLoginError({ name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch" }))
      .toBe("rede");
    expect(classifyLoginError({ message: "TypeError: Failed to fetch" })).toBe("rede");
    expect(classifyLoginError({ message: "NetworkError when attempting to fetch resource." })).toBe("rede");
    // Safari.
    expect(classifyLoginError({ message: "Load failed" })).toBe("rede");
  });

  it("5xx é servidor, não credencial", () => {
    expect(classifyLoginError({ status: 503, code: "unexpected_failure", message: "Service Unavailable" }))
      .toBe("rede");
  });

  it("rate limit tem ramo próprio", () => {
    expect(classifyLoginError({ status: 429, code: "over_request_rate_limit", message: "Request rate limit reached" }))
      .toBe("rate");
    // A frase real do GoTrue no reenvio de código.
    expect(classifyLoginError({ status: 429, message: "For security purposes, you can only request this after 51 seconds." }))
      .toBe("rate");
  });

  it("conta bloqueada e conta não confirmada não somem no genérico", () => {
    expect(classifyLoginError({ status: 400, code: "user_banned", message: "User is banned" })).toBe("bloqueado");
    expect(classifyLoginError({ status: 400, code: "email_not_confirmed", message: "Email not confirmed" }))
      .toBe("nao_confirmado");
  });

  it("credencial errada continua indistinguível de e-mail inexistente", () => {
    const recusa = { status: 400, code: "invalid_credentials", message: "Invalid login credentials" };
    expect(classifyLoginError(recusa)).toBe("credencial");
    expect(classifyLoginError({ status: 403, code: "otp_expired", message: "Token has expired or is invalid" }))
      .toBe("credencial");
    expect(classifyLoginError(null)).toBe("credencial");
  });
});
