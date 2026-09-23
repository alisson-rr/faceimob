import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FEATURE_PERMISSIONS,
  enforcementLabel,
  enforcementOf,
} from "./featurePermissions";

/**
 * Os códigos fora de `menu.*` do catálogo (0044, reafirmados pelo seed), mais
 * os que migrations posteriores acrescentaram.
 *
 * Lista fixa de propósito: é ela que obriga quem cria uma permissão nova a
 * passar por aqui e dizer QUEM lê o código. Foi assim que `pipeline.export`
 * (migration 0092) foi pega — ela nasceu, apareceu na tela de Permissões com o
 * selo "Ainda sem efeito", e o `e2e/admin/permissoes.spec.ts` contou 4 códigos
 * inertes onde deviam existir 3.
 */
const CATALOGO = [
  "leads.view_queue", "leads.reassign", "leads.delete",
  "deals.view_all", "deals.edit_value", "deals.delete",
  "deals.mark_off_distrato",
  "deals.manage_statuses", "deals.edit_status_group", "deals.edit_status_detail",
  "cca.review", "reports.view_finance", "teams.manage",
  "users.manage_roles", "settings.integrations", "game.close_season",
  "pipeline.export",
  "marketing.meta_manage",
];

/** Os 3 sem leitor: continuam no catálogo, mas a tela não pode prometer efeito. */
const SEM_LEITOR = ["deals.view_all", "users.manage_roles", "game.close_season"];

const SRC = path.resolve(__dirname, "..");
const MIGRATIONS = path.resolve(SRC, "../supabase/migrations");

/**
 * TODAS as migrations, concatenadas — o diretório inteiro, não uma lista.
 *
 * Ler só a 0044 foi o defeito que deixou `reports.view_finance` rotulado "ainda
 * sem efeito" sendo predicado de três policies desde a 0045. Trocar por uma
 * lista de três arquivos só adiou o mesmo defeito: a 0065/0066 fez
 * `perform_checkin` exigir `menu.checkin` e nada aqui reprovou o rótulo
 * "aplicada na tela". Varredura do diretório é o único jeito de um leitor novo
 * não passar despercebido.
 */
const migrationSql = readdirSync(MIGRATIONS)
  .filter((file) => file.endsWith(".sql"))
  .map((file) => readFileSync(path.resolve(MIGRATIONS, file), "utf8"))
  .join("\n");

/** Todo código de permissão que alguma migration usa como predicado. */
const lidosNoBanco = new Set(
  [...migrationSql.matchAll(/has_permission\('([a-z_.]+)'\)/g)].map((m) => m[1]),
);

const migration0061 = readFileSync(
  path.resolve(MIGRATIONS, "20260903610000_0061_equipes_permissoes.sql"),
  "utf8",
);

/**
 * Fonte do app (sem os próprios testes, que citam os códigos como literal).
 * O rótulo "Aplicada na tela" tem de sair daqui, não de uma reafirmação do
 * mapa: um `it` que só relê `FEATURE_PERMISSIONS` passa com tela nenhuma
 * fazendo nada, que é exatamente o defeito que o mapa veio denunciar.
 */
const sources = readdirSync(SRC, { recursive: true, encoding: "utf8" })
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
  .map((f) => readFileSync(path.join(SRC, f), "utf8"));

const lidoPelaTela = (code: string) => sources.some((s) => s.includes(`can("${code}")`));

describe("featurePermissions", () => {
  it("todo código de funcionalidade do catálogo tem entrada no mapa", () => {
    for (const code of CATALOGO) expect(FEATURE_PERMISSIONS, code).toHaveProperty(code);
    expect(Object.keys(FEATURE_PERMISSIONS).sort()).toEqual([...CATALOGO].sort());
  });

  it("os códigos sem leitor são rotulados 'Ainda sem efeito', com a frase de quem decide", () => {
    // Apagá-los do catálogo não durava um `db:reset` — `supabase/seed.sql` os
    // reinsere depois de todas as migrations. Então o que precisa ser verdade é
    // o RÓTULO: enquanto ninguém ler o código, a tela diz que gravar não muda
    // nada e aponta quem decide. Ganhar um leitor faz o último `it` reprovar.
    for (const code of SEM_LEITOR) {
      expect(FEATURE_PERMISSIONS, code).toHaveProperty(code);
      expect(FEATURE_PERMISSIONS[code].enforcedBy, code).toBeNull();
      expect(enforcementLabel(enforcementOf(code))).toBe("Ainda sem efeito");
      // "Nada lê este código" sem dizer o que lê deixa o admin sem saída.
      expect(FEATURE_PERMISSIONS[code].where, code).toMatch(/papel|administrador/i);
    }
    // A 0061 não pode voltar a apagar: a exclusão some no seed e trava o
    // `validate-schema.sh` nos dois sentidos (21 espera 12, 23 esperava 0).
    expect(migration0061).not.toMatch(/^\s*delete from public\.permissions/m);
  });

  it("menu.* é aplicado pelo guard de rota, qualquer que seja o item", () => {
    expect(enforcementOf("menu.dashboard").enforcedBy).toBe("tela");
    expect(enforcementOf("menu.inventado").enforcedBy).toBe("tela");
  });

  it("código desconhecido é 'ainda sem efeito', nunca 'aplicada'", () => {
    const e = enforcementOf("nada.disso");
    expect(e.enforcedBy).toBeNull();
    expect(enforcementLabel(e)).toBe("Ainda sem efeito");
  });

  it("o selo sai de quem lê o código no fonte, não de uma afirmação do mapa", () => {
    // Marcar "banco" sem a RPC/policy ler o código, ou "tela" sem nenhum
    // `can()`, é o defeito original em outra roupa: a tela diria "aplicada"
    // para um switch que não muda nada. O inverso também mente. Quando os dois
    // leem (settings.integrations), vale o banco — é a trava de verdade; a
    // tela só esconde o botão.
    for (const code of CATALOGO) {
      const esperado = lidosNoBanco.has(code) ? "banco" : lidoPelaTela(code) ? "tela" : null;
      expect(FEATURE_PERMISSIONS[code].enforcedBy, code).toBe(esperado);
    }
  });

  it("nenhum item de menu lido por migration pode dizer que só vale na tela", () => {
    // A frase padrão de `menu.*` afirma que o item "não muda o RLS de nenhuma
    // tabela". Dois já mudam (`menu.admin_allowed_ips` na 0044, `menu.checkin`
    // na 0065/0066), e essa varredura é o que obriga o próximo a ganhar a sua
    // própria frase em vez de herdar a mentira.
    const padrao = enforcementOf("menu.dashboard").where;
    for (const code of lidosNoBanco) {
      if (!code.startsWith("menu.")) continue;
      const e = enforcementOf(code);
      expect(e.enforcedBy, code).toBe("banco");
      expect(e.where, code).not.toEqual(padrao);
    }
    // O caso concreto, nomeado: revogar o menu de Check-in tira a pessoa da roleta.
    expect(lidosNoBanco.has("menu.checkin"), "0065/0066 fazem perform_checkin exigir menu.checkin").toBe(true);
    expect(enforcementOf("menu.checkin").where).toMatch(/perform_checkin|roleta/i);
  });

  it("deals.edit_value passou a valer no banco, com concessão que reproduz quem já editava", () => {
    // A 0061 lê o código num gatilho e concede aos papéis que editavam antes:
    // no dia do deploy ninguém perde nada, e desligar o switch passa a negar.
    expect(migration0061).toContain("has_permission('deals.edit_value')");
    expect(migration0061).toMatch(/trigger deals_guard_value/);
    for (const papel of ["broker", "manager", "director", "cca"]) {
      expect(migration0061).toContain(`'${papel}'`);
    }
    expect(enforcementLabel(enforcementOf("deals.edit_value"))).toBe("Aplicada no banco");
  });

  it("OFF e distrato valem no banco; a ETAPA volta a ser decidida pela matriz", () => {
    // A trava de 10/09/2026 nasceu larga demais: "off e distrato é só adm"
    // virou recusa de TODO o Status 2, e "Status 1 é bloqueado" virou um código
    // próprio (`deals.edit_stage`) que passava POR CIMA de `stage_permissions`
    // — o admin concedia a etapa na matriz e a concessão não fazia efeito, e
    // agendar visita, aprovar caso no CCA e encerrar negócio (que gravam
    // `stage_id` pelo token de quem clica) caíam em 42501.
    //
    // O que o código de permissão cobre agora são os dois desfechos, e só eles.
    expect(lidosNoBanco.has("deals.mark_off_distrato")).toBe(true);
    expect(enforcementLabel(enforcementOf("deals.mark_off_distrato"))).toBe("Aplicada no banco");

    // Quem autoriza a ETAPA é a matriz, no banco (`deals_guard_stage`, 0020/0028)
    // e na tela — nunca um switch desta aba. Uma entrada nova aqui para etapa é
    // a volta do mesmo defeito.
    expect(FEATURE_PERMISSIONS).not.toHaveProperty("deals.edit_stage");
    expect(migrationSql).toContain("can_exit_stage");
    expect(migrationSql).toContain("can_enter_stage");

    // Sem esta liberação a esteira para de andar em silêncio: aprovar a
    // conferência documental (`review_deal_documents` → `submit_deal_for_analysis`)
    // grava `stage_id`, e `cca_cases_sync_esteira_label` grava `status_detail`
    // — as duas de dentro de funções `security definer`, onde `current_user` é
    // o dono da função.
    expect(migrationSql).toContain("current_user in ('postgres', 'service_role')");

    // O inverso arruína a trava: `security definer` no PRÓPRIO gatilho faria
    // `current_user` ser sempre o dono, e o guard passaria para todo mundo sem
    // nenhum sintoma. Vale para TODA versão da função no diretório — a próxima
    // reescrita também, que é o que a checagem presa a um arquivo só não pegava.
    const definicoes = [...migrationSql.matchAll(
      /create or replace function public\.deals_guard_status_columns\(\)([\s\S]*?)as \$\$/g,
    )];
    expect(definicoes.length).toBeGreaterThan(0);
    for (const [, cabecalho] of definicoes) expect(cabecalho).not.toContain("security definer");
  });

  it("reports.view_finance é lido pelo banco desde a 0045 — o selo dizia o contrário", () => {
    const m0045 = readFileSync(
      path.resolve(MIGRATIONS, "20260901130700_0045_menu_marketing_dados.sql"),
      "utf8",
    );
    expect(m0045).toContain("has_permission('reports.view_finance')");
    expect(enforcementLabel(enforcementOf("reports.view_finance"))).toBe("Aplicada no banco");
  });

  it("marketing.meta_manage trava no banco desde a 0116 e nasce só para o marketing", () => {
    // O `where` promete ao admin quem já nasce com o switch ligado; a promessa
    // tem de sair da concessão escrita na migration, não do próprio mapa.
    const m0116 = readFileSync(
      path.resolve(MIGRATIONS, "20260911160000_0116_meta_acoes_ia.sql"),
      "utf8",
    );
    expect(m0116).toContain("has_permission('marketing.meta_manage')");
    expect(m0116).toMatch(/\('marketing',\s*'marketing\.meta_manage',\s*true\)/);
    expect(m0116).not.toMatch(/\('(director|manager|broker|cca|sdr)',\s*'marketing\.meta_manage'/);
    expect(FEATURE_PERMISSIONS["marketing.meta_manage"].where).toMatch(/só para o marketing/);
    expect(enforcementLabel(enforcementOf("marketing.meta_manage"))).toBe("Aplicada no banco");
  });

  it("menu.admin_allowed_ips avisa que conceder o menu libera dado no banco", () => {
    // A 0044 fez este código de menu virar predicado de `allowed_ips_read`;
    // sem a exceção, a aba Menu prometeria que nenhum `menu.*` mexe em RLS.
    expect(migrationSql.includes("has_permission('menu.admin_allowed_ips')")).toBe(true);
    const e = enforcementOf("menu.admin_allowed_ips");
    expect(e.enforcedBy).toBe("banco");
    expect(e.where).toMatch(/faixas de IP/i);
    expect(e.where).not.toEqual(enforcementOf("menu.dashboard").where);
  });

  it("toda entrada diz onde a permissão vale", () => {
    for (const [code, e] of Object.entries(FEATURE_PERMISSIONS)) {
      expect(e.where.length, code).toBeGreaterThan(10);
    }
  });
});
