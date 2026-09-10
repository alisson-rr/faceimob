#!/usr/bin/env node
/**
 * Carga 03b — Comentários e trilha de anexos dos negócios (Bubble → Supabase).
 *
 * O QUE CARREGA (reexport de 09/09; os números do CSV de 08/09 estão obsoletos)
 *   24.822 observações → 24.628 comentários (`kind='comment'`), o texto que a
 *   operação lê no negócio; e 10.372 snapshots de anexos → 10.110 linhas de
 *   trilha (`kind='bubble_docs_snapshot'`), com as 73.215 referências de arquivo
 *   em `detail`.
 *   Nenhum arquivo é baixado nem enviado ao Storage: aqui só entra a URL que o
 *   Bubble já publicava.
 *
 * DE ONDE (`acharExport`: JSON do reexport de 09/09 antes do CSV de 08/09)
 *   export_All-observacaoPipelines…json (24.822 × 8 colunas)
 *   export_All-historicoPipes…json      (10.372 × 9 colunas)
 *   export_All-pipelines…json e export_All-Users…json só no `--dry-run` SEM
 *   credencial, para o de-para de mentira (ver `deParaEntrada`).
 *
 * PARA ONDE
 *   `public.deal_history` + o de-para em `public.import_bubble_map`
 *   (entidades `observacao` e `historico_pipe`, ambas → `deal_history`).
 *
 *   node scripts/import/03b-historico.mjs --dry-run   → lê, resolve, mede e NÃO grava
 *   node scripts/import/03b-historico.mjs             → grava (exige SUPABASE_SERVICE_ROLE_KEY)
 *   node scripts/import/03b-historico.mjs --autoteste → confere as regras de descarte
 *
 * POR QUE ESTA CARGA SÓ EXISTE AGORA: era a Onda 2 de `DECISOES.md`, parada
 * porque `observacaoPipelines.pipeline` vinha como NOME do cliente — 101 nomes
 * apontavam para 2+ negócios e o mapa (`mapa/negocios.md` §5.3) previa um
 * desempate temporal com até 305 linhas indo para o negócio errado. No JSON a
 * coluna é `unique id` em 10.372/10.372 e 24.822/24.822, e todos existem no
 * export de `pipelines`: a ambiguidade não existe mais e o desempate nunca
 * precisou ser escrito.
 *
 * COLUNAS USADAS (o resto é descarte medido, não esquecimento)
 *   observacaoPipelines: `observacao` (texto), `pipeline` (id), `Creator` (id),
 *     `Creation Date`, `unique id`. `data` só entra na chave de duplicata.
 *     DESCARTADAS: `data` como valor (é `Creation Date`, mesmo dia em 24.822/24.822),
 *     `Modified Date` (igual a `Creation Date` em 24.822/24.822 — append-only),
 *     `Slug` (0 preenchidas).
 *   historicoPipes: `arquivos` (lista), `nomesArquivos` (cru, ver abaixo),
 *     `pipeline` (id), `Creator` (id), `Creation Date`, `unique id`.
 *     DESCARTADAS: `ativo` (`não` em 10.372/10.372, cardinalidade 1),
 *     `Modified Date` (igual a `Creation Date` em 10.367/10.372), `Slug` (0).
 *
 * O QUE PRECISA ESTAR DESLIGADO ANTES: **nada**. `deal_history` não tem
 * gatilho nenhum — só o índice `deal_history_deal_idx` e a policy
 * `deal_history_select` (`0006:361,649`), e `service_role` não passa por RLS.
 * Esta carga não dá UPDATE em `deals`, então nenhum gatilho de `deals` acorda.
 * Ela DEPENDE da carga 03: sem `('pipeline' → 'deals')` no de-para toda linha
 * daqui seria órfã, e o script aborta antes de ler o primeiro arquivo.
 *
 * ─── SQL QUE PROVA QUE DEU CERTO ─────────────────────────────────────────────
 *
 *   -- volume por procedência (nunca count(*) de tabela: o destino tem seed e demo, R-02)
 *   select entidade, count(*) from public.import_bubble_map
 *    where tabela_destino = 'deal_history' group by 1;
 *                                        -- observacao 24.628 · historico_pipe 10.110
 *
 *   -- os dois tipos, na proporção esperada
 *   select h.kind, count(*) from public.deal_history h
 *     join public.import_bubble_map m
 *       on m.registro_id = h.id and m.tabela_destino = 'deal_history'
 *    group by 1;                 -- comment 24.628 · bubble_docs_snapshot 10.110
 *
 *   -- nenhum comentário fantasma: o texto é o produto desta carga
 *   select count(*) from public.deal_history h
 *     join public.import_bubble_map m
 *       on m.registro_id = h.id and m.entidade = 'observacao'
 *    where coalesce(h.to_value, '') = '';                                -- 0
 *
 *   -- autoria: `Creator` resolve em 100% no reexport, então nenhum autor nulo
 *   select count(*) from public.deal_history h
 *     join public.import_bubble_map m
 *       on m.registro_id = h.id and m.tabela_destino = 'deal_history'
 *    where h.actor_id is null;                                           -- 0
 *
 *   -- a data veio do dado, não do relógio da carga
 *   select min(created_at)::date, max(created_at)::date from public.deal_history h
 *     join public.import_bubble_map m
 *       on m.registro_id = h.id and m.tabela_destino = 'deal_history';
 *                                                    -- 2024-11-13 · 2026-09-09
 *
 *   -- a trilha de anexos tem arquivo (linha sem arquivo não entra)
 *   select count(*) from public.deal_history h
 *     join public.import_bubble_map m
 *       on m.registro_id = h.id and m.entidade = 'historico_pipe'
 *    where jsonb_array_length(h.detail->'files') = 0;                    -- 0
 *
 *   -- reexecutar não duplica: o id é UUIDv5 do `unique id` do Bubble
 *   select id, count(*) from public.deal_history group by 1 having count(*) > 1;  -- 0
 *
 * ─── DECISÕES QUE ESTE ARQUIVO IMPLEMENTA ────────────────────────────────────
 *
 * · **Tudo entra como `kind='comment'`, com o texto inteiro em `to_value`.**
 *   4.594 observações (18,5%) começam com `STATUS: <código>` e dariam
 *   `kind='cca_status_changed'` (N-21). Não estruturar: `DealCommentsPanel`
 *   filtra `kind='comment'` (`DealCommentsPanel.tsx:30-31`) e estruturar
 *   ESCONDERIA o laudo de crédito da única tela que a operação lê. O prefixo
 *   continua no texto e a estruturação é derivável a qualquer momento, sem
 *   reimportar. O relatório conta quantas linhas seriam.
 *   `ponytail: sem cca_case_events; evoluir quando existir tela que leia esse
 *   kind e mostre o corpo junto.`
 * · **Descartes antes de inserir**, contados um a um no relatório: observação
 *   com texto vazio (172 — `to_value` vazio é comentário fantasma) e duplicata
 *   exata. A chave da duplicata é `(pipeline, texto, data)` e NÃO
 *   `Creation Date`: `data` é o dia truncado, e é ela que junta o mesmo texto
 *   salvo duas vezes no mesmo dia (22 linhas; por `Creation Date` seria 1).
 *   Em `historicoPipes` a chave equivalente é `(pipeline, arquivos, Creation Date)`
 *   — snapshot idêntico no mesmo instante é duplo-clique de save (29 linhas) —
 *   mais as 233 linhas sem arquivo nenhum, que não são snapshot de coisa alguma.
 * · **`nomesArquivos` entra cru, como string única, em `detail->>'file_names'`.**
 *   Não é splitado: em 653 linhas o separador `" , "` cai dentro do nome do
 *   arquivo e a lista fica ambígua (`perfil/documentos.md` §8) — a lista boa é
 *   `arquivos`, e o nome sai do basename da URL. É também onde moram os 32
 *   caracteres corrompidos (U+FFFD) do export, todos nesta coluna, em 16
 *   registros: gravados como vieram, nunca adivinhados, e contados no relatório.
 * · **`bubble_docs_snapshot` não tem rótulo no front.** `DealHistoryPanel`
 *   mostra a chave crua quando o `kind` não está no catálogo
 *   (`DealHistoryPanel.tsx:8-20,79`), então 10.110 linhas aparecem com o nome
 *   técnico no histórico de 2.398 negócios. É cosmético e vive em outro arquivo
 *   — está nas pendências da entrega.
 *
 * Nenhum CPF, PIS, telefone ou e-mail é lido aqui: as duas origens não têm
 * essas colunas. O texto da observação PODE conter dado pessoal digitado pelo
 * analista, e por isso nenhum trecho de `observacao` é impresso no relatório.
 */
import { createHash } from "node:crypto";

import {
  acharExport,
  criarResolvedor,
  dataBubble,
  ehDryRun,
  inserirEmLote,
  lerCsv,
  lerMapa,
  listaBubble,
  registrarMapa,
  relatorio,
  supa,
} from "./lib/bubble.mjs";

const rel = relatorio("03b-historico");

// ── id determinístico ────────────────────────────────────────────────────────

/**
 * UUIDv5 (RFC 4122), mesmo namespace das cargas 03 e 04: o `id` do destino é
 * função pura do `unique id` do Bubble, então `on conflict (id) do nothing`
 * torna a reexecução inócua. `deal_history` não tem outra chave natural — é
 * aqui que a idempotência mora, junto com o de-para.
 */
function uuid5(ns, nome) {
  const h = createHash("sha1")
    .update(Buffer.from(ns.replace(/-/g, ""), "hex"))
    .update(Buffer.from(nome, "utf8"))
    .digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const s = h.subarray(0, 16).toString("hex");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}
const NS = uuid5("6ba7b811-9dad-11d1-80b4-00c04fd430c8", "https://faceimob.com.br/import/bubble");
const det = (entidade, ...partes) => uuid5(NS, `${entidade}:${partes.join(":")}`);

/** Prefixo do retorno formal da esteira de crédito. Só conta, não estrutura (N-21). */
const PREFIXO_STATUS = /^\s*STATUS\s*:/i;

/** O caractere que o export do Bubble deixou no lugar da letra acentuada. */
const CORROMPIDO = "�";

// ── de-para de entrada ───────────────────────────────────────────────────────

let ONLINE = true;

/**
 * `unique id` do Bubble → id do destino, do que a carga anterior gravou.
 *
 * Sem credencial o `--dry-run` usa o próprio uid como id de mentira, tirado do
 * export daquela entidade: offline o que se mede é volume e taxa de casamento,
 * não o uuid final — e uma linha que aponta para um `unique id` inexistente no
 * export continua sendo contada como órfã. Nada disso chega a banco:
 * `inserirEmLote` não escreve em dry-run.
 */
async function deParaEntrada(entidade, tabelaDestino, prefixoExport) {
  if (ONLINE) return lerMapa(entidade, tabelaDestino);
  const mapa = new Map();
  for await (const linha of lerCsv(acharExport(prefixoExport))) {
    const uid = String(linha["unique id"] ?? "").trim();
    if (uid) mapa.set(uid, uid);
  }
  return mapa;
}

// ── montagem de uma linha ────────────────────────────────────────────────────

/**
 * Uma linha de `deal_history`.
 *
 * `created_at` ausente NÃO vira null: a coluna é `not null default now()` e um
 * null explícito é 23502 — perderia o registro inteiro por causa da data. Sem
 * data legível a linha entra com o relógio do banco e a anomalia fica contada:
 * pior que a data real, melhor que perder o comentário.
 */
function historico(campos, criado) {
  const quando = dataBubble(criado);
  if (!quando) rel.conta("data_ilegivel_usou_relogio_do_banco");
  return quando ? { ...campos, created_at: quando } : campos;
}

async function gravar(tabela, linhas, onConflict) {
  const { inseridos, erros } = await inserirEmLote(tabela, linhas, { onConflict });
  rel.conta(`${tabela}:inseridos`, inseridos);
  rel.conta(`${tabela}:enviados`, linhas.length);
  for (const e of erros.slice(0, 20)) rel.aviso(`${tabela} linha ${e.indice}: ${e.mensagem}`);
  if (erros.length > 20) rel.aviso(`${tabela}: mais ${erros.length - 20} linhas com erro`);
  rel.conta(`${tabela}:erros`, erros.length);
  // Os `id` que o BANCO recusou. Quem falhou não pode entrar no de-para: a
  // reexecução pularia uma linha que nunca existiu, e o aceite por
  // `count(*) from import_bubble_map` fecharia em cima do buraco (R-01/R-02).
  return new Set(erros.map((e) => linhas[e.indice]?.id));
}

// ── leitura das duas origens ─────────────────────────────────────────────────

/**
 * `observacaoPipelines` → comentários. Devolve as linhas de destino e os pares
 * do de-para; linha descartada não vira nenhum dos dois, só contagem.
 */
async function lerObservacoes({ negocio, autor, janela }) {
  const linhas = [];
  const pares = [];
  const vistas = new Set();
  let lidas = 0;

  for await (const o of lerCsv(acharExport("export_All-observacaoPipelines"))) {
    lidas++;
    const uid = String(o["unique id"] ?? "").trim();
    const texto = String(o.observacao ?? "").trim();
    if (!uid) {
      rel.conta("observacao:sem_unique_id");
      continue;
    }
    if (texto === "") {
      rel.conta("observacao:texto_vazio_descartado");
      continue;
    }
    const chave = `${o.pipeline}|${texto}|${o.data}`;
    if (vistas.has(chave)) {
      rel.conta("observacao:duplicata_exata_descartada");
      continue;
    }
    vistas.add(chave);

    const deal = negocio(o.pipeline);
    if (!deal.id) {
      rel.conta("observacao:negocio_inexistente_no_destino");
      continue;
    }
    if (PREFIXO_STATUS.test(texto)) rel.conta("observacao:prefixo_status_nao_estruturado");
    if (texto.includes(CORROMPIDO)) rel.conta("observacao:texto_com_caractere_corrompido");

    const id = det("observacaoPipelines", uid);
    linhas.push(
      historico(
        {
          id,
          deal_id: deal.id,
          actor_id: autor(o.Creator).id,
          kind: "comment",
          to_value: texto,
        },
        o["Creation Date"],
      ),
    );
    pares.push({ bubble_id: uid, tabela_destino: "deal_history", registro_id: id });
    janela(o["Creation Date"]);
  }
  rel.conta("observacao:lidas", lidas);
  return { linhas, pares };
}

/**
 * `historicoPipes` → trilha de anexos. Cada linha é a lista INTEIRA de anexos
 * do negócio naquele instante (`perfil/documentos.md` §9), não um arquivo
 * substituído: por isso vira um snapshot em `detail`, e não linha de documento.
 */
async function lerSnapshots({ negocio, autor, janela }) {
  const linhas = [];
  const pares = [];
  const vistas = new Set();
  let lidas = 0;

  for await (const h of lerCsv(acharExport("export_All-historicoPipes"))) {
    lidas++;
    const uid = String(h["unique id"] ?? "").trim();
    const arquivos = listaBubble(h.arquivos);
    if (!uid) {
      rel.conta("historico:sem_unique_id");
      continue;
    }
    if (arquivos.length === 0) {
      rel.conta("historico:sem_arquivo_descartado");
      continue;
    }
    const chave = `${h.pipeline}|${h.arquivos}|${h["Creation Date"]}`;
    if (vistas.has(chave)) {
      rel.conta("historico:duplicata_exata_descartada");
      continue;
    }
    vistas.add(chave);

    const deal = negocio(h.pipeline);
    if (!deal.id) {
      rel.conta("historico:negocio_inexistente_no_destino");
      continue;
    }
    const nomes = String(h.nomesArquivos ?? "");
    const corrompidos = nomes.split(CORROMPIDO).length - 1;
    if (corrompidos > 0) {
      rel.conta("historico:nome_com_caractere_corrompido");
      rel.conta("historico:caracteres_corrompidos", corrompidos);
    }
    rel.conta("historico:arquivos_referenciados", arquivos.length);

    const id = det("historicoPipes", uid);
    linhas.push(
      historico(
        {
          id,
          deal_id: deal.id,
          actor_id: autor(h.Creator).id,
          kind: "bubble_docs_snapshot",
          detail: { files: arquivos, file_names: nomes === "" ? null : nomes },
        },
        h["Creation Date"],
      ),
    );
    pares.push({ bubble_id: uid, tabela_destino: "deal_history", registro_id: id });
    janela(h["Creation Date"]);
  }
  rel.conta("historico:lidas", lidas);
  return { linhas, pares };
}

// ── carga ────────────────────────────────────────────────────────────────────

async function principal() {
  try {
    supa();
  } catch (e) {
    if (!ehDryRun()) throw e;
    ONLINE = false;
    rel.aviso(`sem banco (${e.message.split("\n")[0]}) — dry-run offline: o de-para sai dos exports`);
  }

  const deals = await deParaEntrada("pipeline", "deals", "export_All-pipelines");
  if (deals.size === 0) {
    throw new Error(
      "import_bubble_map não tem nenhum par ('pipeline' → 'deals'): os negócios não existem no destino. " +
        "Rode `node scripts/import/run.mjs negocios` antes — sem eles as 34.738 linhas daqui seriam órfãs " +
        "e deal_history.deal_id é NOT NULL.",
    );
  }
  const pessoas = await deParaEntrada("user", "profiles", "export_All-Users");
  if (pessoas.size === 0) {
    // `actor_id` é nullable, então o banco aceitaria — e é justamente por isso
    // que isto precisa abortar: 35 mil comentários sem autor entram calados, e
    // `on conflict do nothing` faz a reexecução pular todos para sempre.
    const recado =
      "import_bubble_map não tem nenhum par ('user' → 'profiles'): TODA linha entraria sem autor, " +
      "e a reexecução não corrigiria (o insert é DO NOTHING). Rode `node scripts/import/run.mjs pessoas` antes.";
    if (ehDryRun()) rel.aviso(recado);
    else throw new Error(recado);
  }

  // Sem ramo de nome de propósito: as duas colunas são `unique id` em 100% das
  // linhas do reexport. Um valor que não seja id cai em "ausente" e é contado,
  // que é o que se quer saber se o cliente reexportar com `-modified` por engano.
  const vazio = new Map();
  const negocio = criarResolvedor({ porId: deals, porNome: vazio, rotulo: "negocio" });
  const autor = criarResolvedor({ porId: pessoas, porNome: vazio, rotulo: "autor" });

  // Faixa de datas do que vai entrar: é o que prova, no aceite, que o
  // `created_at` saiu do dado e não do relógio da carga. Comparar as strings
  // basta porque o dado todo é pós-2019 — offset -03:00 em 100% das linhas.
  let menor = null;
  let maior = null;
  const janela = (bruto) => {
    const d = dataBubble(bruto);
    if (!d) return;
    if (menor === null || d < menor) menor = d;
    if (maior === null || d > maior) maior = d;
  };

  const observacoes = await lerObservacoes({ negocio, autor, janela });
  const snapshots = await lerSnapshots({ negocio, autor, janela });

  const linhas = [...observacoes.linhas, ...snapshots.linhas];
  // Zero linha com de-para cheio não é "nada a fazer": é o vínculo não tendo
  // casado — export errado na pasta, ou negócios de outro banco no de-para.
  // Sem esta trava a carga sai com sucesso e sem gravar nada.
  if (linhas.length === 0) {
    throw new Error(
      "nenhuma das 35 mil linhas de observação/histórico casou com um negócio do destino. " +
        "Confira se os exports em DOCUMENTOS/DADOS_BUBBLE/json são do mesmo app que gerou os negócios importados.",
    );
  }
  // Conflito pela PK: o `id` é UUIDv5 do `unique id` do Bubble e `deal_history`
  // não tem unique natural — mirar outra coluna deixaria a PK como segunda
  // chave violável, e aí o DO NOTHING vira 23505.
  const recusados = await gravar("deal_history", linhas, "id");

  let erros = recusados.size;
  const paresPorEntidade = [
    ["observacao", observacoes.pares],
    ["historico_pipe", snapshots.pares],
  ];
  for (const [entidade, pares] of paresPorEntidade) {
    // O de-para recebe a linha que o banco ACEITOU: `registro_id` não tem FK
    // (destino polimórfico, 0096:53), então o par de uma linha recusada
    // apontaria para um uuid inexistente e a reexecução nunca mais tentaria.
    const aceitos = pares.filter((p) => !recusados.has(p.registro_id));
    rel.conta(`import_bubble_map:${entidade}`, aceitos.length);
    if (aceitos.length < pares.length) {
      rel.aviso(
        `${pares.length - aceitos.length} linha(s) de ${entidade} recusadas pelo banco ficaram FORA do de-para ` +
          `de propósito. Corrija o motivo e rode de novo: o id é UUIDv5 e o insert é DO NOTHING.`,
      );
    }
    if (!ehDryRun() && ONLINE) {
      const { erros: falhas } = await registrarMapa(entidade, aceitos);
      erros += falhas.length;
      for (const e of falhas.slice(0, 20)) rel.aviso(`import_bubble_map ${entidade} linha ${e.indice}: ${e.mensagem}`);
    }
  }

  negocio.relatar(rel);
  autor.relatar(rel);
  if (menor) rel.aviso(`faixa de created_at que vai entrar: ${menor} → ${maior}`);
  rel.imprimir();

  if (erros > 0) {
    console.error(`\n${erros} linha(s) não entraram. Veja os avisos acima antes de reexecutar.`);
    process.exit(1);
  }
}

// ── autoteste (sem banco) ────────────────────────────────────────────────────

/**
 * As regras que decidem o que NÃO entra, medidas contra o corpus real —
 * `node scripts/import/03b-historico.mjs --autoteste`.
 *
 * Os volumes são do export de 09/09. Se o cliente reexportar, este teste falha
 * de propósito: o número novo tem de ser remedido e o cabeçalho, atualizado.
 */
async function autoteste() {
  const { default: assert } = await import("node:assert/strict");

  // A armadilha do NOT NULL: data ilegível some do payload em vez de virar null.
  assert.equal(historico({ id: "x" }, "May 11, 2024 6:18 pm").created_at, "2024-05-11T18:18:00-03:00");
  assert.ok(!("created_at" in historico({ id: "x" }, "ontem à tarde")));

  const eu = (v) => ({ id: String(v ?? "").trim() || null });
  const ctx = { negocio: eu, autor: eu, janela: () => {} };

  const obs = await lerObservacoes(ctx);
  assert.equal(obs.linhas.length, 24628, "volume de comentários mudou — remeça e atualize o cabeçalho");
  assert.equal(obs.pares.length, obs.linhas.length);
  assert.ok(obs.linhas.every((l) => l.kind === "comment" && l.to_value));

  const snap = await lerSnapshots(ctx);
  assert.equal(snap.linhas.length, 10110, "volume de snapshots mudou — remeça e atualize o cabeçalho");
  assert.ok(snap.linhas.every((l) => l.detail.files.length > 0));

  // UUIDv5 do `unique id`: sem id repetido, o `do nothing` da reexecução não
  // engole linha diferente que colidiu na PK.
  const ids = new Set([...obs.linhas, ...snap.linhas].map((l) => l.id));
  assert.equal(ids.size, obs.linhas.length + snap.linhas.length);

  console.log("autoteste: OK");
}

const rodar = process.argv.includes("--autoteste") ? autoteste : principal;
rodar().catch((e) => {
  if (rodar === principal) rel.imprimir();
  console.error(`\n[03b-historico] ABORTADO: ${e.message}`);
  process.exit(1);
});
