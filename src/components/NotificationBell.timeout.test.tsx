import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import NotificationBell from "./NotificationBell";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const h = vi.hoisted(() => ({
  handler: null as null | ((payload: { eventType: string; new: Record<string, unknown> }) => void),
  warning: vi.fn(), error: vi.fn(), navigate: vi.fn(),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => h.navigate }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "corretor" } }) }));
vi.mock("@/integrations/supabase/client", () => {
  const channel = { on: (_event: unknown, _filter: unknown, handler: typeof h.handler) => { h.handler = handler; return channel; }, subscribe: () => channel };
  return { supabase: { channel: () => channel, removeChannel: vi.fn() } };
});
vi.mock("@/components/ui/sonner", () => ({ toast: Object.assign(vi.fn(), { warning: h.warning, error: h.error }) }));
vi.mock("@/components/ui/avisos", () => ({ avisarLead: vi.fn(), avisarQueda: vi.fn() }));
vi.mock("@/lib/push", () => ({ getPushStatus: async () => "off", notifyLocally: async () => undefined }));
vi.mock("@/integrations/supabase/notifications", () => ({
  listMyNotifications: async () => [], countMyUnreadNotifications: async () => 0,
  deleteNotification: vi.fn(), markAllNotificationsRead: vi.fn(), markNotificationRead: vi.fn(),
}));
let root: Root;
afterEach(() => { act(() => root?.unmount()); document.body.innerHTML = ""; vi.clearAllMocks(); });

it("mostra apenas prazo confirmado com nome e orientação, sem erro vermelho ou link inacessível", async () => {
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root.render(<NotificationBell />));
  const notice = { kind: "lead_lost_timeout", title: "Prazo encerrado: Maria", body: "Recebido ontem. Voltou à distribuição; confira Aguardando atendimento.", link: "/leads?lead=fora-da-carteira" };
  await act(async () => h.handler!({ eventType: "INSERT", new: notice }));
  expect(h.warning).toHaveBeenCalledWith(notice.title, expect.objectContaining({ description: notice.body, duration: 15_000 }));
  expect(h.error).not.toHaveBeenCalled();
  h.warning.mock.calls[0][1].action.onClick();
  expect(h.navigate).toHaveBeenCalledWith("/leads");
  await act(async () => h.handler!({ eventType: "UPDATE", new: notice }));
  expect(h.warning).toHaveBeenCalledTimes(1);
});
