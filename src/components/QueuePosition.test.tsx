import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import QueuePosition from "./QueuePosition";

/**
 * Os seis estados de texto da posição na fila.
 *
 * Este indicador é a resposta a "por que eu não recebi lead?", e cada frase
 * manda o corretor fazer uma coisa diferente: bater ponto, esperar o horário,
 * regularizar atrasados, ou procurar o gestor. Trocar uma pela outra é mandar
 * resolver o problema errado — e até aqui nada verificava as frases sem
 * depender da hora do relógio e de um banco de verdade.
 *
 * Sem @testing-library no projeto: o render é o do react-dom, como em
 * `components/leads/cards.test.tsx`.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sessao = { user: { id: "eu" } as { id: string } | null };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => sessao }));

// O realtime não participa destes casos: o canal é um objeto inerte.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: () => {
      const chain = { on: () => chain, subscribe: () => chain };
      return chain;
    },
    removeChannel: () => undefined,
  },
}));

const filas = vi.fn();
const andamento = vi.fn();
const entregas = vi.fn();
vi.mock("@/integrations/supabase/checkin", () => ({
  getMyQueues: (...args: unknown[]) => filas(...args),
  getMinhaFilaAndamento: () => andamento(),
  getEntregasDoTurno: () => entregas(),
}));

async function render(ui: ReactNode) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () => { root.render(ui); });
  // Um tique para a consulta da fila resolver antes de ler a tela.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const cleanup = async () => {
    await act(async () => { root.unmount(); });
    container.remove();
  };
  return { container, cleanup };
}

const grupo = (entries: { profile_id: string; full_name: string; queue_position: number }[]) => [{
  groupId: "g1",
  groupName: "Fila Geral",
  entries: entries.map((entry) => ({ ...entry, last_assigned_at: null })),
}];

beforeEach(() => {
  filas.mockReset();
  andamento.mockReset();
  andamento.mockResolvedValue([]);
  entregas.mockReset();
  entregas.mockResolvedValue(new Map());
  sessao.user = { id: "eu" };
});

describe("QueuePosition", () => {
  it("mostra quantos leads o grupo recebeu no turno (03/11/2026)", async () => {
    filas.mockResolvedValue(grupo([{ profile_id: "eu", full_name: "Eu", queue_position: 3 }]));
    entregas.mockResolvedValue(new Map([["g1", 12]]));
    const { container, cleanup } = await render(<QueuePosition checkedIn opensAt="08:30" />);

    expect(container.textContent).toMatch(/12 leads entregues neste turno/);
    await cleanup();
  });

  it("conta o que mandou o corretor para o fim da fila (03/11/2026)", async () => {
    filas.mockResolvedValue(grupo([{ profile_id: "eu", full_name: "Eu", queue_position: 8 }]));
    andamento.mockResolvedValue([
      { ocorreu_em: "2026-11-03T17:10:00Z", tipo: "prazo_vencido", detalhe: "Maria" },
      { ocorreu_em: "2026-11-03T16:42:00Z", tipo: "recebeu", detalhe: "Maria" },
      { ocorreu_em: "2026-11-03T15:00:00Z", tipo: "desbloqueado", detalhe: null },
    ]);
    const { container, cleanup } = await render(<QueuePosition checkedIn opensAt="08:30" />);

    expect(container.textContent).toMatch(/andamento da sua fila hoje/i);
    expect(container.textContent).toMatch(/14:10Perdeu o prazo de Maria: o lead voltou para a roleta e você foi para o fim/);
    expect(container.textContent).toMatch(/Regularizou os atrasados: o próximo check-in está liberado/);
    await cleanup();
  });

  it("na fila, diz a posição e o tamanho dela", async () => {
    filas.mockResolvedValue(grupo([
      { profile_id: "outro", full_name: "Ana", queue_position: 1 },
      { profile_id: "eu", full_name: "Eu", queue_position: 2 },
    ]));
    const { container, cleanup } = await render(<QueuePosition checkedIn opensAt="08:30" />);

    expect(container.textContent).toMatch(/você é o 2º de 2/i);
    // O critério de ordem aparece junto: sem ele o corretor perde a vez e não
    // entende por quê.
    expect(container.textContent).toMatch(/ordem de chegada/i);
    await cleanup();
  });

  it("sem check-in, manda bater ponto — não diz que a fila está fechada", async () => {
    filas.mockResolvedValue(grupo([]));
    const { container, cleanup } = await render(<QueuePosition checkedIn={false} opensAt="08:30" />);

    expect(container.textContent).toMatch(/é preciso estar em check-in/i);
    await cleanup();
  });

  it("com check-in e fila ainda fechada, diz a que horas ela abre", async () => {
    filas.mockResolvedValue(grupo([]));
    const { container, cleanup } = await render(<QueuePosition checkedIn opensAt="08:30" />);

    expect(container.textContent).toMatch(/a fila abre às 08:30/i);
    await cleanup();
  });

  it("sem horário conhecido, não inventa uma hora", async () => {
    filas.mockResolvedValue(grupo([]));
    const { container, cleanup } = await render(<QueuePosition checkedIn opensAt={null} />);

    expect(container.textContent).toMatch(/no horário de distribuição do turno/i);
    await cleanup();
  });

  it("com atrasados demais, avisa que só o próximo check-in trava (0317)", async () => {
    // Desde a 0317 os atrasos não tiram da fila: a fila abre normalmente hoje.
    filas.mockResolvedValue(grupo([]));
    const { container, cleanup } = await render(
      <QueuePosition checkedIn opensAt="08:30" blocked />,
    );

    expect(container.textContent).toMatch(/próximo check-in fica travado/i);
    expect(container.textContent).toMatch(/a fila abre às 08:30/i);
    await cleanup();
  });

  it("fora de qualquer grupo, diz isso — e não 'fila vazia'", async () => {
    filas.mockResolvedValue([]);
    const { container, cleanup } = await render(<QueuePosition checkedIn opensAt="08:30" />);

    expect(container.textContent).toMatch(/não está em nenhum grupo de distribuição/i);
    await cleanup();
  });

  it("erro na consulta mostra o motivo E o botão de tentar de novo", async () => {
    // O estado de erro era um `<p>` sem saída: o corretor ficava sem a própria
    // posição e sem como reconsultar, a não ser recarregando a página.
    filas.mockRejectedValueOnce(Object.assign(new Error("fila"), {
      db: { code: "P0001", message: "A fila não respondeu agora." },
    }));
    const { container, cleanup } = await render(<QueuePosition checkedIn opensAt="08:30" />);

    expect(container.textContent).toMatch(/a fila não respondeu agora/i);
    const retry = [...container.querySelectorAll("button")]
      .find((button) => /tentar de novo/i.test(button.textContent ?? ""));
    expect(retry, "erro sem retry deixa o corretor sem saída").toBeTruthy();

    // E o botão consulta de novo — de verdade.
    filas.mockResolvedValue(grupo([{ profile_id: "eu", full_name: "Eu", queue_position: 1 }]));
    await act(async () => { retry?.click(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(container.textContent).toMatch(/você é o 1º/i);
    await cleanup();
  });
});
