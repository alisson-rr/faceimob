#!/usr/bin/env node
/**
 * Carga 04 — Gamificação, metas e resultados (Bubble → Supabase).
 *
 * Origem (`DOCUMENTOS/DADOS_BUBBLE`, o arquivo mais recente de cada prefixo):
 *   DadosGames ....... 7 temporadas e os 5 pesos de pontuação de cada uma
 *   gameficacaos ..... 1.063 linhas; entram as 629 com `gameMes`. As 434 sem `gameMes`
 *                      são outro regime de dado (`Status*` guardam pontos, não contadores)
 *                      e `pontos` só fecha em 8 de 200 — ficam de fora em bloco
 *   meta-equipes ..... 201 linhas; entram as 191 com equipe E mês
 *   resultado-anuals . 67 linhas; entram 66 (2024-11 duplicado, N-25)
 *
 * Destino: `game_seasons` (7) · `game_scoring_rules` (35) · `game_season_results` (629)
 *          · `goals` (191) · `annual_results` (66). Total 928.
 *
 * O que precisa estar desligado / feito ANTES:
 *   - crons `faceimob-%` sem agendamento e `automation_settings.leads_paused = true` (PLANO fase 0);
 *   - carga 01 (identidade) concluída **inclusive as 204 pessoas desligadas** (N-10): 55 dos 142
 *     participantes do jogo estão `Ativo=não` na origem e respondem por 160 das 629 linhas de
 *     placar (N-11). Sem elas este script ABORTA — pódio congelado com buraco é pior que
 *     pódio ausente, e `game_season_results` existe justamente para não mudar depois;
 *     a própria carga 01 também cria as 12 equipes e grava `import_bubble_map(equipe → teams)`,
 *     de onde sai `goals.team_id` (ou do nome normalizado de `teams.name`);
 *   - nenhuma temporada aberta com `game_events` reais (R-16). Esta carga NUNCA fecha
 *     temporada: se houver uma pontuando, ela aborta e o operador decide como fechar.
 *
 * Gatilho: nenhum precisa ser desligado. As 5 tabelas só têm `set_updated_at`
 * (`0010:77`, `0011:93`, `0012:321`) e as 7 temporadas entram FECHADAS, então os quatro
 * gatilhos de pontuação (`deals_award_points`, `deal_participants_award_points`,
 * `cca_award_points`, `deal_documents_award_points`) não têm temporada onde pontuar.
 *
 *   node scripts/import/04-jogo-metas.mjs --dry-run    lê e resolve tudo, não grava nada
 *   node scripts/import/04-jogo-metas.mjs              grava
 *   node scripts/import/04-jogo-metas.mjs --autoteste  confere as funções puras e os volumes
 *                                                      dos 4 CSVs, sem tocar no banco
 *
 * `--dry-run` ainda LÊ o banco (o de-para de pessoas e de equipes mora lá), então exige
 * `SUPABASE_SERVICE_ROLE_KEY` no ambiente. Só `--autoteste` roda sem credencial.
 *
 * SQL que prova que deu certo. Tudo escopado por procedência: `count(*)` de tabela mede
 * seed + demo + import e reprova carga correta (R-02).
 *
 *   -- volumes por procedência
 *   select tabela_destino, count(*) from public.import_bubble_map
 *    where entidade in ('temporada','regra_jogo','placar','meta_equipe','resultado_anual')
 *    group by 1 order by 1;
 *   -- esperado: annual_results 66 | game_scoring_rules 35 | game_season_results 629
 *   --           game_seasons 7 | goals 191
 *
 *   -- pódio sem buraco. `count(*) = count(distinct rank)` NUNCA acusa nada quando o rank
 *   -- sai de row_number(): a comparação certa é o máximo contra a cardinalidade.
 *   select season_id from public.game_season_results group by 1 having max(rank) <> count(*);
 *   -- esperado: 0 linhas
 *
 *   -- o breakdown fecha com points. `vendas_fracao` é o líquido de venda da origem
 *   -- (0,5 = meio crédito por rateio), não é ponto, e por isso fica fora da soma.
 *   select count(*) from public.game_season_results r
 *    where r.points <> coalesce((select sum(v::numeric) from jsonb_each_text(r.breakdown) e(k,v)
 *                                 where k <> 'vendas_fracao'), 0);
 *   -- esperado: 0
 *
 *   -- todo participante do pódio precisa do papel broker: `visible_game_ranking` filtra por
 *   -- role='broker' (0060:136-146) e sem ele a linha entra invisível, sem nome na tela.
 *   select count(*) from public.game_season_results r
 *    where not exists (select 1 from public.user_roles ur
 *                       where ur.profile_id = r.profile_id and ur.role = 'broker');
 *   -- esperado: 0
 *
 *   -- ninguém aparece mais de 7 vezes (uma por temporada); >7 é perfil duplicado na identidade
 *   select profile_id, count(*) from public.game_season_results group by 1 having count(*) > 7;
 *   -- esperado: 0 linhas
 *
 *   -- meta sempre no dia 1: dia diferente some da tela (newSchema.ts filtra .eq("period", ...))
 *   select count(*) from public.goals g
 *    join public.import_bubble_map m on m.registro_id = g.id and m.entidade = 'meta_equipe'
 *    where g.period <> public.month_start(g.period);
 *   -- esperado: 0
 *
 *   -- meses de annual_results que NÃO vieram do Bubble (o seed inventa 2026-08 e 2026-09)
 *   select a.year, a.month, a.sales_count, a.notes from public.annual_results a
 *    where not exists (select 1 from public.import_bubble_map m
 *                       where m.registro_id = a.id and m.entidade = 'resultado_anual')
 *    order by 1, 2;
 *   -- esperado: só linhas de seed/demo. 2024-10 continua ausente de propósito (buraco da origem)
 *
 *   -- depois que o admin abrir a temporada de produção (fase 10)
 *   select count(*) from public.game_seasons where closed_at is null;   -- esperado: 1
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  criarResolvedor,
  dataBubble,
  dataBubbleDia,
  dinheiro,
  inserirEmLote,
  inteiro,
  lerCsv,
  lerMapa,
  normalizarNome,
  registrarMapa,
  relatorio,
  supa,
} from "./lib/bubble.mjs";

const DIR_CSV = fileURLToPath(
  new URL("../../DOCUMENTOS/DADOS_BUBBLE/", import.meta.url),
);

/**
 * Namespace do de-para determinístico (`mapa/game_metas.md` §4). Os ids das 7
 * temporadas foram publicados a partir dele e são conferidos no `--autoteste`:
 * recalcular com outra string reescreve todas as chaves e duplica a carga.
 */
const NS = uuid5(
  "6ba7b811-9dad-11d1-80b4-00c04fd430c8",
  "https://faceimob.com.br/import/bubble",
);

/** Coluna de peso em `DadosGames` → `event_code` + rótulo do FACEIMOB (`seed.sql:150-156`). */
const EVENTOS = [
  ["aprovado", "Pontos_Aprovado Total ou condicionado", "Análise aprovada"],
  ["esteira", "Pontos_Esteira agil (1* envio)", "Envio para esteira ágil"],
  [
    "incompleto_com_doc",
    "Pontos_Incompleto com doc",
    "Incompleto com documento",
  ],
  ["ligacao", "Pontos_Ligacao", "Ligação"],
  ["venda", "Venda", "Venda"],
];

/** Contador de `gameficacaos` → `event_code`. `StatusVenda` é tratado à parte (pode ser negativo). */
const CONTADORES = [
  ["aprovado", "StatusAprovado"],
  ["esteira", "StatusEsteiraAgil"],
  ["incompleto_com_doc", "StatusIncompleto"],
  ["ligacao", "ligacoes"],
];

const MESES_PTBR = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

/**
 * N-25: `resultado-anuals` tem duas linhas para 2024-11. A escolhida é a que bate com a
 * recontagem de `pipelines` (59 vendas / R$ 12.069.138,34, diferença de 0,002 % no VGV);
 * a outra (109 / 22.461.886,24) foi lançada no meio do mês e não casa com mês nenhum.
 * Mês duplicado que não estiver aqui não entra: escolher a primeira linha seria sorteio.
 */
const ANUAL_DUPLICADO_ESCOLHIDO = new Map([
  ["2024-11", "1733938248662x306743899157168100"],
]);

/** N-26: as metas destes 4 meses saltam de ~90 para até 363. Entram como estão, com aviso. */
const METAS_SUSPEITAS = ["2025-09", "2025-10", "2025-11", "2025-12"];

// ── funções puras ────────────────────────────────────────────────────────────

/** UUIDv5 (SHA-1). O Postgres do projeto não tem `uuid-ossp` (`0001:7-10`), então sai daqui. */
function uuid5(namespace, nome) {
  const h = createHash("sha1")
    .update(
      Buffer.concat([
        Buffer.from(namespace.replace(/-/g, ""), "hex"),
        Buffer.from(nome, "utf8"),
      ]),
    )
    .digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const s = h.subarray(0, 16).toString("hex");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

/** Chave determinística do registro no destino, a partir do `unique id` do Bubble. */
const bid = (entidade, uniqueId) => uuid5(NS, `${entidade}:${uniqueId}`);

/**
 * "Mês YYYY" em pt-BR a partir de `period_start`, igual a `public.season_label_ptbr`
 * (`0035`). Não há CHECK no banco — conferido: `game_seasons.label` é só `text not null`
 * (`0010:60`) —, mas é o formato que `close_game_season` grava, e o histórico tem de ficar
 * coerente com o que o produto gera. `Mes_nome` do Bubble não serve: vem "Março",
 * "Junho 26" e "Setembro 2026" no mesmo arquivo.
 */
const rotuloTemporada = (periodStart) => {
  const [ano, mes] = periodStart.split("-");
  return `${MESES_PTBR[Number(mes) - 1]} ${Number(ano)}`;
};

/** ROUND_HALF_UP afastando do zero: `Math.round(-0,5)` daria -0, e existe placar negativo. */
const arredondar = (v) => Math.sign(v) * Math.round(Math.abs(v));

/** Célula numérica pt-BR vazia vale 0 — nas 629 linhas importáveis não há vazio, mas reexport pode ter. */
const num = (v) => dinheiro(v) ?? 0;

/**
 * Índice nome normalizado → id, guardando ARRAY quando dois ids normalizam para o mesmo
 * nome. É o que faz `criarResolvedor` devolver "ambiguo" em vez de sortear (R-08).
 *
 * @param {Iterable<[string, string]>} pares
 */
function indicePorNome(pares) {
  const m = new Map();
  for (const [nome, id] of pares) {
    const chave = normalizarNome(nome);
    if (!chave || !id) continue;
    const atual = m.get(chave);
    if (atual === undefined) m.set(chave, id);
    else if (Array.isArray(atual)) {
      if (!atual.includes(id)) atual.push(id);
    } else if (atual !== id) m.set(chave, [atual, id]);
  }
  return m;
}

/**
 * Data do export, carimbada no nome pelo Bubble: `…_2026-09-08_19-37-19.csv`.
 * `null` quando não há carimbo — é o que separa snapshot de cópia acidental.
 */
const carimbo = (nome) =>
  nome.match(/_(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})\.csv$/)?.[1] ?? null;

/**
 * O CSV mais NOVO do prefixo — pelo carimbo, nunca pela ordem alfabética do nome
 * inteiro: `-` (0x2D) < `_` (0x5F), então o reexport sem "-modified" que N-05 vai
 * colocar ao lado do atual venceria um `-modified` mais recente (ou perderia dele),
 * conforme a data. Nome sem carimbo (cópia acidental, arquivo salvo à mão) só entra
 * na disputa quando nenhum outro tem.
 */
function acharCsv(prefixo) {
  const nomes = readdirSync(DIR_CSV).filter(
    (n) => n.startsWith(prefixo) && n.toLowerCase().endsWith(".csv"),
  );
  if (nomes.length === 0) {
    throw new Error(
      `Nenhum CSV começando por "${prefixo}" em DOCUMENTOS/DADOS_BUBBLE.`,
    );
  }
  const carimbados = nomes.filter((n) => carimbo(n));
  const nome = (carimbados.length ? carimbados : nomes)
    .sort((a, b) => (carimbo(a) ?? a).localeCompare(carimbo(b) ?? b))
    .at(-1);
  return { nome, caminho: join(DIR_CSV, nome) };
}

/**
 * `DadosGames` → temporada com pesos. `Inicio`/`Fim` viram `date` pelo dia do calendário
 * local (REGRA-D3): nenhum dos 14 valores está perto da meia-noite, então não há
 * deslizamento de um dia. A temporada `MesAtivo='sim'` também entra FECHADA — com uma
 * aberta, a carga de negócios/CCA pontuaria nela pelos 4 gatilhos.
 */
async function lerTemporadas(caminho, agora) {
  const temporadas = [];
  for await (const l of lerCsv(caminho)) {
    const uid = l["unique id"];
    const periodStart = dataBubbleDia(l.Inicio);
    const periodEnd = dataBubbleDia(l.Fim);
    if (!uid || !periodStart || !periodEnd) {
      temporadas.push({ uid, invalida: true, mesNome: l.Mes_nome });
      continue;
    }
    const ativa = l.MesAtivo === "sim";
    temporadas.push({
      uid,
      id: bid("DadosGames", uid),
      mesNome: l.Mes_nome,
      ativa,
      periodStart,
      periodEnd,
      // `closed_at` e `period_end` são bicondicionais (`0010:69-71`): um nulo sem o outro é 23514.
      closedAt: ativa ? agora : dataBubble(l.Fim),
      criador: l.Creator,
      createdAt: dataBubble(l["Creation Date"]),
      updatedAt: dataBubble(l["Modified Date"]),
      pesos: Object.fromEntries(
        EVENTOS.map(([codigo, coluna]) => [codigo, inteiro(l[coluna]) ?? 0]),
      ),
      rotulos: Object.fromEntries(
        EVENTOS.map(([codigo, , rotulo]) => [codigo, rotulo]),
      ),
    });
  }
  return temporadas;
}

/**
 * Âncora `Users.GameAtual` → linha de `gameficacaos` → `user`: dá o par exato
 * (`Users.unique id`, nome curto do jogo) sem heurística de nome. Medido: 142 âncoras,
 * 0 órfãos, 0 ambíguos, 629/629 linhas cobertas.
 */
async function lerAncora(caminhoUsers, caminhoJogo) {
  const porUniqueId = new Map();
  for await (const l of lerCsv(caminhoJogo))
    porUniqueId.set(l["unique id"], l.user);

  const pares = []; // [nome curto, Users.unique id]
  const orfaos = [];
  for await (const u of lerCsv(caminhoUsers)) {
    const ancora = u.GameAtual?.trim();
    if (!ancora) continue;
    const nomeCurto = porUniqueId.get(ancora);
    if (!nomeCurto) {
      orfaos.push(u["unique id"]);
      continue;
    }
    pares.push([nomeCurto, u["unique id"]]);
  }
  return { pares, orfaos };
}

/**
 * `gameficacaos` com `gameMes` → linha de placar, ainda sem `profile_id` nem `rank`.
 *
 * `pontos` do Bubble é a verdade: em 7 linhas de Agosto ele não fecha com a soma ponderada
 * (ajuste manual no fechamento) e o resíduo vai para `breakdown.ajuste`, mantendo o
 * invariante "soma do breakdown = points".
 */
async function lerPlacar(caminho, temporadasPorUid) {
  const linhas = [];
  const semTemporada = [];
  for await (const l of lerCsv(caminho)) {
    if (!l.gameMes?.trim()) continue; // regime legado, descartado em bloco (L1)
    const temporada = temporadasPorUid.get(l.gameMes.trim());
    if (!temporada) {
      semTemporada.push(l.gameMes);
      continue;
    }

    const breakdown = {};
    for (const [codigo, coluna] of CONTADORES) {
      const q = num(l[coluna]);
      if (q) breakdown[codigo] = arredondar(q * temporada.pesos[codigo]);
    }
    // A origem só guarda o líquido do mês: 2 vendas − 1 distrato aparece como 1. O distrato
    // só é visível quando o líquido fica negativo.
    const vendaLiquida = num(l.StatusVenda);
    if (vendaLiquida > 0)
      breakdown.venda = arredondar(vendaLiquida * temporada.pesos.venda);
    if (vendaLiquida < 0)
      breakdown.distrato = arredondar(vendaLiquida * temporada.pesos.venda);

    const points = arredondar(num(l.pontos));
    const ajuste = points - Object.values(breakdown).reduce((s, v) => s + v, 0);
    if (ajuste !== 0) breakdown.ajuste = ajuste;

    // `sales` é int e a meia venda do rateio vira uma venda cheia na tela: +16,5 no total.
    // O líquido exato fica auditável no breakdown (não é ponto — fica fora da soma acima).
    const sales = vendaLiquida < 0 ? 0 : arredondar(vendaLiquida);
    if (sales !== vendaLiquida) breakdown.vendas_fracao = vendaLiquida;

    linhas.push({
      uid: l["unique id"],
      temporada,
      nomeCurto: l.user,
      points,
      sales,
      vendaLiquida,
      breakdown,
      frozenAt: dataBubble(l["Modified Date"]) ?? temporada.closedAt,
    });
  }
  return { linhas, semTemporada };
}

/**
 * `rank` = `row_number()` por temporada ordenando `points desc, full_name` — a mesma regra
 * de `close_game_season` (`0060:532`). O desempate por nome sai normalizado (sem acento)
 * porque a collation do Postgres também ignora acento no nível primário; a chave do registro
 * fecha o desempate para a reexecução dar exatamente o mesmo rank.
 *
 * O rank é calculado sobre TODAS as linhas resolvidas da temporada, não só sobre as que
 * ainda faltam gravar: reexecução tem de reproduzir o mesmo pódio.
 *
 * ponytail: 356 das 629 linhas empatam em `points`; parear a collation com a do banco só
 * importaria se o congelado fosse recalculado algum dia, e ele nunca é.
 *
 * @param {{temporada: {uid: string}, profileId?: string, uid: string, points: number}[]} linhas
 * @param {(linha: object) => string} nomeDe
 */
function atribuirRank(linhas, nomeDe) {
  const porTemporada = new Map();
  for (const l of linhas) {
    porTemporada.set(l.temporada.uid, [
      ...(porTemporada.get(l.temporada.uid) ?? []),
      l,
    ]);
  }
  for (const grupo of porTemporada.values()) {
    grupo.sort(
      (a, b) =>
        b.points - a.points ||
        normalizarNome(nomeDe(a)).localeCompare(normalizarNome(nomeDe(b))) ||
        nomeDe(a).localeCompare(nomeDe(b)) ||
        (a.profileId ?? a.uid).localeCompare(b.profileId ?? b.uid),
    );
    grupo.forEach((l, i) => (l.rank = i + 1));
  }
  return porTemporada;
}

/**
 * `meta-equipes` → meta mensal por equipe. `mes` é competência, não instante (REGRA-D1):
 * pega-se ano e mês e força o dia 1. Converter para fuso jogaria a competência um mês atrás.
 */
async function lerMetas(caminho) {
  const linhas = [];
  const descartadas = { semMes: 0, semEquipe: 0 };
  for await (const l of lerCsv(caminho)) {
    const dia = dataBubbleDia(l.mes);
    if (!dia) {
      descartadas.semMes++;
      continue;
    }
    if (!l.equipe?.trim()) {
      descartadas.semEquipe++; // meta global inventada polui goals_global_idx e a tela da casa (L3)
      continue;
    }
    linhas.push({
      uid: l["unique id"],
      equipe: l.equipe,
      period: `${dia.slice(0, 7)}-01`,
      target: inteiro(l.meta) ?? 0,
      criador: l.Creator,
      createdAt: dataBubble(l["Creation Date"]),
      updatedAt: dataBubble(l["Modified Date"]),
    });
  }
  return { linhas, descartadas };
}

/**
 * `resultado-anuals` → resultado consolidado mensal, com a duplicata de 2024-11 resolvida
 * por N-25 e os buracos da série listados (2024-10 nunca ganhou linha na origem).
 */
async function lerResultadosAnuais(caminho) {
  const porPeriodo = new Map();
  for await (const l of lerCsv(caminho)) {
    const dia = dataBubbleDia(l.data);
    if (!dia) continue;
    const periodo = dia.slice(0, 7);
    const linha = {
      uid: l["unique id"],
      periodo,
      year: Number(periodo.slice(0, 4)),
      month: Number(periodo.slice(5, 7)),
      salesCount: inteiro(l.vendas) ?? 0,
      vgv: dinheiro(l.vgv) ?? 0,
      criador: l.Creator,
      createdAt: dataBubble(l["Creation Date"]),
      updatedAt: dataBubble(l["Modified Date"]),
    };
    porPeriodo.set(periodo, [...(porPeriodo.get(periodo) ?? []), linha]);
  }

  const linhas = [];
  const duplicados = [];
  for (const [periodo, candidatas] of porPeriodo) {
    if (candidatas.length === 1) {
      linhas.push(candidatas[0]);
      continue;
    }
    const escolhido = ANUAL_DUPLICADO_ESCOLHIDO.get(periodo);
    const escolhida = candidatas.find((c) => c.uid === escolhido);
    duplicados.push({ periodo, candidatas, escolhida });
    if (escolhida) linhas.push(escolhida);
  }

  const periodos = [...porPeriodo.keys()].sort();
  const buracos = [];
  // Zero período = coluna `data` renomeada ou em formato novo no reexport. Falhar aqui
  // nomeia a causa; seguir gravaria 0 de 66 linhas e o aceite 9.1 acusaria só no fim.
  if (periodos.length === 0) {
    throw new Error(
      `Nenhuma linha de ${caminho} tem a coluna 'data' em formato reconhecido.`,
    );
  }
  for (let [ano, mes] = periodos[0].split("-").map(Number); ;) {
    const p = `${ano}-${String(mes).padStart(2, "0")}`;
    if (p > periodos.at(-1)) break;
    if (!porPeriodo.has(p)) buracos.push(p);
    if (++mes > 12) ((mes = 1), ano++);
  }
  return { linhas, duplicados, buracos };
}

// ── banco ────────────────────────────────────────────────────────────────────

/** Leitura simples. Erro de conexão ou de permissão aborta na hora — não há linha ruim aqui. */
async function ler(tabela, colunas, filtrar = (q) => q) {
  const { data, error } = await filtrar(
    supa().from(tabela).select(colunas),
  ).range(0, 9999);
  if (error) throw new Error(`Leitura de ${tabela} falhou: ${error.message}`);
  return data ?? [];
}

/**
 * Insere e devolve os índices das linhas que falharam, para que só o que entrou seja
 * registrado no de-para. Lote inteiro falhando é erro sistêmico (chave, permissão, rede),
 * não linha ruim: aborta em vez de gastar uma tentativa por linha e seguir mentindo.
 */
async function gravar(tabela, linhas, onConflict) {
  const { inseridos, erros } = await inserirEmLote(tabela, linhas, {
    onConflict,
  });
  if (linhas.length > 0 && erros.length === linhas.length) {
    throw new Error(
      `Todas as ${linhas.length} linhas de ${tabela} falharam: ${erros[0].mensagem}`,
    );
  }
  return { inseridos, erros, ruins: new Set(erros.map((e) => e.indice)) };
}

// ── execução ─────────────────────────────────────────────────────────────────

async function main() {
  const rel = relatorio("jogo e metas");
  const agora = new Date().toISOString();

  const csvJogos = acharCsv("export_All---DadosGames");
  const csvPlacar = acharCsv("export_All---gameficacaos");
  const csvMetas = acharCsv("export_All-meta-equipes");
  const csvAnuais = acharCsv("export_All-resultado-anuals");
  const csvUsers = acharCsv("export_All-Users");
  for (const c of [csvJogos, csvPlacar, csvMetas, csvAnuais, csvUsers]) {
    console.log(`  origem: ${c.nome}`);
  }

  // ── R-16: pré-condição, nunca efeito colateral ─────────────────────────────
  // Esta carga NÃO fecha temporada nenhuma. Fechar por fora pararia os 4 gatilhos de
  // pontuação em silêncio e o ponto não volta quando a próxima abrir (`0078:162-192`
  // grava um aviso `game_paused` e descarta). `game_seasons_one_open` (`0010:73-75`)
  // garante no máximo uma aberta; a decisão de fechá-la é do operador, com o efeito à vista.
  const abertas = await ler("game_seasons", "id, label", (q) =>
    q.is("closed_at", null),
  );
  const comEvento = new Set(
    abertas.length === 0
      ? []
      : (
          await ler("game_events", "season_id", (q) =>
            q.in(
              "season_id",
              abertas.map((s) => s.id),
            ),
          )
        ).map((e) => e.season_id),
  );
  const fecharSql = (id) =>
    "update public.game_seasons set closed_at = now(), " +
    `period_end = greatest(period_start, current_date) where id = '${id}';`;

  const produtiva = abertas.find((s) => comEvento.has(s.id));
  if (produtiva) {
    throw new Error(
      [
        `Temporada aberta COM game_events reais: "${produtiva.label}" (${produtiva.id}).`,
        "Esta carga não fecha temporada (R-16): fechar por fora pararia os 4 gatilhos de pontuação",
        "em silêncio e o ponto não volta quando a próxima abrir. Quem fecha é o operador, sabendo o efeito:",
        "  · pela tela de Gamificação (RPC close_game_season): CONGELA o ranking atual em",
        "    game_season_results — a mesma tabela que esta carga preenche com as 629 linhas do Bubble,",
        "    e que nunca é recalculada — e ainda abre outra temporada. Num banco com seed/demo isso",
        "    mistura pódio inventado com histórico importado;",
        "  · sem congelar pódio nenhum, se a temporada for de seed/demo:",
        `    ${fecharSql(produtiva.id)}`,
        "Depois de fechar, rode esta carga de novo.",
      ].join("\n"),
    );
  }
  for (const s of abertas) {
    rel.aviso(
      `temporada aberta sem game_events (seed/vitrine): "${s.label}" (${s.id}). Esta carga NÃO a fecha ` +
        "(R-16) — e enquanto ela existir a de produção não pode ser aberta na fase 10 " +
        `(índice game_seasons_one_open). Para fechar sem congelar pódio: ${fecharSql(s.id)}`,
    );
  }

  // ── de-para e catálogos do destino ─────────────────────────────────────────
  const mapaPessoas = await lerMapa("user", "profiles");
  if (mapaPessoas.size === 0) {
    throw new Error(
      "import_bubble_map(entidade='user', tabela_destino='profiles') está vazio: a carga 01 (identidade) não rodou.",
    );
  }
  const mapaEquipes = await lerMapa("equipe", "teams");
  const perfis = await ler("profiles", "id, full_name");
  const equipes = await ler("teams", "id, name");
  const brokers = new Set(
    (await ler("user_roles", "profile_id", (q) => q.eq("role", "broker"))).map(
      (r) => r.profile_id,
    ),
  );
  const nomePorPerfil = new Map(perfis.map((p) => [p.id, p.full_name ?? ""]));

  // `Creator` é sempre "Douglas Gomes" (autoria de backoffice). Não resolveu → NULL.
  const resolverCriador = criarResolvedor({
    porId: mapaPessoas,
    porNome: indicePorNome(perfis.map((p) => [p.full_name, p.id])),
    rotulo: "criador",
  });
  // `teams.name` não é unique (`0002:117`): nome repetido devolve "ambiguo", nunca a primeira linha.
  const resolverEquipe = criarResolvedor({
    porId: mapaEquipes,
    porNome: indicePorNome(equipes.map((t) => [t.name, t.id])),
    rotulo: "equipe",
  });

  // ── temporadas e regras ────────────────────────────────────────────────────
  const temporadas = await lerTemporadas(csvJogos.caminho, agora);
  rel.conta("DadosGames lidos", temporadas.length);
  const validas = temporadas.filter((t) => !t.invalida);
  for (const t of temporadas.filter((t) => t.invalida)) {
    rel.aviso(`temporada sem Inicio/Fim, descartada: ${t.mesNome ?? t.uid}`);
  }
  const temporadasPorUid = new Map(validas.map((t) => [t.uid, t]));

  const rotulosLegados = new Set(
    validas.map((t) => rotuloTemporada(t.periodStart)),
  );
  for (const s of abertas) {
    if (rotulosLegados.has(s.label)) {
      rel.aviso(
        `a temporada de vitrine "${s.label}" (${s.id}) fica com o mesmo rótulo de uma legada — ` +
          "duas entradas iguais no seletor da Gamificação; apagar a de vitrine é decisão do operador",
      );
    }
  }

  // ── placar: leitura e resolução ────────────────────────────────────────────
  // Fica aqui, e não junto do insert do placar, porque os dois abortos abaixo são
  // pré-condição: rodar fora de ordem tem de parar ANTES da primeira escrita.
  const { pares, orfaos } = await lerAncora(
    csvUsers.caminho,
    csvPlacar.caminho,
  );
  for (const uid of orfaos)
    rel.aviso(
      `Users.GameAtual aponta para linha inexistente de gameficacaos: ${uid}`,
    );

  // N-10/N-11: 55 dos 142 participantes estão Ativo=não na origem e valem 160 das 629 linhas.
  // Se a identidade não os trouxe, rejeitar essas linhas deixaria o pódio congelado com o
  // vencedor errado — e congelado é para sempre. Melhor não importar nada e avisar.
  const semPerfil = pares.filter(([, uid]) => !mapaPessoas.has(uid));
  if (semPerfil.length > 0) {
    throw new Error(
      [
        `${semPerfil.length} dos ${pares.length} participantes do jogo não estão em`,
        "import_bubble_map(entidade='user', tabela_destino='profiles').",
        "A carga 01 precisa trazer também as pessoas desligadas (N-10): elas respondem por",
        "160 das 629 linhas de placar e o rank congelado só vale com o conjunto completo (N-11).",
      ].join(" "),
    );
  }

  const resolverPessoa = criarResolvedor({
    porId: mapaPessoas,
    porNome: indicePorNome(
      pares.map(([nome, uid]) => [nome, mapaPessoas.get(uid)]),
    ),
    rotulo: "participante",
  });

  const { linhas: placarBruto, semTemporada } = await lerPlacar(
    csvPlacar.caminho,
    temporadasPorUid,
  );
  rel.conta("gameficacaos com gameMes lidos", placarBruto.length);
  for (const uid of new Set(semTemporada))
    rel.aviso(`gameMes sem temporada correspondente: ${uid}`);

  const placar = [];
  const naoResolvidos = [];
  for (const l of placarBruto) {
    const { id, via } = resolverPessoa(l.nomeCurto);
    if (!id) {
      rel.conta(`placar rejeitado (${via})`, 1);
      naoResolvidos.push(`${l.uid} (${l.nomeCurto || "sem nome"}, ${via})`);
      continue;
    }
    placar.push({ ...l, profileId: id });
  }
  resolverPessoa.relatar(rel);
  // Mesmo motivo do aborto por `semPerfil`: rank recalculado só sobre os sobreviventes
  // fica contíguo, passa em `max(rank) = count(*)` e congela um pódio diferente do Bubble.
  if (naoResolvidos.length > 0) {
    throw new Error(
      [
        `${naoResolvidos.length} de ${placarBruto.length} linhas de placar não resolveram para um perfil.`,
        "O rank congelado só vale com o conjunto completo (N-11) e game_season_results nunca é recalculado.",
        `unique id não resolvidos: ${naoResolvidos.slice(0, 20).join(", ")}`,
        ...(naoResolvidos.length > 20
          ? [`(+${naoResolvidos.length - 20} omitidos)`]
          : []),
      ].join("\n"),
    );
  }

  // ── daqui para baixo, grava ────────────────────────────────────────────────
  const jaTemporadas = await lerMapa("temporada", "game_seasons");
  const novasTemporadas = validas.filter((t) => !jaTemporadas.has(t.uid));
  rel.conta(
    "temporadas já importadas",
    validas.length - novasTemporadas.length,
  );
  const rTemporadas = await gravar(
    "game_seasons",
    novasTemporadas.map((t) => ({
      id: t.id,
      label: rotuloTemporada(t.periodStart),
      period_start: t.periodStart,
      period_end: t.periodEnd,
      closed_at: t.closedAt,
      closed_by: resolverCriador(t.criador).id,
      created_at: t.createdAt,
      updated_at: t.updatedAt,
    })),
    "id",
  );
  rel.conta("game_seasons inseridas", rTemporadas.inseridos);
  for (const e of rTemporadas.erros)
    rel.aviso(`game_seasons linha ${e.indice}: ${e.mensagem}`);
  await registrarMapa(
    "temporada",
    novasTemporadas
      .filter((_, i) => !rTemporadas.ruins.has(i))
      .map((t) => ({
        bubble_id: t.uid,
        tabela_destino: "game_seasons",
        registro_id: t.id,
      })),
  );

  // Os pesos mudaram 3 vezes: a regra vai por temporada, nunca como regra padrão
  // (`season_id is null`) — `ligacao` não existe no seed e viraria código que nunca pontua.
  const jaRegras = await lerMapa("regra_jogo", "game_scoring_rules");
  const regras = validas
    .flatMap((t) =>
      EVENTOS.map(([codigo]) => ({
        chave: `${t.uid}:${codigo}`,
        linha: {
          id: bid("DadosGames.rule", `${t.uid}:${codigo}`),
          season_id: t.id,
          event_code: codigo,
          label: t.rotulos[codigo],
          points: t.pesos[codigo],
          active: true,
        },
      })),
    )
    .filter((r) => !jaRegras.has(r.chave));
  const rRegras = await gravar(
    "game_scoring_rules",
    regras.map((r) => r.linha),
    "id",
  );
  rel.conta("game_scoring_rules inseridas", rRegras.inseridos);
  for (const e of rRegras.erros)
    rel.aviso(`game_scoring_rules linha ${e.indice}: ${e.mensagem}`);
  await registrarMapa(
    "regra_jogo",
    regras
      .filter((_, i) => !rRegras.ruins.has(i))
      .map((r) => ({
        bubble_id: r.chave,
        tabela_destino: "game_scoring_rules",
        registro_id: r.linha.id,
      })),
  );

  // ── placar ─────────────────────────────────────────────────────────────────
  const porTemporada = atribuirRank(
    placar,
    (l) => nomePorPerfil.get(l.profileId) ?? "",
  );

  for (const [uid, linhas] of porTemporada) {
    const temporada = temporadasPorUid.get(uid);
    const real = linhas.reduce((s, l) => s + l.vendaLiquida, 0);
    const gravado = linhas.reduce((s, l) => s + l.sales, 0);
    if (real !== gravado) {
      rel.aviso(
        `${rotuloTemporada(temporada.periodStart)}: StatusVenda soma ${real} na origem e ${gravado} em ` +
          "`sales` (int). O líquido de cada linha fica em breakdown.vendas_fracao",
      );
    }
  }
  const semPapel = new Set(
    placar.filter((l) => !brokers.has(l.profileId)).map((l) => l.profileId),
  );
  if (semPapel.size > 0) {
    rel.aviso(
      `${semPapel.size} participantes não têm o papel 'broker': visible_game_ranking os esconde e a ` +
        "linha congelada aparece sem nome (0060:136-146). Corrigir em user_roles, não aqui",
    );
  }

  const jaPlacar = await lerMapa("placar", "game_season_results");
  const novoPlacar = placar.filter((l) => !jaPlacar.has(l.uid));
  rel.conta("placar já importado", placar.length - novoPlacar.length);
  const rPlacar = await gravar(
    "game_season_results",
    novoPlacar.map((l) => ({
      season_id: l.temporada.id,
      profile_id: l.profileId,
      rank: l.rank,
      points: l.points,
      sales: l.sales,
      // vgv fica 0: não existe VGV neste export. Backfill opcional depois da carga de negócios.
      vgv: 0,
      breakdown: l.breakdown,
      frozen_at: l.frozenAt,
    })),
    "season_id,profile_id",
  );
  rel.conta("game_season_results inseridos", rPlacar.inseridos);
  for (const e of rPlacar.erros)
    rel.aviso(`game_season_results linha ${e.indice}: ${e.mensagem}`);
  await registrarMapa(
    "placar",
    novoPlacar
      .filter((_, i) => !rPlacar.ruins.has(i))
      // `game_season_results` não tem coluna `id` (PK é `(season_id, profile_id)`): o
      // registro_id carrega o profile_id, e a temporada sai do próprio bubble_id.
      .map((l) => ({
        bubble_id: l.uid,
        tabela_destino: "game_season_results",
        registro_id: l.profileId,
      })),
  );

  // ── metas ──────────────────────────────────────────────────────────────────
  const { linhas: metasBrutas, descartadas } = await lerMetas(csvMetas.caminho);
  rel.conta("meta-equipes úteis", metasBrutas.length);
  rel.conta("meta-equipes sem mês", descartadas.semMes);
  rel.conta("meta-equipes sem equipe", descartadas.semEquipe);

  const metas = [];
  for (const m of metasBrutas) {
    const { id, via } = resolverEquipe(m.equipe);
    if (!id) {
      rel.conta(`meta rejeitada (${via})`, 1);
      continue;
    }
    metas.push({ ...m, teamId: id });
  }
  resolverEquipe.relatar(rel);

  // N-26: 4 meses com meta somando até 363 contra ~90 do resto da série. Entram como estão.
  const somaPorPeriodo = new Map();
  for (const m of metas)
    somaPorPeriodo.set(
      m.period,
      (somaPorPeriodo.get(m.period) ?? 0) + m.target,
    );
  for (const p of METAS_SUSPEITAS) {
    const soma = somaPorPeriodo.get(`${p}-01`);
    if (soma !== undefined) {
      rel.aviso(
        `meta de ${p} soma ${soma} (o resto da série fica perto de 90) — conferência humana (N-26)`,
      );
    }
  }

  const jaMetas = await lerMapa("meta_equipe", "goals");
  const novasMetas = metas.filter((m) => !jaMetas.has(m.uid));
  rel.conta("metas já importadas", metas.length - novasMetas.length);
  const rMetas = await gravar(
    "goals",
    novasMetas.map((m) => ({
      id: bid("meta-equipes", m.uid),
      scope: "team", // `goals_scope_team` é bicondicional: exige team_id e proíbe profile_id
      team_id: m.teamId,
      profile_id: null,
      period_type: "month",
      period: m.period,
      metric: "sales",
      target: m.target,
      created_by: resolverCriador(m.criador).id,
      created_at: m.createdAt,
      updated_at: m.updatedAt,
    })),
    "id",
  );
  rel.conta("goals inseridos", rMetas.inseridos);
  for (const e of rMetas.erros)
    rel.aviso(`goals linha ${e.indice}: ${e.mensagem}`);
  await registrarMapa(
    "meta_equipe",
    novasMetas
      .filter((_, i) => !rMetas.ruins.has(i))
      .map((m) => ({
        bubble_id: m.uid,
        tabela_destino: "goals",
        registro_id: bid("meta-equipes", m.uid),
      })),
  );

  // ── resultados anuais ──────────────────────────────────────────────────────
  const anuais = await lerResultadosAnuais(csvAnuais.caminho);
  rel.conta("resultado-anuals úteis", anuais.linhas.length);
  for (const d of anuais.duplicados) {
    const resumo = d.candidatas
      .map((c) => `${c.salesCount} vendas`)
      .join(" × ");
    if (d.escolhida) {
      rel.aviso(
        `${d.periodo} tem ${d.candidatas.length} linhas na origem (${resumo}); importada a de ` +
          `${d.escolhida.salesCount} vendas, que bate com a recontagem de pipelines (N-25)`,
      );
    } else {
      rel.aviso(
        `${d.periodo} duplicado (${resumo}) e sem escolha registrada — nenhuma linha importada`,
      );
    }
  }
  for (const b of anuais.buracos) {
    rel.aviso(
      `${b} não existe na origem e continua ausente no destino (buraco no gráfico anual, N-25)`,
    );
  }

  // O destino já tem resultado anual de seed/demo, inclusive em meses que a origem cobre.
  // Sobrescrever é destrutivo e não é decisão deste script: o mês ocupado por linha alheia
  // fica de fora e sai no relatório com o SQL de saída.
  const ocupados = new Map(
    (await ler("annual_results", "id, year, month")).map((a) => [
      `${a.year}-${String(a.month).padStart(2, "0")}`,
      a.id,
    ]),
  );
  const jaAnuais = await lerMapa("resultado_anual", "annual_results");
  const novosAnuais = [];
  for (const a of anuais.linhas) {
    if (jaAnuais.has(a.uid)) {
      rel.conta("resultados anuais já importados", 1);
      continue;
    }
    const dono = ocupados.get(a.periodo);
    const meu = bid("resultado-anuals", a.uid);
    if (dono && dono !== meu) {
      rel.aviso(
        `${a.periodo} já está ocupado por outra linha (${dono}, seed/demo) e o dado do Bubble não entrou. ` +
          `Para trocar: delete from public.annual_results where id = '${dono}'; e rode de novo`,
      );
      rel.conta("annual_results bloqueados por linha de seed", 1);
      continue;
    }
    novosAnuais.push({ ...a, id: meu });
  }
  const rAnuais = await gravar(
    "annual_results",
    novosAnuais.map((a) => ({
      id: a.id,
      year: a.year,
      month: a.month,
      sales_count: a.salesCount,
      vgv: a.vgv,
      // `notes` não é escrito nem exibido por nenhuma tela (`Resultados.tsx:126-137` só o repassa):
      // é a segunda marca de procedência, visível em SQL sem join.
      notes: `bubble:${a.uid}`,
      updated_by: resolverCriador(a.criador).id,
      created_at: a.createdAt,
      updated_at: a.updatedAt,
    })),
    "year,month",
  );
  rel.conta("annual_results inseridos", rAnuais.inseridos);
  for (const e of rAnuais.erros)
    rel.aviso(`annual_results linha ${e.indice}: ${e.mensagem}`);
  await registrarMapa(
    "resultado_anual",
    novosAnuais
      .filter((_, i) => !rAnuais.ruins.has(i))
      .map((a) => ({
        bubble_id: a.uid,
        tabela_destino: "annual_results",
        registro_id: a.id,
      })),
  );

  const alheios = [...ocupados.keys()].filter(
    (p) => !anuais.linhas.some((a) => a.periodo === p),
  );
  if (alheios.length > 0) {
    rel.aviso(
      `meses em annual_results que a origem não tem (seed/demo, números inventados): ${alheios.join(", ")}`,
    );
  }

  resolverCriador.relatar(rel);
  rel.aviso(
    "fora desta carga por falta de destino no schema: meta-constutoras (389 linhas, N-15) e meta_remuneracao (160 valores, N-17)",
  );
  rel.aviso(
    "a temporada de produção continua fechada: alguém precisa abrir na tela de Gamificação (fase 10)",
  );
  rel.imprimir();
}

// ── autoteste (sem banco) ────────────────────────────────────────────────────

/**
 * Confere o que é puro e os volumes dos 4 CSVs. Roda sem credencial: é a verificação
 * possível enquanto o banco não pode ser tocado.
 */
async function autoteste() {
  assert.equal(
    NS,
    "834b56e0-9263-5e1d-af8e-eb91a3616732",
    "namespace do de-para mudou",
  );
  assert.equal(
    bid("DadosGames", "1774722066067x931669531211071500"),
    "a95ee3f5-4627-5e09-9bcb-8c9ca05db5b1",
  );
  assert.equal(
    bid("DadosGames", "1788277988370x359280909145341950"),
    "6bb69ec8-8d30-520e-9f8e-ee3c4b48925b",
  );

  assert.equal(rotuloTemporada("2026-03-28"), "Março 2026");
  assert.equal(rotuloTemporada("2026-09-01"), "Setembro 2026");
  assert.equal(arredondar(0.5), 1);
  assert.equal(arredondar(-0.5), -1);
  assert.equal(arredondar(73.5), 74);

  const idx = indicePorNome([
    ["Ana Souza", "a"],
    ["ana souza", "b"],
    ["Bruno", "c"],
    ["Bruno", "c"],
  ]);
  assert.deepEqual(idx.get("ana souza"), ["a", "b"]);
  assert.equal(idx.get("bruno"), "c");

  const agora = "2026-09-09T12:00:00.000Z";
  const temporadas = await lerTemporadas(
    acharCsv("export_All---DadosGames").caminho,
    agora,
  );
  assert.equal(temporadas.length, 7);
  const marco = temporadas[0];
  assert.equal(marco.periodStart, "2026-03-28");
  assert.equal(marco.periodEnd, "2026-04-01");
  assert.equal(marco.closedAt, "2026-04-01T10:00:00-03:00");
  assert.deepEqual(marco.pesos, {
    aprovado: 250,
    esteira: 200,
    incompleto_com_doc: 50,
    ligacao: 1,
    venda: 700,
  });
  const setembro = temporadas.at(-1);
  assert.equal(setembro.ativa, true, "Setembro 2026 é a MesAtivo=sim");
  assert.equal(setembro.closedAt, agora, "a ativa também entra fechada (§2.1)");
  assert.equal(setembro.periodEnd, "2026-09-30");

  const porUid = new Map(temporadas.map((t) => [t.uid, t]));
  const { linhas, semTemporada } = await lerPlacar(
    acharCsv("export_All---gameficacaos").caminho,
    porUid,
  );
  assert.equal(linhas.length, 629, "as 629 linhas com gameMes");
  assert.equal(
    semTemporada.length,
    0,
    "todo gameMes resolve para uma temporada",
  );
  // O invariante que a verificação pós-carga cobra: soma do breakdown (sem vendas_fracao) = points.
  for (const l of linhas) {
    const soma = Object.entries(l.breakdown)
      .filter(([k]) => k !== "vendas_fracao")
      .reduce((s, [, v]) => s + v, 0);
    assert.equal(soma, l.points, `breakdown não fecha em ${l.uid}`);
  }
  const comAjuste = linhas.filter((l) => "ajuste" in l.breakdown);
  assert.equal(
    comAjuste.length,
    7,
    "os 7 ajustes manuais do fechamento de Agosto",
  );
  const fracionarias = linhas.filter((l) => "vendas_fracao" in l.breakdown);
  assert.equal(fracionarias.length, 31, "29 metades + 2 negativos zerados");
  assert.equal(
    linhas.reduce((s, l) => s + l.vendaLiquida, 0),
    319.5,
  );
  assert.equal(
    linhas.reduce((s, l) => s + l.sales, 0),
    336,
  );
  assert.ok(
    linhas.every((l) => l.sales >= 0),
    "sales nunca negativo",
  );

  // ACEITE 9.2: `max(rank) = nº de linhas` por temporada, sem buraco e sem repetição.
  const ranqueado = atribuirRank(linhas, (l) => l.nomeCurto);
  assert.equal(ranqueado.size, 7);
  for (const grupo of ranqueado.values()) {
    const ranks = grupo.map((l) => l.rank).sort((a, b) => a - b);
    assert.deepEqual(
      ranks,
      grupo.map((_, i) => i + 1),
      "rank com buraco ou repetido",
    );
    assert.ok(
      grupo.every((l, i) => i === 0 || grupo[i - 1].points >= l.points),
      "rank fora da ordem de points",
    );
  }

  const { pares, orfaos } = await lerAncora(
    acharCsv("export_All-Users").caminho,
    acharCsv("export_All---gameficacaos").caminho,
  );
  assert.equal(pares.length, 142, "142 âncoras Users.GameAtual");
  assert.equal(orfaos.length, 0);
  const ancora = indicePorNome(pares);
  assert.equal(ancora.size, 142, "nenhuma ambiguidade de nome curto");
  assert.ok(
    linhas.every(
      (l) => typeof ancora.get(normalizarNome(l.nomeCurto)) === "string",
    ),
    "as 629 linhas resolvem pela âncora",
  );

  const metas = await lerMetas(acharCsv("export_All-meta-equipes").caminho);
  assert.equal(metas.linhas.length, 191);
  assert.deepEqual(metas.descartadas, { semMes: 2, semEquipe: 8 });
  assert.ok(
    metas.linhas.every((m) => m.period.endsWith("-01")),
    "meta sempre no dia 1",
  );

  const anuais = await lerResultadosAnuais(
    acharCsv("export_All-resultado-anuals").caminho,
  );
  assert.equal(anuais.linhas.length, 66, "67 menos a duplicata de 2024-11");
  assert.equal(anuais.duplicados.length, 1);
  assert.equal(anuais.duplicados[0].periodo, "2024-11");
  assert.equal(anuais.duplicados[0].escolhida.salesCount, 59);
  assert.equal(anuais.duplicados[0].escolhida.vgv, 12069138.34);
  assert.deepEqual(anuais.buracos, ["2024-10"]);

  console.log(
    "autoteste: OK — 7 temporadas · 629 placares · 142 âncoras · 191 metas · 66 resultados",
  );
}

const alvo = process.argv.includes("--autoteste") ? autoteste : main;
alvo().catch((e) => {
  console.error(`\n[jogo e metas] ABORTADO\n${String(e.message || e)}`);
  process.exit(1);
});
