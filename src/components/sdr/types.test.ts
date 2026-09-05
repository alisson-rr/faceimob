import { describe, expect, it } from "vitest";
import {
  cadeiaDeAgentes, conversaParada, efeitosDaExclusao, efeitosDaExclusaoTemplate, resumoDisparo,
  situacaoLista, type ListStats,
} from "./types";

const stats = (p: Partial<ListStats>): ListStats =>
  ({ total: 0, pending: 0, sent: 0, replied: 0, failed: 0, ...p });

describe("situacaoLista", () => {
  it("não chama de rascunho a lista que já disparou e ainda tem fila", () => {
    // O defeito que motivou a função: o broadcast grava 'draft' sempre que
    // sobra fila, então 500 enviados voltavam a aparecer como "nunca enviada".
    const s = situacaoLista("draft", stats({ total: 700, pending: 200, sent: 500 }));
    expect(s.label).toBe("Envio parcial · 200 na fila");
    expect(s.tone).toBe("warning");
  });

  it("uma falha em 500 não marca a lista inteira como falha", () => {
    const s = situacaoLista("failed", stats({ total: 500, sent: 499, failed: 1 }));
    expect(s.label).toBe("Concluída com 1 falha(s)");
    expect(s.tone).toBe("warning");
  });

  it("disparo em que nada saiu é vermelho e diz isso", () => {
    const s = situacaoLista("failed", stats({ total: 500, failed: 500 }));
    expect(s.label).toBe("Nenhum envio saiu · 500 falhas");
    expect(s.tone).toBe("danger");
  });

  it("lista importada e nunca disparada continua rascunho", () => {
    expect(situacaoLista("draft", stats({ total: 30, pending: 30 })).label).toBe("Rascunho · nada enviado");
  });

  it("respondidos contam como envio concluído", () => {
    const s = situacaoLista("done", stats({ total: 10, sent: 7, replied: 3 }));
    expect(s).toEqual({ label: "Concluída", tone: "success" });
  });

  it("'running' é o único estado que só a coluna conhece", () => {
    expect(situacaoLista("running", stats({ total: 10, pending: 10 })).label).toBe("Disparando…");
  });

  it("lista sem contato nenhum não finge conclusão", () => {
    expect(situacaoLista("done", stats({})).label).toBe("Sem contatos");
  });
});

describe("resumoDisparo", () => {
  it("500 falhas e nenhum envio não podem virar toast verde", () => {
    const r = resumoDisparo({ sent: 0, failed: 500, remaining: 0 });
    expect(r.tom).toBe("error");
    expect(r.titulo).toContain("500 falhas");
    // "Nenhum contato pendente" num disparo em que tudo falhou é verdade
    // técnica e mentira prática.
    expect(r.descricao).not.toContain("Nenhum contato pendente");
  });

  it("envio com falhas parciais avisa onde ler o motivo", () => {
    const r = resumoDisparo({ sent: 480, failed: 20, remaining: 0 });
    expect(r.tom).toBe("warning");
    expect(r.descricao).toContain("falhou");
  });

  it("lote cheio avisa que sobrou fila", () => {
    const r = resumoDisparo({ sent: 500, failed: 0, remaining: 130 });
    expect(r.tom).toBe("success");
    expect(r.descricao).toContain("130");
  });

  it("disparo sem nada a enviar não é sucesso", () => {
    expect(resumoDisparo({ sent: 0, failed: 0, remaining: 0 }).tom).toBe("warning");
  });
});

describe("efeitosDaExclusao", () => {
  const agents = [
    { id: "a", handoff_to_agent_id: null },
    { id: "b", handoff_to_agent_id: "a" },
    { id: "c", handoff_to_agent_id: "a" },
  ];

  it("nomeia origem e lista órfãs, que é o efeito que a operação sente", () => {
    // O aviso antigo contava só agentes encadeados. Origem sem agente manda o
    // lead direto para a roleta e lista sem agente deixa a resposta sem robô —
    // as duas coisas somem em silêncio porque as FKs são ON DELETE SET NULL.
    const out = efeitosDaExclusao("a", {
      agents,
      sources: [{ sdr_agent_id: "a" }, { sdr_agent_id: "a" }, { sdr_agent_id: "z" }],
      lists: [{ agent_id: "a" }],
    });
    expect(out).toEqual([
      "2 origens de lead",
      "1 lista de remarketing",
      "2 agentes encadeados nele",
    ]);
  });

  it("não conta o próprio agente como encadeado nele mesmo", () => {
    const out = efeitosDaExclusao("a", {
      agents: [{ id: "a", handoff_to_agent_id: "a" }],
      sources: [],
      lists: [],
    });
    expect(out).toEqual([]);
  });

  it("lista vazia quando nada aponta para ele — e a tela não pode dizer que perde vínculo", () => {
    expect(efeitosDaExclusao("x", { agents, sources: [{ sdr_agent_id: "a" }], lists: [{ agent_id: null }] }))
      .toEqual([]);
  });
});

describe("conversaParada", () => {
  const agora = Date.parse("2026-09-02T12:00:00Z");
  const horasAtras = (h: number) => new Date(agora - h * 3_600_000).toISOString();
  const conversa = (status: string, ultimaMensagem: string | null, atualizada = ultimaMensagem) =>
    ({ status, last_message_at: ultimaMensagem, updated_at: atualizada });

  it("conversa ativa sem resposta há mais de 6 h é marcada como parada", () => {
    const r = conversaParada(conversa("active", horasAtras(7)), agora);
    expect(r).toEqual({ parada: true, horas: 7, rotulo: "parada há 7 h" });
  });

  it("abaixo do corte não vira selo — senão toda conversa em andamento seria alarme", () => {
    expect(conversaParada(conversa("active", horasAtras(2)), agora)?.parada).toBe(false);
  });

  it("acima de um dia conta em dias, não em 39 h", () => {
    expect(conversaParada(conversa("human", horasAtras(39)), agora)?.rotulo).toBe("parada há 1 dia");
    expect(conversaParada(conversa("human", horasAtras(50)), agora)?.rotulo).toBe("parada há 2 dias");
  });

  it("conversa encerrada não é 'parada': ninguém espera resposta nela", () => {
    expect(conversaParada(conversa("qualified", horasAtras(200)), agora)).toBeNull();
    expect(conversaParada(conversa("handed_off", horasAtras(200)), agora)).toBeNull();
  });

  it("sem data utilizável devolve null em vez de NaN na tela", () => {
    expect(conversaParada(conversa("active", null, null), agora)).toBeNull();
    expect(conversaParada(conversa("active", "não é data"), agora)).toBeNull();
  });

  // O defeito que trouxe `last_message_at` para cá: "Assumir conversa" grava
  // `status='human'`, o trigger carimba `updated_at`, e o selo "parada há 3
  // dias" sumia sem ninguém ter falado com o lead — apagando o sinal que fez o
  // operador assumir a conversa.
  it("assumir a conversa não zera o relógio: quem conta é a última mensagem", () => {
    const assumidaAgora = conversa("human", horasAtras(72), horasAtras(0));
    expect(conversaParada(assumidaAgora, agora)?.rotulo).toBe("parada há 3 dias");
  });

  it("sem last_message_at (histórico anterior ao trigger) ainda usa updated_at", () => {
    expect(conversaParada({ status: "active", last_message_at: null, updated_at: horasAtras(8) }, agora)?.parada)
      .toBe(true);
  });
});

describe("efeitosDaExclusaoTemplate", () => {
  const dados = {
    sources: [{ welcome_template_id: "t1" }, { welcome_template_id: "t1" }, { welcome_template_id: null }],
    lists: [{ template_id: "t1" }, { template_id: "t2" }],
  };

  it("conta quantas origens e listas ficam sem template — o número é o que decide", () => {
    expect(efeitosDaExclusaoTemplate("t1", dados)).toEqual(["2 origens de lead", "1 lista de remarketing"]);
  });

  it("template que ninguém usa não inventa efeito nenhum", () => {
    expect(efeitosDaExclusaoTemplate("t9", dados)).toEqual([]);
  });

  it("singular e plural conforme a contagem", () => {
    expect(efeitosDaExclusaoTemplate("t2", dados)).toEqual(["1 lista de remarketing"]);
  });
});

describe("cadeiaDeAgentes", () => {
  const nome = (id: string) => ({ o: "Orquestrador", q: "Qualificador", cr: "Crédito" }[id] ?? "removido");

  it("mostra a passagem pelo orquestrador que sdr_conversations.agent_id apaga", () => {
    const cadeia = cadeiaDeAgentes(
      [{ agent_id: null }, { agent_id: "o" }, { agent_id: null }, { agent_id: "q" }, { agent_id: "cr" }],
      nome,
    );
    expect(cadeia).toEqual(["Orquestrador", "Qualificador", "Crédito"]);
  });

  it("não repete o mesmo agente em turnos seguidos", () => {
    expect(cadeiaDeAgentes([{ agent_id: "q" }, { agent_id: "q" }, { agent_id: "q" }], nome)).toEqual(["Qualificador"]);
  });

  it("histórico anterior à 0082 (sem agent_id) não inventa cadeia", () => {
    expect(cadeiaDeAgentes([{ agent_id: null }, { agent_id: undefined }], nome)).toEqual([]);
  });
});
