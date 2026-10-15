import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SoundUpload } from "./SoundUpload";

const state = vi.hoisted(() => ({ admin: true, upload: vi.fn(), upsert: vi.fn(), remove: vi.fn(), invalidate: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isAdmin: state.admin }) }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: state.invalidate }) }));
vi.mock("@/hooks/useCustomSounds", () => ({
  soundsKey: ["system-sounds"],
  soundsDb: { from: () => ({ upsert: state.upsert }) },
  useCustomSounds: () => ({ data: [], isPending: false, error: null }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { storage: { from: () => ({ upload: state.upload, remove: state.remove }) } } }));
vi.mock("@/lib/engagement/customSounds", () => ({
  SOUND_BUCKET: "system-sounds", AUDIO_TYPES: { "audio/mpeg": "mp3" }, soundDuration: async () => 2,
}));

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  state.admin = true;
  vi.clearAllMocks();
  state.upload.mockResolvedValue({ error: null });
  state.upsert.mockResolvedValue({ error: null });
  state.invalidate.mockResolvedValue(undefined);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("crypto", { randomUUID: () => "00000000-0000-0000-0000-000000000001" });
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

async function chooseAndSave() {
  await act(async () => root.render(<SoundUpload id="checkin" label="Check-in" />));
  const input = host.querySelector("input")!;
  Object.defineProperty(input, "files", { value: [new File(["som"], "meu-som.mp3", { type: "audio/mpeg" })] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  expect(host.querySelector("audio")?.getAttribute("src")).toBe("blob:preview");
  await act(async () => host.querySelector("button")!.click());
}

describe("tela de upload de som", () => {
  it("envia o arquivo e só então grava a escolha para a equipe", async () => {
    await chooseAndSave();
    expect(state.upload).toHaveBeenCalledOnce();
    expect(state.upsert).toHaveBeenCalledWith(expect.objectContaining({ sound_id: "checkin", file_name: "meu-som.mp3", duration: 2 }));
    expect(host.textContent).toContain("Som salvo para toda a equipe");
    expect(state.invalidate).toHaveBeenCalled();
  });
  it("falha de upload não altera a escolha nem informa sucesso", async () => {
    state.upload.mockResolvedValue({ error: new Error("offline") });
    await chooseAndSave();
    expect(state.upsert).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Não foi possível salvar");
  });
  it("resposta perdida ao salvar preserva o arquivo e pede conferência", async () => {
    state.upsert.mockResolvedValue({ error: new Error("resposta perdida") });
    await chooseAndSave();
    expect(state.remove).not.toHaveBeenCalled();
    expect(host.textContent).toContain("não foi possível confirmar");
  });
  it("corretor não recebe controles de envio", async () => {
    state.admin = false;
    await act(async () => root.render(<SoundUpload id="checkin" label="Check-in" />));
    expect(host.querySelector("input")).toBeNull();
  });
});
