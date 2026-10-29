import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { CcaDevolverDialog } from "./CcaDevolverDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const rpc = vi.hoisted(() => vi.fn(async () => ({ error: null })));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("@/components/ui/sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); document.body.innerHTML = ""; rpc.mockClear(); });

it("explica a perda do avanço e orienta pendenciar sem executar a devolução", async () => {
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => { root!.render(<CcaDevolverDialog deal={{ dealId: "d1", client: "Cliente" }} onClose={() => undefined} onDone={() => undefined} />); });
  expect(document.body.textContent).toContain("invalida a aprovação anterior");
  expect(document.body.querySelector('[role="alert"]')?.textContent).toContain("pendente na etapa atual");
  const confirm = [...document.body.querySelectorAll("button")].find((button) => button.textContent === "Devolver ao comercial");
  expect(confirm?.disabled).toBe(true);
  expect(rpc).not.toHaveBeenCalled();
});
