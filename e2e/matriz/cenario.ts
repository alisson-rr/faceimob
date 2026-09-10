/**
 * Cenário compartilhado da matriz de visibilidade.
 *
 * Não é um spec (o `testMatch` do playwright.config só coleta `*.spec.ts`), é o
 * preparo que os specs de broker/brokerRival/manager/director/dual/admin usam
 * para montar o MESMO mundo: um negócio da equipe Alfa e um da equipe Beta.
 *
 * Cada spec monta e derruba o próprio cenário com a sua `runTag()`. Sai mais
 * barato do que coordenar estado entre projects que rodam em workers separados,
 * e o banco é compartilhado com outros agentes — dado marcado é dado que dá
 * para apagar sem levar junto o de terceiros.
 */
import type { Page } from "@playwright/test";
import { db, aguardarCarregamento } from "../support/fixtures";
import type { RoleKey } from "../support/users";

export type Negocio = { id: string; cliente: string };

/** Corretor do seed que NÃO está em nenhuma equipe dos papéis E2E. */
export const CORRETOR_DE_FORA = "seed.ana@example.invalid";

export async function idDoPerfil(email: string): Promise<string> {
  const rows = await db.select<{ id: string }>(
    `profiles?email=eq.${encodeURIComponent(email)}&select=id`,
  );
  if (!rows.length) throw new Error(`perfil ${email} não existe no banco`);
  return rows[0].id;
}

/**
 * Cria um negócio na etapa "Proposta" com um titular e um corretor.
 *
 * O trigger `deal_participants_autofill` puxa gerente e diretor da equipe do
 * corretor — de propósito: é assim que o negócio nasce em produção, e testar
 * com participante montado à mão esconderia a automação.
 */
export async function criarNegocio(
  tag: string,
  apelido: string,
  profileId: string,
): Promise<Negocio> {
  const [etapa] = await db.select<{ id: string }>("pipeline_stages?code=eq.proposal&select=id");
  const [construtora] = await db.select<{ id: string }>("developers?select=id&limit=1");

  const [deal] = await db.insert<{ id: string }>("deals", {
    stage_id: etapa.id,
    developer_id: construtora?.id ?? null,
    unit: "E2E",
    notes: tag, // marca da execução: é por aqui que a limpeza encontra tudo
  });

  const cliente = `${apelido}-${tag}`;
  await db.insert("deal_clients", { deal_id: deal.id, ordinal: 1, full_name: cliente });
  await db.insert("deal_participants", { deal_id: deal.id, profile_id: profileId, role: "broker" });

  return { id: deal.id, cliente };
}

/** Um negócio da equipe Alfa (broker) e outro da Beta (brokerRival). */
export async function montarDuasEquipes(tag: string) {
  const alfa = await criarNegocio(tag, "ALFA", await db.profileIdOf("broker" as RoleKey));
  const beta = await criarNegocio(tag, "BETA", await db.profileIdOf("brokerRival" as RoleKey));
  return { alfa, beta };
}

/** Apaga tudo da execução. `deals` cascateia clientes, participantes e histórico. */
export const limparCenario = (tag: string) => db.remove(`deals?notes=eq.${tag}`);

/** Abre o Pipeline já filtrado — a tabela pagina em 15 e o banco tem seed. */
export async function abrirPipelineFiltrado(page: Page, termo: string) {
  await page.goto("/pipeline");
  await aguardarCarregamento(page);
  await page.getByPlaceholder(/buscar cliente/i).fill(termo);
}

/** Linha da tabela do Pipeline: o cliente é renderizado em caixa alta. */
export const linhaDoCliente = (page: Page, cliente: string) =>
  page.getByText(new RegExp(cliente, "i"));
