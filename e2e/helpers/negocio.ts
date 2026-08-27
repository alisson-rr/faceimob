/**
 * Apoio dos specs de pipeline/negócio.
 *
 * **Voltou a ser `getByLabel`.** Até a Tarefa H o rótulo era um `<label>` solto
 * ao lado do controle, sem `htmlFor`/`id`: o campo não tinha nome acessível e
 * só dava para ancorar por XPath no texto visível (achado X04). O editor único
 * de negócio passou a usar `useId` + `<Label htmlFor>` em todos os ~40 campos,
 * então o nome acessível existe — e o seletor do teste passou a exercitar a
 * mesma associação que o leitor de tela usa.
 *
 * Os rótulos também mudaram na mesma tarefa, porque os DOIS editores que
 * gravavam o mesmo registro viraram um só: "Incorporadora" e "Corretor 1
 * (Obrigatório)" (modal de detalhe) e "Corretor 1" (criação) convergiram para
 * "Construtora *" e "Corretor 1 *".
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { aguardarCarregamento, db } from "../support/fixtures";

export async function abrirPipeline(page: Page) {
  await page.goto("/pipeline");
  await expect(page.getByRole("heading", { name: "Pipeline", level: 1 })).toBeVisible();
  await aguardarCarregamento(page);
}

const literalRegex = (texto: string) => texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Campo identificado pelo rótulo associado por `htmlFor`. */
export const campo = (escopo: Locator, rotulo: string): Locator =>
  escopo.getByLabel(rotulo, { exact: true });

/** Gatilho de `<Select>` (Radix), também pelo rótulo associado. */
export const seletor = (escopo: Locator, rotulo: string): Locator =>
  escopo.getByLabel(rotulo, { exact: true });

/** Abre o select e escolhe a opção pelo texto exato. */
export async function escolher(gatilho: Locator, opcao: string) {
  await gatilho.click();
  await gatilho.page().getByRole("option", { name: opcao, exact: true }).click();
  await expect(gatilho).toContainText(opcao);
}

/** Opções oferecidas por um select, para comparar com o catálogo do banco. */
export async function opcoesDe(gatilho: Locator): Promise<string[]> {
  await gatilho.click();
  const page = gatilho.page();
  await expect(page.getByRole("option").first()).toBeVisible();
  const textos = await page.getByRole("option").allInnerTexts();
  await page.keyboard.press("Escape");
  return textos.map((t) => t.trim());
}

/** Linha da tabela do pipeline que mostra o cliente (a tabela imprime em caixa alta). */
export const linhaDoNegocio = (page: Page, cliente: string): Locator =>
  page.getByRole("row").filter({ hasText: new RegExp(literalRegex(cliente), "i") });

/** Deixa na tabela só o negócio procurado. */
export async function buscar(page: Page, termo: string) {
  const busca = page.getByPlaceholder(/buscar cliente, empreendimento, corretor/i);
  await busca.fill(termo);
  await expect(linhaDoNegocio(page, termo)).toHaveCount(1);
}

/** Abre o modal de detalhe clicando na linha do negócio. */
export async function abrirDetalhe(page: Page, cliente: string): Promise<Locator> {
  await linhaDoNegocio(page, cliente).getByText(new RegExp(literalRegex(cliente), "i")).first().click();
  const modal = page.getByRole("dialog");
  await expect(modal.getByRole("button", { name: /confirmar alterações/i })).toBeVisible();
  return modal;
}

export async function confirmarModal(page: Page, modal: Locator) {
  await modal.getByRole("button", { name: /confirmar alterações/i }).click();
  await expect(modal).toBeHidden();
}

// ── Banco: montagem de cenário e conferência ────────────────────────────────

export type NegocioSemeado = {
  id: string;
  cliente: string;
};

export async function idDaEtapa(codigo: string): Promise<string> {
  const [etapa] = await db.select<{ id: string }>(`pipeline_stages?code=eq.${codigo}&select=id`);
  if (!etapa) throw new Error(`etapa ${codigo} não existe`);
  return etapa.id;
}

/**
 * Construtora do catálogo que tem pelo menos um empreendimento.
 *
 * O `!inner` não é detalhe: os cenários de CCA criam construtoras próprias, sem
 * empreendimento, e uma delas pode ganhar a ordenação alfabética. Pegar "a
 * primeira" sem essa condição fazia o teste quebrar em `undefined.name`, o que
 * parece defeito da tela e é só cenário mal escolhido.
 */
export async function primeiraConstrutora(): Promise<{ id: string; name: string }> {
  const [dev] = await db.select<{ id: string; name: string }>(
    "developers?active=is.true&select=id,name,developer_projects!inner(id)&order=name&limit=1",
  );
  if (!dev) throw new Error("catálogo sem construtora com empreendimento cadastrado");
  return { id: dev.id, name: dev.name };
}

/**
 * Negócio pronto para a tela editar. Criado por service_role de propósito: o
 * cenário não pode depender do fluxo que está sendo testado.
 */
export async function semearNegocio(opts: {
  cliente: string;
  brokerId?: string;
  monthBase?: string;
  statusDetail?: string;
  vgvGross?: number;
}): Promise<NegocioSemeado> {
  const construtora = await primeiraConstrutora();
  const [deal] = await db.insert<{ id: string }>("deals", {
    developer_id: construtora.id,
    stage_id: await idDaEtapa("proposal"),
    unit: "101",
    vgv_gross: opts.vgvGross ?? 400000,
    month_base: opts.monthBase,
    status_detail: opts.statusDetail,
  });
  await db.insert("deal_clients", {
    deal_id: deal.id,
    ordinal: 1,
    full_name: opts.cliente,
  });
  if (opts.brokerId) {
    await db.insert("deal_participants", {
      deal_id: deal.id,
      profile_id: opts.brokerId,
      role: "broker",
    });
  }
  return { id: deal.id, cliente: opts.cliente };
}

export type DealRow = {
  id: string;
  unit: string | null;
  vgv_gross: string | null;
  vgv_net: string | null;
  discount_pct: string | null;
  status_detail: string | null;
  month_base: string | null;
  developer_id: string | null;
  project_id: string | null;
  stage_id: string;
  /** Desfecho e motivo: o que a confirmação de perda (F14) grava. */
  outcome: "open" | "won" | "lost" | "cancelled";
  closed_at: string | null;
  lost_reason: string | null;
};

/** Negócio no banco a partir do nome do cliente — o caminho que a tela gravou. */
export async function negocioPorCliente(cliente: string): Promise<DealRow> {
  const clientes = await db.select<{ deal_id: string }>(
    `deal_clients?full_name=eq.${encodeURIComponent(cliente)}&select=deal_id`,
  );
  if (clientes.length !== 1) {
    throw new Error(`esperava 1 negócio para "${cliente}", achei ${clientes.length}`);
  }
  const [deal] = await db.select<DealRow>(`deals?id=eq.${clientes[0].deal_id}&select=*`);
  return deal;
}

export type ParticipanteRow = {
  profile_id: string;
  role: "broker" | "manager" | "director";
  share_pct: string;
};

export const participantesDe = (dealId: string) =>
  db.select<ParticipanteRow>(
    `deal_participants?deal_id=eq.${dealId}&select=profile_id,role,share_pct`,
  );

export const clientesDe = (dealId: string) =>
  db.select<Record<string, unknown>>(
    `deal_clients?deal_id=eq.${dealId}&select=*&order=ordinal`,
  );

/** Remove tudo que o teste criou (deal_clients/participants/history caem por cascade). */
export async function limparNegocios(marca: string) {
  const clientes = await db.select<{ deal_id: string }>(
    `deal_clients?full_name=like.*${marca}*&select=deal_id`,
  );
  const ids = [...new Set(clientes.map((c) => c.deal_id))];
  if (ids.length) await db.remove(`deals?id=in.(${ids.join(",")})`);
}
