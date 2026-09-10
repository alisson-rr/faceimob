#!/usr/bin/env node
/**
 * Carga 02 — Catálogo e conteúdo (fase 3 de `docs/importacao/PLANO.md`).
 *
 * O QUE CARREGA, DE ONDE, PARA ONDE (volumes medidos no export de 09/09, em JSON)
 *
 *   json/export_All-Construtoras_2026-09-09.json     41 →  public.developers
 *     colunas: nome, CCA, Creation Date, Modified Date, unique id
 *   json/export_All-pipelines_2026-09-09_….json     618 →  public.developer_projects
 *     colunas: CONSTRUTORA2 (id), construtora (texto),      (derivado: o Bubble não
 *              EMPREENDIMENTO (texto)                        tem entidade de empreendimento)
 *   export_All-links_….csv                            3 →  public.useful_links
 *   export_All-dicadeouros-modified_….csv            10 →  public.gold_tips
 *   export_All-mensagemdodias-modified_….csv         18 →  public.important_notices
 *
 * `acharExport` (lib) escolhe o arquivo: JSON antes de CSV, e dentro do formato o
 * carimbo mais novo. `links`, `dicadeouros` e `mensagemdodias` não vieram no reexport
 * e continuam saindo do CSV de 08/09 — inclusive com `Creator` como nome de exibição.
 *
 * QUE COLUNA VIROU id: só `CONSTRUTORA2` importa aqui, e agora é `unique id` do Bubble
 * em 7.557 das 7.579 linhas. `EMPREENDIMENTO` continua TEXTO — o Bubble não tem entidade
 * de empreendimento, então não há id para ela, e o de-para segue casando por nome.
 * `pipelines.construtora` (minúscula) é o texto solto copiado na época e permanece só
 * como fallback das 5 linhas sem `CONSTRUTORA2`, todas grafadas `MAISLAR`.
 *
 * 618 empreendimentos e não os 628 que a mesma regra do mapa §10 produziria neste
 * arquivo: `normalizarNome` ignora pontuação e funde 10 grafias que o `norm()` do mapa
 * deixaria como registros separados. As 10 foram conferidas uma a uma e são todas o
 * mesmo empreendimento — `MORADA DO CAMPO` × `MORADA DO CAMPO ||`, `SOLAR DO BOSQUE` ×
 * `SOLAR DO BOSQUE,`, `ACQUA SENA F1` × `ACQUA SENA - F1`, `SERENA GRAVATAI` ×
 * `SERENA - GRAVATAI`.
 *
 * 618 e não os 615 do CSV de 08/09: o JSON tem 11 pipelines a mais, e 3 deles estrearam
 * uma grafia nova de empreendimento existente (`SOLAR PASSAROS`, `VIOELTA`, `COLONIA`).
 * Nenhum grupo do CSV sumiu — o ramo do id cobre tudo o que o ramo do nome cobria.
 *
 *   node scripts/import/02-catalogo.mjs --dry-run   → lê, resolve e relata; não grava
 *   node scripts/import/02-catalogo.mjs             → grava
 *
 * CÓDIGO DE SAÍDA: 1 se o banco recusar qualquer linha (destino ou de-para), 0 só com a
 * carga inteira dentro. É por ele que `run.mjs` decide liberar a carga 03 — e a 03 pula
 * para sempre o negócio já presente em `import_bubble_map`, então falha aqui é permanente.
 *
 * PRÉ-REQUISITOS (o script não faz nada disso)
 *
 *   1. Migration `0096_import_bubble_map` aplicada — é a trava de idempotência (N-06).
 *   2. `SUPABASE_SERVICE_ROLE_KEY` no ambiente. As 5 tabelas têm RLS de escrita por
 *      papel (`developers_write` exige admin/cca, etc.): com sessão sem papel a policy
 *      DESCARTA a linha e o script termina "com sucesso" e zero gravação.
 *   3. Carga de identidade antes, se quiser autoria: `gold_tips.author_id` e
 *      `important_notices.created_by` saem de `Douglas Gomes` em `profiles`. Sem ele as
 *      duas colunas ficam NULL (são nullable) e a carga segue.
 *
 * GATILHOS A DESLIGAR: nenhum. As 5 tabelas só têm `set_updated_at` (before update, não
 * dispara no insert — por isso `updated_at` do legado sobrevive) e `developers_ensure_slug`
 * (que devolve o slug explícito intacto). A carga é silenciosa: não há notificação, roleta
 * nem pontuação neste domínio.
 *
 * OPCIONAL, ANTES DE RODAR — o seed (020/040) já plantou 2 construtoras, 4 empreendimentos,
 * 3 links, 3 dicas ATIVAS e 2 avisos ativos com `created_at = now()` do seed. Nada disso é
 * apagado (R-02: `deals.developer_id` é `on delete restrict` e o delete seria recusado).
 * Para o banner do pipeline mostrar o conteúdo do Bubble em vez do de seed:
 *   update public.gold_tips         set active = false where id::text like '6d%';
 *   update public.important_notices set active = false where id::text like '6c%';
 *
 * VERIFICAÇÃO — toda contagem é escopada por procedência; `count(*)` de tabela soma seed +
 * demo + import e reprova carga correta (R-02).
 *
 *   select tabela_destino, count(*) from public.import_bubble_map
 *    where entidade in ('construtora','empreendimento','link','dica','mensagem')
 *    group by 1 order by 1;
 *   -- developers 41 | developer_projects 618 | gold_tips 10 | important_notices 18 | useful_links 3
 *
 *   -- N-23: as 22 `CCA Externo` entraram internas e sem e-mail, à espera de cadastro
 *   select count(*) from public.developers d
 *     join public.import_bubble_map m on m.registro_id = d.id and m.tabela_destino='developers'
 *    where d.flow = 'internal' and d.submission_email is null;   -- esperado: 41
 *
 *   -- zero órfão e nome aparado (a idempotência do reimport depende do trim)
 *   select count(*) from public.developer_projects dp
 *    where not exists (select 1 from public.developers d where d.id = dp.developer_id);  -- 0
 *   select count(*) from public.developer_projects where name <> btrim(name);            -- 0
 *
 *   -- created_at veio do legado, não do now() da carga
 *   select min(created_at), max(created_at) from public.gold_tips g
 *     join public.import_bubble_map m on m.registro_id = g.id and m.tabela_destino='gold_tips';
 *   -- esperado: 2026-01-06 .. 2026-06-25
 *
 *   -- o mural importado nasce inteiro desligado (não compete com o aviso do seed)
 *   select count(*) from public.important_notices n
 *     join public.import_bubble_map m on m.registro_id = n.id and m.tabela_destino='important_notices'
 *    where n.active;                                                                     -- 0
 *
 * O DE-PARA QUE AS CARGAS SEGUINTES CONSOMEM
 *
 *   lerMapa("construtora", "developers")            → `unique id` do Bubble → developer_id
 *   lerMapa("empreendimento", "developer_projects") → "<developer_id>|<normalizarNome(EMPREENDIMENTO)>"
 *                                                     → project_id
 *
 * A chave sai do `developer_id` já resolvido, nunca do valor bruto da coluna: o bruto é
 * `unique id` no JSON e nome no CSV, e uma chave que mudasse de formato duplicaria as
 * 618 linhas do de-para na reexecução. É a mesma chave que `03-negocios.mjs` monta para
 * resolver `project_id`, e ela sobrevive ao reexport intacta.
 *
 * A carga de negócios TEM de montar a segunda chave com estas mesmas funções — resolver
 * `project_id` por `ilike` no nome bruto falha nos 91 pares com grafia divergente
 * (`GARDA`/`Garda`, `SOLAR DOS PASSAROS`/`SOLAR DOS PÁSSAROS`) e o `name` gravado é a
 * variante mais frequente, que é estatística do arquivo, não identificador.
 */
import { randomUUID } from "node:crypto";

import {
  acharExport,
  criarResolvedor,
  dataBubble,
  ehDryRun,
  inserirEmLote,
  lerCsv,
  lerMapa,
  normalizarNome,
  registrarMapa,
  relatorio,
  supa,
} from "./lib/bubble.mjs";

// ── normalização local ───────────────────────────────────────────────────────

/** NBSP no lugar do espaço: real no export e invisível no diff, por isso escapado. */
const RX_NBSP = /\u00a0/g;

/** NBSP para espaço, espaços colapsados, trim. */
const limpar = (txt) =>
  String(txt ?? "")
    .replace(RX_NBSP, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * `normalizarNome` sem separador: é o `norm2` do mapa §2, e existe por causa de um
 * único valor — as 6 linhas de `pipelines.construtora` grafadas `MAISLAR`, que só
 * casam com o catálogo `MAIS LAR` depois de remover o espaço. No JSON 1 delas ganhou
 * `CONSTRUTORA2` e resolve por id; as outras 5 ainda dependem desta chave. Medido:
 * aplicada aos 41 nomes produz 41 chaves distintas, zero colisão (`LOTTICI` ≠ `LOTTICCI`).
 */
const chaveNome = (txt) => normalizarNome(txt).replace(/[^a-z0-9]/g, "");

/**
 * Réplica de `public.slugify` (`0001:171-182`) para os 41 nomes do catálogo.
 * O Postgres usa `unaccent_fallback` (translate sobre lista fixa) e não NFKD: as
 * duas versões só divergem em acento fora da lista latina, e os 41 nomes são ASCII
 * puro (medido, 0 divergências). Slug explícito deixa o insert idempotente por
 * `slug` — o gatilho `developers_ensure_slug` devolve intacto o que já vem preenchido.
 */
const slugificar = (nome) => normalizarNome(nome).replace(/ /g, "-");

const RX_YOUTUBE = /\[youtube\]([\w-]{6,})\[\/youtube\]/g;
// Aceita atributo com espaço: `[li indent=0 align=left]` existe no corpus e um
// `\[/?[a-z]+\]` simples deixaria a tag no texto.
const RX_BBCODE = /\[\/?[a-zA-Z][a-zA-Z0-9]*(?:[ =][^\]]*)?\]/g;
// O corpus mistura BBCode do editor do Bubble com markdown do WhatsApp: 2 das 18
// mensagens têm `*BATEU LEVOU*` no corpo, não só no título (refutação dados §1).
const RX_NEGRITO_WA = /\*([^*\n]{1,80})\*/g;

/**
 * Markup do editor para texto puro. A ordem importa: o embed vira URL ANTES do
 * strip genérico, senão o vídeo some junto com a tag.
 *
 * Remove negrito/itálico em vez de converter para HTML de propósito: `gold_tips.body`
 * e `important_notices.body` são renderizados como texto pelo front, e converter
 * abriria superfície de XSS sem sanitizador no caminho.
 */
function limparMarkup(txt) {
  return String(txt ?? "")
    .replace(RX_NBSP, " ")
    .replace(RX_YOUTUBE, "\nhttps://youtu.be/$1\n")
    .replace(RX_BBCODE, "")
    .replace(RX_NEGRITO_WA, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const MARCADORES = ["👉", "🎯", "📲", "📢", "💥"];

/**
 * `title` é NOT NULL nas duas tabelas e não existe no legado: sai da primeira linha
 * do corpo, cortada no marcador de "a dica em si". Fatia por code point para não
 * partir emoji ao meio — os 28 textos começam com um.
 */
function tituloDe(corpo, padrao) {
  let linha = corpo.split("\n")[0].trim();
  for (const mk of MARCADORES)
    if (linha.includes(mk)) linha = linha.split(mk)[0].trim();
  linha = linha.replace(/^[\s\-–—:!?.]+|[\s\-–—:!?.]+$/gu, "");
  const letras = [...linha];
  if (letras.length > 60)
    linha =
      letras
        .slice(0, 60)
        .join("")
        .replace(/\s+\S*$/, "") + "…";
  return linha || padrao;
}

/**
 * Índice `nome normalizado → id` para `criarResolvedor`. Chave repetida vira ARRAY:
 * o resolvedor devolve "ambiguo" e grava NULL em vez de sortear um dos dois (R-08).
 *
 * @param {[string, string][]} pares
 */
function indicePorNome(pares) {
  const indice = new Map();
  for (const [chave, id] of pares) {
    if (!chave) continue;
    const atual = indice.get(chave);
    if (atual === undefined) indice.set(chave, id);
    else if (![].concat(atual).includes(id))
      indice.set(chave, [...[].concat(atual), id]);
  }
  return indice;
}

/** Mesma regra do front para recusar link duplicado (`Links.tsx:42`). */
const chaveUrl = (url) =>
  String(url ?? "")
    .trim()
    .replace(/\/+$/, "")
    .toLowerCase();

/**
 * Chave natural do mural: instante + título. `gold_tips` e `important_notices` não
 * têm unique nem `external_id`, então sem isto uma queda entre o insert e a escrita
 * do de-para faz a rodada seguinte duplicar as 10 dicas e os 18 avisos.
 * Compara por milissegundo porque o destino devolve o mesmo instante em UTC.
 */
const chaveMural = (instante, titulo) =>
  `${Date.parse(instante)}|${String(titulo ?? "").trim()}`;

// ── constantes medidas ───────────────────────────────────────────────────────

/**
 * As 8 construtoras sem um único negócio, empreendimento ou meta no legado (mapa §4.1,
 * reproduzido pela refutação de dados §4.6). Entram inativas e somem dos seletores —
 * mas ENTRAM: `deals.developer_id` é `on delete restrict` e a carga de negócios
 * precisa achar todas as 41 referenciadas.
 */
const INATIVAS = new Set([
  "aditar",
  "cnt",
  "dallasanta",
  "eliowinter",
  "lotticci",
  "paradis",
  "rpm",
  "solv",
]);

/**
 * Pares (construtora, empreendimento) que são rótulo-lixo, pela LISTA NOMINAL medida —
 * não pelo critério em prosa do mapa, que é mais estreito que a própria lista e deixaria
 * passar os 4 pares cujo nome é `AVULSO` (refutação dados §4.2). `?` e `.` normalizam
 * para vazio e caem no mesmo grupo, daí 6 chaves para os 8 pares.
 */
const PLACEHOLDERS = new Set([
  "tenda|",
  "tenda|0",
  "avulso|",
  "avulso|avulso",
  "vasco|avulso",
  "cyrela|avulso",
]);

const DIA_MS = 86_400_000;

// ── leitura do destino ───────────────────────────────────────────────────────

/**
 * Página do PostgREST: acima de 1000 ele trunca calado.
 * `order("id")` é desempate obrigatório, não enfeite: sem ORDER BY o Postgres não
 * garante a mesma ordem entre duas páginas e a linha pulada vira duplicata na carga.
 */
async function todas(tabela, colunas) {
  const cliente = supa();
  const linhas = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await cliente
      .from(tabela)
      .select(colunas)
      .order("id")
      .range(de, de + 999);
    if (error) throw new Error(`select ${tabela}: ${error.message}`);
    linhas.push(...data);
    if (data.length < 1000) return linhas;
  }
}

/**
 * Estado do destino antes da carga: de-para já gravado + chaves naturais do que já
 * existe (seed, demo ou execução anterior interrompida antes de gravar o mapa).
 *
 * Em `--dry-run` sem service role a leitura é impossível; seguir com o destino vazio
 * ainda prova o parse, o de-para de FK e os volumes, que é o objetivo do ensaio.
 */
async function estadoDestino(rel) {
  try {
    const [
      mapaDev,
      mapaProj,
      mapaLink,
      mapaDica,
      mapaAviso,
      mapaUser,
      developers,
      projetos,
      links,
      dicas,
      avisos,
      profiles,
    ] = await Promise.all([
      lerMapa("construtora", "developers"),
      lerMapa("empreendimento", "developer_projects"),
      lerMapa("link", "useful_links"),
      lerMapa("dica", "gold_tips"),
      lerMapa("mensagem", "important_notices"),
      // De-para da carga 01: é o que fará `Creator` resolver quando `dicadeouros` e
      // `mensagemdodias` vierem em JSON, com `unique id` no lugar do nome de exibição.
      lerMapa("user", "profiles"),
      todas("developers", "id, name, slug"),
      todas("developer_projects", "id, developer_id, name"),
      todas("useful_links", "id, url"),
      todas("gold_tips", "id, title, created_at"),
      todas("important_notices", "id, title, starts_at"),
      todas("profiles", "id, full_name"),
    ]);
    return {
      mapaDev,
      mapaProj,
      mapaLink,
      mapaDica,
      mapaAviso,
      mapaUser,
      developers,
      projetos,
      links,
      dicas,
      avisos,
      profiles,
    };
  } catch (e) {
    if (!ehDryRun()) throw e;
    rel.aviso(
      `sem acesso ao banco (${String(e.message).split("\n")[0]}) — ensaio assume destino vazio`,
    );
    return {
      mapaDev: new Map(),
      mapaProj: new Map(),
      mapaLink: new Map(),
      mapaDica: new Map(),
      mapaAviso: new Map(),
      mapaUser: new Map(),
      developers: [],
      projetos: [],
      links: [],
      dicas: [],
      avisos: [],
      profiles: [],
    };
  }
}

// ── escrita ──────────────────────────────────────────────────────────────────

/**
 * Linhas que o banco recusou, somando os 5 destinos e o de-para. O processo tem de
 * sair != 0 quando isto for > 0: `run.mjs:214` decide continuar SÓ pelo código de
 * saída, e a carga 03 pula para sempre o negócio já presente em `import_bubble_map`.
 */
let falhas = 0;

/**
 * Insere os registros novos e grava o de-para de TODOS eles — inclusive os que já
 * existiam por chave natural, que é o que torna a construtora do seed resolvível pela
 * carga de negócios. Linha que falha é isolada por `inserirEmLote`, reportada, e fica
 * FORA do mapa: registrar procedência de linha que não entrou é mentira gravada.
 *
 * @param {{conta:Function,aviso:Function}} rel
 * @param {string} entidade
 * @param {string} tabela
 * @param {{id: string, bubbleId: string, linha: object|null}[]} registros
 * @param {{onConflict?: string}} [opcoes]
 * @returns {Promise<Set<string>>} ids cujo insert o banco recusou
 */
async function gravar(rel, entidade, tabela, registros, opcoes = {}) {
  const novos = registros.filter((r) => r.linha);
  const { inseridos, erros } = await inserirEmLote(
    tabela,
    novos.map((r) => r.linha),
    opcoes,
  );
  rel.conta(`${tabela}:inseridos`, inseridos);
  rel.conta(`${tabela}:pulados`, registros.length - novos.length);

  const falhou = new Set(erros.map((e) => novos[e.indice]?.id));
  for (const e of erros) {
    falhas++;
    rel.conta(`${tabela}:falhas`);
    rel.aviso(`${tabela}: ${e.mensagem}`);
  }

  const mapa = await registrarMapa(
    entidade,
    registros
      .filter((r) => !falhou.has(r.id))
      .map((r) => ({
        bubble_id: r.bubbleId,
        tabela_destino: tabela,
        registro_id: r.id,
      })),
  );
  for (const e of mapa.erros) {
    // De-para não gravado é pior que insert perdido: `gold_tips`/`important_notices`
    // não têm unique, e sem a linha do mapa a reexecução duplica o conteúdo.
    falhas++;
    rel.conta("import_bubble_map:falhas");
    rel.aviso(`import_bubble_map(${entidade}): ${e.mensagem}`);
  }
  return falhou;
}

// ── cargas ───────────────────────────────────────────────────────────────────

/**
 * As 41 construtoras. Todas `flow='internal'`, inclusive as 22 marcadas `CCA Externo`
 * (N-23): elas não têm e-mail em lugar nenhum do export, `developers_external_needs_email`
 * recusaria a linha, e um endereço inventado faria o cron mandar documento de cliente
 * de verdade para fora. O e-mail é cadastrado na tela antes do primeiro envio externo.
 *
 * @returns {Promise<{nome: string, id: string, bubbleId: string}[]>} o catálogo
 *   resolvido, para os projetos — só as construtoras que o banco aceitou
 */
async function carregarDevelopers(rel, estado) {
  const porSlug = new Map(estado.developers.map((d) => [d.slug, d.id]));
  const porNome = new Map(
    estado.developers.map((d) => [normalizarNome(d.name), d.id]),
  );
  const registros = [];
  const catalogo = [];
  let externas = 0;

  for await (const linha of lerCsv(acharExport("export_All-Construtoras"))) {
    rel.conta("construtoras:lidas");
    const nome = limpar(linha.nome);
    const bubbleId = linha["unique id"];
    if (!nome || !bubbleId) {
      rel.aviso(`construtora sem nome ou sem unique id: ${bubbleId || "?"}`);
      continue;
    }
    if (limpar(linha.CCA) === "CCA Externo") externas++;

    const slug = slugificar(nome);
    const existente =
      estado.mapaDev.get(bubbleId) ??
      porSlug.get(slug) ??
      porNome.get(normalizarNome(nome));
    const id = existente ?? randomUUID();

    registros.push({
      id,
      bubbleId,
      linha: existente
        ? null
        : {
            id,
            name: nome,
            slug,
            flow: "internal",
            active: !INATIVAS.has(normalizarNome(nome)),
            // `undefined` some do JSON e a coluna cai no default; `null` explícito
            // violaria o NOT NULL. As 41 datas parseiam, isto é rede de segurança.
            created_at: dataBubble(linha["Creation Date"]) ?? undefined,
            updated_at: dataBubble(linha["Modified Date"]) ?? undefined,
          },
    });

    // `bubbleId` vai junto: é a chave do ramo de id do resolvedor de empreendimento.
    catalogo.push({ nome, id, bubbleId });
  }

  rel.conta("construtoras:cca_externo", externas);
  rel.aviso(
    `N-23: ${externas} construtoras "CCA Externo" entraram flow=internal sem submission_email — cadastrar o e-mail na tela antes do primeiro envio externo`,
  );
  const falhou = await gravar(rel, "construtora", "developers", registros, {
    onConflict: "slug",
  });
  // Construtora recusada não pode virar `developer_id` de empreendimento: seriam
  // centenas de inserts, um a um, todos contra uma FK que não existe.
  return catalogo.filter((d) => !falhou.has(d.id));
}

/**
 * Os empreendimentos, derivados de `pipelines`: o Bubble não tem entidade de
 * empreendimento e `EMPREENDIMENTO` é o único lugar do export onde eles aparecem.
 *
 * Agrupa por (construtora resolvida, nome normalizado) e grava como `name` a variante
 * bruta mais frequente do grupo — 91 grupos têm mais de uma grafia. Por isso o de-para
 * é gravado pela CHAVE NORMALIZADA e não pelo `name`: em 33 dos grupos a diferença
 * entre a 1ª e a 2ª grafia é de até 2 ocorrências, e um export mais novo com um negócio
 * a mais inverteria o vencedor, criando uma segunda linha para o mesmo empreendimento.
 */
async function carregarProjetos(rel, estado, catalogo) {
  // Duas chaves por construtora: o nome normalizado e a chave curta. No JSON o índice
  // por nome cobre só as 5 linhas de `pipelines.construtora` que sobraram sem
  // `CONSTRUTORA2` — e as 5 são `MAISLAR`, exatamente o caso que a chave curta existe
  // para casar com `MAIS LAR`. As do seed entram no mesmo índice: um negócio do legado
  // pode citar uma construtora que já existia no destino.
  const porNome = indicePorNome(
    [
      ...catalogo,
      ...estado.developers.map((d) => ({ nome: d.name, id: d.id })),
    ].flatMap((d) => [
      [normalizarNome(d.nome), d.id],
      [chaveNome(d.nome), d.id],
    ]),
  );
  // No JSON de 09/09 `CONSTRUTORA2` é `unique id` em 7.557 das 7.579 linhas, e este é
  // o caminho principal. `criarResolvedor` NÃO cai para o nome depois do ramo do id:
  // com o mapa vazio, todas as linhas virariam "ausente" e zero empreendimento entraria.
  // As duas procedências: o de-para de uma execução anterior e o catálogo desta.
  const porId = new Map([
    ...estado.mapaDev,
    ...catalogo.map((d) => [d.bubbleId, d.id]),
  ]);
  const resolver = criarResolvedor({ porId, porNome, rotulo: "construtora" });
  // O filtro de PLACEHOLDERS é escrito por nome de construtora ("tenda|0"), mas a
  // coluna de origem traz o `unique id` no JSON e o nome no CSV. Casar pelo nome da
  // construtora JÁ RESOLVIDA vale nos dois casos.
  const nomeDevPorId = new Map(
    [
      ...catalogo,
      ...estado.developers.map((d) => ({ nome: d.name, id: d.id })),
    ].map((d) => [d.id, d.nome]),
  );

  const grupos = new Map();
  for await (const linha of lerCsv(acharExport("export_All-pipelines"))) {
    rel.conta("pipelines:lidos");
    const nome = limpar(linha.EMPREENDIMENTO);
    if (!nome) continue;
    const bruta = limpar(linha.CONSTRUTORA2) || limpar(linha.construtora) || "";
    const { id: devId } = resolver(bruta);
    if (!devId) {
      rel.conta("empreendimentos:sem_construtora");
      continue;
    }
    // A chave sai do id da construtora resolvida, nunca do valor bruto: o bruto é
    // nome no CSV e `unique id` no JSON, e ela é gravada como bubble_id do de-para —
    // se mudasse de formato, a reexecução duplicaria as linhas.
    const chave = `${devId}|${normalizarNome(nome)}`;
    if (
      PLACEHOLDERS.has(
        `${chaveNome(nomeDevPorId.get(devId) ?? "")}|${normalizarNome(nome)}`,
      )
    ) {
      rel.conta("empreendimentos:placeholder");
      continue;
    }
    if (!normalizarNome(nome)) {
      rel.conta("empreendimentos:nome_vazio");
      continue;
    }
    const grupo = grupos.get(chave) ?? { devId, variantes: new Map() };
    grupo.variantes.set(nome, (grupo.variantes.get(nome) ?? 0) + 1);
    grupos.set(chave, grupo);
  }
  resolver.relatar(rel);
  rel.conta("empreendimentos:grupos", grupos.size);

  const porPar = new Map(
    estado.projetos.map((p) => [
      `${p.developer_id}|${normalizarNome(p.name)}`,
      p.id,
    ]),
  );
  const registros = [];
  for (const [chave, grupo] of grupos) {
    // Mais frequente; empate resolvido pelo nome mais longo e depois alfabético,
    // para o vencedor não depender da ordem de leitura do arquivo.
    const nome = [...grupo.variantes.entries()].sort(
      (a, b) =>
        b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]),
    )[0][0];
    const existente =
      estado.mapaProj.get(chave) ??
      porPar.get(`${grupo.devId}|${normalizarNome(nome)}`);
    const id = existente ?? randomUUID();
    registros.push({
      id,
      bubbleId: chave,
      linha: existente
        ? null
        : { id, developer_id: grupo.devId, name: nome, active: true },
    });
  }

  await gravar(rel, "empreendimento", "developer_projects", registros, {
    onConflict: "developer_id,name",
  });
}

/** Os 3 atalhos. Único arquivo do grupo sem `unique id`: a chave é a URL normalizada. */
async function carregarLinks(rel, estado) {
  const existentes = new Map(estado.links.map((l) => [chaveUrl(l.url), l.id]));
  const lidos = [];
  for await (const linha of lerCsv(acharExport("export_All-links"))) {
    rel.conta("links:lidos");
    const url = limpar(linha.link);
    const criado = dataBubble(linha["Creation Date"]);
    if (!url || !criado) {
      rel.aviso(`link sem URL ou sem data: ${limpar(linha.nome) || "?"}`);
      continue;
    }
    lidos.push({ url, criado, linha });
  }

  lidos.sort((a, b) => a.criado.localeCompare(b.criado));
  const registros = lidos.map((item, i) => {
    const chave = chaveUrl(item.url);
    const existente = estado.mapaLink.get(chave) ?? existentes.get(chave);
    const id = existente ?? randomUUID();
    return {
      id,
      bubbleId: chave,
      linha: existente
        ? null
        : {
            id,
            label: limpar(item.linha.nome),
            url: item.url,
            // `icon` fica nulo: o legado não tem o campo e a tela nem lê a coluna
            // (`Links.tsx` desenha um `Link2` fixo em todo card). Nome de ícone aqui
            // seria dado inventado sem consumidor.
            icon: null,
            category: "geral",
            sort_order: i + 1,
            active: true,
            created_at: item.criado,
            updated_at: dataBubble(item.linha["Modified Date"]) ?? item.criado,
          },
    };
  });
  await gravar(rel, "link", "useful_links", registros);
}

/**
 * Conteúdo do mural: dicas e avisos. As duas tabelas têm o mesmo formato de origem
 * (uma coluna de texto rico + `Creator`) e o mesmo cuidado: `created_at` explícito é
 * obrigatório — `PipelineTopRanking.tsx:64` ordena o banner por ele, e no default
 * `now()` seis meses de mural viram empate.
 */
async function carregarConteudo(rel, estado, resolverCriador) {
  const dicas = await lerConteudo(rel, "export_All-dicadeouros", "dica");
  const avisos = await lerConteudo(
    rel,
    "export_All-mensagemdodias",
    "mensagem",
  );

  const porDica = new Map(
    estado.dicas.map((d) => [chaveMural(d.created_at, d.title), d.id]),
  );
  const porAviso = new Map(
    estado.avisos.map((a) => [chaveMural(a.starts_at, a.title), a.id]),
  );

  // Só a mais recente ativa: é a invariante do próprio app — `GamificationAdmin.tsx:39`
  // desativa todas antes de inserir uma nova e o banner lê `active=true … limit 1`.
  const registrosDica = dicas.map((item, i) => {
    const titulo = tituloDe(item.corpo, "Dica de ouro");
    const existente =
      estado.mapaDica.get(item.bubbleId) ??
      porDica.get(chaveMural(item.criado, titulo));
    const id = existente ?? randomUUID();
    return {
      id,
      bubbleId: item.bubbleId,
      linha: existente
        ? null
        : {
            id,
            title: titulo,
            body: item.corpo,
            author_id: resolverCriador(item.criador).id,
            sort_order: i + 1,
            active: i === dicas.length - 1,
            created_at: item.criado,
            updated_at: item.modificado,
          },
    };
  });
  await gravar(rel, "dica", "gold_tips", registrosDica);

  const registrosAviso = avisos.map((item, i) => {
    const titulo = tituloDe(item.corpo, "Recado Faceimob");
    const existente =
      estado.mapaAviso.get(item.bubbleId) ??
      porAviso.get(chaveMural(item.criado, titulo));
    const id = existente ?? randomUUID();
    // O cartaz do mural valia até ser substituído: `ends_at` é o `starts_at` do
    // seguinte; no último, 30 dias. Todas entram `active=false` — são campanhas de
    // jan–jun/2026 encerradas, e o aviso do seed continua sendo o que aparece.
    const proximo = avisos[i + 1]?.criado;
    return {
      id,
      bubbleId: item.bubbleId,
      linha: existente
        ? null
        : {
            id,
            title: titulo,
            body: item.corpo,
            severity: "info",
            starts_at: item.criado,
            ends_at:
              proximo ??
              new Date(Date.parse(item.criado) + 30 * DIA_MS).toISOString(),
            active: false,
            created_by: resolverCriador(item.criador).id,
            created_at: item.criado,
            updated_at: item.modificado,
          },
    };
  });
  await gravar(rel, "mensagem", "important_notices", registrosAviso);
}

/** Lê e limpa um CSV de conteúdo, já em ordem cronológica. */
async function lerConteudo(rel, prefixo, coluna) {
  const itens = [];
  for await (const linha of lerCsv(acharExport(prefixo))) {
    rel.conta(`${coluna}:lidas`);
    const bubbleId = linha["unique id"];
    const corpo = limparMarkup(linha[coluna]);
    const criado = dataBubble(linha["Creation Date"]);
    if (!bubbleId || !corpo || !criado) {
      // `title`, `body` e `starts_at` são NOT NULL: sem um dos três a linha não entra.
      rel.aviso(
        `${coluna} descartada (sem id, corpo ou data): ${bubbleId || "?"}`,
      );
      rel.conta(`${coluna}:descartadas`);
      continue;
    }
    itens.push({
      bubbleId,
      corpo,
      criado,
      modificado: dataBubble(linha["Modified Date"]) ?? criado,
      criador: limpar(linha.Creator),
    });
  }
  return itens.sort((a, b) => a.criado.localeCompare(b.criado));
}

// ── execução ─────────────────────────────────────────────────────────────────

async function main() {
  const rel = relatorio("catálogo");
  const estado = await estadoDestino(rel);

  // `dicadeouros` e `mensagemdodias` ainda são CSV, e lá `Creator` é nome de exibição
  // em 28/28 linhas ("Douglas Gomes") — o `Nome_completo` de `Users`. O ramo do id
  // (`porId`, do de-para da carga 01) fica pronto para quando esses dois vierem em JSON.
  // As duas colunas de autoria são nullable: sem o profile a carga segue, registra o
  // não-casamento e o vínculo é um UPDATE depois.
  const resolverCriador = criarResolvedor({
    porId: estado.mapaUser,
    porNome: indicePorNome(
      estado.profiles.map((p) => [normalizarNome(p.full_name), p.id]),
    ),
    rotulo: "creator",
  });

  const catalogo = await carregarDevelopers(rel, estado);
  await carregarProjetos(rel, estado, catalogo);
  await carregarLinks(rel, estado);
  await carregarConteudo(rel, estado, resolverCriador);
  resolverCriador.relatar(rel);

  rel.imprimir();

  // Linha recusada não pode liberar a carga 03: `run.mjs` só olha o código de saída,
  // e a 03 pula para sempre o negócio já presente no de-para. Mesmo padrão da 03.
  if (falhas > 0) {
    console.error(
      `\n${falhas} gravação(ões) recusada(s) pelo banco — a carga 02 NÃO está completa.` +
        "\nCorrija a causa (veja os avisos acima) e reexecute: o que entrou está no de-para e não duplica.",
    );
    process.exit(1);
  }
}

// ── autoteste ────────────────────────────────────────────────────────────────

/**
 * As três transformações que não são triviais e que gravam coluna NOT NULL:
 * limpeza de markup, título derivado e as chaves de casamento. Casos tirados do
 * corpus real — `node scripts/import/02-catalogo.mjs --autoteste`.
 */
async function autoteste() {
  const { default: assert } = await import("node:assert/strict");

  assert.equal(limparMarkup("[h2][b]😉💰🚀[/b][/h2]"), "😉💰🚀");
  assert.equal(limparMarkup("a [li indent=0 align=left]b"), "a b");
  assert.equal(
    limparMarkup("[b][color=rgb(255, 255, 255)]ORE ET LABORE[/color][/b]"),
    "ORE ET LABORE",
  );
  assert.equal(
    limparMarkup("veja [youtube]XEsKqh-2e3U[/youtube]"),
    "veja\nhttps://youtu.be/XEsKqh-2e3U",
  );
  assert.equal(limparMarkup("🥳 *BATEU LEVOU* 🥳"), "🥳 BATEU LEVOU 🥳");
  assert.equal(limparMarkup("  a \n\n\n\n b  "), "a\n\nb");

  assert.equal(
    tituloDe("💡 Dica de Ouro – Vendas MCMV 👉 Pare de vender", "x"),
    "💡 Dica de Ouro – Vendas MCMV",
  );
  assert.equal(
    tituloDe("🏡 Quem acompanha, vende!\nresto", "x"),
    "🏡 Quem acompanha, vende",
  );
  assert.equal(tituloDe("", "Dica de ouro"), "Dica de ouro");
  assert.equal(tituloDe("...!?", "Recado"), "Recado");
  // Corte por code point: fatiar por UTF-16 partiria o emoji em surrogate solto.
  const longo = tituloDe("🚀".repeat(70), "x");
  assert.equal([...longo].length, 61);
  assert.ok(
    !/[\uD800-\uDFFF]/.test(
      longo.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ""),
    ),
  );

  // Chave do mural: o destino devolve o instante em UTC, a origem em -03:00.
  assert.equal(
    chaveMural("2026-01-06T09:00:00-03:00", "Dica"),
    chaveMural("2026-01-06T12:00:00+00:00", "Dica"),
  );
  assert.notEqual(
    chaveMural("2026-01-06T09:00:00-03:00", "Dica"),
    chaveMural("2026-01-06T09:00:00-03:00", "Outra"),
  );

  assert.equal(chaveNome("MAISLAR"), chaveNome("MAIS LAR"));
  assert.notEqual(chaveNome("LOTTICI"), chaveNome("LOTTICCI"));
  assert.equal(slugificar("MAIS LAR"), "mais-lar");
  assert.equal(slugificar("Harmonia"), "harmonia");
  assert.equal(chaveUrl("https://Faceimob.com.br/"), "https://faceimob.com.br");
  // Os 8 pares-placeholder da lista nominal têm de cair nas 6 chaves declaradas.
  for (const [c, e] of [
    ["TENDA", "?"],
    ["TENDA", "0"],
    ["TENDA", "."],
    ["AVULSO", "?"],
    ["AVULSO", "."],
    ["AVULSO", "AVULSO"],
    ["VASCO", "AVULSO"],
    ["CYRELA", "AVULSO"],
  ])
    assert.ok(
      PLACEHOLDERS.has(`${chaveNome(c)}|${normalizarNome(e)}`),
      `placeholder não coberto: ${c}/${e}`,
    );

  console.log("autoteste: OK");
}

const rodar = process.argv.includes("--autoteste") ? autoteste : main;
rodar().catch((e) => {
  console.error(String(e?.message || e));
  process.exit(1);
});
