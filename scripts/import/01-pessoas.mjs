#!/usr/bin/env node
/**
 * Carga 01 — Pessoas, papéis e equipes (Bubble → Supabase).
 *
 * O QUE CARREGA (reexport de 09/09; o CSV de 08/09 dava 94/88/87 — uma pessoa
 * foi desativada no Bubble entre os dois)
 *   298 pessoas (93 ativas), 12 equipes, os papéis de cada um, os 267 vínculos
 *   de equipe (87 abertos + 180 fechados) e os 86 corretores da roleta.
 *
 * DE ONDE (`acharExport`: JSON do reexport de 09/09 antes do CSV de 08/09)
 *   export_All-Users…json (298) · export_All-corretors…json (365, só para saber
 *   quem tem ficha e quem está na fila) · export_All-Equipes…**csv** (12 — o
 *   cliente ainda não reexportou Equipes; o script serve os dois formatos e não
 *   muda quando o JSON chegar).
 *   `export_All-gerentes…` NÃO é lido: `mapa/pessoas.md` §4.3 mede que as 22
 *   linhas não geram nenhuma linha de destino — a gerência vive em
 *   `teams.manager_id` e em `Users.gerencia`, que este script já usa.
 *
 * COLUNAS DE VÍNCULO — o que é id e o que ainda é nome (medido em 09/09)
 *   id do Bubble, resolvido sem tocar em nome:
 *     Users.diretor (217/217) · Users.gerencia (285/285) ·
 *     Users.equipe (267/267, e todos casam com o `unique id` do CSV de Equipes) ·
 *     corretors.user (294 de 365; as outras 71 fichas vêm com a coluna vazia).
 *   texto, porque no Bubble são campo de texto e não relacionamento:
 *     Equipes.Diretor (12/12) · Equipes.gerente (12/12) · corretors.Nome
 *     (fallback das 71 fichas sem `user`: recupera 9, descarta 62).
 *   Users.corretor e Users.gerente (11 cada) são id de `corretors`/`gerentes`,
 *   não de `Users` — nenhuma das duas é lida aqui.
 *
 *   COMO LER O PLACAR DE FK NO RELATÓRIO
 *     `<coluna>:vazio`   — a coluna veio em branco no Bubble: 81 em
 *       `Users.diretor`, 13 em `Users.gerencia`, 31 em `Users.equipe`, 71 em
 *       `corretors.user`. É dado que não existe na origem, não falha de
 *       resolução, e não há o que consertar.
 *     `<coluna>:ausente` — apontou para alguém e o índice não achou. Hoje só
 *       `corretors.Nome` tem esse caso (62, §3 abaixo).
 *     Até 09/09 as duas saíam somadas em `ausente` (`criarResolvedor` conta
 *     vazio como ausente) e o ensaio parecia ter perdido 125 vínculos de
 *     hierarquia que nunca existiram.
 *
 * PARA ONDE
 *   auth.users + auth.identities (via Admin API) → o gatilho
 *   `on_auth_user_created` cria `profiles` e concede `broker`; depois
 *   `profiles` (UPDATE dos campos de RH), `user_roles`, `teams`,
 *   `team_members`, `distribution_group_members` e o de-para em
 *   `public.import_bubble_map` (entidades `user` e `equipe`).
 *
 * O QUE PRECISA ESTAR DESLIGADO ANTES
 *   - Nenhum gatilho. Não existe gatilho em `team_members` nem em
 *     `distribution_group_members`, e `profiles_guard_admin_columns` **não pode
 *     ser desligado**: a 0061 (linhas 84-91) dá passagem explícita ao
 *     `service_role`, que é como este script escreve. Desligá-lo só abriria a
 *     coluna `bypass_ip_check`.
 *   - A roleta pausada (PLANO §6 fase 0.2 e 0.3): `automation_settings
 *     .leads_paused = true` e os `cron.job` `faceimob-%` desagendados. O último
 *     passo põe 86 corretores na fila geral; com lead em `queued` e cron ligado,
 *     `assign_queued_leads` começa a distribuir no meio da carga.
 *
 * SQL DE VERIFICAÇÃO (rodar depois, como `postgres`; todo aceite é escopado
 * por procedência, nunca `count(*)` de tabela — R-02)
 *
 *   -- 1. volumes por procedência
 *   select (select count(*) from public.import_bubble_map
 *            where entidade='user'   and tabela_destino='profiles') as perfis,   -- 298
 *          (select count(*) from public.import_bubble_map
 *            where entidade='equipe' and tabela_destino='teams')    as equipes;  --  12
 *
 *   -- 2. papéis: 317, não 318 (R-11 — o `Gerente Interino` não é corretor)
 *   select count(*) from public.user_roles ur
 *     join public.import_bubble_map m
 *       on m.registro_id = ur.profile_id and m.tabela_destino='profiles';        -- 317
 *
 *   -- 3. login existe de verdade (R-18): uma identidade por conta criada
 *   select count(*) from auth.identities i
 *     join public.import_bubble_map m
 *       on m.registro_id = i.user_id and m.tabela_destino='profiles';            -- 298
 *
 *   -- 4. ninguém na roleta sem o papel que a roleta pressupõe (R-12)
 *   select p.email from public.distribution_group_members dgm
 *     join public.profiles p on p.id = dgm.profile_id
 *    where not exists (select 1 from public.user_roles ur
 *                       where ur.profile_id = dgm.profile_id and ur.role='broker');
 *                                                                    -- 0 linhas
 *   -- 5. idempotência de team_members (R-05): rodar 2× não muda nada
 *   select profile_id, team_id, joined_at, count(*)
 *     from public.team_members group by 1,2,3 having count(*) > 1;    -- 0 linhas
 *   select count(*) from public.team_members where left_at >= current_date;  -- 0
 *
 *   -- 6. CPF não fabricado (R-17)
 *   select count(*) from public.profiles p
 *     join public.import_bubble_map m
 *       on m.registro_id = p.id and m.tabela_destino='profiles'
 *    where p.cpf is not null and length(p.cpf) <> 11;                 -- 0
 *
 *   -- 7. hierarquia e equipe (R-08): 217 diretores, 285 gerências e 267
 *   --    vínculos vieram de id, não de nome. Aqui isso vira: ninguém está em
 *   --    equipe de outra diretoria.
 *   select count(*) from public.team_members tm
 *     join public.teams t on t.id = tm.team_id
 *     join public.import_bubble_map m
 *       on m.registro_id = tm.profile_id and m.tabela_destino='profiles'
 *    where t.director_id is null;                                     -- 0
 *
 * USO
 *   node scripts/import/01-pessoas.mjs --dry-run   → lê tudo, resolve tudo,
 *                                                    imprime o relatório, não grava
 *   node scripts/import/01-pessoas.mjs             → carga
 *
 *   Sai com código 1 se alguma linha não entrou (conta, papel, equipe, vínculo,
 *   roleta ou de-para). O `run.mjs` decide continuar só pelo código de saída:
 *   carga parcial não pode liberar a 02, a 03 e a 04.
 *
 * DUAS DIVERGÊNCIAS DELIBERADAS DO BRIEFING, PORQUE O BANCO NÃO ACEITA A OUTRA
 * FORMA — as duas estão no relatório e no retorno da tarefa:
 *
 *   1. As 205 desligadas (N-10 diz 204, medido no CSV de 08/09) GANHAM linha em
 *      `auth.users`, com `banned_until` em 2126 (ninguém loga). Não é opcional:
 *      `profiles.id` é FK de `auth.users(id)` (`0002:29`), então não existe
 *      perfil sem conta — e sem perfil os 4.096 vínculos de `deal_participants`
 *      que a decisão N-10 existe para preservar ficam órfãos.
 *      "Sem conta de login" vira
 *      `banned_until`, que é o interruptor real de acesso.
 *   2. Elas entram `status='suspended'`, não `'terminated'`. O check
 *      `profiles_terminated_consistency` (`0002:44-45`) exige
 *      `(status='terminated') = (terminated_at is not null)`, e não há data de
 *      desligamento na origem — `Modified Date` é carimbo de edição, não de
 *      saída. `suspended` é o mesmo estado que a tela grava ao desativar
 *      alguém (`people.ts:627`, "Suspenso" em `Equipes.tsx:54`) e não fabrica
 *      fato nenhum. Quando houver a data real: um UPDATE muda os dois campos.
 *      `team_members.left_at` é o caso oposto e por isso recebe o proxy: ali o
 *      que a operação lê é `left_at is null` (vínculo aberto ou fechado), não o
 *      valor; deixá-lo nulo poria 180 desligados na listagem da equipe de hoje.
 *
 * Senha: `Users.senha_temporaria` não é lida por este script. Conta ativa nasce
 * sem senha utilizável — o acesso é por recuperação de senha. Nada aqui imprime
 * chave, e-mail completo, CPF, telefone ou senha.
 */
import { randomUUID } from "node:crypto";

import {
  acharExport,
  cpf,
  criarResolvedor,
  dataBubble,
  dataBubbleDia,
  ehDryRun,
  inserirEmLote,
  lerCsv,
  lerMapa,
  normalizarNome,
  registrarMapa,
  relatorio,
  supa,
  telefoneBR,
} from "./lib/bubble.mjs";

/**
 * Volumes medidos em `mapa/pessoas.md` §8 e reproduzidos pelas três refutações.
 * Divergência é AVISO, nunca abortar: a refutação `pessoas-dados.md` §2.1 mostra
 * que um `assert` de volume pararia a carga na primeira execução contra o
 * arquivo real (o mapa publicou 56 órfãs onde há 63).
 *
 * Rebaseado no reexport de 09/09. `ativas`, `vinculos_abertos` e `roleta` caíram
 * 1 em relação ao CSV de 08/09 (94/88/87) por uma única pessoa desativada no
 * Bubble entre os dois exports — não é regressão de parse. Manter o número velho
 * faria três avisos "conferir antes de liberar" dispararem em toda carga
 * correta, que é justamente o que o tripwire existe para não fazer.
 */
const ESPERADO = {
  pessoas: 298,
  ativas: 93,
  equipes: 12,
  papeis: 317,
  vinculos: 267,
  vinculos_abertos: 87,
  roleta: 86,
};

/** `Funcao` → papel que não depende de ficha. `null` = valor conhecido, sem papel. */
const FUNCAO_PAPEL = new Map([
  ["CORRETOR", null],
  ["GERENTE", "manager"],
  ["DIRETOR", "director"],
  ["CCA", "cca"],
  ["SÓCIO", "partner"], // com acento; `SERVICOS GERAIS` sem cedilha — comparação literal
  ["ADM", "admin"],
  ["SERVICOS GERAIS", null],
  ["", null],
]);

/** Só estas três funções atendem lead — e ainda assim só com ficha em `corretors` (R-11). */
const FUNCAO_ATENDE = new Set(["CORRETOR", "GERENTE", "DIRETOR"]);

/** `habilitacao` do Bubble → check `profiles_habilitation_values` (`0046:55-58`). */
const HABILITACAO = new Map([
  ["CRECI", "CRECI"],
  ["Não Possui (Estágio)", "CRECI-ESTAGIARIO"],
  ["Estágio", "CRECI-ESTAGIARIO"],
]);

/** `creci` textual → habilitação, aplicado só quando `habilitacao` está vazia. */
const CRECI_TEXTUAL = new Map([
  ["estagio", "CRECI-ESTAGIARIO"],
  ["nao possui", "OUTRO"],
]);

const ANO_ATUAL = new Date().getFullYear();

/**
 * Teto do proxy de `team_members.left_at`: ontem em `America/Sao_Paulo`.
 *
 * `Modified Date` é carimbo de edição, e o reexport de N-05 recarimba todo
 * mundo no dia da exportação. Sem teto, uma carga rodada no mesmo dia grava
 * saída de hoje e reprova o ACEITE 2.4 do PLANO
 * (`team_members where left_at >= current_date` = 0) numa carga correta.
 * Ontem em SP também é ontem em UTC, então o aceite passa nos dois fusos.
 */
const TETO_SAIDA = new Date(
  Date.parse(
    `${new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })}T00:00:00Z`,
  ) - 86_400_000,
)
  .toISOString()
  .slice(0, 10);

/** Só quando numérico: "32.957" → "32957". "078022F" entra como está; texto vira habilitação. */
function creciDe(bruto) {
  const v = String(bruto ?? "").trim();
  if (!/\d/.test(v)) return null;
  return /^[\d.\s-]+$/.test(v) ? v.replace(/\D/g, "") : v;
}

/** `nascimento` só vale entre 1930 e há 16 anos: dezenas de linhas trazem a data do cadastro. */
function nascimentoDe(bruto) {
  const dia = dataBubbleDia(bruto);
  if (!dia) return { valor: null, absurdo: false };
  const ano = Number(dia.slice(0, 4));
  const ok = ano >= 1930 && ano <= ANO_ATUAL - 16;
  return { valor: ok ? dia : null, absurdo: !ok };
}

async function main() {
  const rel = relatorio("pessoas");
  // Toda linha recusada pelo destino soma aqui e vira código de saída 1 no fim.
  // Divergência de conferência continua sendo só aviso; linha que não entrou, não.
  let falhas = 0;

  // Sem credencial o dry-run continua: ele existe para conferir CSV e regra.
  // Fora do dry-run, falta de credencial aborta aqui mesmo.
  let cliente = null;
  try {
    cliente = supa();
  } catch (erro) {
    if (!ehDryRun()) throw erro;
    rel.aviso(
      `sem credencial (${String(erro.message).split("\n")[0]}) — o dry-run assume destino vazio`,
    );
  }

  // ── 1. ler os exports ──────────────────────────────────────────────────────
  const usuarios = [];
  const porEmail = new Map();
  for await (const linha of lerCsv(acharExport("export_All-Users"))) {
    const email = String(linha.email ?? "")
      .trim()
      .toLowerCase();
    const bubbleId = String(linha["unique id"] ?? "").trim();
    if (!email || !bubbleId) {
      rel.aviso("linha de Users sem e-mail ou sem unique id — descartada");
      continue;
    }
    if (porEmail.has(email)) {
      rel.aviso(`e-mail repetido no CSV (${linha.colaboradores}) — 2ª linha descartada`);
      continue;
    }
    const u = {
      bubbleId,
      email,
      apelido: String(linha.colaboradores ?? "").trim(),
      nomeCompleto: String(linha.Nome_completo ?? "").trim(),
      ativo: String(linha.Ativo ?? "").trim().toLowerCase() === "sim",
      funcao: String(linha.Funcao ?? "").trim(),
      diretor: linha.diretor,
      gerencia: linha.gerencia,
      equipe: linha.equipe,
      telefone: telefoneBR(linha.telefone),
      cpf: cpf(linha.cpf),
      cpfBruto: String(linha.cpf ?? "").replace(/\D/g, ""),
      creci: creciDe(linha.creci),
      creciBruto: String(linha.creci ?? "").trim(),
      habilitacaoBruta: String(linha.habilitacao ?? "").trim(),
      endereco: String(linha.endereco ?? "").replace(/\u00a0/g, " ").trim() || null,
      indicacao: String(linha.indicacao ?? "").trim() || null,
      entrada: dataBubbleDia(linha.entrada),
      modificado: dataBubbleDia(linha["Modified Date"]),
      modificadoIso: dataBubble(linha["Modified Date"]),
      profileId: null,
    };
    u.fullName = u.nomeCompleto || u.apelido;
    const { valor, absurdo } = nascimentoDe(linha.nascimento);
    u.nascimento = valor;
    if (absurdo) rel.conta("pessoas:nascimento-descartado");
    if (u.cpfBruto && !u.cpf)
      rel.aviso(`CPF fora de 11 dígitos → NULL (R-17): ${u.apelido}`);
    if (String(linha.telefone ?? "").trim() && !u.telefone)
      rel.conta("pessoas:telefone-invalido");
    usuarios.push(u);
    porEmail.set(email, u);
  }
  rel.conta("pessoas:lidas", usuarios.length);

  const equipes = [];
  for await (const linha of lerCsv(acharExport("export_All-Equipes"))) {
    const nome = String(linha.nome ?? "").trim(); // "Susana " tem espaço à direita
    const bubbleId = String(linha["unique id"] ?? "").trim();
    if (!nome || !bubbleId) {
      rel.aviso("linha de Equipes sem nome ou sem unique id — descartada");
      continue;
    }
    equipes.push({
      bubbleId,
      nome,
      diretor: linha.Diretor,
      gerente: linha.gerente,
      criadoEm: dataBubble(linha["Creation Date"]),
      criadoDia: dataBubbleDia(linha["Creation Date"]),
      teamId: null,
    });
  }
  rel.conta("equipes:lidas", equipes.length);

  // ── 2. índice de pessoa: `colaboradores` primeiro, `Nome_completo` como reserva ──
  // O índice por nome ficou SÓ para o que o Bubble guarda como texto:
  // `Equipes.Diretor`, `Equipes.gerente` (12+12) e `corretors.Nome` (as 71
  // fichas sem `user`). `Users.diretor`, `Users.gerencia` e `corretors.user`
  // vêm em id e não passam mais por aqui.
  // A ordem importa: `colaboradores` é o texto de exibição do Bubble. Deixar um
  // `Nome_completo` homônimo marcar essa chave como ambígua quebraria uma
  // coluna que hoje é exata.
  const pessoaPorId = new Map(usuarios.map((u) => [u.bubbleId, u.bubbleId]));
  const pessoaPorNome = new Map();
  for (const u of usuarios) {
    const chave = normalizarNome(u.apelido);
    if (!chave) continue;
    // Dois apelidos que normalizam igual viram array: o resolvedor devolve
    // "ambiguo" em vez de escolher um (R-08). Mesma forma de `reservas` abaixo.
    const antes = pessoaPorNome.get(chave);
    pessoaPorNome.set(chave, antes ? [antes, u.bubbleId].flat() : u.bubbleId);
  }
  const reservas = new Map();
  for (const u of usuarios) {
    const chave = normalizarNome(u.nomeCompleto);
    if (!chave || pessoaPorNome.has(chave)) continue;
    reservas.set(chave, [...(reservas.get(chave) ?? []), u.bubbleId]);
  }
  for (const [chave, ids] of reservas) pessoaPorNome.set(chave, ids);

  const equipePorId = new Map(equipes.map((e) => [e.bubbleId, e.bubbleId]));

  // Equipe não tem índice por nome: `Users.equipe` vem 267/267 em id e todos
  // casam com o `unique id` do CSV de Equipes. Sem `porNome`, um export que
  // regredisse para nome cairia em `ausente` — alto no relatório — em vez de
  // casar "Susana " com "Susana" e mandar gente para a equipe errada calada.
  //
  // `criarResolvedor` joga coluna vazia na MESMA gaveta de "id que o índice não
  // tem" (`bubble.mjs:611-613`). Era só isso o antigo `Users.diretor:ausente: 81`
  // e `Users.gerencia:ausente: 13`: 298−217 e 298−285, pessoas que no Bubble não
  // têm diretor nem gerência — nenhum vínculo perdido, o índice sempre esteve
  // completo (217/217, 285/285 e 267/267 casam). Vazio ganha contador próprio
  // aqui para que `ausente` volte a significar "apontou para alguém e não achei",
  // que é o número que faz alguém parar a carga.
  const novoResolvedor = (rotulo, escopo = "pessoa") => {
    const base = criarResolvedor({
      porId: escopo === "pessoa" ? pessoaPorId : equipePorId,
      porNome: escopo === "pessoa" ? pessoaPorNome : undefined,
      rotulo,
    });
    let vazios = 0;
    const resolver = (valor) => {
      if (String(valor ?? "").trim() === "") {
        vazios++;
        return { id: null, via: "vazio" };
      }
      return base(valor);
    };
    resolver.relatar = (rel) => {
      if (vazios) rel.conta(`${rotulo}:vazio`, vazios);
      base.relatar(rel);
    };
    return resolver;
  };

  const resDiretor = novoResolvedor("Users.diretor");
  const resGerencia = novoResolvedor("Users.gerencia");
  const resEquipe = novoResolvedor("Users.equipe", "equipe");
  const resEqDiretor = novoResolvedor("Equipes.Diretor");
  const resEqGerente = novoResolvedor("Equipes.gerente");
  const resCorretorUser = novoResolvedor("corretors.user");
  const resCorretorNome = novoResolvedor("corretors.Nome");

  // ── 3. fichas de `corretors`: quem atende e quem está na fila ──────────────
  // Cascata do mapa §2.4: `user` primeiro (agora id, 294/365), `Nome` como
  // reserva para as 71 fichas com `user` vazio — recupera 9. Ficha que não
  // resolve é descartada: 62, todas do lote `(App admin)` de 13/05/2024 e
  // nenhuma ativa. (A refutação mediu 63 casando só por `colaboradores`;
  // indexar também `Nome_completo` recupera mais uma ficha.)
  // Três pessoas têm fichas contraditórias (`sim` e `não`): vence `sim`.
  const temFicha = new Set();
  const fichaAtiva = new Set();
  let fichasDescartadas = 0;
  for await (const linha of lerCsv(acharExport("export_All-corretors"))) {
    const alvo =
      resCorretorUser(linha.user).id ?? resCorretorNome(linha.Nome).id;
    if (!alvo) {
      fichasDescartadas++;
      continue;
    }
    temFicha.add(alvo);
    if (String(linha.ativo ?? "").trim().toLowerCase() === "sim")
      fichaAtiva.add(alvo);
  }
  rel.conta("corretors:fichas-resolvidas", temFicha.size);
  rel.conta("corretors:fichas-descartadas", fichasDescartadas);

  // ── 4. papéis (mapa §5.2 com as DUAS metades do predicado — R-11) ──────────
  const papeis = new Map(usuarios.map((u) => [u.bubbleId, new Set()]));
  const conceder = (bubbleId, papel) => papeis.get(bubbleId)?.add(papel);

  for (const u of usuarios) {
    // Antes do filtro de `Funcao`: o que esta linha concede é o papel do CHEFE
    // dela, que não depende da função de quem aponta. Uma `Funcao` nova no
    // Bubble custaria o director/manager desses chefes e ainda encolheria o
    // denominador do placar de FK sem dizer que encolheu.
    const d = resDiretor(u.diretor);
    if (d.id) conceder(d.id, "director");
    const g = resGerencia(u.gerencia);
    if (g.id) conceder(g.id, "manager");

    if (!FUNCAO_PAPEL.has(u.funcao)) {
      rel.aviso(`Funcao desconhecida "${u.funcao}" (${u.apelido}) — pessoa fica sem papel próprio`);
      rel.conta("papeis:funcao-desconhecida");
      continue;
    }
    const papel = FUNCAO_PAPEL.get(u.funcao);
    if (papel) conceder(u.bubbleId, papel);
    // `broker` exige as duas metades: função que atende E ficha em `corretors`.
    // Só a primeira deixaria passar o placeholder `Gerente Interino`, que iria
    // parar na listagem de corretores e no pódio da 0027 (R-11).
    if (FUNCAO_ATENDE.has(u.funcao) && temFicha.has(u.bubbleId))
      conceder(u.bubbleId, "broker");
  }
  for (const e of equipes) {
    // Resolvido uma vez só: o passo das equipes reusa `e.diretorBubble`.
    e.diretorBubble = resEqDiretor(e.diretor).id;
    e.gerenteBubble = resEqGerente(e.gerente).id;
    if (e.diretorBubble) conceder(e.diretorBubble, "director");
    if (e.gerenteBubble) conceder(e.gerenteBubble, "manager");
  }

  const totalPapeis = [...papeis.values()].reduce((n, s) => n + s.size, 0);
  const semPapel = [...papeis.values()].filter((s) => s.size === 0).length;
  rel.conta("papeis:linhas", totalPapeis);
  rel.conta("papeis:pessoas-sem-papel", semPapel);
  // O total sozinho não prova a regra — com o predicado incompleto de R-11 ele
  // fecharia em 318 e o conjunto `{director,manager}` sumiria. Quem denuncia é
  // a distribuição. mapa §5.2, medido: broker 271 · broker+manager 11 · cca 5 ·
  // broker+director+manager 4 · partner 2 · admin 1 · director+manager 1 ·
  // broker+director 1
  for (const conjunto of papeis.values())
    if (conjunto.size) rel.conta(`papeis:conjunto:${[...conjunto].sort().join("+")}`);

  // ── 5. CPF duplicado: vence quem está ativo; empate, o `Modified Date` maior ──
  const porCpf = new Map();
  for (const u of usuarios) {
    if (!u.cpf) continue;
    porCpf.set(u.cpf, [...(porCpf.get(u.cpf) ?? []), u]);
  }
  for (const [, grupo] of porCpf) {
    if (grupo.length === 1) continue;
    const ordenado = [...grupo].sort(
      (a, b) =>
        Number(b.ativo) - Number(a.ativo) ||
        String(b.modificadoIso ?? "").localeCompare(String(a.modificadoIso ?? "")),
    );
    for (const perdedor of ordenado.slice(1)) {
      perdedor.cpf = null;
      rel.conta("pessoas:cpf-duplicado-anulado");
      rel.aviso(`CPF duplicado, gravado só no cadastro ativo: ${perdedor.apelido} ficou sem CPF`);
    }
  }

  // ── 6. contas no Auth (R-18: identidade junto, senão ninguém loga) ─────────
  const mapaUsuarios = cliente ? await lerMapa("user", "profiles") : new Map();
  const perfisPorEmail = new Map();
  // `lerTudo` porque um `perfisPorEmail` truncado faz o ramo de recuperação
  // abaixo não reencontrar a conta: `createUser` devolve "e-mail já registrado",
  // a pessoa entra em `pessoas:falha-ao-criar` e a carga sai com 1.
  if (cliente) {
    for (const p of await lerTudo(cliente, "profiles", "id, email"))
      if (p.email) perfisPorEmail.set(String(p.email).toLowerCase(), p.id);
  }

  console.log(`[pessoas] passo 1/6 — contas (${usuarios.length} pessoas)`);
  const paresUsuario = [];
  let criadas = 0;
  for (const u of usuarios) {
    const jaMapeado = mapaUsuarios.get(u.bubbleId);
    if (jaMapeado) {
      u.profileId = jaMapeado;
      rel.conta("pessoas:ja-importadas");
      continue;
    }
    const jaNoDestino = perfisPorEmail.get(u.email);
    if (jaNoDestino) {
      // Execução anterior criou a conta e morreu antes do de-para: reaproveita.
      u.profileId = jaNoDestino;
      rel.conta("pessoas:perfil-ja-existia");
      paresUsuario.push({
        bubble_id: u.bubbleId,
        tabela_destino: "profiles",
        registro_id: u.profileId,
      });
      continue;
    }
    if (ehDryRun()) {
      u.profileId = randomUUID(); // só para os passos seguintes contarem
      rel.conta(u.ativo ? "pessoas:criaria-conta-ativa" : "pessoas:criaria-conta-bloqueada");
      paresUsuario.push({
        bubble_id: u.bubbleId,
        tabela_destino: "profiles",
        registro_id: u.profileId,
      });
      continue;
    }

    const atributos = {
      email: u.email,
      email_confirm: true,
      user_metadata: { full_name: u.fullName, phone: u.telefone ?? null },
    };
    // ~100 anos. `banned_until` é o interruptor real de acesso do GoTrue —
    // `profiles.status` não impede login nenhum.
    if (!u.ativo) atributos.ban_duration = "876000h";

    const { data, error } = await cliente.auth.admin.createUser(atributos);
    if (error || !data?.user) {
      falhas++;
      rel.conta("pessoas:falha-ao-criar");
      rel.aviso(`falha ao criar conta de ${u.apelido}: ${error?.message ?? "sem usuário na resposta"}`);
      continue;
    }
    u.profileId = data.user.id;
    criadas++;

    // R-18: sem `auth.identities` a conta existe e o login por e-mail não
    // resolve. A Admin API cria a identidade junto; se algum dia parar de
    // criar, o relatório denuncia e o conserto é o insert de `seeds/010:81-96`.
    if (!data.user.identities?.length) {
      falhas++;
      rel.conta("auth:sem-identity");
      rel.aviso(`conta sem auth.identities (${u.apelido}) — ninguém loga por e-mail; rodar o insert de supabase/seeds/010:81-96`);
    }
    // Idem para o bloqueio: se a versão do GoTrue ignorar `ban_duration` no
    // create, um desligado consegue pedir recuperação de senha e entrar.
    if (!u.ativo && !data.user.banned_until) {
      const r = await cliente.auth.admin.updateUserById(u.profileId, {
        ban_duration: "876000h",
      });
      if (r.error) {
        falhas++;
        rel.conta("auth:sem-bloqueio");
        rel.aviso(`desligado sem banned_until (${u.apelido}): ${r.error.message}`);
      }
    }
    paresUsuario.push({
      bubble_id: u.bubbleId,
      tabela_destino: "profiles",
      registro_id: u.profileId,
    });
    if (criadas % 50 === 0) console.log(`[pessoas]   ${criadas} contas criadas…`);
  }
  rel.conta("pessoas:contas-criadas", criadas);

  // De-para antes de qualquer passo dependente: se a carga morrer no meio, a
  // próxima execução reencontra as contas em vez de duplicar.
  const mapaGravado = await registrarMapa("user", paresUsuario);
  rel.conta("de-para:user", mapaGravado.inseridos);
  for (const e of mapaGravado.erros) rel.aviso(`de-para user: ${e.mensagem}`);
  falhas += mapaGravado.erros.length;

  const comPerfil = usuarios.filter((u) => u.profileId);
  const perfilDe = new Map(comPerfil.map((u) => [u.bubbleId, u.profileId]));
  if (comPerfil.length < usuarios.length)
    rel.aviso(`${usuarios.length - comPerfil.length} pessoas ficaram sem perfil — os passos seguintes as ignoram`);

  // ── 7. campos de RH em `profiles` ──────────────────────────────────────────
  // Um upsert por `id`: o gatilho já criou a linha, aqui só completa. O
  // `service_role` passa pelo `profiles_guard_admin_columns` (0061:84-91) —
  // não é preciso impersonar admin como o mapa §9 supunha.
  console.log(`[pessoas] passo 2/6 — dados de RH (${comPerfil.length} perfis)`);
  const linhasPerfil = comPerfil.map((u) => ({
    id: u.profileId,
    full_name: u.fullName,
    email: u.email,
    phone: u.telefone,
    // `terminated` exigiria data de desligamento, que a origem não tem.
    status: u.ativo ? "active" : "suspended",
    terminated_at: null,
    hired_at: u.entrada,
    cpf: u.cpf,
    creci: u.creci,
    habilitation: habilitacaoDe(u, rel),
    birth_date: u.nascimento,
    address: u.endereco,
    indication: u.indicacao,
  }));
  if (ehDryRun()) {
    rel.conta("perfis:atualizaria", linhasPerfil.length);
  } else {
    let atualizados = 0;
    for (let i = 0; i < linhasPerfil.length; i += 200) {
      const bloco = linhasPerfil.slice(i, i + 200);
      const { data, error } = await cliente
        .from("profiles")
        .upsert(bloco, { onConflict: "id" })
        .select("id");
      if (!error) {
        atualizados += data?.length ?? 0;
        continue;
      }
      for (const linha of bloco) {
        const r = await cliente.from("profiles").upsert(linha, { onConflict: "id" }).select("id");
        if (r.error) {
          falhas++;
          rel.aviso(`perfil não atualizado: ${r.error.message}`);
        } else atualizados++;
      }
    }
    rel.conta("perfis:atualizados", atualizados);
  }

  // ── 8. papéis ──────────────────────────────────────────────────────────────
  console.log(`[pessoas] passo 3/6 — papéis (${totalPapeis} linhas)`);
  const linhasPapel = [];
  const semBroker = [];
  for (const u of comPerfil) {
    const conjunto = papeis.get(u.bubbleId) ?? new Set();
    for (const papel of conjunto) linhasPapel.push({ profile_id: u.profileId, role: papel });
    // O gatilho `handle_new_auth_user` concede `broker` a TODA conta nova; quem
    // não atende precisa perder o papel, senão entra na roleta e no pódio.
    if (!conjunto.has("broker")) semBroker.push(u.profileId);
  }
  const papeisGravados = await inserirEmLote("user_roles", linhasPapel, {
    onConflict: "profile_id,role",
  });
  rel.conta("papeis:inseridos", papeisGravados.inseridos);
  for (const e of papeisGravados.erros) rel.aviso(`user_roles: ${e.mensagem}`);
  falhas += papeisGravados.erros.length;

  if (ehDryRun()) {
    rel.conta("papeis:broker-a-remover", semBroker.length);
  } else if (semBroker.length) {
    let removidos = 0;
    for (let i = 0; i < semBroker.length; i += 100) {
      const { error, count } = await cliente
        .from("user_roles")
        .delete({ count: "exact" })
        .eq("role", "broker")
        .in("profile_id", semBroker.slice(i, i + 100));
      if (error) {
        falhas++;
        rel.aviso(`remoção de broker: ${error.message}`);
      } else removidos += count ?? 0;
    }
    rel.conta("papeis:broker-removidos", removidos);
  }

  // ── 9. equipes ─────────────────────────────────────────────────────────────
  console.log(`[pessoas] passo 4/6 — equipes (${equipes.length})`);
  const mapaEquipes = cliente ? await lerMapa("equipe", "teams") : new Map();
  const equipesPorNome = new Map();
  if (cliente) {
    for (const t of await lerTudo(cliente, "teams", "id, name"))
      equipesPorNome.set(normalizarNome(t.name), t.id);
  }

  const equipesNovas = [];
  for (const e of equipes) {
    const doMapa = mapaEquipes.get(e.bubbleId);
    const ja = doMapa ?? equipesPorNome.get(normalizarNome(e.nome));
    if (ja) {
      e.teamId = ja;
      if (doMapa) rel.conta("equipes:ja-existiam");
      else {
        // O ramo do nome existe para recuperar a rodada que criou a equipe e
        // morreu antes do de-para (por isso não dá para trocá-lo pelo de-para).
        // Ele também adota equipe de OUTRA procedência que normalize igual — a
        // criada na tela de homologação —, levando o director_id/manager_id
        // alheios junto. Tem de aparecer no relatório com nome e tudo.
        rel.conta("equipes:adotada-por-nome");
        rel.aviso(`equipe "${e.nome}" adotada por nome, fora do de-para — confira a procedência antes de liberar`);
      }
      continue;
    }
    const diretorId = e.diretorBubble ? perfilDe.get(e.diretorBubble) ?? null : null;
    // Equipe com gerente e sem diretor é adotável por qualquer diretor que
    // enxergue esse gerente (`0068:36-48`) — vazamento de diretoria. Melhor
    // não criar a equipe e deixar na lista de revisão.
    if (!diretorId) {
      rel.aviso(`equipe "${e.nome}" sem diretor resolvido — NÃO criada (evita equipe órfã adotável, 0068)`);
      rel.conta("equipes:descartadas-sem-diretor");
      continue;
    }
    e.diretorId = diretorId;
    e.gerenteId = e.gerenteBubble ? perfilDe.get(e.gerenteBubble) ?? null : null;
    if (!e.gerenteId) rel.aviso(`equipe "${e.nome}" sem gerente resolvido — entra com manager_id nulo`);
    equipesNovas.push(e);
  }

  if (equipesNovas.length) {
    // Uma por vez porque precisamos do `id` de volta (o slug sai do gatilho
    // `teams_ensure_slug` e não dá para calcular aqui) e porque são 12: uma
    // equipe recusada não pode levar as outras 11 junto.
    for (const e of equipesNovas) {
      if (ehDryRun()) {
        e.teamId = randomUUID();
        rel.conta("equipes:criaria");
        continue;
      }
      const { data, error } = await cliente
        .from("teams")
        .insert({
          name: e.nome,
          director_id: e.diretorId,
          manager_id: e.gerenteId,
          active: true, // §7.3: `false` cegaria o gestor de duas equipes vazias
          created_at: e.criadoEm,
        })
        .select("id")
        .single();
      if (error) {
        falhas++;
        rel.aviso(`equipe "${e.nome}" não criada: ${error.message}`);
        continue;
      }
      e.teamId = data.id;
      rel.conta("equipes:criadas");
    }
  }
  // De-para de TODAS as equipes com id, não só das criadas agora: se a rodada
  // anterior morreu entre os inserts e esta gravação, a equipe é reencontrada
  // pelo nome e é só por aqui que o de-para volta a fechar em 12 (ACEITE 2.1).
  const paresEquipe = equipes
    .filter((e) => e.teamId)
    .map((e) => ({ bubble_id: e.bubbleId, tabela_destino: "teams", registro_id: e.teamId }));
  const mapaEq = await registrarMapa("equipe", paresEquipe);
  rel.conta("de-para:equipe", mapaEq.inseridos);
  for (const e of mapaEq.erros) rel.aviso(`de-para equipe: ${e.mensagem}`);
  falhas += mapaEq.erros.length;
  const equipePorBubble = new Map(equipes.filter((e) => e.teamId).map((e) => [e.bubbleId, e]));

  // ── 10. vínculos de equipe ─────────────────────────────────────────────────
  console.log("[pessoas] passo 5/6 — vínculos de equipe");
  const linhasVinculo = [];
  let abertos = 0;
  for (const u of comPerfil) {
    const alvo = resEquipe(u.equipe);
    if (!alvo.id) continue; // 31 pessoas sem equipe; `Users.equipe:vazio` no relatório
    const equipe = equipePorBubble.get(alvo.id);
    if (!equipe) {
      rel.conta("vinculos:equipe-nao-criada");
      continue;
    }
    // Ninguém entra na equipe antes de a equipe existir.
    const joined = [u.entrada, equipe.criadoDia].filter(Boolean).sort().at(-1);
    if (!joined) {
      rel.aviso(`vínculo sem data para ${u.apelido} — descartado`);
      continue;
    }
    // `left_at` do desligado usa `Modified Date` como proxy declarado: aqui o
    // que a operação lê é "aberto ou fechado", e deixar nulo poria o desligado
    // na listagem da equipe de hoje.
    let left = u.ativo ? null : u.modificado;
    if (left && left > TETO_SAIDA) {
      left = TETO_SAIDA;
      rel.conta("vinculos:saida-limitada-ao-teto");
    }
    if (!u.ativo && !left) {
      rel.aviso(`desligado sem data de fechamento (${u.apelido}) — vínculo descartado para não nascer aberto`);
      continue;
    }
    if (left && left < joined) {
      rel.aviso(`vínculo com saída anterior à entrada (${u.apelido}) — descartado`);
      continue;
    }
    if (!left) abertos++;
    linhasVinculo.push({
      team_id: equipe.teamId,
      profile_id: u.profileId,
      joined_at: joined,
      left_at: left,
    });
  }
  // `team_members_import_key` (migration 0096) é a chave que faltava: sem ela
  // a reexecução inseria +179 linhas fechadas sem erro e sem conflito (R-05).
  const vinculos = await inserirEmLote("team_members", linhasVinculo, {
    onConflict: "profile_id,team_id,joined_at",
  });
  rel.conta("vinculos:enviados", linhasVinculo.length);
  rel.conta("vinculos:inseridos", vinculos.inseridos);
  for (const e of vinculos.erros) rel.aviso(`team_members: ${e.mensagem}`);
  falhas += vinculos.erros.length;

  // ── 11. roleta ─────────────────────────────────────────────────────────────
  console.log("[pessoas] passo 6/6 — fila geral");
  const naRoleta = comPerfil.filter(
    (u) => u.ativo && fichaAtiva.has(u.bubbleId) && papeis.get(u.bubbleId)?.has("broker"),
  );
  // R-12: `distribution_queue()` (`0074:270-330`) não consulta `user_roles` —
  // basta estar no grupo e bater check-in para receber lead. Sem o filtro de
  // papel o único administrador entraria na fila.
  let grupoId = null;
  if (cliente) {
    const { data, error } = await cliente
      .from("distribution_groups")
      .select("id")
      .eq("slug", "fila-geral")
      .maybeSingle();
    if (error) throw new Error(`distribution_groups: ${error.message}`);
    grupoId = data?.id ?? null;
  }
  if (cliente && !grupoId) {
    rel.aviso("grupo `fila-geral` não existe no destino (vem do supabase/seed.sql) — passo da roleta pulado");
    rel.conta("roleta:pulada", naRoleta.length);
    falhas += naRoleta.length;
  } else {
    const linhasRoleta = naRoleta.map((u) => ({
      group_id: grupoId ?? randomUUID(),
      profile_id: u.profileId,
      active: true,
    }));
    const roleta = await inserirEmLote("distribution_group_members", linhasRoleta, {
      onConflict: "group_id,profile_id",
    });
    rel.conta("roleta:enviados", linhasRoleta.length);
    rel.conta("roleta:inseridos", roleta.inseridos);
    for (const e of roleta.erros) rel.aviso(`distribution_group_members: ${e.mensagem}`);
    falhas += roleta.erros.length;
  }

  // ── 12. conferência e relatório ────────────────────────────────────────────
  for (const r of [
    resDiretor,
    resGerencia,
    resEquipe,
    resEqDiretor,
    resEqGerente,
    resCorretorUser,
    resCorretorNome,
  ])
    r.relatar(rel);

  const medido = {
    pessoas: usuarios.length,
    ativas: usuarios.filter((u) => u.ativo).length,
    equipes: equipes.length,
    papeis: totalPapeis,
    vinculos: linhasVinculo.length,
    vinculos_abertos: abertos,
    roleta: naRoleta.length,
  };
  for (const [chave, esperado] of Object.entries(ESPERADO)) {
    rel.conta(`conferência:${chave}`, medido[chave]);
    if (medido[chave] !== esperado)
      rel.aviso(`conferência ${chave}: ${medido[chave]}, o plano mede ${esperado} — o CSV ou a regra mudou, conferir antes de liberar o app`);
  }

  rel.aviso("`profiles.terminated_at` fica NULL nos 205 desligados: a origem não tem data de desligamento (status entra como `suspended`)");
  rel.aviso("avatares (87 fotos de `Users.imgPerfil`) NÃO entram nesta carga — bucket privado exige URL assinada (R-19)");
  rel.imprimir();

  if (falhas > 0) {
    console.error(
      `
${falhas} linha(s) não entraram. Corrija e reexecute (a carga é idempotente) antes de liberar a 02, a 03 e a 04.`,
    );
    process.exit(1);
  }
}

/**
 * Tabela inteira do destino, paginada de 1.000 em 1.000.
 *
 * Acima de 1.000 linhas o PostgREST trunca CALADO (`lib/bubble.mjs`, `lerMapa`),
 * e aqui um índice truncado não falha: faz o script decidir errado. `ordem`
 * precisa ser CHAVE — sem ordem total duas páginas repetem e PULAM linha.
 */
async function lerTudo(cliente, tabela, colunas, ordem = "id") {
  const linhas = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await cliente.from(tabela).select(colunas).order(ordem).range(de, de + 999);
    if (error) throw new Error(`${tabela}: ${error.message}`);
    linhas.push(...data);
    if (data.length < 1000) return linhas;
  }
}

/**
 * `habilitacao` manda; `creci` textual só completa o que está vazio.
 * Valor fora do de-para vira `OUTRO` — o check do banco não aceita o texto do
 * legado, e `NULL` perderia a informação de que a pessoa tem habilitação.
 */
function habilitacaoDe(u, rel) {
  if (u.habilitacaoBruta) {
    const alvo = HABILITACAO.get(u.habilitacaoBruta);
    if (alvo) return alvo;
    rel.aviso(`habilitação desconhecida "${u.habilitacaoBruta}" (${u.apelido}) → OUTRO`);
    return "OUTRO";
  }
  if (!u.creciBruto || u.creci) return null;
  return CRECI_TEXTUAL.get(normalizarNome(u.creciBruto)) ?? null;
}

main().catch((e) => {
  console.error(String(e.message || e));
  process.exit(1);
});
