#!/usr/bin/env node
/**
 * Carga 03 — Negócios, clientes, participantes e esteira de crédito.
 *
 * Origem : export_All-pipelines_* (7.579 linhas, 110 colunas — JSON de 09/09 pelo
 *          reexport de N-05; `acharExport` escolhe o JSON e cai para o CSV sozinho)
 *          + export_All-Users_* (`unique id` → perfil, e o índice de nomes do CSV antigo)
 *          + export_All-corretors_* e export_All-gerentes_* (a ponte: as colunas de
 *            participante apontam para essas fichas, não para `Users`)
 *          + export_All-Construtoras_* (só no dry-run offline, para medir sem banco)
 * Destino: public.deals · public.deal_clients · public.deal_participants · public.cca_cases
 * De-para: import_bubble_map, entidade 'pipeline', tabela_destino 'deals' e 'cca_cases'
 *
 * ─── DE ONDE VEM CADA PARTICIPANTE (medido no JSON de 09/09, linha a linha) ───
 *
 * Nenhuma coluna de corretor ou gerente aponta para `Users`. Elas apontam para
 * as FICHAS, e a pessoa está um salto adiante. Volume e destino de cada uma:
 *
 *   coluna       linhas  aponta para           chega em Users  ficha sem `user`
 *   CORRETOR 1    7.360  corretors."unique id"          7.266                94
 *   CORRETOR 2      849  corretors."unique id"            839                10
 *   CORRETOR 3        5  corretors."unique id"              5                 0
 *   GERENTE 1     7.532  gerentes."unique id"           7.386               146
 *   GERENTE2        155  gerentes."unique id"             151                 4
 *   GERENTE 3         7  gerentes."unique id"               7                 0
 *   Diretor1      5.097  Users."unique id"              5.097  (sem ficha)
 *   diretor2         73  Users."unique id"                 73  (sem ficha)
 *   diretor3          0  100% vazia, não é lida
 *
 * A ponte de cada ficha para a pessoa: `corretors.user` (294 das 365 fichas
 * preenchidas, 294/294 casam em `Users`) e `gerentes.gerente` (19 de 22, 19/19
 * casam). `gerentes.diretor` (18/18) NÃO é usada: o papel do participante sai do
 * SLOT da coluna, e um `GERENTE n` é gerente. Órfão — id que não é ficha nem
 * `Users` — são ZERO nas nove colunas.
 *
 * Resultado: 27.171 referências de pessoa por id (15.654 pela ponte + 5.170 de
 * diretor + 6.347 `Creator`), zero por nome, zero "ausente". As 254 ocorrências
 * que sobram são as 30 fichas sem `user`/`gerente`: NÃO viram participante,
 * contam por coluna no relatório (`ficha_sem_pessoa:<coluna>`) e saem com nome e
 * id no bloco FICHAS SEM VÍNCULO, impresso depois dele.
 * R-08 morre aqui — no CSV eram 27.145 casamentos por nome; no JSON, nenhum.
 *
 * O preço das 254: `deal_participants` cai de 20.755 para 20.737 (as 18 que
 * casavam por homônimo), 88 negócios ficam sem corretor nenhum (eram 75) e 16
 * ficam com o RATEIO INFLADO — perderam um corretor, sobrou pelo menos um, e o
 * `resplit` dá 100% ao sobrevivente. Os três números saem no relatório
 * (`negocios:sem_corretor_resolvido: 88`, `negocios:sem_participante_nenhum: 36`
 * e `rateio:inflado_revisao_manual: 16`), e os dois blocos impressos DEPOIS do
 * relatório trazem, um a um, os 16 negócios inflados e as fichas sem vínculo.
 *
 * Não confundir com `rateio:corretor_sem_ordinal_1: 21`, que é outro conjunto:
 * 6 dos 16 inflados (aqueles em que a ficha órfã era o CORRETOR 1) mais 15
 * negócios que já nasciam sem CORRETOR 1 no Bubble e estão certos.
 *
 * `CONSTRUTORA2` também chega como id (7.557 de 7.579). No dry-run OFFLINE o
 * de-para da carga 02 não existe, e como `criarResolvedor` não cai para o nome
 * depois de reconhecer um id, os 7.557 viravam "construtora:ausente: 7579" — o
 * ensaio não media nada. Offline o resolvedor passa a montar o índice do próprio
 * export de Construtoras, com o `unique id` fazendo de id: 7.557 por id, 5 por
 * nome (`MAISLAR`), 17 ausentes (as linhas realmente sem construtora).
 *
 * SE O CSV ANTIGO FOR LIDO NO LUGAR DO JSON o ramo do nome volta a valer
 * sozinho: lá as mesmas colunas trazem o NOME da pessoa, que não é id de ficha
 * nenhuma, a ponte devolve o valor intocado e o índice por nome do resolvedor
 * casa (medido com o `json/` fora do caminho: 27.145 por nome, 236 ausentes,
 * zero `ficha_sem_pessoa` — o comportamento de antes do reexport, idêntico).
 *
 * As colunas minúsculas `corretor`, `gerente` e `EMPREENDIMENTO` continuam texto
 * solto (campo de texto no Bubble, não relacionamento) e nenhuma delas resolve
 * participante. `construtora` (minúscula) segue só como fallback das 22 linhas
 * sem `CONSTRUTORA2` — 5 delas são `MAISLAR`. `diretor3`, `vgv_bruto` e
 * `PARC. DESCONTO` estão 100% vazias e não são lidas: quem tem dado é
 * `VGV BRUTO` (2.783 linhas) e `PARC_DESCONTO` (661), que já eram as usadas.
 *
 *   node scripts/import/03-negocios.mjs --dry-run   → lê, resolve, mede e NÃO grava
 *   node scripts/import/03-negocios.mjs             → grava (exige SUPABASE_SERVICE_ROLE_KEY)
 *
 * Pré-requisitos: a carga 01 (pessoas) e a 02 (catálogo) já rodaram. Sem elas
 * `deal_participants` nasce vazia e `developer_id`/`project_id` ficam nulos.
 * De-para de pessoas PARCIAL (carga 01 pela metade) termina em CÓDIGO 1 com o
 * que falta e o que fazer: o participante que não foi montado não volta por
 * gatilho nenhum, só reexecutando esta carga depois da 01.
 *
 * ─── O QUE PRECISA ESTAR DESLIGADO ANTES (o operador roda, o script confere) ──
 *
 * `disable trigger` exige ser DONO da tabela; `service_role` não é (R-13). Rode
 * como `postgres` (MCP do Supabase ou psql). O script NÃO desliga nada: ele
 * SONDA os gatilhos com um negócio descartável e ABORTA se algum dos que ela
 * alcança estiver vivo (o alcance exato está no fim deste bloco).
 *
 *   alter table public.deals             disable trigger deals_default_month_base;
 *   alter table public.deals             disable trigger deals_add_creator_participant;
 *   alter table public.deals             disable trigger deals_award_points;
 *   alter table public.deal_participants disable trigger deal_participants_autofill;
 *   alter table public.deal_participants disable trigger deal_participants_award_points;
 *   alter table public.cca_cases         disable trigger cca_cases_sync_esteira_label;
 *   alter table public.cca_cases         disable trigger cca_award_points;
 *   alter table public.cca_cases         disable trigger notify_cca_case_created;
 *   -- MANTER LIGADO: deal_participants_resplit (é ele que calcula o 100/n)
 *
 * Depois da carga, na ordem inversa:
 *
 *   alter table public.cca_cases         enable trigger notify_cca_case_created;
 *   alter table public.cca_cases         enable trigger cca_award_points;
 *   alter table public.cca_cases         enable trigger cca_cases_sync_esteira_label;
 *   alter table public.deal_participants enable trigger deal_participants_award_points;
 *   alter table public.deal_participants enable trigger deal_participants_autofill;
 *   alter table public.deals             enable trigger deals_award_points;
 *   alter table public.deals             enable trigger deals_add_creator_participant;
 *   alter table public.deals             enable trigger deals_default_month_base;
 *
 * Por que cada um: `deals_default_month_base` reescreveria o mês de 419 negócios
 * (T2, irreversível); `deals_add_creator_participant` insere participante espúrio
 * em 2.371 negócios e o `resplit` recalcula o rateio em cima do conjunto errado
 * (T4); `deal_participants_autofill` grava o gestor da equipe ATUAL em ordinal 1,
 * sobre o gestor histórico (T6, o bug que a 0025 consertou);
 * `cca_cases_sync_esteira_label` sobrescreve `deals.status_detail` e reverte
 * `document_review_status` para 'returned' em 1.273 negócios, com 1.273 linhas
 * falsas de histórico e as notificações de R-04 na tela dos corretores;
 * `notify_cca_case_created` gera um aviso por analista de CCA por caso (×7.560);
 * os três `*_award_points` despejam a pontuação do legado na temporada aberta hoje
 * e disparam a animação de venda em toda tela aberta pelo realtime (T1).
 *
 * ALCANCE DA SONDA (o que ela prova e o que não prova): o negócio descartável
 * nasce `won`, então `deal_participants_award_points` — o que despejaria a
 * pontuação dos 1.840 ganhos do legado, um evento por corretor — é observável
 * pelo `game_events` da própria sonda. `deals_award_points` NÃO é observável no
 * INSERT: ele varre `deal_participants`, que ainda está vazia quando o negócio
 * nasce, e esta carga nunca dá UPDATE em `deals`. Ele só alcançaria a carga se
 * `deals_add_creator_participant` estivesse ligado — e esse a sonda pega. As
 * duas linhas de `disable` continuam obrigatórias: a sonda não é substituto.
 *
 * ─── SQL QUE PROVA QUE DEU CERTO ─────────────────────────────────────────────
 *
 *   -- volume por procedência (nunca count(*) de tabela: o destino tem seed e demo, R-02)
 *   select tabela_destino, count(*) from public.import_bubble_map
 *    where entidade = 'pipeline' group by 1;               -- deals 7.579 · cca_cases 7.560
 *
 *   -- R-03: o mês-base saiu do dado, não do relógio. O esperado NÃO é fixo — é a
 *   -- quantidade de linhas cujo `mes` do Bubble é o mês corrente (419 rodando em
 *   -- 09/2026; 155 em 10/2026). Esta consulta NÃO é o detector do gatilho: com o
 *   -- jogo parado `deals_default_month_base` devolve o mesmo número ligado ou
 *   -- desligado. Quem prova que ele estava desligado é a sonda.
 *   select count(*) from public.deals d
 *     join public.import_bubble_map m on m.registro_id = d.id and m.tabela_destino = 'deals'
 *    where d.month_base = public.month_start(current_date);
 *
 *   -- VGV bruto ao centavo (N-24 opção a)
 *   select round(sum(vgv_gross), 2) from public.deals d
 *     join public.import_bubble_map m on m.registro_id = d.id and m.tabela_destino = 'deals';
 *                                                                 -- esperado: 465819613.45
 *   -- volume de participantes (a ponte é o que define este número)
 *   select role, count(*) from public.deal_participants p
 *     join public.deals d on d.id = p.deal_id
 *     join public.import_bubble_map m on m.registro_id = d.id and m.tabela_destino = 'deals'
 *    group by 1;                            -- broker 8.103 · manager 7.501 · director 5.133
 *                                           -- total 20.737 = 20.824 referências que chegam em
 *                                           -- Users − 87 repetidas dentro do mesmo papel.
 *                                           -- Eram 20.755: os 18 a menos são as fichas sem
 *                                           -- `user` que antes casavam por homônimo.
 *
 *   -- rateio fecha 100 em todo negócio com corretor. As três consultas de
 *   -- participante abaixo são escopadas por procedência pelo mesmo motivo das
 *   -- de cima: `deal_participants` mistura seed, demo e import, e sem o join o
 *   -- número medido não é o desta carga — reprova carga correta (R-02).
 *   select p.deal_id, sum(p.share_pct) from public.deal_participants p
 *     join public.import_bubble_map m on m.registro_id = p.deal_id and m.tabela_destino = 'deals'
 *    where p.role = 'broker' group by 1 having sum(p.share_pct) <> 100;  -- 0 linhas
 *
 *   -- corretor sem ordinal 1 = 6 negócios em que a ficha órfã ERA o CORRETOR 1
 *   -- (só esses estão inflados) + 15 que já nasciam sem CORRETOR 1 no Bubble e
 *   -- estão certos. NÃO é a lista dos inflados: os outros 10 perderam o
 *   -- CORRETOR 2/3, seguem com min(ordinal) = 1 e ficam FORA desta consulta.
 *   select p.deal_id from public.deal_participants p
 *     join public.import_bubble_map m on m.registro_id = p.deal_id and m.tabela_destino = 'deals'
 *    where p.role = 'broker' group by 1 having min(p.ordinal) > 1;
 *                            -- esperado: 21, o `rateio:corretor_sem_ordinal_1` do dry-run
 *
 *   -- Os 16 com RATEIO INFLADO não têm consulta: o destino não guarda memória do
 *   -- corretor perdido, e `sum(share_pct) = 100` PASSA neles justamente porque
 *   -- foi inflado. A lista autoritativa é o bloco REVISÃO MANUAL impresso no fim
 *   -- da rodada (contador `rateio:inflado_revisao_manual`) — guarde a saída.
 *
 *   -- duas pessoas no MESMO slot (negócio, papel, ordinal) — o bug da 0025 e o
 *   -- sintoma de `deal_participants_autofill` ligado. Esta carga não consegue
 *   -- produzir a duplicata sozinha: o `id` é UUIDv5 de (negócio, papel, ordinal)
 *   -- e o segundo colidiria na PK. Quem duplica é gatilho, e ele grava no
 *   -- MESMO negócio importado — por isso o join não esconde o que se procura.
 *   select p.deal_id, p.role, p.ordinal, count(*) from public.deal_participants p
 *     join public.import_bubble_map m on m.registro_id = p.deal_id and m.tabela_destino = 'deals'
 *    group by 1,2,3 having count(*) > 1;                                 -- 0 linhas
 *
 *   -- negócio invisível (sem participante nenhum; can_see_deal aceita qualquer papel)
 *   select count(*) from public.deals d
 *     join public.import_bubble_map m on m.registro_id = d.id and m.tabela_destino = 'deals'
 *    where not exists (select 1 from public.deal_participants p where p.deal_id = d.id);
 *                                                                        -- esperado: 36
 *   -- R-04: nada foi revertido, nada foi notificado, nada pontuou
 *   select count(*) from public.deal_history  where created_at >= :inicio_carga;  -- 0
 *   select count(*) from public.notifications where created_at >= :inicio_carga;  -- 0
 *   select count(*) from public.game_events   where created_at >= :inicio_carga;  -- 0
 *   select count(*) from public.deal_participants
 *    where auto_added and created_at >= :inicio_carga;                            -- 0
 *
 * ─── DECISÕES QUE ESTE ARQUIVO IMPLEMENTA (e que divergem de algum documento) ─
 *
 * · `document_review_status` entra já como 'approved' no INSERT dos fechados, e
 *   não por UPDATE depois da carga de CCA. A ordem invertida de R-04 existia para
 *   o caso de o gatilho ficar ligado; com ele desligado (sondado acima) o UPDATE
 *   só acrescenta dano: `deals_log_changes` escreveria 7.131 linhas de histórico,
 *   `deals_set_updated_at` apagaria o `updated_at` do legado e `deals_guard_stage`
 *   carimbaria `closed_at := now()`. Os casos de CCA continuam entrando DEPOIS
 *   dos negócios, e nenhum UPDATE em `deals` roda nesta carga.
 * · `outcome` sai da etapa resolvida, não direto do `STATUS`. É o mesmo resultado
 *   do de-para do mapa em 7.533 linhas e corrige as 46 em que `STATUS='PROPOSTA'`
 *   com `STATUS2` de perda nasceriam `stage='lost'` + `outcome='open'` — cuja
 *   primeira edição faria `deals_guard_stage` carimbar `closed_at = now()`.
 * · Negócio sem `CLIENTE` (16 linhas) não ganha linha em `deal_clients`. O
 *   `full_name` é NOT NULL e um nome inventado é pior que a ausência.
 * · `vgv_net` é coluna gerada: nunca é enviada. O líquido derivado diverge do
 *   líquido do Bubble; o erro medido sai no relatório (N-24).
 *
 * Nada aqui lê a coluna `senha_temporaria` do export de Users, e nenhum CPF, PIS,
 * telefone ou e-mail completo é impresso.
 */
import { createHash, randomUUID } from "node:crypto";

import {
  acharExport,
  criarResolvedor,
  cpf,
  dataBubble,
  dataBubbleDia,
  dinheiro,
  ehDryRun,
  inserirEmLote,
  inteiro,
  lerCsv,
  lerMapa,
  normalizarNome,
  registrarMapa,
  relatorio,
  supa,
  telefoneBR,
} from "./lib/bubble.mjs";

// Singular, como nas outras três cargas ("user", "equipe", "construtora",
// "empreendimento", "temporada"…) e como o PLANO §6 publica nos ACEITES 4.1 e
// 5.1 (`where entidade='pipeline'`).
const ENTIDADE = "pipeline";
const rel = relatorio("03-negocios");

// ── id determinístico ────────────────────────────────────────────────────────

/**
 * UUIDv5 (RFC 4122). O `id` do destino é função pura do `unique id` do Bubble:
 * reexecutar produz o mesmo uuid, `on conflict (id) do nothing` é inócuo e as
 * tabelas filhas calculam a FK sem consultar nada.
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

// ── de-para de valores ───────────────────────────────────────────────────────

/** 3 rótulos de `STATUS2` e 1 de `OrigemLead` trazem NBSP no lugar do espaço (T-NBSP). */
const semNbsp = (v) => String(v ?? "").replace(/\u00a0/g, " ").trim();

/**
 * `STATUS2` → [rótulo do catálogo do front, família de etapa, status do CCA].
 *
 * O rótulo é o vocabulário de `src/components/pipeline/statuses.ts`; `RC EMITIDA`
 * é o único dos 29 que não está lá e entra cru — `statusChoices()` o mostra no
 * Select em vez de abrir em branco.
 */
const STATUS2 = new Map([
  ["APROV. TOTAL", ["09. APROV. TOTAL", "approved", "approved"]],
  ["ASSINADO", ["03. ASSINADO", "contract", "approved"]],
  ["ASS. BANCO", ["02. ASS. BANCO", "contract", "approved"]],
  ["PENDENTE", ["16. PENDENTE", "under_analysis", "pending_documents"]],
  ["APROV. COND.", ["10. APROV. COND.", "approved", "approved"]],
  ["REPROVADO", ["19. REPROVADO", "lost", "rejected"]],
  ["INCOMPLETO", ["INCOMPLETO", "incomplete", "pending_documents"]],
  ["BACEN", ["20. BACEN", "under_analysis", "rejected"]],
  ["EM CONTRATO", ["04. EM CONTRATO", "contract", "approved"]],
  ["ESTEIRA AGIL", ["13. ESTEIRA AGIL", "under_analysis", "under_review"]],
  ["RESTRIÇÃO", ["21. RESTRIÇÃO", "under_analysis", "rejected"]],
  ["PENDENTE C/ RESTRIÇÃO", ["PENDENTE C/ RESTRIÇÃO", "under_analysis", "pending_documents"]],
  ["DISTRATO", ["17. DISTRATO", "lost", "cancelled"]],
  ["QUEDA", ["18. QUEDA", "lost", "cancelled"]],
  ["APROVADO POTENCIAL", ["APROVADO POTENCIAL", "approved", "approved"]],
  ["ANÁLISE EXTERNA", ["ANÁLISE EXTERNA", "under_analysis", "sent_to_agency"]],
  ["VIROU NEGÓCIO", ["08. VIROU NEGÓCIO", "approved", "approved"]],
  ["APROV. TOT. RESTRIÇÃO", ["APROV. TOT. RESTRIÇÃO", "approved", "approved"]],
  ["ANÁLISE P/ VIRAR NEGÓCIO", ["15. ANÁLISE P/ VIRAR NEGÓCIO", "under_analysis", "under_review"]],
  ["INTERNALIZADO", ["15. INTERNALIZADO", "approved", "under_review"]],
  ["PENDENTE P/ VIRAR NEGÓCIO", ["14. PENDENTE P/ VIRAR NEGÓCIO", "under_analysis", "pending_documents"]],
  ["APROV. COND. RESTRIÇÃO", ["APROV. COND. RESTRIÇÃO", "approved", "approved"]],
  ["APROV. AG. CONT.", ["07. APROV. AG. CONT.", "approved", "approved"]],
  ["RET. ESTEIRA AGIL", ["RET. ESTEIRA AGIL", "under_analysis", "pending_documents"]],
  ["AG. RET. AGENCIA", ["11. AG. RET. AGENCIA", "under_analysis", "sent_to_agency"]],
  ["EM PROCESSAMENTO", ["12. EM PROCESSAMENTO", "under_analysis", "under_review"]],
  ["RP APROVADO", ["05. RP APROVADO", "approved", "approved"]],
  ["ENVIO DE RP", ["06. ENVIO DE RP", "approved", "under_review"]],
  ["RC EMITIDA", ["RC EMITIDA", "approved", "approved"]],
]);

/** `STATUS` do Bubble: 5 valores fechados. Um sexto significa export novo, não dado sujo. */
const STATUS_ETAPA = new Map([
  ["VENDA", "closed"],
  ["PARCEIRO", "closed"],
  ["OFF", "lost"],
  ["DISTRATO", "lost"],
  ["PROPOSTA", null], // a etapa sai da família do STATUS2
  ["", "incomplete"],
]);

/** Rótulos de perda que ficam com `status_detail` próprio mesmo sob `STATUS='OFF'`. */
const PERDA_REAL = new Set(["QUEDA", "DISTRATO", "REPROVADO"]);

/** 39 variantes cruas para 6 conceitos. Desconhecido vira NULL + log, nunca valor cru. */
const ESTADO_CIVIL = new Map(
  Object.entries({
    solteiro: "SOLTEIRO(A)",
    solteira: "SOLTEIRO(A)",
    "solteiro a": "SOLTEIRO(A)",
    soltiro: "SOLTEIRO(A)",
    solterio: "SOLTEIRO(A)",
    soleiro: "SOLTEIRO(A)",
    solterira: "SOLTEIRO(A)",
    soreira: "SOLTEIRO(A)",
    soltgeira: "SOLTEIRO(A)",
    solteira161: "SOLTEIRO(A)",
    casado: "CASADO(A)",
    casada: "CASADO(A)",
    casados: "CASADO(A)",
    "casado rs": "CASADO(A)",
    "casado a": "CASADO(A)",
    divorciada: "DIVORCIADO(A)",
    divorciado: "DIVORCIADO(A)",
    divordicado: "DIVORCIADO(A)",
    "divorciado a": "DIVORCIADO(A)",
    "uniao estavel": "UNIÃO ESTÁVEL",
    viuva: "VIÚVO(A)",
    viuvo: "VIÚVO(A)",
    separada: "SEPARADO(A)",
    separado: "SEPARADO(A)",
  }),
);

/** `BL - UN` que não é bloco/unidade de verdade: ≥80 das 2.379 linhas preenchidas. */
const UNIDADE_PLACEHOLDER = new Set(["ESCOLHER", "00", "01", "0", "0-0", "0000", "00-00", "EXTERNO"]);

/** Sentinelas do Bubble em campo de pessoa: NULL direto, sem tentar casar. */
const SENTINELAS = new Set(["app admin", "deleted thing", "faceimob", "integracao leadfy"]);

/** E-mails de teste em `cca_externo1`. Não viram `agency_name`. */
const EMAIL_LIXO = new Set(["a@a.com", "a@aaa.com", "a@arrombado.com", "a@gmal.com"]);

/** Typos conhecidos do domínio da casa. */
const DOMINIO_CORRIGIDO = new Map([
  ["facimob.com.br", "faceimob.com.br"],
  ["fcaeimob.com.br", "faceimob.com.br"],
]);

// ── conversões locais ────────────────────────────────────────────────────────

const texto = (v) => {
  const s = semNbsp(v);
  return s === "" ? null : s;
};

/** "SIM"/"NÃO" (com ou sem acento, qualquer caixa) → boolean; resto → null. */
function simNao(v) {
  const s = normalizarNome(v);
  if (s === "sim") return true;
  if (s === "nao") return false;
  return null;
}

/** Competência mensal → 'YYYY-MM-01'. Nunca por timezone: meia-noite -03 viraria o mês anterior em UTC. */
function mesBase(...candidatos) {
  for (const c of candidatos) {
    const dia = dataBubbleDia(c);
    if (dia) return `${dia.slice(0, 7)}-01`;
  }
  return null;
}

/** Primeiro candidato que parseia como timestamptz. */
function primeiraData(...candidatos) {
  for (const c of candidatos) {
    const d = dataBubble(c);
    if (d) return d;
  }
  return null;
}

/** Só dígitos, e só quando o tamanho é o esperado. Nunca completa com zero (R-17). */
function digitos(v, tamanho) {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length === tamanho ? d : null;
}

function tituloCaso(v) {
  const s = semNbsp(v).replace(/\s+/g, " ");
  if (s === "") return null;
  return s
    .toLowerCase()
    .split(" ")
    .map((p) => (p.length > 2 ? p[0].toUpperCase() + p.slice(1) : p))
    .join(" ");
}

function emailLimpo(v) {
  const s = semNbsp(v).toLowerCase();
  return s.includes("@") ? s : null;
}

/** Adiciona um id ao índice de nomes preservando colisão — o resolvedor devolve "ambiguo". */
function indexar(mapa, chave, id) {
  if (!chave) return;
  const atual = mapa.get(chave);
  if (!atual) mapa.set(chave, [id]);
  else if (!atual.includes(id)) atual.push(id);
}

// ── leitura do destino ───────────────────────────────────────────────────────

let ONLINE = true;

/**
 * Página o PostgREST: acima de 1.000 linhas ele trunca calado.
 *
 * `ordem` precisa ser CHAVE da tabela: sem `order by`, o Postgres não garante a
 * mesma ordem entre duas páginas do mesmo `select` e a paginação pode repetir e
 * PULAR linha (`developer_projects` e `profiles` já passam de uma página).
 */
async function lerTudo(tabela, colunas, ordem = ["id"]) {
  if (!ONLINE) return [];
  const cliente = supa();
  const linhas = [];
  const pagina = 1000;
  for (let de = 0; ; de += pagina) {
    let consulta = cliente.from(tabela).select(colunas);
    for (const coluna of ordem) consulta = consulta.order(coluna);
    const { data, error } = await consulta.range(de, de + pagina - 1);
    if (error) throw new Error(`ler ${tabela}: ${error.message}`);
    linhas.push(...data);
    if (data.length < pagina) return linhas;
  }
}

async function mapaImportado(tabelaDestino) {
  if (!ONLINE) return new Map();
  return lerMapa(ENTIDADE, tabelaDestino);
}

/** Linhas nascidas na janela da carga. É como se prova que nenhum gatilho escreveu. */
async function contarDesde(tabela, inicio, extra = (q) => q) {
  if (!ONLINE) return 0;
  const { count, error } = await extra(
    supa().from(tabela).select("id", { count: "exact", head: true }).gte("created_at", inicio),
  );
  if (error) throw new Error(`contar ${tabela}: ${error.message}`);
  return count ?? 0;
}

// ── sonda de gatilhos ────────────────────────────────────────────────────────

/**
 * Escolhe a pessoa que a sonda usa como autor e como corretor do negócio falso.
 *
 * Precisa de duas propriedades para os dois gatilhos serem observáveis:
 * papel em (director, manager, broker), senão `deals_add_creator_participant`
 * sai cedo; e equipe ativa com gestor, senão `deal_participants_autofill` não
 * tem o que copiar. Sem elas a sonda passa por ausência de sintoma, não por
 * gatilho desligado — e é isso que o aviso diz.
 */
async function corretorParaSonda() {
  const comPapel = new Set(
    (await lerTudo("user_roles", "profile_id,role", ["profile_id", "role"]))
      .filter((r) => ["broker", "manager", "director"].includes(r.role))
      .map((r) => r.profile_id),
  );
  if (comPapel.size === 0) return { id: null, temGestor: false };

  const equipes = new Map((await lerTudo("teams", "id,manager_id,director_id")).map((t) => [t.id, t]));
  for (const v of await lerTudo("team_members", "profile_id,team_id,left_at")) {
    if (v.left_at || !comPapel.has(v.profile_id)) continue;
    const t = equipes.get(v.team_id);
    if (t && [t.manager_id, t.director_id].some((g) => g && g !== v.profile_id)) {
      return { id: v.profile_id, temGestor: true };
    }
  }
  return { id: [...comPapel][0], temGestor: false };
}

/**
 * Prova, com um negócio descartável, que os gatilhos perigosos estão desligados.
 *
 * Não há como ler `pg_trigger` por PostgREST, e confiar no operador custaria
 * 419 meses reescritos, 2.371 participantes espúrios e 1.273 conferências
 * revertidas — nenhum deles reversível por `delete`. A sonda escreve UMA linha,
 * lê o efeito e apaga tudo antes de a carga começar.
 *
 * O primeiro teste é o mais barato e o mais importante: `month_base` é NOT NULL
 * e só o gatilho a preenche. Enviar NULL explícito tem duas saídas possíveis e
 * nenhuma ambiguidade — 23502 (gatilho desligado) ou sucesso (ligado).
 */
async function sondarGatilhos(etapaId) {
  const cliente = supa();
  const codigo = `BUB-SONDA-${Date.now()}`;
  const id = randomUUID();
  const marco = new Date().toISOString();
  const problemas = [];
  const cobaia = await corretorParaSonda();

  if (!cobaia.id) {
    rel.aviso(
      "sonda: nenhum corretor cadastrado — deals_add_creator_participant e " +
        "deal_participants_award_points não puderam ser verificados",
    );
  }
  if (!cobaia.temGestor) {
    rel.aviso("sonda: nenhum corretor com equipe ativa e gestor — deal_participants_autofill não pôde ser verificado");
  }

  const base = {
    id,
    code: codigo,
    stage_id: etapaId,
    // `won` de propósito: `deal_participants_award_points` só age em negócio
    // ganho, e é ele que despejaria a pontuação dos 1.840 ganhos do legado
    // quando `deal_participants` for gravada. Com o negócio `open` a sonda
    // passava por AUSÊNCIA DE SINTOMA. `deals_closed_consistency` (0006:59)
    // exige `closed_at` junto de todo outcome diferente de 'open'.
    outcome: "won",
    closed_at: marco,
    stage_entered_at: marco,
    status_detail: "16. PENDENTE",
    document_review_status: "approved",
    notes: "sonda de gatilhos da carga 03 — apagada em seguida",
    // `deals_add_creator_participant` sai cedo quando `created_by` é nulo:
    // sondar sem autor daria falso negativo justo no gatilho que insere os
    // 2.371 participantes espúrios.
    created_by: cobaia.id,
  };

  const nulo = await cliente.from("deals").insert({ ...base, month_base: null });
  if (!nulo.error) {
    await cliente.from("deals").delete().eq("id", id);
    throw new Error(
      `deals_default_month_base está LIGADO: o INSERT com month_base nulo passou.\n` +
        `Rode 'alter table public.deals disable trigger deals_default_month_base;' como postgres.\n` +
        `(negócio de sonda ${codigo} já foi apagado)`,
    );
  }
  if (nulo.error.code !== "23502") {
    throw new Error(`sonda de month_base falhou por outro motivo (${nulo.error.code}): ${nulo.error.message}`);
  }

  try {
    // Mês antigo de propósito: fora de qualquer `closed_months` plausível.
    const criado = await cliente.from("deals").insert({ ...base, month_base: "2000-01-01" });
    if (criado.error) throw new Error(`sonda: não consegui inserir o negócio (${criado.error.message})`);

    const depoisDoDeal = await cliente.from("deal_participants").select("id").eq("deal_id", id);
    if (depoisDoDeal.error) throw new Error(`sonda: ${depoisDoDeal.error.message}`);
    if (depoisDoDeal.data.length > 0) problemas.push("deals_add_creator_participant");

    if (cobaia.id) {
      const participante = await cliente
        .from("deal_participants")
        .insert({ deal_id: id, profile_id: cobaia.id, role: "broker", ordinal: 1 });
      if (participante.error) throw new Error(`sonda: ${participante.error.message}`);
      const agora = await cliente.from("deal_participants").select("id").eq("deal_id", id);
      if (agora.error) throw new Error(`sonda: ${agora.error.message}`);
      if (agora.data.length > 1) problemas.push("deal_participants_autofill");
    }

    const caso = await cliente
      .from("cca_cases")
      .insert({ deal_id: id, status: "under_review", submitted_at: marco });
    if (caso.error) throw new Error(`sonda: ${caso.error.message}`);

    const negocio = await cliente
      .from("deals")
      .select("month_base, status_detail, document_review_status")
      .eq("id", id)
      .single();
    if (negocio.error) throw new Error(`sonda: ${negocio.error.message}`);
    if (negocio.data.month_base !== "2000-01-01") problemas.push("deals_default_month_base");
    if (negocio.data.status_detail !== "16. PENDENTE" || negocio.data.document_review_status !== "approved")
      problemas.push("cca_cases_sync_esteira_label");

    // Escopadas no negócio da sonda onde a coluna existe: um lote de
    // notificações do próprio produto na mesma janela não pode virar
    // diagnóstico errado. `notifications` não tem FK de negócio e fica na
    // janela de tempo mesmo — abortar por engano custa uma reexecução, deixar
    // 7.560 casos notificarem custa a caixa de todo analista.
    for (const [tabela, coluna, gatilho] of [
      ["deal_history", "deal_id", "cca_cases_sync_esteira_label (ramo de devolução)"],
      ["game_events", "ref_id", "cca_award_points / deals_award_points / deal_participants_award_points"],
      // Sem temporada aberta `award_game_points` (0078:174-195) não grava evento:
      // grava uma notificação `game_paused` por corretor. Por isso o mesmo
      // contador cobre os dois desfechos de um `*_award_points` vivo.
      ["notifications", null, "notify_cca_case_created / *_award_points (game_paused)"],
    ]) {
      const n = await contarDesde(tabela, marco, (q) => (coluna ? q.eq(coluna, id) : q));
      if (n > 0) problemas.push(gatilho);
    }
  } finally {
    const apagado = await cliente.from("deals").delete().eq("id", id);
    if (apagado.error) {
      rel.aviso(`sonda: NÃO consegui apagar o negócio ${codigo} — apague à mão (${apagado.error.message})`);
    }
    // O negócio da sonda nasce `won`: se um `*_award_points` estiver vivo, o
    // ponto fica em `game_events`, que não tem FK para `deals` e sobrevive ao
    // delete acima. Sem esta linha o operador não sabe o que limpar.
    const eventos = await contarDesde("game_events", marco, (q) => q.eq("ref_id", id));
    if (eventos > 0) {
      rel.aviso(
        `sonda: ${eventos} evento(s) de jogo nasceram da sonda. Limpe com ` +
          `delete from public.game_events where ref_id = '${id}';`,
      );
    }
    const sobrou = await contarDesde("notifications", marco);
    if (sobrou > 0) {
      rel.aviso(
        `sonda: ${sobrou} notificação(ões) nasceram da sonda. Limpe com ` +
          `delete from public.notifications where created_at >= '${marco}';`,
      );
    }
  }

  if (problemas.length > 0) {
    throw new Error(
      `Gatilho LIGADO durante a carga: ${[...new Set(problemas)].join(", ")}.\n` +
        `Rode os 'alter table … disable trigger …' do cabeçalho deste arquivo como postgres e tente de novo.`,
    );
  }
  rel.conta("sonda:gatilhos_desligados", 1);
}

// ── resolvedores ─────────────────────────────────────────────────────────────

/**
 * `unique id` de `Users` (ou nome de exibição) → `profiles.id`.
 *
 * O JSON de 09/09 traz `Diretor1`, `diretor2` e 6.347 dos 7.579 `Creator` como
 * `unique id`, e a ponte entrega os corretores e gerentes já como id: com o JSON
 * o ramo do nome não é usado uma vez sequer. O índice por nome NÃO é peso morto
 * mesmo assim — é ele, e só ele, que resolve as 27.145 referências do CSV antigo
 * (ver `pontePessoa`), o formato que volta se o cliente reexportar errado.
 *
 * `Users.colaboradores` é a chave canônica (298 valores em 298 linhas, zero
 * duplicata). `Nome_completo` entra como segundo índice, mas só nas chaves que
 * `colaboradores` não ocupa — senão um homônimo de nome completo tornaria
 * ambíguo um apelido que era exato (R-08).
 */
async function resolvedorPessoas(rotulo) {
  const doMapa = ONLINE ? await lerMapa("user", "profiles") : new Map();
  // Mesma trava do resolvedor de construtoras: o id de mentira vale só quando o
  // de-para está INTEIRAMENTE vazio (dry-run sem banco). Com de-para PARCIAL —
  // ensaio online com a carga 01 pela metade — cada ausência tem de ser medida,
  // senão `semPerfil` fica 0, o aviso "rode a carga 01 antes" nunca dispara e a
  // carga real derruba esses participantes em silêncio.
  const semDePara = doMapa.size === 0 && ehDryRun();
  const porId = new Map();
  const porApelido = new Map();
  const porNomeCompleto = new Map();
  let semPerfil = 0;

  for await (const u of lerCsv(acharExport("export_All-Users"))) {
    const uid = String(u["unique id"] ?? "").trim();
    if (!uid) continue;
    // Sem banco o `--dry-run` usa o próprio uid como id de mentira: o que se
    // quer medir offline é a taxa de casamento, não o uuid final.
    const id = doMapa.get(uid) ?? (semDePara ? uid : null);
    if (!id) {
      semPerfil++;
      continue;
    }
    porId.set(uid, id);
    indexar(porApelido, normalizarNome(u.colaboradores), id);
    indexar(porNomeCompleto, normalizarNome(u.Nome_completo), id);
  }
  if (semPerfil > 0) {
    rel.conta("pessoa:sem_perfil_no_destino", semPerfil);
    rel.aviso(`${semPerfil} usuários do Bubble ainda não têm perfil — rode a carga 01 antes`);
  }
  if (porId.size === 0 && !ehDryRun()) {
    throw new Error("import_bubble_map não tem nenhum ('user' → 'profiles'). Rode a carga 01 (pessoas) primeiro.");
  }

  const porNome = new Map(porApelido);
  for (const [chave, ids] of porNomeCompleto) if (!porNome.has(chave)) porNome.set(chave, ids);

  const bruto = criarResolvedor({ porId, porNome, rotulo });
  const resolver = (valor) => {
    if (SENTINELAS.has(normalizarNome(valor))) {
      rel.conta(`${rotulo}:sentinela`);
      return { id: null, via: "sentinela" };
    }
    return bruto(valor);
  };
  resolver.relatar = bruto.relatar;
  resolver.pessoas = porId.size;
  resolver.contagem = bruto.contagem;
  // Quem opera precisa disso no fim da rodada, não só no meio do relatório: de-para
  // parcial é a única forma de a carga perder participante sem o banco recusar nada.
  resolver.semPerfil = semPerfil;
  return resolver;
}

/**
 * `CORRETOR n` / `GERENTE n` → o que identifica a PESSOA.
 *
 * As duas famílias não apontam para `Users`: apontam para `corretors` e
 * `gerentes`, as fichas intermediárias do Bubble. Medido no JSON de 09/09,
 * linha a linha de `pipelines`: 8.214 referências de corretor 100% em
 * `corretors`, 7.694 de gerente 100% em `gerentes`, ZERO em `Users` nas duas.
 * Sem esta ponte o ramo do id resolveria zero participante.
 *
 * Dois ramos, um por formato de export, e é o VALOR que decide qual vale:
 *  · JSON (reexport N-05): a coluna traz o `unique id` da FICHA → a ponte
 *    devolve o `unique id` do `Users` que a ficha guarda (`corretors.user`,
 *    `gerentes.gerente`), e o resolvedor de pessoas fecha pelo ramo do id.
 *  · CSV antigo: a coluna traz o NOME da pessoa, que não é id de ficha nenhuma
 *    → passa direto e o índice por nome do resolvedor casa, como sempre casou.
 *    Este ramo não é peso morto: volta a valer se o cliente reexportar errado.
 *
 * Ficha sem vínculo com `Users` (71 de 365 corretors, 3 de 22 gerentes; 254
 * ocorrências em `pipelines`) devolve `null` e NÃO vira participante. Cair para
 * o nome da ficha aqui inventaria um vínculo que o Bubble não tem: `user` vazio
 * é a afirmação de que aquela ficha não é ninguém do quadro. 18 das 254 casavam
 * por homônimo em `Users` e viravam participante com rateio de VGV — o falso
 * positivo de R-08, sem marca que o distinga de um acerto. Ficam contadas por
 * coluna e listadas por nome, para conferência manual depois da carga.
 */
async function pontePessoa() {
  const fichas = new Map();
  for (const [prefixo, familia, colVinculo, colNome] of [
    ["export_All-corretors", "corretor", "user", "Nome"],
    ["export_All-gerentes", "gerente", "gerente", "nome"],
  ]) {
    for await (const ficha of lerCsv(acharExport(prefixo))) {
      const uid = String(ficha["unique id"] ?? "").trim();
      if (!uid) continue;
      fichas.set(uid, {
        familia,
        vinculo: semNbsp(ficha[colVinculo]),
        nome: semNbsp(ficha[colNome]),
      });
    }
  }
  // Ponte vazia = coluna renomeada num export futuro. Sem estas duas travas os
  // 15.654 vínculos de corretor e gerente virariam "ficha sem pessoa" um a um e
  // a carga gravaria 7.579 negócios invisíveis, sem nenhum erro do banco. A
  // segunda cobre o caso pior: `unique id` intacto e `user`/`gerente` renomeada,
  // que passa pela primeira e some com 100% dos participantes em silêncio.
  const comVinculo = [...fichas.values()].filter((f) => f.vinculo).length;
  if (fichas.size === 0 || comVinculo === 0) {
    throw new Error(
      `A ponte corretors/gerentes não liga em ninguém (${fichas.size} fichas, ${comVinculo} com vínculo). ` +
        "Confira as colunas `unique id`, `user` (corretors) e `gerente` (gerentes) nos exports.",
    );
  }
  rel.conta("ponte:fichas", fichas.size);
  rel.conta("ponte:fichas_com_pessoa", comVinculo);

  const semPessoa = new Map();
  /** Como o operador acha a ficha no Bubble: nome dela + id dela, nunca o texto solto da linha. */
  const descrever = (valor) => {
    const ficha = fichas.get(valor);
    return ficha ? `${ficha.nome || "(ficha sem nome)"} [${valor}]` : valor;
  };

  /** O slot manda: `CORRETOR n` só aceita ficha de corretor, `GERENTE n` só de gerente. */
  const FAMILIA_DO_PAPEL = { broker: "corretor", manager: "gerente" };

  const ponte = (valor, coluna, role) => {
    const ficha = fichas.get(valor);
    if (!ficha) return valor; // id de `Users` (Diretor1/diretor2) ou nome do CSV antigo
    // Um Map só guarda as duas famílias, e nada no export obriga a coluna a
    // apontar para a família certa. Se um export futuro trocar, sem esta trava a
    // pessoa entra com o papel do SLOT — participante errado, rateio de VGV
    // errado, nenhum erro do banco. ZERO ocorrências no export de 09/09; papel
    // de diretor nunca casa ficha nenhuma, e ficha ali também é troca de família.
    if (ficha.familia !== FAMILIA_DO_PAPEL[role]) {
      rel.conta(`ficha_familia_errada:${coluna}`);
      return null;
    }
    if (ficha.vinculo) return ficha.vinculo;
    rel.conta(`ficha_sem_pessoa:${coluna}`);
    const chave = descrever(valor);
    semPessoa.set(chave, (semPessoa.get(chave) ?? 0) + 1);
    return null;
  };
  ponte.descrever = descrever;
  // Lista, não aviso: `relatorio.imprimir` corta em 50 avisos, e numa rodada com
  // pendências de FK os avisos de `pessoa` e `construtora` (21 cada) empurram
  // estas linhas para fora do corte. É por elas que o operador acha a ficha no
  // Bubble, então saem inteiras depois do relatório, como a REVISÃO MANUAL.
  ponte.fichasSemPessoa = () =>
    [...semPessoa]
      .sort((a, b) => b[1] - a[1])
      .map(([ficha, n]) => `${ficha} — ${n}x, sem participante`);
  return ponte;
}

/**
 * `CONSTRUTORA2` → `developers.id`.
 *
 * O ramo do `unique id` sai do de-para que a carga 02 gravou: o reexport de
 * N-05 devolve a coluna como id do Bubble, e `criarResolvedor` não cai para o
 * nome depois de reconhecer um id — com `porId` vazio, TODA linha resolveria
 * "ausente" e os 7.579 negócios nasceriam sem construtora, calados.
 */
async function resolvedorConstrutoras() {
  const porNome = new Map();
  for (const d of await lerTudo("developers", "id,name")) indexar(porNome, normalizarNome(d.name), d.id);
  const porId = ONLINE ? await lerMapa("construtora", "developers") : new Map();
  // Mesma trava do resolvedor de pessoas. `CONSTRUTORA2` vem como id do Bubble em
  // 7.557 das 7.579 linhas e `criarResolvedor` NÃO cai para o nome depois de
  // reconhecer um id: com o de-para vazio, os 7.557 viram "ausente" em silêncio e
  // a carga grava 7.579 negócios sem construtora.
  if (porId.size === 0 && !ehDryRun()) {
    throw new Error(
      "import_bubble_map não tem nenhum ('construtora' → 'developers'). Rode a carga 02 (catálogo) primeiro.",
    );
  }
  // Dry-run OFFLINE: sem banco não há de-para nem `developers`, os dois índices
  // saem vazios e as 7.562 referências viram "construtora:ausente" — o ensaio
  // deixa de medir a única coisa que dá para medir sem banco, a taxa de
  // casamento. Mesma mentira do resolvedor de pessoas: o próprio `unique id`
  // faz de id, e o nome da construtora entra no índice por nome para as 5
  // linhas que só têm `construtora` (minúscula).
  if (porId.size === 0 && ehDryRun()) {
    for await (const c of lerCsv(acharExport("export_All-Construtoras"))) {
      const uid = String(c["unique id"] ?? "").trim();
      if (!uid) continue;
      porId.set(uid, uid);
      indexar(porNome, normalizarNome(c.nome), uid);
    }
  }
  return criarResolvedor({ porId, porNome, rotulo: "construtora" });
}

// ── montagem de uma linha ────────────────────────────────────────────────────

/**
 * Uma linha de `pipelines` → as linhas de destino. Devolve `null` quando a
 * linha não pode virar negócio (só `STATUS` fora dos 5 valores conhecidos).
 */
function montar(l, ctx) {
  const uid = String(l["unique id"] ?? "").trim();
  const status = semNbsp(l.STATUS).toUpperCase();
  const status2 = semNbsp(l.STATUS2);

  if (!STATUS_ETAPA.has(status)) return { erro: `STATUS desconhecido "${status}"` };

  const catalogo = STATUS2.get(status2);
  if (status2 !== "" && !catalogo) ctx.rel.aviso(`STATUS2 fora do catálogo (${uid}): ${status2}`);

  // Etapa: STATUS manda; só PROPOSTA delega a família ao STATUS2 (§4.2).
  let codigoEtapa = STATUS_ETAPA.get(status);
  if (codigoEtapa === null) {
    codigoEtapa = catalogo?.[1] ?? "incomplete";
    if (!catalogo && status2 !== "") ctx.rel.conta("etapa:proposta_status2_desconhecido");
  }
  const etapa = ctx.etapas.get(codigoEtapa);
  if (!etapa) return { erro: `pipeline_stages sem o code "${codigoEtapa}"` };

  // `outcome` sai da etapa e não do STATUS: é o mesmo valor em 7.533 linhas e
  // impede que as 46 `PROPOSTA` com STATUS2 de perda nasçam abertas numa etapa
  // perdida — cuja primeira edição faria o guard carimbar closed_at = now().
  const outcome = etapa.outcome;

  const rotulo = catalogo?.[0] ?? (status2 === "" ? null : status2);
  const ehPerdaRotulada = PERDA_REAL.has(status2);
  const statusDetail = status === "OFF" && !ehPerdaRotulada ? "OFF" : rotulo;
  const lostReason = status === "OFF" ? rotulo : null;

  // R-03: a linha "Teste Leadfy Integ" tem STATUS, mes, ENVIO e mudou_status
  // vazios. Sem `Creation Date` no fim da cadeia, ou a carga aborta por NOT NULL
  // ou o negócio de jun/2026 nasce em set/2026.
  const criacao = l["Creation Date"];
  const monthBase = mesBase(l.mes, l.ENVIO, criacao);
  const criadoEm = primeiraData(l.ENVIO, criacao);
  const entrouNaEtapa = primeiraData(l.mudou_status, l.ENVIO, criacao);
  if (!monthBase || !criadoEm || !entrouNaEtapa) return { erro: "sem nenhuma data aproveitável" };
  if (!l.mes || !l.ENVIO || !l.mudou_status) {
    ctx.rel.aviso(`data ausente coberta por Creation Date (${uid}, ${semNbsp(l.CLIENTE) || "sem cliente"})`);
  }

  const bruto = dinheiro(l["VGV BRUTO"]);
  const descontoRs = dinheiro(l.PARC_DESCONTO);
  let discount = 0;
  if (bruto && bruto > 0 && descontoRs && descontoRs > 0) {
    discount = Math.min(100, Math.round((descontoRs / bruto) * 10000) / 100);
  } else if (descontoRs && descontoRs < 0) {
    ctx.rel.aviso(`desconto negativo forçado a 0 (${uid}): o líquido derivado fica acima do Bubble`);
  }

  // `construtora` (minúscula) é o fallback das 5 linhas sem `CONSTRUTORA2`; a
  // regra MAISLAR → MAIS LAR cobre 6 linhas que perderam o espaço no Bubble.
  const construtora = ctx.construtora(
    (semNbsp(l.CONSTRUTORA2) || semNbsp(l.construtora)).replace(/^MAISLAR$/i, "MAIS LAR"),
  );
  // `EMPREENDIMENTO` é campo de TEXTO no Bubble, não relacionamento: o reexport
  // de N-05 continua trazendo o nome (7.540 preenchidos, zero `unique id`). A
  // chave é a mesma que a carga 02 usou para agrupar — id da construtora
  // resolvida + nome normalizado —, nunca o nome bruto.
  const empreendimento = semNbsp(l.EMPREENDIMENTO);
  let projectId = null;
  if (construtora.id && empreendimento) {
    projectId = ctx.projetos.get(`${construtora.id}|${normalizarNome(empreendimento)}`) ?? null;
    // `projetos` vazia é o dry-run offline, onde a construtora resolve por id de
    // mentira: ali o contador mediria a ausência do banco, não do empreendimento.
    if (!projectId && ctx.projetos.size > 0) ctx.rel.conta("empreendimento:sem_developer_project");
  }

  const unidade = semNbsp(l["BL - UN"]).toUpperCase();
  const criador = ctx.pessoa(l.Creator);

  const deal = {
    // "pipelines" aqui é semente de UUIDv5, não a `entidade` do de-para: mudar
    // esta string regenera os 7.579 ids e duplica a carga inteira.
    id: det("pipelines", uid),
    code: `BUB-${uid}`,
    developer_id: construtora.id,
    project_id: projectId,
    unit: unidade && !UNIDADE_PLACEHOLDER.has(unidade) ? semNbsp(l["BL - UN"]) : null,
    stage_id: etapa.id,
    outcome,
    month_base: monthBase,
    vgv_gross: bruto,
    discount_pct: discount,
    lead_origin: texto(l.OrigemLead),
    notes: texto(l["OBSERVAÇÃO"]),
    stage_entered_at: entrouNaEtapa,
    closed_at: outcome === "open" ? null : entrouNaEtapa,
    lost_reason: lostReason,
    created_by: criador.id,
    created_at: criadoEm,
    updated_at: primeiraData(l["Modified Date"]) ?? criadoEm,
    status_detail: statusDetail,
    // D5: afirmar conferência só onde ninguém mais vai mexer. Os abertos ficam
    // em 'draft' e o gerente confere de verdade antes de avançar a etapa.
    document_review_status: outcome === "open" ? "draft" : "approved",
  };

  return {
    uid,
    deal,
    clientes: montarClientes(l, deal.id),
    participantes: montarParticipantes(l, deal.id, ctx),
    caso: catalogo ? montarCaso(l, deal.id, uid, catalogo, ctx) : null,
    liquidoBubble: dinheiro(l["VGV LIQUIDO"]),
  };
}

function montarClientes(l, dealId) {
  const linhas = [];
  for (const ordinal of [1, 2]) {
    const s = ordinal === 1 ? "" : "_2";
    const nome = semNbsp(l[`CLIENTE${s}`]);
    // Sem nome não há linha: `full_name` é NOT NULL e um nome inventado é pior
    // que a ausência — o negócio já carrega o resto.
    if (!nome) continue;

    const civil = normalizarNome(l[`estado_civil${s}`]);
    const cep = String(l[`cep_endereco${s}`] ?? "").replace(/\D/g, "");

    linhas.push({
      id: det("deal_clients", dealId, String(ordinal)),
      deal_id: dealId,
      ordinal,
      full_name: nome,
      cpf: cpf(l[`cpf_numero${s}`]),
      phone: telefoneBR(l[`Contato${s}`]),
      email: emailLimpo(l[`email${s}`]),
      pis: digitos(l[`pis${s}`], 11),
      marital_status: civil ? (ESTADO_CIVIL.get(civil) ?? null) : null,
      birthplace: tituloCaso(l[`naturalidade${s}`]),
      is_shareholder: simNao(l[`cotista${s}`]),
      dependents: texto(l[`dependente${s}`]),
      admission_date: dataBubbleDia(l[`data_Admissao${s}`]),
      cch_reference: texto(l[`ref_cch${s}`])?.toUpperCase() ?? null,
      postal_code: cep ? (cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : cep) : null,
      // O bloco de renda informal só existe no cliente 1 no CSV de origem.
      has_informal_income: ordinal === 1 ? (simNao(l.rendaInformal) ?? false) : false,
      activity_segment: ordinal === 1 ? texto(l.segmentoAtividade) : null,
      activity_form: ordinal === 1 ? (texto(l.formaAtuacao)?.toUpperCase() ?? null) : null,
      // `dataInicioAtividade ` tem espaço no fim do nome da coluna, e o valor é
      // duração ("2 ANOS"), não data: 0 de 306 parseiam.
      activity_duration: ordinal === 1 ? texto(l["dataInicioAtividade "]) : null,
      disclosure_form: ordinal === 1 ? texto(l.formaDivulgacao) : null,
      declares_income_tax: ordinal === 1 ? simNao(l.declaraImpostoRenda) : null,
      monthly_income: ordinal === 1 ? dinheiro(l.rendimentoMensal) : null,
      income_notes: ordinal === 1 ? texto(l.ObsRenda) : null,
    });
  }
  return linhas;
}

/**
 * O papel vem do SLOT da coluna, nunca da `Funcao` da pessoa: `GERENTE 1` aponta
 * para alguém cuja função no RH é DIRETOR em 3.392 negócios.
 *
 * `GERENTE 2` com espaço não existe no export — a coluna é `GERENTE2`.
 * `diretor3` existe e está 100% vazia no JSON: fica fora.
 * A mesma pessoa pode ocupar dois papéis (o unique é `(deal, profile, role)`),
 * então a deduplicação é DENTRO do papel, nunca entre papéis. Duas fichas de
 * `corretors` da mesma pessoa também colidem aqui, e é o que se quer.
 */
const SLOTS = [
  ["CORRETOR 1", "broker", 1],
  ["CORRETOR 2", "broker", 2],
  ["CORRETOR 3", "broker", 3],
  ["GERENTE 1", "manager", 1],
  ["GERENTE2", "manager", 2],
  ["GERENTE 3", "manager", 3],
  ["Diretor1", "director", 1],
  ["diretor2", "director", 2],
];

function montarParticipantes(l, dealId, ctx) {
  const linhas = [];
  const vistos = new Set();
  let corretoresPreenchidos = 0;
  let corretoresResolvidos = 0;
  const perdidos = [];

  for (const [coluna, role, ordinal] of SLOTS) {
    const bruto = semNbsp(l[coluna]);
    if (!bruto) continue;
    if (role === "broker") corretoresPreenchidos++;

    // A ponte troca o id da FICHA pelo que identifica a pessoa. `null` = ficha
    // sem `user`/`gerente`: já contada lá dentro, e aqui não vira participante.
    const valor = ctx.ponte(bruto, coluna, role);
    const id = valor === null ? null : ctx.pessoa(valor).id;
    if (!id) {
      // Nunca o valor cru da coluna quando ele é id de ficha: `descrever` põe o
      // nome da ficha e o id dela, que é o que o operador procura no Bubble.
      if (role === "broker") perdidos.push(`${coluna}=${ctx.ponte.descrever(bruto)}`);
      continue;
    }
    if (role === "broker") corretoresResolvidos++;

    const chave = `${role}|${id}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);

    linhas.push({
      id: det("deal_participants", dealId, role, String(ordinal)),
      deal_id: dealId,
      profile_id: id,
      role,
      ordinal,
      // `share_pct` não vai: `deal_participants_resplit` (que fica LIGADO)
      // recalcula 100/n entre corretores e zera gestor.
      auto_added: false,
    });
  }

  return { linhas, corretoresPreenchidos, corretoresResolvidos, perdidos };
}

/**
 * Um caso por negócio. `STATUS2` vazio (19 linhas) não cria caso: sem rótulo de
 * crédito não houve esteira, e inventar `under_review` poria 19 negócios mortos
 * na fila do analista.
 */
function montarCaso(l, dealId, uid, catalogo, ctx) {
  const [, , status] = catalogo;
  const criacao = l["Creation Date"];
  const submetido = primeiraData(l.ENVIO, criacao);
  const decidido = primeiraData(l.mudou_status, l.ENVIO, criacao);

  const externo1 = emailLimpo(l.cca_externo1);
  let analystId = null;
  let agencia = null;
  let emailNormalizado = null;
  if (externo1) {
    const [local, dominio = ""] = externo1.split("@");
    emailNormalizado = `${local}@${DOMINIO_CORRIGIDO.get(dominio) ?? dominio}`;
    analystId = ctx.analistas.get(emailNormalizado) ?? null;
    if (!analystId && !EMAIL_LIXO.has(externo1) && !emailNormalizado.endsWith("@faceimob.com.br")) {
      agencia = emailNormalizado.split("@")[1] || null;
    }
  }

  const bruto = dinheiro(l["VGV BRUTO"]);
  const avaliacao = dinheiro(l.ValorAvaliacao);
  const prazo = inteiro(l.Prazo);

  const analise = {
    bubble_status2: semNbsp(l.STATUS2),
    ref_cch_cca: texto(l.RefCCHcca)?.toUpperCase() ?? null,
    cca_externo_email: externo1,
    analistas_extras: semNbsp(l.cca_externo2)
      .split(/\s*,\s*/)
      .map((e) => e.toLowerCase())
      .filter((e) => e.includes("@")),
    statusNumero: texto(l.statusNumero),
    // Um dígito colado fez `ValorAvaliacao` = 277.000.194 valer 97% da coluna.
    valor_avaliacao: avaliacao !== null && bruto && avaliacao > bruto * 10 ? null : avaliacao,
    valor_compra_venda: dinheiro(l.ValorCompraVenda),
    valor_fgts: dinheiro(l.ValorFGTS),
    usa_fgts: simNao(l.FGTS),
    usa_fgts_futuro: simNao(l.FGTSFuturo),
    subsidio_estadual: dinheiro(l.SubsidioEstadual),
    subsidio_federal: dinheiro(l.SubsidioFederal),
    parcela_aprovada: dinheiro(l.ParcelaAprovada),
    renda_aprovada: dinheiro(l.RendaAprovada),
    usa_fator: simNao(l.Fator),
    tabela: texto(l.Tabela)?.toUpperCase() ?? null,
    prazo_meses: prazo !== null && prazo > 0 && prazo <= 480 ? prazo : null,
    financiamento_aprovado: dinheiro(l.FinanciamentoAprovado),
  };
  for (const [k, v] of Object.entries(analise)) {
    if (v === null || (Array.isArray(v) && v.length === 0)) delete analise[k];
  }
  if (avaliacao !== null && analise.valor_avaliacao === undefined) {
    ctx.rel.conta("cca:valor_avaliacao_descartado");
  }

  return {
    id: det("cca_cases", uid),
    deal_id: dealId,
    status,
    stage_id: ctx.estagiosCca.get(status) ?? null,
    analyst_id: analystId,
    agency_name: agencia,
    submitted_at: submetido,
    // `cca_cases_decision_consistency` derruba a transação inteira se um caso
    // decidido chegar sem data. `mudou_status` cobre 100% dos que precisam.
    decided_at: status === "approved" || status === "rejected" ? decidido : null,
    analysis: analise,
    created_at: primeiraData(criacao),
    updated_at: primeiraData(l["Modified Date"]) ?? primeiraData(criacao),
  };
}

// ── carga ────────────────────────────────────────────────────────────────────

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

async function principal() {
  try {
    supa();
  } catch (e) {
    if (!ehDryRun()) throw e;
    ONLINE = false;
    rel.aviso(`sem banco (${e.message.split("\n")[0]}) — dry-run offline: FK do catálogo não é conferida`);
  }

  const etapas = new Map(
    (await lerTudo("pipeline_stages", "id,code,outcome")).map((s) => [s.code, s]),
  );
  const estagiosCca = new Map();
  for (const s of (await lerTudo("cca_stages", "id,status,position,active")).sort(
    (a, b) => a.position - b.position,
  )) {
    if (s.active !== false && !estagiosCca.has(s.status)) estagiosCca.set(s.status, s.id);
  }
  if (!ONLINE) {
    // Dry-run sem credencial: catálogo de faz-de-conta só para o de-para rodar
    // até o fim e as contagens fecharem. `id` fica sendo o próprio código —
    // nada disso chega a banco, porque `inserirEmLote` não escreve em dry-run.
    for (const code of ["incomplete", "under_analysis", "approved", "contract", "closed", "lost"]) {
      etapas.set(code, { id: code, code, outcome: code === "closed" ? "won" : code === "lost" ? "lost" : "open" });
    }
    for (const s of ["pending_documents", "under_review", "sent_to_developer", "sent_to_agency", "approved", "rejected", "cancelled"]) {
      estagiosCca.set(s, s);
    }
  }
  const projetos = new Map(
    (await lerTudo("developer_projects", "id,developer_id,name")).map((p) => [
      `${p.developer_id}|${normalizarNome(p.name)}`,
      p.id,
    ]),
  );
  const analistas = new Map(
    (await lerTudo("profiles", "id,email"))
      .filter((p) => p.email)
      .map((p) => [String(p.email).toLowerCase(), p.id]),
  );

  if (ONLINE && etapas.size === 0) {
    throw new Error("pipeline_stages vazia — aplique supabase/seed.sql antes.");
  }
  // `deals_guard_closed_month` dispara no INSERT e só isenta `is_admin()`, que
  // lê auth.uid(): service_role NÃO fura essa trava. Um mês fechado recusaria a
  // linha uma a uma no meio do lote — melhor descobrir agora.
  const mesesFechados = new Set(
    (await lerTudo("closed_months", "period", ["period"])).map((m) => m.period),
  );

  const pessoa = await resolvedorPessoas("pessoa");
  const ponte = await pontePessoa();
  const construtora = await resolvedorConstrutoras();
  const ctx = { rel, etapas, estagiosCca, projetos, analistas, pessoa, ponte, construtora };

  const jaImportados = await mapaImportado("deals");
  const casosImportados = await mapaImportado("cca_cases");

  // Sonda antes de qualquer escrita real. Só depois dela o relógio da carga começa.
  if (ONLINE && !ehDryRun()) await sondarGatilhos(etapas.get("incomplete").id);
  const inicioCarga = new Date().toISOString();

  const deals = [];
  const clientes = [];
  const participantes = [];
  const casos = [];
  const paresDeals = [];
  const paresCasos = [];
  const inflados = [];
  let lidos = 0;
  let erroCentavos = 0;
  let maiorErro = { centavos: 0, code: null };
  let comparados = 0;
  let vgvCentavos = 0;
  const emMesFechado = [];

  for await (const l of lerCsv(acharExport("export_All-pipelines"))) {
    lidos++;
    const uid = String(l["unique id"] ?? "").trim();
    if (!uid) {
      rel.aviso(`linha ${lidos} sem unique id — descartada`);
      rel.conta("descartados:sem_uid");
      continue;
    }

    const m = montar(l, ctx);
    if (m.erro) {
      rel.aviso(`${uid}: ${m.erro} — linha descartada`);
      rel.conta("descartados:linha_invalida");
      continue;
    }

    // N-24: o líquido derivado (`vgv_net`) não reproduz o líquido do Bubble.
    // Medir e publicar, não esconder.
    if (m.deal.vgv_gross !== null && m.liquidoBubble !== null) {
      const brutoC = Math.round(m.deal.vgv_gross * 100);
      const bps = Math.round(m.deal.discount_pct * 100);
      const derivado = Math.round((brutoC * (10000 - bps)) / 10000);
      const erro = Math.abs(derivado - Math.round(m.liquidoBubble * 100));
      comparados++;
      erroCentavos += erro;
      if (erro > maiorErro.centavos) maiorErro = { centavos: erro, code: m.deal.code };
    }
    vgvCentavos += Math.round((m.deal.vgv_gross ?? 0) * 100);
    if (mesesFechados.has(m.deal.month_base)) emMesFechado.push(m.deal.code);

    const p = m.participantes;
    if (p.corretoresResolvidos > 0 && p.perdidos.length > 0) {
      inflados.push(`${m.deal.code} — corretor sem correspondência: ${p.perdidos.join(" · ")}`);
    }
    // O `select … having min(ordinal) > 1` da conferência conta DOIS casos: o
    // corretor que sumiu (acima) e o negócio que já nascia sem "Corretor 1" no
    // Bubble. Contar os dois aqui é o que faz o esperado 21 do aceite fechar.
    const ordinaisCorretor = p.linhas.filter((x) => x.role === "broker").map((x) => x.ordinal);
    if (ordinaisCorretor.length > 0 && Math.min(...ordinaisCorretor) > 1) {
      rel.conta("rateio:corretor_sem_ordinal_1");
    }
    if (p.corretoresPreenchidos > 0 && p.corretoresResolvidos === 0) rel.conta("negocios:sem_corretor_resolvido");
    if (p.linhas.length === 0) rel.conta("negocios:sem_participante_nenhum");

    rel.conta(`outcome:${m.deal.outcome}`);
    rel.conta(`document_review:${m.deal.document_review_status}`);

    if (jaImportados.has(uid)) {
      rel.conta("deals:ja_importados");
    } else {
      deals.push(m.deal);
      paresDeals.push({ bubble_id: uid, tabela_destino: "deals", registro_id: m.deal.id });
    }
    clientes.push(...m.clientes);
    participantes.push(...p.linhas);
    if (m.caso) {
      rel.conta(`cca:${m.caso.status}`);
      if (casosImportados.has(uid)) {
        rel.conta("cca_cases:ja_importados");
      } else {
        casos.push(m.caso);
        paresCasos.push({ bubble_id: uid, tabela_destino: "cca_cases", registro_id: m.caso.id });
      }
    } else {
      rel.conta("cca:sem_caso_status2_vazio");
    }
  }

  rel.conta("pipelines:lidos", lidos);
  rel.aviso(`VGV bruto somado da origem: R$ ${(vgvCentavos / 100).toFixed(2)} (esperado 465819613.45)`);

  if (emMesFechado.length > 0) {
    throw new Error(
      `${emMesFechado.length} negócio(s) caem em mês fechado e seriam recusados por ` +
        `deals_guard_closed_month (service_role não fura essa trava). Reabra os meses em ` +
        `public.closed_months e rode de novo. Primeiros: ${emMesFechado.slice(0, 5).join(", ")}`,
    );
  }

  // Ordem obrigatória: os negócios primeiro (FK), e os casos de CCA por último —
  // depois de todo participante existir, para que nenhuma notificação de
  // devolução tenha destinatário caso um gatilho escape da sonda.
  // Conflito sempre pela PK: o `id` é UUIDv5 do `unique id` do Bubble, então a
  // reexecução colide nela. Mirar o unique natural deixaria a PK como segunda
  // chave violável, e aí o DO NOTHING vira erro 23505.
  const recusados = {
    deals: await gravar("deals", deals, "id"),
    deal_clients: await gravar("deal_clients", clientes, "id"),
    deal_participants: await gravar("deal_participants", participantes, "id"),
    cca_cases: await gravar("cca_cases", casos, "id"),
  };
  let erros = Object.values(recusados).reduce((n, s) => n + s.size, 0);

  // O de-para recebe a linha que o banco ACEITOU, não a linha que o CSV tinha.
  // `import_bubble_map.registro_id` não tem FK (0096:53, destino polimórfico):
  // o par de um negócio recusado entraria apontando para um uuid inexistente e
  // a reexecução nunca mais tentaria aquele negócio. Filho recusado
  // (deal_clients/deal_participants) não bloqueia o pai: eles não passam pelo
  // de-para e a reexecução os reenvia inteiros.
  const mapaDeals = paresDeals.filter((p) => !recusados.deals.has(p.registro_id));
  const mapaCasos = paresCasos.filter((p) => !recusados.cca_cases.has(p.registro_id));
  const foraDoMapa = paresDeals.length - mapaDeals.length + (paresCasos.length - mapaCasos.length);
  if (foraDoMapa > 0) {
    rel.aviso(
      `${foraDoMapa} linha(s) recusadas pelo banco ficaram FORA do de-para de propósito. ` +
        `Corrija o motivo e rode de novo: o id é UUIDv5 e o insert é DO NOTHING, reexecutar é inócuo.`,
    );
  }

  if (!ehDryRun() && ONLINE) {
    for (const pares of [mapaDeals, mapaCasos]) {
      // Mapa que não é gravado também é linha perdida: a rodada seguinte
      // reinsere o que já entrou. Vai para o código de saída junto com o resto.
      const { erros: falhas } = await registrarMapa(ENTIDADE, pares);
      erros += falhas.length;
      for (const e of falhas.slice(0, 20)) rel.aviso(`import_bubble_map linha ${e.indice}: ${e.mensagem}`);
    }
  }
  rel.conta("import_bubble_map:deals", mapaDeals.length);
  rel.conta("import_bubble_map:cca_cases", mapaCasos.length);

  // ── relatório ──────────────────────────────────────────────────────────────
  pessoa.relatar(rel);
  construtora.relatar(rel);

  if (comparados > 0) {
    rel.aviso(
      `N-24: vgv_net derivado diverge do "VGV LIQUIDO" do Bubble em ` +
        `R$ ${(erroCentavos / 100).toFixed(2)} no total (${comparados} negócios), ` +
        `maior erro R$ ${(maiorErro.centavos / 100).toFixed(2)} em ${maiorErro.code}. ` +
        `O bruto e o desconto são fiéis; o líquido é derivado com 2 casas de percentual.`,
    );
  }
  rel.conta("rateio:inflado_revisao_manual", inflados.length);

  if (ONLINE && !ehDryRun()) {
    for (const [tabela, filtro] of [
      ["deal_history", (q) => q],
      ["notifications", (q) => q],
      ["game_events", (q) => q],
      ["deal_participants", (q) => q.eq("auto_added", true)],
    ]) {
      const n = await contarDesde(tabela, inicioCarga, filtro);
      rel.conta(`gatilhos:${tabela}_na_janela`, n);
      if (n > 0) {
        rel.aviso(
          `${n} linha(s) em ${tabela} nasceram durante a carga: algum gatilho voltou a rodar. ` +
            `Limpe com: delete from public.${tabela} where created_at >= '${inicioCarga}';`,
        );
      }
    }
  }

  rel.imprimir();

  // Fora do relatório pelo mesmo motivo da REVISÃO MANUAL: o corte de 50 avisos
  // não pode comer o carimbo que as consultas de R-04 usam como `:inicio_carga`.
  if (ONLINE && !ehDryRun()) {
    console.log(`\ninício da carga (para as consultas de aceite): ${inicioCarga}`);
  }

  const semVinculo = ponte.fichasSemPessoa();
  if (semVinculo.length > 0) {
    console.log(`\nFICHAS SEM VÍNCULO COM Users — ${semVinculo.length}, nenhuma virou participante:`);
    for (const linha of semVinculo) console.log(`  · ${linha}`);
  }

  // Fora do `relatorio`, que corta em 50 avisos: esta lista é o produto da
  // rodada. São os negócios em que um corretor do legado não virou pessoa e o
  // sobrevivente fica com 100% do rateio — e `sum(share_pct) = 100` PASSA neles.
  if (inflados.length > 0) {
    console.log(`\nREVISÃO MANUAL — ${inflados.length} negócio(s) com rateio inflado:`);
    for (const linha of inflados) console.log(`  · ${linha}`);
  }

  if (erros > 0) {
    console.error(`\n${erros} linha(s) não entraram. Veja os avisos acima antes de reexecutar.`);
  }

  // De-para de pessoas PARCIAL não pode sair com 0. O banco não recusa nada: os
  // participantes dessas pessoas simplesmente não são montados, `deals` fecha o
  // volume esperado, o aceite por `count(*) from import_bubble_map` passa, e a
  // carga "concluída" deixou negócio sem corretor — invisível para ele.
  if (pessoa.semPerfil > 0) {
    console.error(
      `\n${pessoa.semPerfil} usuário(s) do export de Users NÃO têm par ('user' → 'profiles') em ` +
        `import_bubble_map: a carga 01 não gravou todo mundo.\n` +
        `Todo participante dessas pessoas ficou FORA desta rodada, sem erro do banco — os avisos ` +
        `"pessoa não resolvido" acima nomeiam os valores que caíram.\n` +
        `O que fazer: rode 'node scripts/import/run.mjs pessoas --gatilhos-desligados' até o de-para ` +
        `fechar 298 pares e repita esta carga. A reexecução reenvia participante e cliente inteiros ` +
        `(eles não passam pelo de-para) e não duplica negócio: o id é UUIDv5 e o insert é DO NOTHING.`,
    );
  }

  if (erros > 0 || pessoa.semPerfil > 0) process.exit(1);
}

principal().catch((e) => {
  rel.imprimir();
  console.error(`\n[03-negocios] ABORTADO: ${e.message}`);
  process.exit(1);
});
