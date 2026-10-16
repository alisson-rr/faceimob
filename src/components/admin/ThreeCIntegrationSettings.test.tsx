import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IntegrationRecord } from "@/integrations/supabase/integrations";

const api = vi.hoisted(() => ({ configure: vi.fn(), rotate: vi.fn(), options: vi.fn() }));
vi.mock("@/integrations/supabase/threeC", async (original) => ({
  ...(await original<typeof import("@/integrations/supabase/threeC")>()),
  configureThreeC: api.configure, rotateThreeCToken: api.rotate, listThreeCOptions: api.options,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
import { emptyThreeCConfig } from "@/integrations/supabase/threeC";
import { ThreeCIntegrationSettings } from "./ThreeCIntegrationSettings";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
const changed = vi.fn(async () => {});
const revoked = vi.fn();
const button = (text: RegExp) => Array.from(container.querySelectorAll("button")).find((element) => text.test(element.textContent || ""))!;
const inputFor = (label: string) => {
  const element = Array.from(container.querySelectorAll("label")).find((candidate) => candidate.textContent === label)!;
  return document.getElementById(element.htmlFor) as HTMLInputElement;
};
const setValue = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const record = (): IntegrationRecord => ({
  id: "cred", provider: "3c", label: "api_token", active: true, has_secret: true,
  config: { ...emptyThreeCConfig(), integration_user_id: "tecnico-servidor" }, updated_at: null,
});
const render = async (integration?: IntegrationRecord) => {
  await act(async () => { root.render(<ThreeCIntegrationSettings integration={integration} canManage onChanged={changed} onRevoke={revoked} />); });
};

beforeEach(() => {
  vi.clearAllMocks();
  api.options.mockResolvedValue({ groups: [{ id: "g", name: "Grupo permitido" }], brokers: [{ id: "b", name: "Corretora Ana" }] });
  api.configure.mockImplementation(async (config) => config);
  api.rotate.mockResolvedValue("nova-chave-apenas-no-estado");
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe("painel da 3C", () => {
  it("mostra somente acesso e impede ativação sem escopos", async () => {
    await render();
    expect(container.querySelector('input[type="number"]')).toBeNull();
    expect(container.querySelector('input[type="time"]')).toBeNull();
    expect(container.querySelector<HTMLButtonElement>('[role="switch"]')?.disabled).toBe(true);
    expect(container.textContent).toContain("Corretora Ana");
  });

  it("permite salvar configuração desligada e mantém identidade somente leitura", async () => {
    await render(record());
    expect(inputFor("Identidade da integração").readOnly).toBe(true);
    expect(inputFor("Identidade da integração").value).toBe("tecnico-servidor");
    await act(async () => button(/Salvar configuração 3C/).click());
    expect(api.configure).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, integration_user_id: "tecnico-servidor" }));
  });

  it("libera ativação com chave e escopos sem pedir regras de atendimento", async () => {
    const integration = record();
    integration.config = { ...integration.config, allowed_group_ids: ["g"], default_group_id: "g", agenda_ids: ["b"] };
    await render(integration);
    const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(toggle.disabled).toBe(false);
    await act(async () => toggle.click());
    await act(async () => button(/Salvar configuração 3C/).click());
    expect(api.configure).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, integration_user_id: "tecnico-servidor", agenda_ids: ["b"] }));
  });

  it("rotação preserva rascunho, mostra chave uma vez e não a recupera ao remontar", async () => {
    const integration = record();
    await render(integration);
    await setValue(inputFor("Desfechos aceitos (separados por vírgula)"), "agendado, pediu_retorno");
    await act(async () => button(/Gerar nova chave 3C/).click());
    expect(api.rotate).toHaveBeenCalledOnce();
    expect(inputFor("Chave nova — exibida somente agora").value).toBe("nova-chave-apenas-no-estado");
    await render({ ...integration, config: { ...integration.config } });
    expect(inputFor("Desfechos aceitos (separados por vírgula)").value).toBe("agendado, pediu_retorno");
    await act(async () => button(/Já guardei a chave/).click());
    expect(container.textContent).not.toContain("exibida somente agora");
    await act(async () => root.render(null));
    await render(integration);
    expect(container.querySelector('input[value="nova-chave-apenas-no-estado"]')).toBeNull();
  });

  it("primeira chave preserva as escolhas quando o refresh cria o registro com config vazio", async () => {
    const created = { ...record(), config: {} };
    changed.mockImplementationOnce(async () => {
      root.render(<ThreeCIntegrationSettings integration={created} canManage onChanged={changed} onRevoke={revoked} />);
    });
    await render();
    const checkbox = (label: string) => Array.from(container.querySelectorAll("label"))
      .find((element) => element.textContent === label)!.querySelector<HTMLInputElement>("input")!;
    await act(async () => checkbox("Grupo permitido").click());
    const entryGroup = container.querySelector<HTMLSelectElement>("select")!;
    expect(entryGroup.value).toBe("");
    await act(async () => {
      entryGroup.value = "g";
      entryGroup.dispatchEvent(new Event("change", { bubbles: true }));
      checkbox("Corretora Ana").click();
    });
    await setValue(inputFor("Desfechos aceitos (separados por vírgula)"), "agendado, pediu_retorno");
    await act(async () => button(/Gerar chave 3C/).click());
    expect(api.rotate).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalledOnce();
    expect(checkbox("Grupo permitido").checked).toBe(true);
    expect(entryGroup.value).toBe("g");
    expect(checkbox("Corretora Ana").checked).toBe(true);
    expect(inputFor("Desfechos aceitos (separados por vírgula)").value).toBe("agendado, pediu_retorno");
    expect(container.querySelectorAll('input[value="nova-chave-apenas-no-estado"]')).toHaveLength(1);
    await act(async () => button(/Salvar configuração 3C/).click());
    expect(api.configure).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      enabled: false, allowed_group_ids: ["g"], default_group_id: "g", agenda_ids: ["b"],
      outcomes: ["agendado", "pediu_retorno"],
    }));
    await act(async () => button(/Já guardei a chave/).click());
    expect(container.querySelector('input[value="nova-chave-apenas-no-estado"]')).toBeNull();
  });

  it("remove seleções indisponíveis somente do rascunho e limpa o grupo de entrada removido", async () => {
    const integration = record();
    integration.config = {
      ...integration.config, allowed_group_ids: ["g", "grupo-inativo"], default_group_id: "grupo-inativo",
      agenda_ids: ["b", "corretor-suspenso"],
    };
    await render(integration);
    expect(container.textContent).toContain("1 grupo e 1 agenda");
    await act(async () => button(/Remover seleções indisponíveis/).click());
    expect(api.configure).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Seleções indisponíveis:");
    await act(async () => button(/Salvar configuração 3C/).click());
    expect(api.configure).toHaveBeenCalledWith(expect.objectContaining({
      allowed_group_ids: ["g"], default_group_id: null, agenda_ids: ["b"],
    }));
    expect(integration.config).toMatchObject({
      allowed_group_ids: ["g", "grupo-inativo"], default_group_id: "grupo-inativo", agenda_ids: ["b", "corretor-suspenso"],
    });
  });
});
