import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WhatsAppTab } from "./WhatsAppTab";
import type { WhatsAppTemplate } from "./types";

/**
 * O cadastro de template MONTADO, não só as funções puras.
 *
 * `templateVars.test.ts` já cobre a regra; o que faltava era a ligação: até
 * aqui `templateIssues` só pintava um aviso amarelo e o Salvar gravava assim
 * mesmo. Um corpo com {{2}} e uma variável só é recusado pela Graph API, e uma
 * variável fora do catálogo vira "-" no meio da mensagem que o CLIENTE lê —
 * defeitos que só apareciam em `remarketing_contacts.last_error` ou no
 * silêncio das boas-vindas.
 *
 * A fronteira é o que está mockado (cliente do Supabase e toast). A decisão de
 * gravar roda de verdade: é ela que estes testes cobram — e o e2e
 * `e2e/sdr/origens-e-templates.spec.ts` cobra o mesmo contra o banco.
 */
const banco = vi.hoisted(() => ({ from: vi.fn() }));
const avisos = vi.hoisted(() => ({ erros: [] as string[], sucessos: [] as string[] }));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: banco.from } }));
vi.mock("sonner", () => ({
  toast: {
    error: (m: string) => { avisos.erros.push(m); },
    success: (m: string) => { avisos.sucessos.push(m); },
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Resposta feliz do PostgREST: `.select("id")` devolve a linha gravada. */
const gravou = { select: async () => ({ data: [{ id: "id-gravado" }], error: null }) };

const template = (patch: Partial<WhatsAppTemplate> = {}): WhatsAppTemplate => ({
  id: "tpl-1",
  name: "boas_vindas_faceimob",
  language: "pt_BR",
  category: "UTILITY",
  body: "Olá {{1}}, tudo bem? Vi seu interesse em {{2}}.",
  variables: ["nome"],
  provider_template_id: null,
  approved: true,
  active: true,
  created_at: "2026-09-01T10:00:00Z",
  updated_at: "2026-09-01T10:00:00Z",
  ...patch,
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  avisos.erros = [];
  avisos.sucessos = [];
  banco.from.mockReset();
  banco.from.mockImplementation(() => ({
    insert: () => gravou,
    update: () => ({ eq: () => gravou }),
    delete: () => ({ eq: () => gravou }),
  }));
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  container?.remove();
  root = null;
  container = null;
});

async function abrir(templates: WhatsAppTemplate[] = []) {
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <WhatsAppTab templates={templates} sources={[]} lists={[]} canWrite reload={() => {}} />,
    );
  });
  return container;
}

/** Digitação de verdade num campo controlado: o setter nativo + evento input. */
async function digitar(seletor: string, valor: string) {
  const campo = container!.querySelector<HTMLInputElement | HTMLTextAreaElement>(seletor);
  if (!campo) throw new Error(`campo ${seletor} não está na tela`);
  const proto = campo instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  await act(async () => {
    setter?.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function salvar() {
  const botao = [...container!.querySelectorAll("button")].find(b => b.textContent?.trim() === "Salvar");
  if (!botao) throw new Error("botão Salvar não está na tela");
  await act(async () => { botao.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}

describe("WhatsAppTab · o que chega ao banco", () => {
  /**
   * Nome de variável fora do catálogo AVISA, não bloqueia: o card do lead
   * (`OutreachDialogs`) monta a mensagem pelo `wa.me` com `corretor` — que
   * `VAR_ALIASES` não conhece — e deixa a posição desconhecida visível para o
   * corretor completar. Bloquear aqui derrubaria template legítimo, e a saída
   * sugerida ("arquive") o tiraria do único caminho que o suporta, porque
   * `listWhatsappTemplates` filtra `active = true`.
   */
  it("avisa, mas grava, template com variável fora do catálogo", async () => {
    const tela = await abrir();
    await digitar("#wa-name", "tpl_teste");
    await digitar("#wa-vars", "nome, corretor");
    await digitar("#wa-body", "Olá {{1}}, tudo bem? Falo por {{2}}.");

    expect(tela.textContent, "o operador tem de ver o que o disparo automático fará").toMatch(/"corretor"/);
    await salvar();

    expect(banco.from).toHaveBeenCalledWith("whatsapp_templates");
    expect(avisos.sucessos).toContain("Template cadastrado");
  });

  it("não grava corpo com mais placeholders do que variáveis declaradas", async () => {
    await abrir();
    await digitar("#wa-name", "tpl_teste");
    await digitar("#wa-vars", "nome");
    await digitar("#wa-body", "Olá {{1}}, tudo bem? Vi seu interesse em {{2}}.");
    await salvar();

    expect(banco.from).not.toHaveBeenCalled();
    expect(avisos.erros[0]).toMatch(/recusa o envio/);
    expect(avisos.erros[0], "o aviso tem de dizer o que fazer").toMatch(/Corrija antes de salvar/);
  });

  // "Informe nome e mensagem" não dizia qual dos dois faltou.
  it("diz qual campo obrigatório faltou", async () => {
    await abrir();
    await digitar("#wa-body", "Mensagem sem variável nenhuma.");
    await salvar();
    expect(avisos.erros[0]).toMatch(/nome do template/i);

    await digitar("#wa-name", "tpl_teste");
    await digitar("#wa-body", "");
    await salvar();
    expect(avisos.erros[1]).toMatch(/mensagem do template/i);
    expect(banco.from).not.toHaveBeenCalled();
  });

  it("não grava nome fora do formato que a Meta registra", async () => {
    await abrir();
    await digitar("#wa-name", "Boas Vindas");
    await digitar("#wa-body", "Mensagem sem variável nenhuma.");
    await salvar();

    expect(banco.from, "a Meta não casa esse nome no disparo").not.toHaveBeenCalled();
    expect(avisos.erros[0]).toMatch(/minúsculas/);
  });

  it("grava quando corpo, variáveis e nome combinam", async () => {
    await abrir();
    await digitar("#wa-name", "tpl_teste");
    await digitar("#wa-vars", "nome, campanha");
    await digitar("#wa-body", "Olá {{1}}, tudo bem? Vi seu interesse em {{2}}.");
    await salvar();

    expect(banco.from).toHaveBeenCalledWith("whatsapp_templates");
    expect(avisos.sucessos).toContain("Template cadastrado");
    expect(avisos.erros).toEqual([]);
  });

  /**
   * A exceção é deliberada: template quebrado precisa poder ser ARQUIVADO.
   * Desmarcar "Template ativo" é a saída que o diálogo de exclusão sugere para
   * tirar de circulação sem perder o cadastro, e os dois envios já ignoram
   * `active = false` — travar aqui deixaria o operador sem saída.
   */
  it("deixa salvar o template quebrado que está arquivado", async () => {
    await abrir([template({ active: false, variables: ["nome"] })]);
    await salvar();

    expect(banco.from).toHaveBeenCalledWith("whatsapp_templates");
    expect(avisos.sucessos).toContain("Template atualizado");
  });

  it("mostra a pré-visualização com os valores de exemplo antes de salvar", async () => {
    const tela = await abrir([template({ variables: ["nome", "campanha"] })]);
    expect(tela.textContent).toContain("Olá Maria Souza, tudo bem? Vi seu interesse em Lançamento Parque.");
  });

  // O nome é a chave do disparo, e o motivo tem de estar junto do campo — não
  // só no toast de quem já clicou em Salvar.
  it("diz na tela que o nome precisa ser o do template aprovado na Meta", async () => {
    const tela = await abrir();
    expect(tela.textContent).toMatch(/APROVADO na Meta/);
  });
});
