/**
 * Cenário da esteira de crédito (ata 23/07): construtora, negócio, cliente e
 * documentos.
 *
 * Não é um spec — o `testMatch` do playwright.config só coleta `*.spec.ts`.
 *
 * Cada cenário cria a PRÓPRIA construtora, em vez de reaproveitar as duas do
 * seed. O banco é compartilhado entre agentes e entre execuções: alternar o
 * fluxo de "Horizonte Urbanismo" para provar o toggle da tela de admin mudaria
 * o mundo de quem estivesse rodando ao mesmo tempo, e o defeito apareceria como
 * "flaky" no relatório do outro. Construtora marcada é construtora que dá para
 * apagar sem levar nada de terceiros junto.
 */
import type { Page } from "@playwright/test";
import { db, aguardarCarregamento, expect, runTag } from "../support/fixtures";
import { mintSession } from "../support/session";
import { resolveTarget, storageKeyFor } from "../support/target";
import { userFor, type RoleKey } from "../support/users";

export type Cenario = {
  tag: string;
  dealId: string;
  /** `NEG-000123` — o código humano do negócio, não o uuid. */
  dealCode: string;
  developerId: string;
  developerName: string;
  cliente: string;
};

export type TipoDocumento = {
  id: string;
  code: string;
  label: string;
  naming_pattern: string | null;
  allows_multiple: boolean;
  required_for_conversion: boolean;
};

export type DocumentoDoNegocio = {
  id: string;
  document_type_id: string;
  stored_name: string;
  original_name: string;
  storage_path: string;
  version: number;
  superseded_at: string | null;
  superseded_by: string | null;
  size_bytes: number | null;
  mime_type: string | null;
};

// ── Catálogo (leitura pura, dá para memorizar dentro da execução) ────────────

const cacheEtapas = new Map<string, string>();

export async function etapaId(code: string): Promise<string> {
  const emCache = cacheEtapas.get(code);
  if (emCache) return emCache;
  const [linha] = await db.select<{ id: string }>(`pipeline_stages?code=eq.${code}&select=id`);
  if (!linha) throw new Error(`etapa de pipeline "${code}" não existe`);
  cacheEtapas.set(code, linha.id);
  return linha.id;
}

export async function estagioCca(status: string): Promise<{ id: string; name: string }> {
  const [linha] = await db.select<{ id: string; name: string }>(
    `cca_stages?status=eq.${status}&active=is.true&select=id,name&limit=1`,
  );
  if (!linha) throw new Error(`estágio de CCA com status "${status}" não existe`);
  return linha;
}

export async function tipoDocumento(code: string): Promise<TipoDocumento> {
  const [linha] = await db.select<TipoDocumento>(
    `document_types?code=eq.${code}&select=id,code,label,naming_pattern,allows_multiple,required_for_conversion`,
  );
  if (!linha) throw new Error(`tipo de documento "${code}" não existe`);
  return linha;
}

export const tiposObrigatorios = () =>
  db.select<TipoDocumento>(
    "document_types?active=is.true&required_for_conversion=is.true&select=id,code,label,naming_pattern,allows_multiple,required_for_conversion&order=sort_order",
  );

export const documentosDoNegocio = (dealId: string) =>
  db.select<DocumentoDoNegocio>(
    `deal_documents?deal_id=eq.${dealId}&select=id,document_type_id,stored_name,original_name,storage_path,version,superseded_at,superseded_by,size_bytes,mime_type&order=created_at.asc`,
  );

// ── Montagem e limpeza ───────────────────────────────────────────────────────

/**
 * Negócio com titular e corretor. O trigger `deal_participants_autofill` puxa
 * gerente e diretor da equipe do corretor — é assim que o negócio nasce em
 * produção, montar participante à mão esconderia a automação.
 */
export async function criarCenario(opts: {
  dono: RoleKey;
  fluxo?: "internal" | "external";
  etapa?: string;
  apelido?: string;
}): Promise<Cenario> {
  // `runTag()` já sai só com minúscula, dígito e hífen — o mesmo alfabeto que a
  // renomeação de arquivo produz. Isso deixa o nome esperado previsível sem
  // reimplementar o `slug` que está sendo testado.
  const tag = runTag();
  const fluxo = opts.fluxo ?? "internal";

  const [construtora] = await db.insert<{ id: string; name: string }>("developers", {
    name: `Construtora E2E ${tag}`,
    slug: `construtora-e2e-${tag}`,
    flow: fluxo,
    // A constraint `developers_external_needs_email` exige e-mail no fluxo externo.
    submission_email: fluxo === "external" ? `dossie-${tag}@construtora.test` : null,
  });

  const [negocio] = await db.insert<{ id: string; code: string }>("deals", {
    stage_id: await etapaId(opts.etapa ?? "proposal"),
    developer_id: construtora.id,
    unit: "E2E-CCA",
    vgv_gross: 500000,
    notes: tag,
  });

  const cliente = `${opts.apelido ?? "Dossie"} ${tag}`;
  await db.insert("deal_clients", { deal_id: negocio.id, ordinal: 1, full_name: cliente });
  await db.insert("deal_participants", {
    deal_id: negocio.id,
    profile_id: await db.profileIdOf(opts.dono),
    role: "broker",
  });

  return {
    tag,
    dealId: negocio.id,
    dealCode: negocio.code,
    developerId: construtora.id,
    developerName: construtora.name,
    cliente,
  };
}

/** Documento já gravado, sem passar pela tela — para cenários que só precisam
 *  de "existe documento", como liberar uma etapa com `requires_document`. */
export async function semearDocumento(
  cenario: Cenario,
  code: string,
): Promise<DocumentoDoNegocio> {
  const tipo = await tipoDocumento(code);
  const nome = `${tipo.code}-${cenario.tag}.pdf`;
  const [linha] = await db.insert<DocumentoDoNegocio>("deal_documents", {
    deal_id: cenario.dealId,
    document_type_id: tipo.id,
    storage_path: `${cenario.dealId}/semeado-${nome}`,
    original_name: nome,
    stored_name: nome,
    mime_type: "application/pdf",
    size_bytes: 1024,
  });
  return linha;
}

export const semearCasoCca = (cenario: Cenario, status: string, stageId: string) =>
  db.insert<{ id: string }>("cca_cases", {
    deal_id: cenario.dealId,
    status,
    stage_id: stageId,
    submitted_at: new Date().toISOString(),
  });

/**
 * Os arquivos do bucket não somem com o `delete` da linha: `deal_documents` e
 * `storage.objects` são tabelas diferentes. Sem esta parte a limpeza deixaria
 * lixo binário acumulando a cada execução.
 */
export async function apagarArquivos(dealId: string): Promise<void> {
  const docs = await db.select<{ storage_path: string }>(
    `deal_documents?deal_id=eq.${dealId}&select=storage_path`,
  );
  if (docs.length === 0) return;
  const alvo = resolveTarget();
  await fetch(`${alvo.supabaseUrl}/storage/v1/object/deal-documents`, {
    method: "DELETE",
    headers: {
      apikey: alvo.serviceRoleKey,
      Authorization: `Bearer ${alvo.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prefixes: docs.map((d) => d.storage_path) }),
  }).catch(() => undefined);
}

/** `deals` cascateia clientes, participantes, documentos, caso e envios; a
 *  construtora só cai depois, porque a FK do negócio é `on delete restrict`. */
export async function limparCenario(cenario: Cenario): Promise<void> {
  await apagarArquivos(cenario.dealId);
  await db.remove(`deals?id=eq.${cenario.dealId}`);
  await db.remove(`developers?id=eq.${cenario.developerId}`);
}

// ── Sessão ───────────────────────────────────────────────────────────────────

const sessaoPorPapel = new Map<RoleKey, string>();

/**
 * Garante a sessão do papel na origem em que o teste está rodando.
 *
 * O `storageState` do `global-setup` grava a sessão amarrada à origem daquela
 * execução (`http://localhost:<E2E_PORT>`). Vários agentes compartilham este
 * repositório e cada um roda numa porta diferente, então `e2e/.auth/<papel>.json`
 * pode ter sido reescrito com a porta do vizinho entre o meu setup e o meu
 * teste — e aí o app abre em /login sem defeito nenhum na aplicação.
 *
 * Aqui a sessão é obtida pelo MESMO caminho do global-setup (OTP real via
 * `mintSession`, sem bypass) e injetada antes do boot do app. Uma por papel e
 * por worker.
 */
export async function comSessao(page: Page, papel: RoleKey): Promise<void> {
  let valor = sessaoPorPapel.get(papel);
  if (!valor) {
    valor = JSON.stringify(await mintSession(userFor(papel).email));
    sessaoPorPapel.set(papel, valor);
  }
  const chave = storageKeyFor(resolveTarget().supabaseUrl);
  await page.addInitScript(
    ({ k, v }: { k: string; v: string }) => window.localStorage.setItem(k, v),
    { k: chave, v: valor },
  );
}

// ── Navegação ────────────────────────────────────────────────────────────────

/** Abre o Pipeline filtrado: a tabela pagina em 15 e o banco tem seed. */
export async function abrirNegocio(page: Page, cliente: string): Promise<void> {
  await page.goto("/pipeline");
  await aguardarCarregamento(page);
  await page.getByPlaceholder(/buscar cliente/i).fill(cliente);
  // A linha inteira abre o modal, mas as células de Status 2, visita e "Off"
  // param a propagação; a célula do cliente é o alvo seguro.
  await page.getByRole("cell", { name: new RegExp(cliente, "i") }).click();
  await expect(page.getByRole("button", { name: /confirmar alterações/i })).toBeVisible();
}

export const abaDoModal = (page: Page, nome: RegExp) =>
  page.getByRole("button", { name: nome });

/**
 * O `<input type="file">` de cada tipo é `hidden` e não tem nome acessível —
 * quem tem rótulo é o `<label>` irmão. Por isso o caminho pelo irmão em vez de
 * `getByLabel`: o input não está associado ao label por `for`/`id`.
 * (Registrado como achado de acessibilidade no relatório.)
 */
export const campoDeArquivo = (page: Page, rotulo: string) =>
  page
    .locator("label", { hasText: rotulo })
    .locator("xpath=following-sibling::input[@type='file']");

/** Base da API do Supabase do alvo — usado para conferir a URL assinada. */
export const urlSupabase = () => resolveTarget().supabaseUrl;

export const arquivo = (nome: string, conteudo: string) => ({
  name: nome,
  mimeType: "application/pdf",
  buffer: Buffer.from(conteudo),
});
