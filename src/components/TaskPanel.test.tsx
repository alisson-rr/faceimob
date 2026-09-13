import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { TaskRecord } from "@/integrations/supabase/activities";
import TaskPanel from "./TaskPanel";

/**
 * Concluir atividade só avisa sucesso quando o banco gravou.
 *
 * `setTaskStatus` não pede a linha de volta, e update barrado pelo RLS volta
 * sem erro: o sócio vê a atividade de qualquer um, mas `tasks_write` não o
 * deixa alterar. "Atividade concluída" com a atividade ainda aberta é pior que
 * o erro.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "eu" } }) }));

const avisos = vi.hoisted(() => ({ success: [] as string[], error: [] as string[] }));
vi.mock("@/components/ui/sonner", () => ({
  toast: Object.assign(() => undefined, {
    success: (mensagem: string) => { avisos.success.push(mensagem); },
    error: (mensagem: string) => { avisos.error.push(mensagem); },
    warning: () => undefined,
  }),
}));

/** O banco de mentira: `gravou = false` imita o update que o RLS ignora. */
const banco = vi.hoisted(() => ({ gravou: true, status: "open" }));
vi.mock("@/integrations/supabase/activities", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  listTasksFor: async () => [tarefa(banco.status)],
  setTaskStatus: async (_id: string, status: string) => { if (banco.gravou) banco.status = status; },
}));

function tarefa(status: string) {
  return { id: "t1", title: "Retornar ligação", status, due_at: null, priority: "normal" } as unknown as TaskRecord;
}

/** Deixa terminar a cadeia de promessas (gravar, reler, avisar). */
const assentar = () => new Promise((resolve) => setTimeout(resolve, 0));

async function concluir() {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () => { root.render(<TaskPanel refType="lead" refId="l1" />); await assentar(); });
  const botao = container.querySelector<HTMLButtonElement>('button[aria-label="Concluir Retornar ligação"]');
  expect(botao).not.toBeNull();
  await act(async () => { botao?.click(); await assentar(); });
  await act(async () => { root.unmount(); });
  container.remove();
}

describe("TaskPanel · concluir atividade", () => {
  afterEach(() => {
    avisos.success.length = 0;
    avisos.error.length = 0;
    banco.status = "open";
  });

  it("avisa sucesso quando a lista relida mostra a atividade concluída", async () => {
    banco.gravou = true;
    await concluir();
    expect(avisos.success).toEqual(["Atividade concluída"]);
    expect(avisos.error).toEqual([]);
  });

  it("avisa erro, e não sucesso, quando o update não gravou nada", async () => {
    banco.gravou = false;
    await concluir();
    expect(avisos.success).toEqual([]);
    expect(avisos.error).toEqual(["Não foi possível concluir a atividade"]);
  });
});
