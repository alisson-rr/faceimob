#!/usr/bin/env node
/**
 * Orquestrador da importação Bubble → Supabase (onda 1).
 *
 *   node scripts/import/run.mjs --dry-run                        ensaio: lê tudo, não grava
 *   node scripts/import/run.mjs --gatilhos-desligados            carga completa
 *   node scripts/import/run.mjs negocios --gatilhos-desligados   uma carga só
 *
 * O passo a passo de quem opera está em `docs/importacao/COMO_RODAR.md`.
 *
 * Cada carga roda em um PROCESSO SEPARADO, na ordem de dependência. Não existe
 * transação cobrindo duas cargas (PLANO §6): a que falhar não desfaz as
 * anteriores — elas ficam commitadas, e o de-para em `import_bubble_map` faz a
 * reexecução pular o que já entrou. Na primeira falha o orquestrador PARA: a 03
 * e a 04 dependem da 01 e da 02, e seguir depois de um erro grava dado torto.
 *
 * Todo número impresso aqui sai de `import_bubble_map`, nunca de `count(*)` da
 * tabela de destino — o banco já tem seed e demonstração, e `count(*)` reprova
 * carga correta (R-02).
 *
 * Este arquivo não desliga gatilho nem escreve dado de negócio: `disable
 * trigger` exige ser dono da tabela e o PostgREST não executa DDL (R-13).
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ehDryRun, supa } from "./lib/bubble.mjs";

/**
 * Ordem de dependência. `alvos` são os pares (entidade, tabela_destino) que
 * cada carga grava no de-para — é por eles que o inventário é escopado.
 */
const CARGAS = [
  {
    nome: "pessoas",
    script: "01-pessoas.mjs",
    alvos: [
      ["user", "profiles"],
      ["equipe", "teams"],
    ],
  },
  {
    nome: "catalogo",
    script: "02-catalogo.mjs",
    alvos: [
      ["construtora", "developers"],
      ["empreendimento", "developer_projects"],
      ["link", "useful_links"],
      ["dica", "gold_tips"],
      ["mensagem", "important_notices"],
    ],
  },
  {
    nome: "negocios",
    script: "03-negocios.mjs",
    alvos: [
      ["pipeline", "deals"],
      ["pipeline", "cca_cases"],
    ],
  },
  {
    // Depende da carga de negócios: `deal_history.deal_id` é NOT NULL e o vínculo
    // sai do de-para ('pipeline' → 'deals'). Por isso vem logo depois dela.
    nome: "historico",
    script: "03b-historico.mjs",
    alvos: [
      ["observacao", "deal_history"],
      ["historico_pipe", "deal_history"],
    ],
  },
  {
    nome: "jogo-metas",
    script: "04-jogo-metas.mjs",
    alvos: [
      ["temporada", "game_seasons"],
      ["regra_jogo", "game_scoring_rules"],
      ["placar", "game_season_results"],
      ["meta_equipe", "goals"],
      ["resultado_anual", "annual_results"],
    ],
  },
  {
    // Independente das anteriores no destino, mas fica por último porque é a
    // maior (102.799 leads) e a mais demorada: falhar aqui não custa refazer
    // pessoas, catálogo e negócios.
    nome: "leads",
    script: "05-leads.mjs",
    alvos: [
      ["lead", "leads"],
      ["lead", "lead_comments"],
      ["ligacao", "lead_events"],
    ],
  },
  {
    // Depende dos negócios (`deal_documents.deal_id`) e é a única que baixa e
    // sobe arquivo — por isso separada, para poder rodar e retomar sozinha.
    nome: "documentos",
    script: "06-documentos.mjs",
    alvos: [["doc_arquivo", "deal_documents"]],
  },
];

/**
 * O bloco que o operador roda como `postgres` ANTES da carga. Fica aqui porque
 * é o texto da mensagem de aborto — quem esqueceu recebe o SQL pronto na tela.
 * Um `alter table` por gatilho: DISABLE TRIGGER aceita um nome, ALL ou USER,
 * nunca uma lista.
 */
const PREPARACAO = `-- 0. ANOTE quais robôs estão ativos AGORA: o religamento (§5) liga só estes.
--    Ligar todos ressuscitaria um job pausado de propósito (0065 já teve um assim).
select jobname from cron.job where jobname like 'faceimob-%' and active order by 1;

-- 1. congelar os crons (PLANO fase 0.2) — 'faceimob-assign-queued' roda a cada minuto.
--    'alter_job' e não 'unschedule': os agendamentos nascem espalhados por 7 migrations
--    (0013, 0017, 0018, 0020, 0043, 0062, 0083) e recriá-los à mão depois é receita de perder um.
select cron.alter_job(jobid, active := false) from cron.job where jobname like 'faceimob-%';

-- 2. pausar a roleta (fase 0.3) — assign_queued_leads não consulta a pausa sozinho
update public.automation_settings set leads_paused = true where id;

-- 3. gatilhos da carga 03 (as outras três não precisam de nenhum)
alter table public.deals             disable trigger deals_default_month_base;
alter table public.deals             disable trigger deals_add_creator_participant;
alter table public.deals             disable trigger deals_award_points;
alter table public.deal_participants disable trigger deal_participants_autofill;
alter table public.deal_participants disable trigger deal_participants_award_points;
alter table public.cca_cases         disable trigger cca_cases_sync_esteira_label;
alter table public.cca_cases         disable trigger cca_award_points;
alter table public.cca_cases         disable trigger notify_cca_case_created;
-- MANTER LIGADO: deal_participants_resplit (é ele que calcula o rateio 100/n)

-- 4. reabrir os meses fechados. 'deals_guard_closed_month' só isenta is_admin(), que lê
--    auth.uid(): service_role NÃO fura essa trava, e desligar o gatilho não basta — a carga 03
--    também recusa gravar negócio em mês fechado (501 deles com os seeds aplicados).
--    A cópia guarda period/closed_at/closed_by/notes e §5 refecha tudo de volta. Rodar este
--    bloco duas vezes é seguro: o 'if not exists' preserva a primeira cópia.
--    O gatilho de log sai junto: sem ele desligado, o delete grava em 'month_reopenings'
--    uma reabertura por mês, sem responsável, e esse rastro contábil falso fica permanente.
alter table public.closed_months disable trigger closed_months_log_reopen;
create table if not exists private.closed_months_import as table public.closed_months;
delete from public.closed_months;`;

const abortar = (msg) => {
  console.error(`\n[import] ABORTADO\n${msg}\n`);
  process.exit(1);
};

// ── inventário ───────────────────────────────────────────────────────────────

/**
 * Contagem por procedência. `head: true` conta no servidor e não traz linha:
 * na onda 2 o de-para passa de 170 mil linhas e baixar tudo só para contar
 * levaria minutos.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} cliente
 * @param {[string, string][]} alvos
 * @returns {Promise<Map<string, number>>}
 */
async function inventario(cliente, alvos) {
  const contar = async (filtro) => {
    let q = cliente
      .from("import_bubble_map")
      .select("bubble_id", { count: "exact", head: true });
    if (filtro) q = q.eq("entidade", filtro[0]).eq("tabela_destino", filtro[1]);
    const { count, error } = await q;
    if (error) throw new Error(`import_bubble_map: ${error.message}`);
    return count ?? 0;
  };

  const linhas = new Map();
  for (const alvo of alvos)
    linhas.set(`${alvo[0]} → ${alvo[1]}`, await contar(alvo));
  // O total pega também o que este arquivo ainda não conhece (onda 2).
  linhas.set("TOTAL (todas as entidades)", await contar(null));
  return linhas;
}

function imprimirInventario(antes, depois) {
  console.log(
    "\n[import] inventário por procedência — import_bubble_map, nunca count(*) de tabela (R-02)",
  );
  const largura = Math.max(...[...antes.keys()].map((k) => k.length));
  for (const [chave, a] of antes) {
    const d = depois?.get(chave);
    const delta = depois ? `  ${d - a >= 0 ? "+" : ""}${d - a}` : "";
    const fim = depois ? ` → ${String(d).padStart(7)}` : "";
    console.log(
      `  ${chave.padEnd(largura)} ${String(a).padStart(7)}${fim}${delta}`,
    );
  }
}

// ── pré-condições ────────────────────────────────────────────────────────────

/**
 * Roda antes de qualquer escrita. Aborta com o comando pronto quando falha.
 *
 * O que NÃO dá para verificar daqui: `pg_trigger` e `cron.job` não são legíveis
 * por PostgREST (nenhuma view nem RPC os expõe) e a service role não é dona das
 * tabelas para consultar o catálogo. Por isso a verificação de gatilho vira
 * confirmação explícita: `--gatilhos-desligados`, que o operador só passa depois
 * de rodar o bloco acima. A carga 03 ainda confere por conta própria, sondando
 * com um negócio descartável antes de gravar.
 */
async function precondicoes(cliente) {
  // A confirmação primeiro: é local e evita gastar chamada de rede em quem esqueceu.
  if (!ehDryRun() && !process.argv.includes("--gatilhos-desligados")) {
    abortar(
      "Falta confirmar a preparação do banco.\n" +
        "Rode este bloco como `postgres` (MCP do Supabase ou psql — service_role não é dona das tabelas, R-13)\n" +
        "e só então repita o comando com --gatilhos-desligados:\n\n" +
        PREPARACAO,
    );
  }

  const { error } = await cliente
    .from("import_bubble_map")
    .select("bubble_id", { count: "exact", head: true });
  if (error) {
    abortar(
      `Não consegui ler public.import_bubble_map (${error.message}).\n` +
        "Aplique a migration supabase/migrations/20260909960000_0096_import_bubble_map.sql antes de carregar.",
    );
  }

  if (ehDryRun()) return; // ensaio não escreve: as travas de operação não se aplicam

  const { data, error: erroPausa } = await cliente
    .from("automation_settings")
    .select("leads_paused")
    .maybeSingle();
  if (erroPausa)
    abortar(`Não consegui ler automation_settings (${erroPausa.message}).`);
  if (!data?.leads_paused) {
    abortar(
      "A roleta de leads está ATIVA. A carga 01 põe 87 corretores na fila geral;\n" +
        "com a roleta rodando, lead do legado começa a ser distribuído no meio da importação.\n\n" +
        "  update public.automation_settings set leads_paused = true where id;",
    );
  }

  // Mês fechado só é recusado na carga 03 — que roda DEPOIS de a 01 e a 02 já
  // terem commitado. Barrar aqui é o que evita parar a importação pela metade.
  const { count: fechados, error: erroMeses } = await cliente
    .from("closed_months")
    .select("period", { count: "exact", head: true });
  if (erroMeses) abortar(`Não consegui ler closed_months (${erroMeses.message}).`);
  if (fechados) {
    abortar(
      `${fechados} mês(es) fechado(s) em public.closed_months. A carga 03 recusa gravar negócio\n` +
        "em mês fechado, e `deals_guard_closed_month` só isenta o administrador — a chave de\n" +
        "serviço não fura a trava. Rode o passo 4 da preparação (COMO_RODAR §2); a seção 5 refecha:\n\n" +
        "  alter table public.closed_months disable trigger closed_months_log_reopen;\n" +
        "  create table if not exists private.closed_months_import as table public.closed_months;\n" +
        "  delete from public.closed_months;",
    );
  }
}

// ── execução ─────────────────────────────────────────────────────────────────

function rodar(carga) {
  const caminho = fileURLToPath(new URL(carga.script, import.meta.url));
  const inicio = Date.now();
  console.log(`\n[import] ▶ ${carga.script}${ehDryRun() ? " (--dry-run)" : ""}`);
  const proc = spawnSync(
    process.execPath,
    ehDryRun() ? [caminho, "--dry-run"] : [caminho],
    { stdio: "inherit" },
  );
  const seg = ((Date.now() - inicio) / 1000).toFixed(1);
  if (proc.error) {
    console.error(`[import] ✗ ${carga.nome}: ${proc.error.message}`);
    return false;
  }
  const ok = proc.status === 0;
  console.log(`[import] ${ok ? "✔" : "✗"} ${carga.nome} em ${seg}s`);
  return ok;
}

async function main() {
  const pedido = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const planejadas = pedido
    ? CARGAS.filter((c) => c.nome === pedido || c.script.startsWith(pedido))
    : CARGAS;
  if (planejadas.length === 0) {
    abortar(
      `Não conheço a carga "${pedido}". Disponíveis: ${CARGAS.map((c) => c.nome).join(", ")} ` +
        "(ou o número: 01, 02, 03, 04). Sem argumento roda todas na ordem.",
    );
  }

  let cliente;
  try {
    cliente = supa(); // valida .env e SUPABASE_SERVICE_ROLE_KEY, ou lança
  } catch (e) {
    // Medido em 09/09/2026: com @supabase/supabase-js 2.110 o `createClient`
    // morre no Node 20 por falta de WebSocket nativo — o mesmo vale para as
    // quatro cargas, que criam o cliente pelo mesmo `supa()`.
    const msg = String(e?.message || e);
    abortar(
      /WebSocket/.test(msg)
        ? `${msg}\n\nO importador precisa de Node 22 ou mais novo. Rode: nvm install 22 && nvm use 22`
        : msg,
    );
  }
  await precondicoes(cliente);

  // O inventário só precisa dos alvos das cargas planejadas; o total pega o resto.
  const alvos = planejadas.flatMap((c) => c.alvos);
  const antes = await inventario(cliente, alvos);
  imprimirInventario(antes);

  const feitas = [];
  let falhou = null;
  for (const carga of planejadas) {
    if (!rodar(carga)) {
      falhou = carga;
      break; // 03 e 04 dependem das anteriores: seguir depois de um erro grava dado torto
    }
    feitas.push(carga.nome);
  }

  imprimirInventario(antes, await inventario(cliente, alvos));

  console.log(
    `\n[import] ${ehDryRun() ? "ENSAIO — nada foi gravado" : "cargas concluídas"}: ${feitas.join(", ") || "nenhuma"}`,
  );
  if (falhou) {
    console.error(
      `[import] PAROU em ${falhou.script}. As anteriores continuam commitadas e são reexecutáveis\n` +
        `         (o de-para pula o que já entrou). Corrija e rode: node scripts/import/run.mjs ${falhou.nome} ${ehDryRun() ? "--dry-run" : "--gatilhos-desligados"}`,
    );
    process.exit(1);
  }
  if (!ehDryRun()) {
    console.log(
      "[import] FALTA RELIGAR o banco: gatilhos, meses fechados, roleta e crons —\n" +
        "         o SQL está em docs/importacao/COMO_RODAR.md §5, na ordem.",
    );
  }
}

main().catch((e) => {
  console.error(`\n[import] ABORTADO\n${String(e?.message || e)}\n`);
  process.exit(1);
});
