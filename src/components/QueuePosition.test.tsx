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
vi.mock("@/integrations/supabase/checkin", () => ({
  getMyQueues: (...args: unknown[]) => filas(...args),
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
  sessao.user = { id: "eu" };
});

describe("QueuePosition", () => {
  it("na fila, diz a posição e o tamanho dela", async () => {
    filas.mockResolvedValue(grupo([
      { profile_id: "outro", full_name: "Ana", queue_position: 1 },
      { profile_id: "eu", full_name: "Eu", queue_position: 2 },
    ]));
    const { container, cleanup } = await render(<QueuePosition checkedIn opensAt="08:30" />);

    expect(container.textContent).toMatch(/você é o 2º de 2/i);
    // O critério de ordem aparece junto: sem ele o corretor perde a vez e não
    // entende por quê.
    expect(container.textContent).toMatch(/há mais tempo sem receber/i);
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

  it("bloqueado por atrasados, explica o bloqueio em vez do horário", async () => {
    // A fila usa a mesma trava do check-in (0014): dizer "a fila abre às 08:30"
    // embaixo do banner de bloqueio seria mentira.
    filas.mockResolvedValue(grupo([]));
    const { container, cleanup } = await render(
      <QueuePosition checkedIn opensAt="08:30" blocked />,
    );

    expect(container.textContent).toMatch(/leads atrasados demais/i);
    expect(container.textContent).not.toMatch(/a fila abre/i);
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
    expect(container.textContent).toMatch(/você é o 1º de 1/i);
    await cleanup();
  });
});
