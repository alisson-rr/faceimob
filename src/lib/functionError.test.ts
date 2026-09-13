import { describe, expect, it } from "vitest";
import { functionErrorMessage } from "./functionError";

const erroDoSdk = (body: string, contentType = "application/json") =>
  Object.assign(new Error("Edge Function returned a non-2xx status code"), {
    name: "FunctionsHttpError",
    context: new Response(body, { status: 500, headers: { "Content-Type": contentType } }),
  });

describe("functionErrorMessage", () => {
  it("usa a mensagem em pt-BR que a function devolveu no corpo", async () => {
    expect(await functionErrorMessage(erroDoSdk('{"error":"Limite do dia atingido."}'), "Tente de novo."))
      .toBe("Limite do dia atingido.");
  });

  it("sem corpo JSON, não mostra a frase em inglês do SDK: usa a de quem chamou", async () => {
    expect(await functionErrorMessage(erroDoSdk("<html>Bad Gateway</html>", "text/html"), "Tente de novo."))
      .toBe("Tente de novo.");
    const semRede = Object.assign(new Error("Failed to send a request to the Edge Function"), { name: "FunctionsFetchError" });
    expect(await functionErrorMessage(semRede, "Sem conexão com o servidor.")).toBe("Sem conexão com o servidor.");
  });

  it("erro que não é do SDK mantém a própria mensagem", async () => {
    expect(await functionErrorMessage(new Error("Arquivo acima de 10 MB."), "Tente de novo.")).toBe("Arquivo acima de 10 MB.");
  });
});
