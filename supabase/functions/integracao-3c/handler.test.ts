// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { handleRequest, type ThreeCRpc } from "./handler.ts";

const id = "11111111-2222-4333-8444-555555555555";
const token = "a".repeat(64);
const start = "2026-10-20T14:00:00-03:00";
const end = "2026-10-20T15:00:00-03:00";
const event = { lead_id: id, agenda_id: id, inicio: start, fim: end, tipo: "visita", titulo: "Visita", origem: "agente_ia_3c" };
const call = { data: start, duracao_seg: 120, desfecho: "agendado", resumo: "Visita combinada." };

const request = (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => new Request(
  `https://app.faceimob.com.br/functions/v1/integracao-3c${path}`,
  { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
);
const successful = () => vi.fn<ThreeCRpc>().mockResolvedValue({ status: 200, body: { aceito: true } });

describe("contrato HTTP da integração 3C", () => {
  it.each([
    ["GET", `/leads?id=${id}`, undefined, "buscar_lead", { id }],
    ["POST", "/leads", { nome: "Contato de teste", telefone: "5542999999999" }, "criar_lead", { nome: "Contato de teste", telefone: "5542999999999" }],
    ["PATCH", `/leads/${id}`, { etapa_id: "scheduled_visit" }, "atualizar_lead", { id, etapa_id: "scheduled_visit" }],
    ["GET", `/agenda/disponibilidade?inicio=${encodeURIComponent(start)}&fim=${encodeURIComponent(end)}&duracao_min=60&agenda_id=${id}`, undefined,
      "disponibilidade", { inicio: start, fim: end, duracao_min: 60, agenda_id: id }],
    ["POST", "/agenda/eventos", event, "criar_evento", event],
    ["POST", `/leads/${id}/ligacoes`, call, "registrar_ligacao", { id, ...call }],
    ["GET", "/etapas", undefined, "etapas", {}],
    ["GET", "/agendas", undefined, "agendas", {}],
  ])("traduz %s %s para a operação restrita", async (method, path, body, operation, data) => {
    const rpc = successful();
    const response = await handleRequest(request(method as string, path as string, body), rpc);
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith(token, operation, data);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("aceita o prefixo usado pelo runtime self-hosted", async () => {
    const rpc = successful();
    const req = new Request("http://edge/integracao-3c/agendas", { headers: { authorization: `Bearer ${token}` } });
    expect((await handleRequest(req, rpc)).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(token, "agendas", {});
  });

  it("preserva os status e envelopes do contrato, inclusive ausência e conflitos", async () => {
    for (const result of [
      { status: 200, body: { encontrado: false, lead: null } },
      { status: 201, body: { id, criado: true } },
      { status: 409, body: { erro: "HORARIO_OCUPADO", mensagem: "Consulte novamente." } },
      { status: 422, body: { erro: "PERIODO_INVALIDO", mensagem: "Período fora do limite." } },
    ]) {
      const response = await handleRequest(request("GET", `/leads?id=${id}`), vi.fn().mockResolvedValue(result));
      expect(response.status).toBe(result.status);
      expect(await response.json()).toEqual(result.body);
    }
  });

  it.each(["", "Basic abc", "Bearer", "Bearer abc def", `Bearer ${"x".repeat(513)}`])("recusa autorização malformada antes do banco", async (authorization) => {
    const rpc = successful();
    const response = await handleRequest(request("GET", "/agendas", undefined, { authorization }), rpc);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ erro: "CHAVE_INVALIDA", mensagem: "Chave ausente ou inválida." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("pré-voo não executa operação nem exige a chave", async () => {
    const rpc = successful();
    expect((await handleRequest(request("OPTIONS", "/leads", undefined, { authorization: "" }), rpc)).status).toBe(204);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["GET", "/leads", undefined],
    ["GET", `/leads?id=${id}&telefone=5542999999999`, undefined],
    ["GET", `/leads?id=${id}&id=${id}`, undefined],
    ["GET", "/etapas?sql=select", undefined],
    ["PATCH", `/leads/${id}`, {}],
    ["PATCH", `/leads/${id}`, { assigned_to: id }],
    ["PATCH", `/leads/${id}`, { raw_payload: {} }],
    ["POST", "/leads", { nome: "Teste", telefone: "abc" }],
    ["POST", "/leads", { nome: "Teste", telefone: "5542999999999", dados_adicionais: [] }],
    ["POST", `/leads/${id}/ligacoes`, { ...call, duracao_seg: -1 }],
    ["POST", `/leads/${id}/ligacoes`, { ...call, data: "2026-10-20T14:00:00" }],
    ["POST", `/leads/${id}/ligacoes`, { ...call, data: "2026-02-31T14:00:00Z" }],
    ["POST", `/leads/${id}/ligacoes`, { ...call, _idempotency_key: "forjado" }],
    ["POST", "/agenda/eventos", { ...event, agenda_id: "123" }],
    ["POST", "/agenda/eventos", { lead_id: id, agenda_id: id, inicio: start, fim: end, tipo: "visita", titulo: "Sem origem" }],
    ["PATCH", "/leads/123", { observacao: "Teste" }],
  ])("barra dados inválidos sem executar %s %s", async (method, path, body) => {
    const rpc = successful();
    const response = await handleRequest(request(method as string, path as string, body), rpc);
    expect(response.status).toBe(400);
    expect((await response.json()).erro).toBe("DADOS_INVALIDOS");
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([[], null, "texto", { nome: "x".repeat(70000), telefone: "5542999999999" }])("exige objeto e limita o corpo sem depender de Content-Length", async (body) => {
    const rpc = successful();
    expect((await handleRequest(request("POST", "/leads", body), rpc)).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("aceita limpeza explícita de e-mail/notas sem perder o PATCH parcial", async () => {
    const rpc = successful();
    expect((await handleRequest(request("PATCH", `/leads/${id}`, { email: null, observacao: null }), rpc)).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(token, "atualizar_lead", { id, email: null, observacao: null });
  });

  it("normaliza ISO sem segundos antes de chamar a agenda do banco", async () => {
    const rpc = successful();
    const input = { ...event, inicio: "2026-10-20T14:00-03:00", fim: "2026-10-20T15:00-03:00" };
    expect((await handleRequest(request("POST", "/agenda/eventos", input), rpc)).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(token, "criar_evento", { ...event, inicio: start, fim: end });
  });

  it("recebe a duração escolhida pela 3C sem aplicar duração de expediente", async () => {
    const rpc = successful();
    const path = `/agenda/disponibilidade?inicio=${encodeURIComponent(start)}&fim=${encodeURIComponent(end)}&duracao_min=1500`;
    expect((await handleRequest(request("GET", path), rpc)).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(token, "disponibilidade", { inicio: start, fim: end, duracao_min: 1500 });
  });

  it("transmite a chave de repetição somente pelo header e nas operações apropriadas", async () => {
    const rpc = successful();
    expect((await handleRequest(request("POST", "/agenda/eventos", event, { "idempotency-key": "chamada-123-evento" }), rpc)).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(token, "criar_evento", { ...event, _idempotency_key: "chamada-123-evento" });
    rpc.mockClear();
    expect((await handleRequest(request("POST", "/leads", { nome: "Teste", telefone: "5542999999999" }, { "idempotency-key": "nao-aceita" }), rpc)).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("não expõe token nem detalhes internos se o banco falhar", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error(`secret=${token}; relation private.secret does not exist`));
    const response = await handleRequest(request("GET", "/agendas"), rpc);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ erro: "ERRO_INTERNO", mensagem: "Não foi possível concluir a operação." });
  });

  it("recusa rota desconhecida e método não previsto", async () => {
    const rpc = successful();
    expect((await handleRequest(request("GET", "/admin"), rpc)).status).toBe(404);
    expect((await handleRequest(request("DELETE", `/leads/${id}`), rpc)).status).toBe(405);
    expect(rpc).not.toHaveBeenCalled();
  });
});
