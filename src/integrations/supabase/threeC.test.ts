import { beforeEach, describe, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ rpc: vi.fn(), list: vi.fn(), secret: vi.fn() }));
vi.mock("./client", () => ({ supabase: { rpc: calls.rpc } }));
vi.mock("./integrations", () => ({ listIntegrations: calls.list, setIntegrationSecret: calls.secret }));
import { configureThreeC, emptyThreeCConfig, listThreeCOptions, loadThreeCIntegration, rotateThreeCToken, threeCConfig, threeCConfigProblem } from "./threeC";

beforeEach(() => { vi.clearAllMocks(); });

describe("configuração da 3C", () => {
  it("carrega opções mínimas pela permissão da integração em uma única RPC", async () => {
    const options = { groups: [{ id: "g", name: "Grupo" }], brokers: [{ id: "b", name: "Corretora" }] };
    calls.rpc.mockResolvedValue({ data: options, error: null });
    expect(await listThreeCOptions()).toEqual(options);
    expect(calls.rpc).toHaveBeenCalledExactlyOnceWith("integracao_3c_options");
  });
  it("configura somente acesso e desfechos, começando desligada", () => {
    const config = emptyThreeCConfig();
    expect(Object.keys(config).sort()).toEqual(["agenda_ids", "allowed_group_ids", "default_group_id", "enabled", "integration_user_id", "outcomes"]);
    expect(config.enabled).toBe(false);
    expect(threeCConfigProblem(config)).toMatch(/grupos/i);
  });

  it("exige apenas escopos válidos para habilitar o acesso", () => {
    const config = { ...emptyThreeCConfig(), allowed_group_ids: ["g"], default_group_id: "g", agenda_ids: ["b"] };
    expect(threeCConfigProblem(config)).toBeNull();
    expect(threeCConfigProblem({ ...config, default_group_id: "outro" })).toMatch(/entrada/i);
    expect(threeCConfigProblem({ ...config, agenda_ids: [] })).toMatch(/agenda/i);
    expect(threeCConfig({ config: { ...config, metadata_externo: true } })).toEqual(config);
  });

  it("lê o estado sem pedir o segredo e não deixa o formulário trocar a identidade", async () => {
    calls.list.mockResolvedValue([{ provider: "outro", label: "api_token" }, { provider: "3c", label: "api_token", has_secret: true, config: { enabled: false } }]);
    expect(await loadThreeCIntegration()).toMatchObject({ provider: "3c", has_secret: true });
    const config = { ...emptyThreeCConfig(), integration_user_id: "servidor" };
    calls.rpc.mockResolvedValue({ data: config, error: null });
    expect(await configureThreeC(config)).toEqual(config);
    const args = calls.rpc.mock.calls[0];
    expect(args[0]).toBe("configure_integracao_3c");
    expect(args[1].p_config).not.toHaveProperty("integration_user_id");
  });

  it("gera 32 bytes novos por rotação, salva só a chave e não regrava o config", async () => {
    calls.secret.mockResolvedValue("id");
    const getRandomValues = vi.spyOn(crypto, "getRandomValues").mockImplementation((values) => {
      (values as Uint8Array).fill(17);
      return values;
    });
    try {
      const token = await rotateThreeCToken();
      expect(getRandomValues.mock.calls[0][0]).toHaveLength(32);
      expect(token).toMatch(/^[a-f0-9]{64}$/);
      expect(calls.secret).toHaveBeenCalledWith("3c", "api_token", token);
      expect(calls.rpc).not.toHaveBeenCalled();
    } finally { getRandomValues.mockRestore(); }
  });
});
