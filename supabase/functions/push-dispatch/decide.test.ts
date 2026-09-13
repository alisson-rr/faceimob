// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MAX_FAILURES, notificationChange, outcomeOf, subscriptionChange } from "./decide.ts";

const agora = "2026-09-12T21:15:00.000Z";

describe("status do serviço de push → desfecho do aparelho", () => {
  it("só 404/410 descartam na hora e só 400/401/403 contam falha do aparelho", () => {
    expect(outcomeOf(201)).toBe("ok");
    expect(outcomeOf(404)).toBe("gone");
    expect(outcomeOf(410)).toBe("gone");
    for (const status of [400, 401, 403]) expect(outcomeOf(status)).toBe("rejected");
    for (const status of [413, 429, 500, 502, 503, null]) expect(outcomeOf(status)).toBe("transient");
  });
});

describe("assinatura depois do lote", () => {
  it("instabilidade do serviço de push nunca apaga nem conta falha, mesmo com o contador no limite", () => {
    expect(subscriptionChange(["transient", "transient"], MAX_FAILURES - 1, agora)).toBeNull();
  });

  it("recusa conta uma falha por lote e descarta na décima seguida", () => {
    expect(subscriptionChange(["rejected", "rejected"], 3, agora)).toEqual({ failures: 4 });
    expect(subscriptionChange(["rejected", "transient"], MAX_FAILURES - 1, agora)).toBe("delete");
  });

  it("entrega zera as falhas e 404/410 descarta", () => {
    expect(subscriptionChange(["rejected", "ok"], 7, agora)).toEqual({ last_success_at: agora, failures: 0 });
    expect(subscriptionChange(["ok", "gone"], 0, agora)).toBe("delete");
  });
});

describe("notificação depois do lote", () => {
  it("todos os aparelhos tratados (entregue ou descartado) encerra o push", () => {
    expect(notificationChange({
      doneSubs: [],
      deliveries: [
        { subscriptionId: "a", outcome: "ok", detail: "HTTP 201 em fcm.googleapis.com" },
        { subscriptionId: "b", outcome: "gone", detail: "HTTP 410 em web.push.apple.com" },
      ],
      attempt: 1,
      now: agora,
    })).toEqual({ push_sent_at: agora, push_error: null });
  });

  it("com um aparelho falhando, guarda quem já recebeu e não solta a reivindicação", () => {
    const change = notificationChange({
      doneSubs: ["celular-antigo"],
      deliveries: [
        { subscriptionId: "celular", outcome: "ok", detail: "HTTP 201 em fcm.googleapis.com" },
        { subscriptionId: "notebook", outcome: "rejected", detail: "HTTP 403 em wns2.notify.windows.com" },
        { subscriptionId: "firefox", outcome: "transient", detail: "sem resposta de updates.push.services.mozilla.com" },
      ],
      attempt: 2,
      now: agora,
    });
    expect(change).toEqual({
      push_done_subs: ["celular-antigo", "celular"],
      push_error: "tentativa 2: HTTP 403 em wns2.notify.windows.com; sem resposta de updates.push.services.mozilla.com",
    });
    expect(change).not.toHaveProperty("push_claimed_at");
    expect(change).not.toHaveProperty("push_sent_at");
  });

  it("carga grande demais encerra o push sem tocar em aparelho", () => {
    expect(notificationChange({ doneSubs: [], deliveries: null, attempt: 1, now: agora }))
      .toEqual({ push_sent_at: agora, push_error: "carga acima do limite do push: o aviso ficou só no sino" });
  });
});
