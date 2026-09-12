#!/usr/bin/env node
/**
 * Carga 06 — Documentos dos negócios (Bubble → Supabase).
 *
 * O QUE CARREGA
 *   A caixa de anexos de cada negócio: 29.573 linhas em `public.deal_documents`
 *   para 4.355 negócios, das quais 21.758 ganham o binário no bucket privado
 *   `deal-documents` (~8,9 GB pela média de uma amostra HEAD de 30, ~4,4 GB pela
 *   mediana) e 7.815 entram como registro SEM arquivo (N-28, abaixo).
 *   Cada linha é um par (negócio, arquivo) — é a unidade de R-14.
 *
 * DE ONDE (`acharExport`: não há JSON de doc-clientes; cai no CSV de 08/09)
 *   export_All-doc-clientes-modified…csv (25.890 × 23) — `arquivos`, `pipeline`,
 *     `url_1`…`url_16`, `Creation Date`, `Modified Date`, `Creator`, `unique id`.
 *   export_All-pipelines…json (7.579 × 110) — só `unique id`, `doc`, `CLIENTE` e
 *     `Modified Date`: é a ponte por id, o de-para por nome e o recorte de 12 meses.
 *   export_All-Users…json — só no `--dry-run` SEM credencial, para o de-para de
 *     mentira (ver `deParaEntrada`).
 *   Os binários vêm do CDN público do Bubble, uma URL por arquivo.
 *
 * PARA ONDE
 *   `public.deal_documents` + objetos em `storage.objects` (bucket
 *   `deal-documents`, privado, teto de 25 MB, sem restrição de MIME) + o de-para
 *   em `public.import_bubble_map` (entidade `doc_arquivo` → `deal_documents`).
 *
 *   node scripts/import/06-documentos.mjs --dry-run   → monta o índice, mede e NÃO baixa/sobe/grava
 *   node scripts/import/06-documentos.mjs             → carrega (exige SUPABASE_SERVICE_ROLE_KEY)
 *   node scripts/import/06-documentos.mjs --autoteste → confere as regras sem rede e sem banco
 *
 * ─── O QUE PRECISA ESTAR DESLIGADO ANTES ─────────────────────────────────────
 *
 *   alter table public.deal_documents disable trigger deal_documents_award_points;
 *   -- … carga …
 *   alter table public.deal_documents enable  trigger deal_documents_award_points;
 *
 * É o único gatilho de efeito colateral no caminho (`0060:483-486`): todo INSERT
 * num negócio da etapa `incomplete` pontua o jogo — na temporada ABERTA HOJE,
 * com `now()`, para cada corretor participante. São 73 negócios do índice nessa
 * etapa (420 arquivos); pouco volume, mas mexe no pódio corrente com documento
 * de 2024. `deal_documents_enforce_single` e `deal_documents_supersede` ficam
 * LIGADOS de propósito: são eles que versionam, e a ordem cronológica de
 * inserção deste script — e a separação em ondas de `ondas` — existem para eles
 * (alvo cca §(d)).
 *
 * NÃO é preciso mexer em `deals`: esta carga não dá UPDATE em negócio nenhum,
 * então `deals_guard_closed_month` e `deals_guard_document_review` não acordam.
 *
 * DEPENDE das cargas 01 (pessoas) e 03 (negócios): sem
 * `('pipeline' → 'deals')` no de-para toda linha daqui seria órfã e
 * `deal_documents.deal_id` é NOT NULL.
 *
 * ─── SQL QUE PROVA QUE DEU CERTO ─────────────────────────────────────────────
 *
 *   -- volume da carga (nunca count(*) da tabela: o destino tem seed e demo, R-02)
 *   select count(*) from public.import_bubble_map
 *    where entidade = 'doc_arquivo' and tabela_destino = 'deal_documents';
 *                                                       -- 29.573
 *
 *   -- N-28: quem ficou sem binário está marcado no caminho, e só ele
 *   select (storage_path like '%/nao-migrado/%') as sem_arquivo, count(*)
 *     from public.deal_documents d
 *     join public.import_bubble_map m on m.registro_id = d.id and m.entidade = 'doc_arquivo'
 *    group by 1;        -- false 21.758 · true 7.815
 *
 *   -- N-27: nenhum CPF sobrou no nome que a tela mostra e o e-mail anexa.
 *   -- `[0-9]{11}` SEM âncora casa dentro de uma corrida maior de dígitos e acusa
 *   -- falso positivo: `impressao-20260722140305.pdf` (carimbo do Bubble, 14
 *   -- dígitos) reprovaria uma carga correta. As bordas `(^|[^0-9])` são a âncora.
 *   select count(*) from public.deal_documents d
 *     join public.import_bubble_map m on m.registro_id = d.id and m.entidade = 'doc_arquivo'
 *    where d.stored_name ~ '(^|[^0-9])[0-9]([0-9-]*[0-9])?([^0-9]|$)'
 *      and (select count(*) from regexp_matches(d.stored_name, '[0-9]', 'g')) = 11;   -- 0
 *   -- `sanear` deixa só [a-z0-9-] em stored_name, então a janela de 11 dígitos é a
 *   -- única forma que um CPF sobrevivente pode ter. Contar dígito é o mesmo
 *   -- critério do código (mascararCpf), não um segundo critério que pode divergir.
 *
 *   -- N-20: o catálogo continua com os 9 do seed, e `outros` é o esperado
 *   select t.code, count(*) from public.deal_documents d
 *     join public.document_types t on t.id = d.document_type_id
 *     join public.import_bubble_map m on m.registro_id = d.id and m.entidade = 'doc_arquivo'
 *    group by 1 order by 2 desc;              -- outros ≈ 29% do total (N-20)
 *
 *   -- versionamento: EXATAMENTE um vigente por par, em tipo que não é
 *   -- allows_multiple. Precisa ser `<> 1`, não `> 1`: o defeito do gatilho em
 *   -- statement multi-linha deixa ZERO vigente, e um teste de `> 1` aprova isso.
 *   -- Contar sobre o par (e não filtrar antes) é o que enxerga o zero.
 *   select d.deal_id, d.document_type_id,
 *          count(*) filter (where d.superseded_at is null) as vigentes
 *     from public.deal_documents d
 *     join public.document_types t on t.id = d.document_type_id
 *     join public.import_bubble_map m on m.registro_id = d.id and m.entidade = 'doc_arquivo'
 *    where not t.allows_multiple
 *    group by 1, 2
 *   having count(*) filter (where d.superseded_at is null) <> 1;             -- 0
 *
 *   -- a data veio do dado, não do relógio da carga
 *   select min(d.created_at)::date, max(d.created_at)::date
 *     from public.deal_documents d
 *     join public.import_bubble_map m on m.registro_id = d.id and m.entidade = 'doc_arquivo';
 *                                                      -- 2024-09-27 · 2026-09-08
 *
 *   -- linha × objeto: todo caminho SEM a marca precisa existir no bucket.
 *   -- Não há SQL que case as duas gravações (alvo cca §14.13); a conferência é
 *   -- pela tela (`missingStoragePaths`, src/integrations/supabase/documents.ts:317)
 *   -- ou repetindo esta carga, que só reenvia o que não está no de-para.
 *
 * ─── DECISÕES QUE ESTE ARQUIVO IMPLEMENTA ────────────────────────────────────
 *
 * · **N-28 — só os últimos 12 meses ganham binário.** `MOVIMENTO_DESDE` é uma
 *   CONSTANTE (09/09/2025), não `now() - 12 meses`: data calculada mudaria o
 *   recorte a cada execução e a segunda rodada baixaria um conjunto diferente do
 *   que o de-para registrou. A movimentação do negócio é `pipelines.Modified Date`
 *   — medido: usar `max(pipelines.Modified, doc-clientes.Modified)` dá EXATAMENTE
 *   o mesmo recorte (mesmos negócios, mesmos arquivos), porque mexer na caixa de
 *   anexos sempre tocou o pipeline. Fora do recorte a linha entra com
 *   `storage_path` = `<deal_id>/nao-migrado/<id do arquivo>-<nome>`: a MARCA é o
 *   segmento `nao-migrado/`, achável por um `like`, e o prefixo continua sendo o
 *   UUID do negócio — então o dia em que alguém baixar o arquivo, o caminho já
 *   está reservado e a policy `deal_documents_storage` autoriza a escrita
 *   (`deal_id_of_object` lê só o primeiro segmento, `0059:301-310`). Essas linhas
 *   também nascem com `mime_type` e `size_bytes` nulos: nada foi medido nelas.
 *   Arquivo maior que o teto de 25 MB do bucket recebe o mesmo tratamento e conta
 *   à parte no relatório.
 * · **N-20 — os 9 `document_types` do seed, sem tipo novo.** O classificador é o
 *   de `mapa/documentos.md` §3.2, na ordem da tabela, sobre o nome do arquivo.
 *   Medido neste índice: `outros` 8.659 de 29.573 (29,3%, as 763 "carta de
 *   cancelamento" incluídas) · comprovante_renda 4.721 · rg_cpf 4.240 ·
 *   simulacao 3.392 · comprovante_resid 2.875 · ctps 2.724 · certidao_civil
 *   1.592 · extrato_fgts 936 · imposto_renda 434. É heurística de NOME, não de
 *   conteúdo, e não foi validada contra os PDFs.
 * · **N-27 — `stored_name` mascarado, `original_name` cru.** 1.689 nomes deste
 *   índice carregam CPF. `stored_name` é o que a tela mostra, o que vai no
 *   `Content-Disposition` do download e o nome do anexo no e-mail para a
 *   construtora (`submission-dispatch/index.ts:301`) — nele o CPF vira `***`, e a
 *   máscara é aplicada ANTES de sanear (senão `601.123.456-08` viraria
 *   `601-123-456-08` e escaparia). O separador é `[.\s-]+`, não um só: nome
 *   digitado à mão traz separador REPETIDO e MISTO (`601..123.456-08`,
 *   `601. -123 456 - 08`), e exigir exatamente um deixava passar 6 CPFs INTEIROS
 *   para a tela, para o cabeçalho do download e para o anexo do e-mail — são os
 *   6 de `n27:cpf_perdido_por_um_separador_so` no relatório, a diferença entre os
 *   1.683 da regra antiga e os 1.689 desta. Corrida longa de dígitos NÃO é CPF:
 *   `(?<!\d)\d{11}(?!\d)` preserva o carimbo `Impressao_20260722140305.pdf`.
 *   `original_name` guarda o nome real: é o dado de auditoria, e some da tela se
 *   for mascarado também.
 * · **R-14 — um objeto por par (negócio, arquivo).** O caminho carrega o
 *   `deal_id`, então o mesmo arquivo em dois negócios exige DOIS objetos, e a
 *   unidade de trabalho (a chave do de-para, o `id` da linha, o caminho) é o
 *   PAR, não o arquivo. Medido no export de 08/09: nenhum arquivo cai em dois
 *   negócios (29.573 pares = 29.573 arquivos distintos) — porque o pacote de
 *   nome ambíguo é descartado em vez de duplicado. Como a repetição não existe
 *   HOJE, não há cache de download entre pares: seria estrutura para zero caso.
 *   `ponytail: sem cache arquivo→bytes; evoluir se um export futuro (ou a volta
 *   dos ambíguos por N-05) puser o mesmo arquivo em dois negócios.`
 * · **R-15 — caixa esvaziada cai para o snapshot anterior.** Entra UM registro
 *   de `doc-clientes` por negócio, não a união do histórico: o mais recente
 *   (`Creation Date` manda, `Modified Date` desempata) e, só quando ele está
 *   VAZIO (a caixa foi esvaziada no Bubble), o não-vazio mais recente antes
 *   dele. Medido: 1.338 negócios têm o registro corrente vazio; em 78 deles
 *   existe registro anterior com arquivo, e são 542 arquivos que seriam os
 *   ÚNICOS daqueles negócios. Nos outros 1.260 a caixa está vazia em TODOS os
 *   registros — nada a recuperar, nenhuma linha criada. O que a regra NÃO
 *   recupera está contado: 2.495 arquivos de 684 negócios existem apenas num
 *   registro mais antigo e ficam de fora (`r15:arquivo_so_em_snapshot_antigo`),
 *   porque o registro corrente daqueles negócios tem arquivo e é ele que vale.
 *   Os snapshots antigos já estão na trilha da carga 03b
 *   (`kind='bubble_docs_snapshot'`), sem binário.
 * · **Nome de cliente ambíguo é DESCARTADO, não duplicado.** 144 nomes de
 *   `CLIENTE` pertencem a 2+ negócios; `mapa/documentos.md` §4.1 propunha anexar
 *   o pacote aos dois (+636 linhas). Aqui o critério automático é igualdade
 *   exata do nome normalizado com destino ÚNICO — o mesmo da lib, pelo mesmo
 *   motivo (R-08: casar por nome já pôs 85 leads na mão da corretora errada).
 *   São 687 registros descartados (2,7% dos 25.890), contados no relatório e
 *   recuperáveis com o reexport de N-05, que traria o vínculo como `unique id`.
 * · **Ponte por id primeiro.** `pipelines.doc` aponta o `unique id` de
 *   `doc-clientes` em 2.859 negócios e casa em 2.828 registros — confiança
 *   máxima, sem nome no meio. O nome resolve outros 22.370, e 5 registros ficam
 *   sem nome nenhum. Taxa de casamento medida: 25.198 de 25.890 (97,3%), zero
 *   nome de cliente que não exista em `pipelines.CLIENTE`.
 * · **Versão repetida entra uma por statement (`ondas`).** `deal_documents_supersede`
 *   é AFTER INSERT FOR EACH ROW (`0006:316-345`): num INSERT de várias linhas os
 *   gatilhos rodam depois que TODAS entraram, na ordem das linhas. Com três
 *   linhas do mesmo par (negócio, tipo) no mesmo statement, o gatilho de A supera
 *   B e C, o de B supera A — o único ainda com `superseded_at` nulo — e o de C
 *   não acha nenhum nulo: sobra ZERO vigente, e a aba Anexos, que lista só o
 *   vigente, perde o tipo inteiro. Pré-marcar `superseded_at` nas antigas não
 *   resolve (o gatilho da antiga continua enxergando a nova com nulo);
 *   `enforce_single` tem o mesmo cego e sairia `version = 1` nas três. A carga
 *   fatia cada bloco em ONDAS: a onda 1 leva a primeira ocorrência de cada par —
 *   e todo tipo com `allows_multiple`, em que o gatilho retorna cedo —, a onda 2
 *   a segunda, e como o índice já vem em ordem crescente a versão mais nova entra
 *   por último e fica vigente. As duas versões de um par saem sempre do MESMO
 *   registro de `doc-clientes` (R-15: só um entra por negócio), então nascem com
 *   o mesmo `created_at` — "mais nova" é a ordem dos slots do Bubble, o único
 *   sinal que a origem dá. Medido: dos 10.702 pares versionados, **1.808 têm
 *   mais de uma versão** (3.907 linhas); em blocos de 200 isso custa **+318
 *   statements sobre os 148 de hoje** — 466 no total, ao lado de ~43,5 mil idas
 *   ao CDN e ao Storage. Não é alto. Mandar cada uma dessas 3.907 linhas sozinha,
 *   em vez de agrupá-las por onda, custaria 2.247.
 * · **Retomada é o de-para, não um arquivo de checkpoint.** A carga anda em
 *   blocos de 200: sobe os binários do bloco, grava as linhas, grava o de-para.
 *   Reexecutar pula o par já registrado — sem baixar, sem subir, sem inserir.
 *   `ponytail: sem HEAD em /object/info antes de subir (o que
 *   scripts/seed-documents-storage.mjs faz); o prejuízo máximo de uma queda é
 *   rebaixar 200 arquivos. Evoluir quando o bloco crescer ou o CDN cobrar banda.`
 * · **Falha de arquivo não vira linha.** Download ou upload que falha depois das
 *   4 tentativas é contado, listado e a linha NÃO é criada: assim a marca
 *   `nao-migrado` significa exatamente "deixado de fora de propósito", e a
 *   reexecução tenta de novo o que faltou. Uma falha nunca derruba a carga.
 * · **Sem triagem de extensão, porque não há o que triar.** Medido no índice:
 *   pdf 24.181 · jpeg 3.609 · jpg 1.268 · xlsx 178 · png 142 · xls 100 · jfif 41
 *   · docx 12 · htm/html/mht 20 · txt 7 · rar 5 · zip 4 · ods 2 · heic 1 · 3 sem
 *   extensão utilizável. **Nenhum executável** — os 3 `.exe` que
 *   `perfil/documentos.md` §7.2 encontrou estão só em snapshot antigo de
 *   `historicoPipes`, fora do recorte corrente; por isso não existe filtro de
 *   `\.(exe|bat|cmd|scr)$` aqui. Os 20 `htm`/`mht` (anexo de e-mail salvo pelo
 *   Outlook) o mapa sugeria descartar como ruído: ficam. Apagar é irreversível,
 *   e são 20 de 29.573 num bucket privado. `mime_type` vem do header HTTP, nunca
 *   da extensão — são 3 arquivos sem extensão nenhuma.
 * · **`uploaded_by` casa `Creator` por nome exato, e indexa APELIDO também.**
 *   `perfil/documentos.md` §4.2 mediu 43% de acerto exato usando só
 *   `Users.Nome_completo` (825 registros do recorte corrente sem match) e
 *   propunha uma escada de primeiro+último nome para o resto — a mesma escada que
 *   R-08 condena. Indexar `Users.colaboradores` (o apelido, que é o nome de
 *   exibição do Bubble) resolve o problema sem heurística: 4.334 dos 4.349
 *   registros com `Creator` preenchido casam por igualdade exata, 0 ambíguos, e
 *   os 15 que sobram são `Creator` VAZIO. Nome ambíguo continuaria virando NULL.
 *
 * COLUNAS USADAS (o resto é descarte medido, não esquecimento)
 *   doc-clientes: `url_1`…`url_16` (fonte primária), `arquivos` (só recupera os
 *     56 registros cujos itens não cabem nos 16 slots), `pipeline`, `Creator`,
 *     `Creation Date`, `Modified Date` (ordem do snapshot), `unique id`.
 *     DESCARTADAS: `Slug` (0% preenchida).
 *   pipelines: `unique id`, `doc`, `CLIENTE`, `Modified Date`. O resto é das
 *     cargas 03 e 05.
 *   NÃO É LIDO: `export_All-doc-clientes_…csv` (7 colunas) — mesmo dataset,
 *     subconjunto perfeito, sem `unique id` (`perfil/documentos.md` §2).
 *   NÃO É LIDO: `historicoPipes` — os snapshots antigos já entraram como trilha
 *     na carga 03b (`kind='bubble_docs_snapshot'`), sem baixar arquivo.
 *   NÃO É CARREGADO: `pipelines.documentos` (a lista corrente denormalizada).
 *     Medido: traz 746 arquivos que não estão em nenhum snapshot de doc-clientes.
 *     A origem desta carga é doc-clientes; esses 746 estão nas pendências da
 *     entrega, não esquecidos.
 *
 * O valor `https:` nas colunas `url_N` é SENTINELA DE VAZIO (261.023 ocorrências),
 * não URL: quem tratar como texto cria 261 mil documentos fantasmas.
 *
 * Nenhuma chave, URL assinada ou CPF é impressa: o relatório conta, e o nome de
 * arquivo que aparece em aviso já passou pela máscara.
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
  normalizarNome,
  registrarMapa,
  relatorio,
  supa,
} from "./lib/bubble.mjs";

const rel = relatorio("06-documentos");

// ── id determinístico ────────────────────────────────────────────────────────

/**
 * UUIDv5 (RFC 4122), mesmo namespace das cargas 03, 03b e 04: o `id` do destino
 * é função pura do par (negócio, arquivo), então reexecutar não duplica mesmo
 * que o de-para tenha se perdido.
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

// ── constantes da carga ──────────────────────────────────────────────────────

/** N-28: negócio com `Modified Date` daqui para frente ganha o binário. */
const MOVIMENTO_DESDE = "2025-09-09";
const BUCKET = "deal-documents";
/** `file_size_limit` do bucket (`0059:378`). Acima disso o Storage recusa. */
const TETO_BYTES = 26_214_400;
/** Segmento que marca "registro sem arquivo" no `storage_path` (N-28). */
const MARCA_SEM_ARQUIVO = "nao-migrado";
/** Teto duro de slots no Bubble; 707 registros têm os 16 cheios. */
const SLOTS = Array.from({ length: 16 }, (_, i) => `url_${i + 1}`);
const CONCORRENCIA = 6;
const BLOCO = 200;
const TENTATIVAS = 4;
const AMOSTRA = 30;
const ESPERA_MS = 700;
const TIMEOUT_MS = 30_000;

// ── URL do CDN → arquivo ─────────────────────────────────────────────────────

/**
 * URL do CDN normalizada, ou `null` quando o slot está vazio.
 *
 * A MESMA URL aparece com e sem esquema: sem tirar o `https:` o export vira
 * 60.021 "arquivos" onde existem 34.457 (`perfil/documentos.md` §5). O que
 * sobra é `//host/f<epoch>x<rand>/<nome percent-encoded>`, que é a chave
 * estável do arquivo.
 */
function urlCanonica(valor) {
  const bruto = String(valor ?? "")
    .replace(/\u00a0/g, " ")
    .trim();
  // `https:` sozinho é o resto da concatenação do Bubble com o campo vazio.
  if (bruto === "" || /^https?:$/i.test(bruto)) return null;
  const sem = bruto.replace(/^https?:/i, "");
  if (!sem.startsWith("//")) return null;
  // `//host/fID/nome` = 5 pedaços. Menos que isso não tem id nem nome de arquivo.
  return sem.split("/").length >= 5 ? sem : null;
}

const decodificar = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s; // percent-encoding quebrado no export: melhor o nome cru que nada
  }
};

/** `f<epoch_ms>x<rand>` — id do arquivo no Bubble, penúltimo segmento da URL. */
const idArquivo = (url) => url.split("/").at(-2);
/** Nome original, como o cliente mandou (último segmento, decodificado). */
const nomeOriginal = (url) => decodificar(url.split("/").at(-1));

// ── nome: máscara (N-27) e saneamento ────────────────────────────────────────

// `+` em cada separador: digitação à mão produz separador REPETIDO e MISTO
// (`601..123.456-08`, `601. -123 456 - 08`), e exigir exatamente um deixava o
// CPF inteiro em `stored_name` — que é o nome que a tela mostra, o que vai no
// `Content-Disposition` e o nome do anexo no e-mail para a construtora.
// Janela de dígitos e separadores, começando e terminando em dígito. Não fixa
// agrupamento de propósito: quem digita à mão produz 3-3-3-2, 3-6-2, 11 colado e
// separador repetido/misto na mesma pasta, e cada forma nova que a regra não
// previsse deixaria o CPF inteiro em `stored_name` — o nome que a tela mostra, o
// do `Content-Disposition` e o do anexo no e-mail para a construtora. Quem decide
// é a CONTAGEM de dígitos da janela, não o formato dela.
const JANELA_DIGITOS = /(?<!\d)\d[\d.\s-]*\d(?!\d)/g;
// CPF como bloco próprio dentro de uma janela maior: grudado por hífen numa data
// ou num horário (`rg-60112345608-20240115`), a janela passa de 11 dígitos e o
// CPF saía inteiro. Medido na carga de 12/09/2026: 76 nomes com CPF válido.
const CPF_EM_BLOCO = /(?<!\d)(?:\d{3}[.\s-]+\d{3}[.\s-]+\d{3}[.\s-]+\d{2}|\d{11})(?!\d)/g;
// Só para medir o que a versão de um separador deixava passar (relatório N-27).
const CPF_UM_SEPARADOR = /\d{3}[.\s-]\d{3}[.\s-]\d{3}[-.\s]\d{2}|(?<!\d)\d{11}(?!\d)/;

/**
 * Tira o CPF do nome (N-27). Roda ANTES de sanear: depois, `601.123.456-08` já
 * teria virado `601-123-456-08` e a janela quebraria no hífen.
 *
 * Mascara toda janela com exatamente 11 dígitos e, dentro de janela maior, o
 * bloco com forma de CPF (`CPF_EM_BLOCO`). Mascarar demais é aceitável e
 * mascarar de menos não é: `original_name` guarda o nome real para auditoria, e o
 * carimbo do Bubble (`impressao-20260722140305`, 14 dígitos) não é tocado.
 */
function mascararCpf(nome) {
  return String(nome ?? "").replace(JANELA_DIGITOS, (janela) =>
    janela.replace(/\D/g, "").length === 11 ? "***" : janela.replace(CPF_EM_BLOCO, "***"),
  );
}

/**
 * Nome ASCII para o caminho e para o download (`mapa/documentos.md` §2.1).
 * Extensão preservada em minúsculas; corpo truncado em 80 caracteres.
 */
function sanear(nome) {
  const i = String(nome ?? "").lastIndexOf(".");
  const ext = i > 0 ? nome.slice(i + 1).toLowerCase() : "";
  const corpo = i > 0 ? nome.slice(0, i) : String(nome ?? "");
  const s =
    corpo
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .toLowerCase()
      .slice(0, 80)
      .replace(/^-+|-+$/g, "") || "arquivo";
  return ext.length <= 5 && /^[a-z0-9]+$/.test(ext) ? `${s}.${ext}` : s;
}

// ── tipo do documento (N-20) ─────────────────────────────────────────────────

/**
 * `mapa/documentos.md` §3.2: primeira regra que casa vence, sobre o nome
 * normalizado. A ORDEM é a regra — `ctps` antes de tudo porque
 * `CTPS_CONTRATO_DE_TRABALHO…` casaria em "contrato"; `comprovante_renda` por
 * último porque "extrato"/"declaracao" aparecem dentro de nome de FGTS e de IR.
 */
const TIPOS = [
  ["ctps", /ctps|carteira de trabalho|ct digital|contratosdigitais|outrosvinculos/],
  ["extrato_fgts", /fgts|historico creditos/],
  ["imposto_renda", /irpf|imposto de renda|declaracao de ajuste|\bdirf\b/],
  [
    "comprovante_resid",
    /comprovante de resid|residencia|\bendereco\b|\bfatura\b|conta de (luz|agua|energia)|\brge\b|\bceee\b|corsan/,
  ],
  ["certidao_civil", /certidao|casamento|nascimento|estado civil|averbacao/],
  ["rg_cpf", /\brg\b|identidade|cnh|\bcin\b|\bcpf\b|\brne\b/],
  [
    "simulacao",
    /simula|proposta|\bmo\b|porta de entrada|caixa aqui|avaliacao de risco|portal de negocios|\bscr\b|bacen|cch|carta de credito|fator social/,
  ],
  [
    "comprovante_renda",
    /holerite|contracheque|recibo de pag|esocial|demonstrativo|extrato|renda|salario|\bpis\b|inss|cnis|declaracao|\bnu \b|nubank|banco|conta de pagamentos/,
  ],
];

/** Código do tipo; `outros` é o fallback obrigatório do schema (alvo cca §(c)). */
function classificar(nome) {
  const n = normalizarNome(nome);
  return TIPOS.find(([, re]) => re.test(n))?.[0] ?? "outros";
}

/** `Creator` que não é pessoa: vai direto para NULL, sem tentar casar nome. */
const CREATOR_NAO_PESSOA = new Set([
  "app admin",
  "deleted thing",
  "parceiro externo",
  "gerente interino",
  "zona sul",
  "faceimob",
  "integracao leadfy",
]);

// ── de-para de entrada ───────────────────────────────────────────────────────

let ONLINE = true;

/**
 * `unique id` do Bubble → id do destino, do que as cargas anteriores gravaram.
 *
 * Sem credencial o `--dry-run` usa o próprio uid como id de mentira, tirado do
 * export daquela entidade: offline o que se mede é volume e taxa de casamento,
 * não o uuid final. O fallback é do MAPA INTEIRO vazio, nunca linha a linha —
 * um de-para PARCIAL continua sendo medido de verdade, e é isso que separa
 * "carga 03 completa" de "carga 03 pela metade" num ensaio online.
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

/** `allows_multiple` como o seed grava (`supabase/seed.sql:64-76`), só offline. */
const MULTIPLOS_OFFLINE = ["comprovante_renda", "simulacao", "outros"];

/**
 * `code` → `id` de `document_types` (FK `restrict`), mais o conjunto de ids que
 * aceitam vários arquivos do mesmo tipo.
 *
 * `allows_multiple` sai da TABELA, que é a mesma linha que os dois gatilhos de
 * versionamento consultam: é ele que decide se a linha precisa de statement
 * próprio (ver `ondas`). Offline vale o valor do seed.
 */
async function catalogoTipos() {
  const codigos = [...TIPOS.map(([c]) => c), "outros"];
  if (!ONLINE)
    return { tipos: new Map(codigos.map((c) => [c, c])), multiplos: new Set(MULTIPLOS_OFFLINE) };
  const { data, error } = await supa().from("document_types").select("code,id,allows_multiple");
  if (error) throw new Error(`document_types: ${error.message}`);
  const mapa = new Map(data.map((t) => [t.code, t.id]));
  const faltando = codigos.filter((c) => !mapa.has(c));
  if (faltando.length)
    throw new Error(
      `document_types sem os códigos ${faltando.join(", ")} — o seed do catálogo não rodou. ` +
        "`document_type_id` é FK restrict: toda linha seria recusada.",
    );
  return {
    tipos: mapa,
    multiplos: new Set(data.filter((t) => t.allows_multiple).map((t) => t.id)),
  };
}

// ── índice ───────────────────────────────────────────────────────────────────

/**
 * Ponte de `doc-clientes` para o negócio: por id primeiro, por nome depois.
 *
 * `pipelines.doc` guarda o `unique id` do registro de anexos (2.859 negócios) —
 * é vínculo por id, sem nome no meio. O resto casa por igualdade exata do nome
 * normalizado do cliente, e SÓ quando o nome pertence a um único negócio: nome
 * repetido devolve null e o pacote inteiro fica de fora, em vez de ser anexado
 * aos dois homônimos.
 */
async function lerPipelines() {
  const porDoc = new Map(); // `unique id` de doc-clientes → uid do pipeline
  const porNome = new Map(); // nome do cliente normalizado → [uid do pipeline]
  const movimento = new Map(); // uid do pipeline → data da última movimentação
  let lidos = 0;

  for await (const p of lerCsv(acharExport("export_All-pipelines"))) {
    const uid = String(p["unique id"] ?? "").trim();
    if (!uid) continue;
    lidos++;
    movimento.set(uid, dataBubble(p["Modified Date"]) ?? "");
    const doc = String(p.doc ?? "").trim();
    if (doc) {
      // Duas fichas apontando a MESMA caixa de anexos entregaria o pacote ao
      // último negócio lido, em silêncio. Hoje não acontece (2.859 ponteiros,
      // 2.859 distintos); num export futuro isso precisa aparecer no relatório.
      if (porDoc.has(doc)) rel.conta("pipelines:ponteiro_doc_repetido");
      porDoc.set(doc, uid);
    }
    const nome = normalizarNome(p.CLIENTE);
    if (!nome) continue;
    if (!porNome.has(nome)) porNome.set(nome, []);
    porNome.get(nome).push(uid);
  }
  rel.conta("pipelines:lidos", lidos);
  rel.conta("pipelines:com_ponteiro_doc", porDoc.size);
  rel.conta("pipelines:nomes_ambiguos", [...porNome.values()].filter((v) => v.length > 1).length);
  return { porDoc, porNome, movimento };
}

/**
 * Um registro de `doc-clientes` reduzido ao que a carga usa: a lista de
 * arquivos, a data e quem criou.
 *
 * Os 16 slots são a fonte primária (19.527 registros têm slot e `arquivos`
 * vazio); `arquivos` entra depois só para recuperar os 56 registros cujos itens
 * não cabem nos 16. A ordem é a do Bubble — é ela que vira a ordem de inserção
 * dentro do mesmo instante, e portanto quem o gatilho de versionamento deixa
 * vigente.
 */
function registro(linha) {
  const urls = [];
  const vistas = new Set();
  const juntar = (bruto) => {
    const u = urlCanonica(bruto);
    if (!u || vistas.has(u)) return;
    vistas.add(u);
    urls.push(u);
  };
  for (const slot of SLOTS) juntar(linha[slot]);
  const soSlots = urls.length;
  for (const item of listaBubble(linha.arquivos)) juntar(item);
  if (urls.length > soSlots) rel.conta("doc:arquivos_alem_dos_16_slots");
  return {
    uid: String(linha["unique id"] ?? "").trim(),
    criado: dataBubble(linha["Creation Date"]),
    modificado: dataBubble(linha["Modified Date"]) ?? "",
    creator: String(linha.Creator ?? "").trim(),
    urls,
  };
}

/**
 * Monta a lista de pares (negócio, arquivo) que a carga vai processar.
 *
 * Devolve as linhas já prontas, em ordem cronológica: quem decide o vigente é
 * `deal_documents_supersede`, e ele deixa vigente o ÚLTIMO que entrou — inserir
 * fora de ordem deixaria o documento ANTIGO vigente e o novo escondido. É essa
 * ordem que `ondas` distribui entre os statements.
 */
async function indice({ negocio, autor, tipos, multiplos }) {
  const { porDoc, porNome, movimento } = await lerPipelines();

  const porNegocio = new Map(); // uid do pipeline → registros de doc-clientes
  let lidos = 0;
  for await (const linha of lerCsv(acharExport("export_All-doc-clientes"))) {
    lidos++;
    const r = registro(linha);
    if (!r.uid) {
      rel.conta("doc:sem_unique_id");
      continue;
    }
    let pipe = porDoc.get(r.uid);
    if (pipe) rel.conta("doc:ponte_por_id");
    else {
      const nome = normalizarNome(linha.pipeline);
      if (!nome) {
        rel.conta("doc:sem_nome_de_pipeline");
        continue;
      }
      const candidatos = porNome.get(nome) ?? [];
      if (candidatos.length === 0) {
        rel.conta("doc:pipeline_inexistente_no_export");
        continue;
      }
      if (candidatos.length > 1) {
        // Anexar aos dois homônimos é a alternativa do mapa (+636 linhas de
        // documento alheio). Descartar perde o pacote e diz quanto perdeu.
        rel.conta("doc:nome_ambiguo_descartado");
        continue;
      }
      pipe = candidatos[0];
      rel.conta("doc:ponte_por_nome");
    }
    if (!porNegocio.has(pipe)) porNegocio.set(pipe, []);
    porNegocio.get(pipe).push(r);
  }
  rel.conta("doc:lidos", lidos);

  const itens = [];
  const caminhos = new Set();
  for (const [pipe, registros] of porNegocio) {
    const deal = negocio(pipe);
    if (!deal.id) {
      rel.conta("negocio_inexistente_no_destino");
      continue;
    }
    // Ordem do snapshot: `Creation Date` manda, `Modified Date` desempata.
    registros.sort((a, b) =>
      `${a.criado ?? ""}|${a.modificado}`.localeCompare(`${b.criado ?? ""}|${b.modificado}`),
    );
    let escolhido = registros.at(-1);
    if (escolhido.urls.length === 0) {
      rel.conta("r15:snapshot_corrente_vazio");
      // R-15: a caixa foi esvaziada no Bubble. O registro anterior não-vazio é
      // o único lugar onde esses arquivos ainda existem.
      const anterior = [...registros].reverse().find((r) => r.urls.length > 0);
      if (!anterior) {
        rel.conta("r15:negocio_sem_arquivo_em_nenhum_registro");
        continue;
      }
      rel.conta("r15:negocio_recuperado");
      rel.conta("r15:arquivos_recuperados", anterior.urls.length);
      escolhido = anterior;
    }

    // O que R-15 NÃO recupera: só o snapshot escolhido vira linha, então o
    // arquivo que existe apenas num registro mais antigo fica de fora. É perda
    // conhecida (a trilha da carga 03b guarda os snapshots), não esquecimento —
    // por isso é contada, como os 687 pacotes de nome ambíguo.
    const noEscolhido = new Set(escolhido.urls);
    const soEmAntigo = new Set();
    for (const r of registros) for (const u of r.urls) if (!noEscolhido.has(u)) soEmAntigo.add(u);
    if (soEmAntigo.size) {
      rel.conta("r15:negocio_com_arquivo_so_em_snapshot_antigo");
      rel.conta("r15:arquivo_so_em_snapshot_antigo", soEmAntigo.size);
    }

    const recente = (movimento.get(pipe) ?? "") >= MOVIMENTO_DESDE;
    rel.conta(recente ? "recorte:negocio_com_movimento" : "recorte:negocio_parado");
    const pessoa = CREATOR_NAO_PESSOA.has(normalizarNome(escolhido.creator))
      ? { id: null }
      : autor(escolhido.creator);

    escolhido.urls.forEach((url, ordem) => {
      const original = nomeOriginal(url);
      const mascarado = mascararCpf(original);
      if (mascarado !== original) {
        rel.conta("n27:cpf_mascarado_no_stored_name");
        if (!CPF_UM_SEPARADOR.test(original)) rel.conta("n27:cpf_perdido_por_um_separador_so");
      }
      const codigo = classificar(original);
      const item = {
        id: det("doc_arquivo", pipe, idArquivo(url)),
        bubbleId: `${pipe}:${idArquivo(url)}`,
        dealId: deal.id,
        fileId: idArquivo(url),
        url: `https:${url}`,
        original,
        // Máscara nos DOIS lados de `sanear`: ele troca vírgula, barra e underscore
        // por hífen, e um CPF separado por vírgula (`601,123,456,08`) só vira janela
        // de 11 dígitos DEPOIS disso. O invariante é sobre o valor final —
        // `stored_name` nunca carrega janela de 11 dígitos.
        stored: mascararCpf(sanear(mascarado)),
        tipo: tipos.get(codigo),
        codigo,
        criadoEm: escolhido.criado,
        autorId: pessoa.id,
        recente,
        ordem,
      };
      const caminho = caminhoDe(item, true);
      if (caminhos.has(caminho)) {
        // `storage_path` é unique no banco: duas linhas com o mesmo caminho
        // fariam a segunda ser recusada com 23505 no meio do lote.
        rel.conta("indice:caminho_repetido_descartado");
        return;
      }
      caminhos.add(caminho);
      itens.push(item);
      rel.conta(`tipo:${item.codigo}`);
      rel.conta(recente ? "arquivo:no_recorte" : "arquivo:fora_do_recorte");
    });
  }

  itens.sort(
    (a, b) =>
      `${a.criadoEm ?? ""}|${a.dealId}|${String(a.ordem).padStart(2, "0")}`.localeCompare(
        `${b.criadoEm ?? ""}|${b.dealId}|${String(b.ordem).padStart(2, "0")}`,
      ),
  );
  rel.conta("indice:negocios", new Set(itens.map((i) => i.dealId)).size);
  rel.conta("indice:linhas", itens.length);
  medirVersionamento(itens, multiplos);
  return itens;
}

/**
 * Quanto o versionamento custa: quantos pares (negócio, tipo) chegam com mais
 * de uma versão e quantos statements a mais isso obriga (ver `ondas`).
 *
 * O número interessa no `--dry-run`, antes da carga: é ele que diz se a
 * separação em ondas é barata ou se vale rever o tamanho do bloco.
 */
function medirVersionamento(itens, multiplos) {
  const porPar = new Map();
  for (const i of itens) {
    if (multiplos.has(i.tipo)) continue;
    const chave = `${i.dealId}|${i.tipo}`;
    porPar.set(chave, (porPar.get(chave) ?? 0) + 1);
  }
  const repetidos = [...porPar.values()].filter((n) => n > 1);
  rel.conta("versionamento:pares_versionados", porPar.size);
  rel.conta("versionamento:pares_com_mais_de_uma_versao", repetidos.length);
  rel.conta("versionamento:linhas_nesses_pares", repetidos.reduce((s, n) => s + n, 0));

  let extras = 0;
  for (let i = 0; i < itens.length; i += BLOCO)
    extras +=
      ondas(
        itens.slice(i, i + BLOCO).map((it) => ({ deal_id: it.dealId, document_type_id: it.tipo })),
        multiplos,
      ).length - 1;
  rel.conta("versionamento:statements_extras_previstos", extras);
}

/**
 * Fatia as linhas em ondas: dentro de uma onda nenhum par
 * (deal_id, document_type_id) versionado aparece duas vezes.
 *
 * `deal_documents_supersede` é AFTER INSERT FOR EACH ROW (`0006:316-345`): num
 * INSERT de várias linhas os gatilhos só rodam DEPOIS que todas entraram, na
 * ordem das linhas. Com três linhas do mesmo par no mesmo statement, o gatilho
 * de A supera B e C, o de B supera A (o único que ainda tinha `superseded_at`
 * nulo) e o de C não acha nenhum nulo: sobra ZERO vigente, e a aba Anexos —
 * que lista só o vigente — perde o tipo inteiro. Pré-marcar `superseded_at` nas
 * antigas não resolve: o gatilho da antiga continua enxergando a nova com nulo
 * e supera ela. `deal_documents_enforce_single` tem o mesmo cego no `version`,
 * que sairia 1 nas três (o comando não incrementa o contador entre linhas).
 *
 * Onda 1 leva a primeira ocorrência de cada par — mais todo tipo com
 * `allows_multiple`, em que o gatilho retorna cedo e nada é superado —, onda 2
 * a segunda, e assim por diante. Como `linhas` já vem em ordem crescente
 * (`created_at`, negócio, slot do Bubble), a versão mais nova entra no último
 * statement e fica vigente.
 *
 * As duas versões de um par saem SEMPRE do mesmo registro de `doc-clientes`
 * (só um entra por negócio, R-15), então nascem com o mesmo `created_at`: quem
 * é "mais nova" é a ordem dos slots do Bubble, não uma data. É o único sinal que
 * a origem dá.
 */
function ondas(linhas, multiplos) {
  const ocorrencia = new Map();
  const saida = [];
  for (const l of linhas) {
    let n = 0;
    if (!multiplos.has(l.document_type_id)) {
      const chave = `${l.deal_id}|${l.document_type_id}`;
      n = ocorrencia.get(chave) ?? 0;
      ocorrencia.set(chave, n + 1);
    }
    (saida[n] ??= []).push(l);
  }
  return saida;
}

/** Caminho no bucket. Sem arquivo, o segmento de marca entra no meio (N-28). */
const caminhoDe = (item, comArquivo) =>
  comArquivo
    ? `${item.dealId}/${item.fileId}-${item.stored}`
    : `${item.dealId}/${MARCA_SEM_ARQUIVO}/${item.fileId}-${item.stored}`;

/** Uma linha de `deal_documents`. `version`/`superseded_*` são do gatilho. */
function linha(item, { caminho, mime = null, tamanho = null }) {
  const base = {
    id: item.id,
    deal_id: item.dealId,
    document_type_id: item.tipo,
    storage_path: caminho,
    original_name: item.original,
    stored_name: item.stored,
    mime_type: mime ?? null,
    size_bytes: tamanho ?? null,
    uploaded_by: item.autorId,
  };
  // `created_at` é `not null default now()`: null explícito é 23502 e perderia
  // a linha por causa da data. Sem data legível entra o relógio do banco.
  if (item.criadoEm) return { ...base, created_at: item.criadoEm };
  rel.conta("data_ilegivel_usou_relogio_do_banco");
  return base;
}

// ── rede ─────────────────────────────────────────────────────────────────────

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * `fetch` com backoff. Repete em 429, 5xx e erro de rede; desiste no 4xx que
 * não é 429 (arquivo apagado do CDN não melhora com espera).
 *
 * Respeita `Retry-After` quando o CDN manda: é o único número real que existe
 * sobre a taxa aceita — nem o repositório nem o Supabase declaram limite.
 */
async function comBackoff(url, opcoes = {}) {
  let ultimo = null;
  for (let t = 0; t < TENTATIVAS; t++) {
    if (t > 0) await dormir(ESPERA_MS * 2 ** (t - 1) + Math.random() * 200);
    try {
      const r = await fetch(url, { ...opcoes, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (r.ok) return r;
      if (r.status !== 429 && r.status < 500) return r;
      const espera = Number(r.headers.get("retry-after"));
      if (Number.isFinite(espera) && espera > 0) await dormir(Math.min(espera, 30) * 1000);
      ultimo = new Error(`HTTP ${r.status}`);
    } catch (e) {
      ultimo = e;
    }
  }
  throw ultimo ?? new Error("sem resposta");
}

/** Roda `fn` sobre `itens` com no máximo `n` em voo. */
async function emParalelo(itens, n, fn) {
  const fila = itens[Symbol.iterator]();
  await Promise.all(
    Array.from({ length: Math.min(n, itens.length) }, async () => {
      for (const item of fila) await fn(item);
    }),
  );
}

/**
 * Tamanho médio por amostra de HEAD, sem baixar corpo nenhum.
 *
 * A amostra é espalhada pelo índice (passo fixo), não sorteada: o mesmo índice
 * dá a mesma amostra, e duas execuções do `--dry-run` são comparáveis.
 */
async function amostrarTamanho(itens) {
  const alvo = itens.filter((i) => i.recente);
  if (alvo.length === 0) return null;
  const passo = Math.max(1, Math.floor(alvo.length / AMOSTRA));
  const amostra = [];
  for (let i = 0; i < alvo.length && amostra.length < AMOSTRA; i += passo) amostra.push(alvo[i]);

  const bytes = [];
  let falhas = 0;
  await emParalelo(amostra, CONCORRENCIA, async (item) => {
    try {
      const r = await comBackoff(item.url, { method: "HEAD" });
      const n = Number(r.headers.get("content-length"));
      if (r.ok && Number.isFinite(n)) bytes.push(n);
      else falhas++;
    } catch {
      falhas++;
    }
  });
  if (bytes.length === 0) return { pedidos: amostra.length, falhas, bytes: [] };
  bytes.sort((a, b) => a - b);
  return {
    pedidos: amostra.length,
    falhas,
    bytes,
    media: bytes.reduce((s, n) => s + n, 0) / bytes.length,
    mediana: bytes[Math.floor(bytes.length / 2)],
    total: alvo.length,
  };
}

const gb = (n) => (n / 1024 ** 3).toFixed(2);

// ── carga ────────────────────────────────────────────────────────────────────

/** Arquivo que o bucket recusaria: vira registro sem arquivo, como os antigos. */
const GRANDE_DEMAIS = Symbol("grande demais");

/** `cf-polished: ok, orig_size=123425` → 123425; sem o cabeçalho → null. */
const tamanhoOriginal = (polished) => {
  const m = /orig_size=(\d+)/.exec(polished ?? "");
  return m ? Number(m[1]) : null;
};

/** O mesmo arquivo na origem S3 do Bubble, antes do Cloudflare do CDN. */
const semPolish = (url) => {
  const u = new URL(url);
  return u.hostname.endsWith(".cdn.bubble.io") ? `https://s3.amazonaws.com/appforest_uf${u.pathname}` : url;
};

/**
 * Traz o binário do CDN e sobe no bucket. Devolve o que a linha precisa, ou
 * `GRANDE_DEMAIS`. Falha de rede sobe como exceção — e falha NÃO vira linha.
 */
async function migrar(item, cliente) {
  const cabeca = await comBackoff(item.url, { method: "HEAD" });
  if (!cabeca.ok) throw new Error(`CDN HEAD ${cabeca.status}`);
  const tamanho = Number(cabeca.headers.get("content-length"));
  const mime = cabeca.headers.get("content-type") || "application/octet-stream";
  if (Number.isFinite(tamanho) && tamanho > TETO_BYTES) {
    rel.conta("arquivo:maior_que_o_teto_do_bucket");
    return GRANDE_DEMAIS;
  }

  const corpo = await comBackoff(item.url);
  if (!corpo.ok) throw new Error(`CDN GET ${corpo.status}`);
  let dados = Buffer.from(await corpo.arrayBuffer());
  // O CDN passa imagem pelo Cloudflare Polish: com o cache quente o GET devolve
  // a versão otimizada (`cf-polished: ok, orig_size=N`), não o arquivo enviado.
  // Medido na carga de 12/09/2026. A origem S3 do Bubble entrega o original.
  const original = tamanhoOriginal(corpo.headers.get("cf-polished"));
  if (original !== null && dados.length !== original) {
    const cru = await comBackoff(semPolish(item.url));
    if (!cru.ok) throw new Error(`origem S3 GET ${cru.status}`);
    dados = Buffer.from(await cru.arrayBuffer());
    if (dados.length !== original) throw new Error(`origem S3 devolveu ${dados.length} bytes, o original tem ${original}`);
    rel.conta("arquivo:original_pela_origem_s3");
  }
  if (dados.length === 0) throw new Error("arquivo vazio no CDN");

  // `scripts/seed-documents-storage.mjs` faz `encodeURIComponent` por segmento
  // porque o `storage_path` da tela pode ter acento e espaço. Aqui não precisa:
  // `sanear` já limita o nome a `[a-z0-9.-]`, o id do arquivo é `f<dígitos>x<dígitos>`
  // e o prefixo é um uuid — o caminho inteiro já é seguro em URL.
  const caminho = caminhoDe(item, true);
  const { error } = await cliente.storage
    .from(BUCKET)
    .upload(caminho, dados, { contentType: mime, upsert: true });
  if (error) throw new Error(`storage: ${error.message}`);
  rel.conta("storage:objetos_enviados");
  return { caminho, mime, tamanho: dados.length };
}

/**
 * Um bloco: sobe os binários em paralelo, grava as linhas em ordem e só então
 * registra o de-para. A ordem importa duas vezes — é a ordem dos STATEMENTS que
 * o gatilho de versionamento enxerga (ver `ondas`), e o de-para é o que a
 * reexecução usa para pular.
 */
async function processarBloco(bloco, cliente) {
  const resultado = new Map(); // id do par → objeto pronto | GRANDE_DEMAIS
  await emParalelo(
    bloco.filter((i) => i.recente),
    CONCORRENCIA,
    async (item) => {
      try {
        resultado.set(item.id, await migrar(item, cliente));
      } catch (e) {
        // Um arquivo que falhou não derruba a carga nem vira linha: a
        // reexecução tenta de novo porque o par não entrou no de-para.
        rel.conta("arquivo:falhou");
        rel.aviso(`arquivo não migrado (${item.stored}, negócio ${item.dealId}): ${String(e.message ?? e).slice(0, 120)}`);
      }
    },
  );

  const linhas = [];
  for (const item of bloco) {
    const pronto = resultado.get(item.id);
    // Recente sem resultado = download ou upload falhou. Não cria linha: a marca
    // `nao-migrado` tem de significar só "deixado de fora de propósito".
    if (item.recente && pronto === undefined) continue;
    const comArquivo = pronto !== undefined && pronto !== GRANDE_DEMAIS;
    linhas.push(
      linha(item, comArquivo ? pronto : { caminho: caminhoDe(item, false) }),
    );
    rel.conta(comArquivo ? "deal_documents:com_arquivo" : "deal_documents:sem_arquivo");
  }
  return linhas;
}

/** Grava o bloco, uma onda por statement, e devolve os ids que o banco recusou. */
async function gravar(linhas, multiplos) {
  const recusados = new Set();
  const fatias = ondas(linhas, multiplos);
  rel.conta("deal_documents:enviados", linhas.length);
  rel.conta("versionamento:statements_extras", fatias.length - 1);
  for (const onda of fatias) {
    const { inseridos, erros } = await inserirEmLote("deal_documents", onda, {
      onConflict: "storage_path",
    });
    rel.conta("deal_documents:inseridos", inseridos);
    rel.conta("deal_documents:erros", erros.length);
    // O índice do erro é da ONDA, não do bloco: o id da linha é o que localiza.
    for (const e of erros.slice(0, 10)) rel.aviso(`deal_documents ${onda[e.indice]?.id}: ${e.mensagem}`);
    for (const e of erros) recusados.add(onda[e.indice]?.id);
  }
  return recusados;
}

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
        "Rode `node scripts/import/run.mjs negocios` antes — deal_documents.deal_id é NOT NULL.",
    );
  }
  const pessoas = await deParaEntrada("user", "profiles", "export_All-Users");
  if (pessoas.size === 0) {
    const recado =
      "import_bubble_map não tem nenhum par ('user' → 'profiles'): toda linha entraria sem `uploaded_by`, " +
      "e a reexecução não corrigiria (o insert é DO NOTHING). Rode `node scripts/import/run.mjs pessoas` antes.";
    if (ehDryRun()) rel.aviso(recado);
    else throw new Error(recado);
  }

  // `pipeline` vem como `unique id` (a ponte por nome é feita no índice, contra
  // o export de pipelines, não contra o destino).
  const vazio = new Map();
  const negocio = criarResolvedor({ porId: deals, porNome: vazio, rotulo: "negocio" });
  // `Creator` é NOME de exibição: aqui o ramo do nome é o único que existe.
  const autor = criarResolvedor({ porId: vazio, porNome: await nomesDePessoas(pessoas), rotulo: "autor" });

  const { tipos, multiplos } = await catalogoTipos();
  const itens = await indice({ negocio, autor, tipos, multiplos });
  if (itens.length === 0) {
    throw new Error(
      "nenhum dos 25.890 registros de doc-clientes casou com um negócio do destino. " +
        "Confira se os exports em DOCUMENTOS/DADOS_BUBBLE são do mesmo app que gerou os negócios importados.",
    );
  }

  const janela = itens.map((i) => i.criadoEm).filter(Boolean).sort();
  rel.aviso(`faixa de created_at que vai entrar: ${janela[0]} → ${janela.at(-1)}`);

  const medida = await amostrarTamanho(itens);
  if (medida?.bytes?.length) {
    rel.conta("amostra:arquivos_medidos", medida.bytes.length);
    rel.conta("amostra:falhas", medida.falhas);
    rel.aviso(
      `amostra HEAD (n=${medida.bytes.length}): média ${Math.round(medida.media / 1024)} KB · ` +
        `mediana ${Math.round(medida.mediana / 1024)} KB · maior ${Math.round(medida.bytes.at(-1) / 1024)} KB`,
    );
    rel.aviso(
      `volume estimado do recorte (${medida.total} arquivos): ${gb(medida.media * medida.total)} GB pela média · ` +
        `${gb(medida.mediana * medida.total)} GB pela mediana`,
    );
  } else if (medida) {
    rel.aviso(`amostra HEAD indisponível (${medida.falhas} de ${medida.pedidos} falharam) — sem estimativa de volume`);
  }

  negocio.relatar(rel);
  autor.relatar(rel);

  if (ehDryRun()) {
    rel.imprimir();
    // Fora do relatório porque `imprimir` corta em 50 avisos e este bloco é o
    // produto da rodada: é o que o operador confere antes de liberar a carga.
    const comArquivo = itens.filter((i) => i.recente).length;
    console.log(`
PREVISTO POR DESTINO
  public.deal_documents ............ ${itens.length} linhas em ${new Set(itens.map((i) => i.dealId)).size} negócios
    com arquivo no bucket .......... ${comArquivo}
    sem arquivo (N-28, marcadas) ... ${itens.length - comArquivo}
  storage 'deal-documents' ......... ${comArquivo} objetos${medida?.media ? ` (~${gb(medida.media * comArquivo)} GB)` : ""}
  public.import_bubble_map ......... ${itens.length} pares (entidade 'doc_arquivo')
  document_types / cca_stages ...... 0 (N-20: o catálogo não muda)`);
    return;
  }

  const feitos = await lerMapa("doc_arquivo", "deal_documents");
  const pendentes = itens.filter((i) => !feitos.has(i.bubbleId));
  rel.conta("retomada:ja_no_de_para", itens.length - pendentes.length);

  const cliente = supa();
  let naoEntraram = 0;
  for (let i = 0; i < pendentes.length; i += BLOCO) {
    const bloco = pendentes.slice(i, i + BLOCO);
    const linhas = await processarBloco(bloco, cliente);
    // O que não virou linha neste bloco é arquivo que falhou: continua fora do
    // de-para, então a próxima execução tenta de novo só esses.
    naoEntraram += bloco.length - linhas.length;
    if (linhas.length === 0) continue;
    const recusados = await gravar(linhas, multiplos);
    naoEntraram += recusados.size;
    // O de-para recebe a linha que o banco ACEITOU: `registro_id` não tem FK
    // (destino polimórfico, 0096:53), então o par de uma linha recusada
    // apontaria para um uuid inexistente e a reexecução nunca mais tentaria.
    const gravados = new Set(linhas.filter((l) => !recusados.has(l.id)).map((l) => l.id));
    const aceitos = bloco
      .filter((it) => gravados.has(it.id))
      .map((it) => ({ bubble_id: it.bubbleId, tabela_destino: "deal_documents", registro_id: it.id }));
    const { erros: falhas } = await registrarMapa("doc_arquivo", aceitos);
    naoEntraram += falhas.length;
    for (const e of falhas.slice(0, 5)) rel.aviso(`import_bubble_map linha ${e.indice}: ${e.mensagem}`);
    rel.conta("import_bubble_map:doc_arquivo", aceitos.length);
    console.log(`  … ${Math.min(i + BLOCO, pendentes.length)}/${pendentes.length} pares processados`);
  }

  rel.imprimir();
  if (naoEntraram > 0) {
    console.error(
      `\n${naoEntraram} par(es) não entraram (arquivo que falhou ou linha recusada). ` +
        "Reexecute: o de-para faz a carga retomar só o que faltou.",
    );
    process.exit(1);
  }
}

/**
 * Nome normalizado → id do perfil, para resolver `Creator`.
 *
 * `Nome_completo` e o apelido (`colaboradores`) entram os dois: o nome de
 * exibição do Bubble é um ou outro conforme o cadastro. Nome que aponta para
 * duas pessoas vira array e o resolvedor devolve "ambiguo" em vez de sortear.
 */
async function nomesDePessoas(mapa) {
  const porNome = new Map();
  const juntar = (nome, id) => {
    const chave = normalizarNome(nome);
    if (!chave || !id) return;
    const atual = porNome.get(chave);
    if (!atual) porNome.set(chave, [id]);
    else if (!atual.includes(id)) atual.push(id);
  };
  for await (const u of lerCsv(acharExport("export_All-Users"))) {
    const id = mapa.get(String(u["unique id"] ?? "").trim());
    if (!id) continue;
    juntar(u.Nome_completo, id);
    juntar(u.colaboradores, id);
  }
  return porNome;
}

// ── autoteste (sem rede, sem banco) ──────────────────────────────────────────

/**
 * As regras que decidem nome, tipo e caminho — `node scripts/import/06-documentos.mjs --autoteste`.
 * Os volumes são do export de 08/09: se o cliente reexportar, este teste falha
 * de propósito e o cabeçalho tem de ser remedido.
 */
async function autoteste() {
  const { default: assert } = await import("node:assert/strict");

  // A sentinela de vazio não é URL, e o esquema não muda o arquivo.
  assert.equal(urlCanonica("https:"), null);
  assert.equal(urlCanonica(""), null);
  assert.equal(urlCanonica("//h/f1x2/a.pdf"), "//h/f1x2/a.pdf");
  assert.equal(urlCanonica("https://h/f1x2/a.pdf"), "//h/f1x2/a.pdf");
  assert.equal(urlCanonica("//h/semnome"), null);
  assert.equal(idArquivo("//h/f1726755891484x979/3%20-%20COMP.pdf"), "f1726755891484x979");
  assert.equal(nomeOriginal("//h/f1x2/3%20-%20COMP.pdf"), "3 - COMP.pdf");
  assert.equal(nomeOriginal("//h/f1x2/100%.pdf"), "100%.pdf"); // percent quebrado entra cru

  // N-27: a máscara roda ANTES de sanear, senão o ponto do CPF já virou hífen.
  assert.equal(mascararCpf("CTPS 601.123.456-08.pdf"), "CTPS ***.pdf");
  assert.equal(mascararCpf("RG 60112345608.pdf"), "RG ***.pdf");
  // Separador repetido e misto: o que a regra de um separador só deixava passar.
  assert.equal(mascararCpf("CPF 601..123.456-08.pdf"), "CPF ***.pdf");
  assert.equal(mascararCpf("cpf 601. -123 456 - 08.pdf"), "cpf ***.pdf");
  assert.equal(mascararCpf("601 - 123 - 456 - 08 joao.pdf"), "*** joao.pdf");
  assert.ok(!/\d{3}/.test(sanear(mascararCpf("RG--601--123--456--08.jpg"))));
  // Corrida longa de dígitos NÃO é CPF: o carimbo do Bubble tem de sobreviver.
  assert.equal(mascararCpf("Impressao_20260722140305.pdf"), "Impressao_20260722140305.pdf");
  // CPF grudado por hífen numa data: a janela passa de 11 dígitos, o bloco não.
  assert.equal(mascararCpf("rg-60112345608-20240115-1030.pdf"), "rg-***-20240115-1030.pdf");
  assert.equal(sanear(mascararCpf("CPF 601.123.456-08-20240115.pdf")), "cpf-20240115.pdf");
  // Polish do CDN: tamanho do original no cabeçalho e o mesmo arquivo na origem S3.
  assert.equal(tamanhoOriginal("ok, orig_size=123425"), 123425);
  assert.equal(tamanhoOriginal(null), null);
  assert.equal(semPolish("https://abc.cdn.bubble.io/f1x2/a%20b.jpg"), "https://s3.amazonaws.com/appforest_uf/f1x2/a%20b.jpg");
  assert.equal(sanear(mascararCpf("CTPS 601.123.456-08.pdf")), "ctps.pdf");
  assert.ok(!/\d{11}|\d{3}[.-]\d{3}/.test(sanear(mascararCpf("cpf 601.123.456-08 joao.PDF"))));
  assert.equal(sanear("Certidão de Casamento.PDF"), "certidao-de-casamento.pdf");
  assert.equal(sanear("..."), "arquivo");
  assert.equal(sanear("a".repeat(200) + ".pdf").length, 84);

  // A ordem do classificador é a regra: os dois casos que ela decide.
  assert.equal(classificar("CTPS_CONTRATO_DE_TRABALHO.pdf"), "ctps");
  assert.equal(classificar("Relatório Extrato FGTS.pdf"), "extrato_fgts");
  assert.equal(classificar("1 - CPF E RG.pdf"), "rg_cpf");
  assert.equal(classificar("cch abril.pdf"), "simulacao");
  assert.equal(classificar("Imagem do WhatsApp.jpg"), "outros");

  // N-28: a marca de "sem arquivo" preserva o prefixo UUID que a policy exige.
  const item = { dealId: "11111111-2222-3333-4444-555555555555", fileId: "f1x2", stored: "a.pdf" };
  assert.equal(caminhoDe(item, true), `${item.dealId}/f1x2-a.pdf`);
  assert.equal(caminhoDe(item, false), `${item.dealId}/nao-migrado/f1x2-a.pdf`);
  assert.equal(caminhoDe(item, false).split("/")[0], item.dealId);

  // ── versionamento: o gatilho `deal_documents_supersede`, ao pé da letra ──
  // AFTER INSERT FOR EACH ROW: os gatilhos do statement rodam depois que todas
  // as linhas entraram, na ordem das linhas; cada um supera o que ainda estiver
  // com `superseded_at` nulo, menos ele mesmo.
  const aplicarGatilho = (statements) => {
    const tabela = [];
    for (const stmt of statements) {
      for (const id of stmt) tabela.push({ id, superado: false });
      for (const id of stmt)
        for (const r of tabela) if (r.id !== id && !r.superado) r.superado = true;
    }
    return tabela.filter((r) => !r.superado).map((r) => r.id);
  };
  const multiplos = new Set(MULTIPLOS_OFFLINE);
  const trio = ["v1", "v2", "v3"].map((id) => ({ id, deal_id: "d", document_type_id: "ctps" }));
  // O defeito: as três num statement só deixam ZERO vigente.
  assert.deepEqual(aplicarGatilho([trio.map((l) => l.id)]), []);
  const fatias = ondas(trio, multiplos).map((o) => o.map((l) => l.id));
  assert.deepEqual(fatias, [["v1"], ["v2"], ["v3"]], "grupo de 3 tem de virar 3 statements");
  assert.deepEqual(aplicarGatilho(fatias), ["v3"], "tem de sobrar 1 vigente, e a mais nova");
  // Tipo com `allows_multiple`: o gatilho retorna cedo, tudo cabe numa onda.
  const soltas = ["a", "b", "c"].map((id) => ({ id, deal_id: "d", document_type_id: "outros" }));
  assert.equal(ondas(soltas, multiplos).length, 1);
  // Pares diferentes não disputam: continuam no mesmo statement.
  assert.equal(
    ondas(
      [
        { id: "x", deal_id: "d", document_type_id: "ctps" },
        { id: "y", deal_id: "d", document_type_id: "rg_cpf" },
        { id: "z", deal_id: "e", document_type_id: "ctps" },
      ],
      multiplos,
    ).length,
    1,
  );

  // O índice inteiro contra o corpus real, com de-para de identidade.
  ONLINE = false;
  const eu = (v) => ({ id: String(v ?? "").trim() || null });
  const tipos = new Map([...TIPOS.map(([c]) => [c, c]), ["outros", "outros"]]);
  const itens = await indice({ negocio: eu, autor: eu, tipos, multiplos });
  assert.equal(itens.length, 29573, "volume do índice mudou — remeça e atualize o cabeçalho");
  assert.equal(itens.filter((i) => i.recente).length, 21758, "recorte de 12 meses mudou");
  assert.equal(new Set(itens.map((i) => i.id)).size, itens.length, "id do par não é único");
  // Ordem cronológica: é dela que depende qual versão fica vigente.
  const chaves = itens.map((i) => `${i.criadoEm ?? ""}|${i.dealId}`);
  assert.deepEqual(chaves, [...chaves].sort(), "índice fora de ordem cronológica");

  console.log("autoteste: OK");
}

const rodar = process.argv.includes("--autoteste") ? autoteste : principal;
rodar().catch((e) => {
  if (rodar === principal) rel.imprimir();
  console.error(`\n[06-documentos] ABORTADO: ${e.message}`);
  process.exit(1);
});
