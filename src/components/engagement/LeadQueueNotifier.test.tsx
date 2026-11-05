import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LeadQueueNotifier } from "./LeadQueueNotifier";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({
  data: [] as { groupId: string; groupName: string; entries: { profile_id: string; queue_position: number }[] }[],
}));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn() }));
const playSound = vi.hoisted(() => vi.fn());
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "broker" }, role: "broker" }) }));
vi.mock("@/hooks/useMyQueues", () => ({ useMyQueues: () => ({ data: state.data, isSuccess: true }) }));
vi.mock("@/components/ui/sonner", () => ({ toast }));
vi.mock("@/lib/engagement/audio", () => ({ playSound }));

let root: Root;
let container: HTMLDivElement;
const positions = (...values: number[]) => {
  state.data = values.map((position, index) => ({
    groupId: String(index), groupName: `Grupo ${index}`,
    entries: [{ profile_id: "broker", queue_position: position }],
  }));
};
const render = async (paused = false) => {
  await act(async () => { root.render(<LeadQueueNotifier paused={paused} />); });
};
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

it("não empilha avisos de três grupos ao entrar, mesmo com posições antigas salvas", async () => {
  localStorage.setItem("faceimob-lead-queue-position:broker", JSON.stringify({ 0: 9 }));
  positions(1, 2, 3);
  await render();
  expect(toast).not.toHaveBeenCalled();
  expect(playSound).not.toHaveBeenCalled();
});

it("avisa mudanças no canto, sem cobrir o atendimento no centro", async () => {
  positions(2);
  await render();
  positions(1);
  await render();
  expect(toast).toHaveBeenCalledWith(expect.stringContaining("próximo"), expect.objectContaining({ position: "top-right" }));
  expect(playSound).toHaveBeenCalledWith("leadNew");
});

it("remove avisos de posição e não os repete depois de pegar o lead", async () => {
  positions(2, 3);
  await render();
  positions(1, 2);
  await render();
  toast.mockClear();
  playSound.mockClear();
  positions(8, 9);
  await render(true);
  expect(toast.dismiss).toHaveBeenCalledWith("lead-queue-0");
  expect(toast.dismiss).toHaveBeenCalledWith("lead-queue-1");
  await render(false);
  expect(toast).not.toHaveBeenCalled();
  expect(playSound).not.toHaveBeenCalled();
});
