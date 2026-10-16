import { serviceClient } from "../_shared/auth.ts";
import { handleRequest } from "./handler.ts";

const client = serviceClient();

Deno.serve((req) => handleRequest(req, async (token, operation, data) => {
  const result = await client.rpc("integracao_3c_request", {
    p_token: token,
    p_operacao: operation,
    p_dados: data,
  });
  if (result.error) {
    // Nunca registrar token, payload, resumo ou dados pessoais.
    console.error("integracao-3c: falha na RPC", result.error.code);
    if (result.error.code === "23P01") {
      return { status: 409, body: { erro: "HORARIO_OCUPADO", mensagem: "O horário foi ocupado. Consulte a disponibilidade novamente." } };
    }
    throw new Error("Falha na operação da integração.");
  }
  return result.data;
}));
