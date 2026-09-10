# Refutação — `mapa/game_metas.md` pela lente **schema**

Domínio: Gamificação, metas e resultados. Data: 09/09/2026.
Verificado contra `supabase/migrations/` (86 arquivos), `supabase/seed.sql`, `supabase/seeds/010`–`050`,
`scripts/seed-database.ps1`, `src/integrations/supabase/game.ts`, `src/components/engagement/ranking.ts`,
`src/pages/Gamification.tsx` e 5 CSVs do Bubble (parse com `csv.DictReader`, `encoding="utf-8-sig"`).
Nada foi executado contra banco. Nenhum arquivo de código foi alterado.

**Veredito: REFUTADO — gravidade alta.**
As citações de migration do mapa estão corretas praticamente uma a uma (conferi 30 delas, tabela da §3), e as
medições da origem se reproduzem ao número. O que quebra é outro eixo: **o mapa trata o destino como tabela
vazia em toda contagem e em toda limpeza, exceto na temporada aberta.** O destino real é o banco semeado por
`npm run db:seed:remote`, que já grava linhas nas MESMAS tabelas — e, em `annual_results`, nas MESMAS chaves
naturais. Consequência: duas linhas de resultado anual **inventadas** sobrevivem misturadas a cinco anos de
histórico real, a temporada `Setembro 2026` fica **duplicada e indistinguível** no seletor, e **4 das 5
contagens de aceite da §11 nunca podem bater**.

---

## 1. Defeito principal — o destino não está vazio, e o mapa só sabe disso na §2.1

O próprio mapa admite que há dado de seed no destino (§2.1: *"encerre a temporada aberta que existir no destino
(seed/demo)"*). Mas a §10 (volumes) e a §11 (verificação 8) contam como se a tabela estivesse zerada, e a §1
(ordem de carga) não tem nenhum passo de remoção do dado demonstrativo.

O que o seed remoto aplica (`scripts/seed-database.ps1:15-23`):

```
$seedFiles = @(
  "/workspace/supabase/seed.sql",
  "/workspace/supabase/seeds/010_identity_and_teams.sql",
  "/workspace/supabase/seeds/020_catalog_distribution_sdr.sql",
  "/workspace/supabase/seeds/030_commercial_operation.sql",
  "/workspace/supabase/seeds/040_reports_game_workspace.sql",
  "/workspace/supabase/seeds/050_test_scenarios.sql"
)
```

### 1.1 `annual_results` — duas linhas fictícias sobrevivem à carga

`supabase/seeds/040_reports_game_workspace.sql:189-196`:

```sql
insert into public.annual_results (id, year, month, sales_count, vgv, notes, updated_by)
values
  ('6e000000-…-0001', extract(year from current_date)::int,  extract(month from current_date)::int,  1,  472875, 'Resultado parcial do mes atual.', …),
  ('6e000000-…-0002', extract(year from (current_date - interval '1 month'))::int,  …,  4, 1985000, 'Resultado consolidado do mes anterior.', …),
  ('6e000000-…-0003', extract(year from (current_date - interval '2 months'))::int, …,  3, 1670000, 'Historico demonstrativo.', …)
on conflict do nothing;
```

`supabase/seeds/050_test_scenarios.sql:402-409` acrescenta mais 5: `(ano, 1)`, `(ano, 2)`, `(ano, 3)`,
`(ano-1, 11)`, `(ano-1, 12)`.

Com a carga rodando hoje (09/09/2026) o seed ocupa 8 pares `(year, month)`:
**2026-09, 2026-08, 2026-07, 2026-03, 2026-02, 2026-01, 2025-12, 2025-11**.

A origem cobre 2021-01 → 2026-07 (medido: 66 meses distintos, 2024-10 ausente, 2024-11 duplicado).
O upsert da §7.5 (`on conflict (year, month) do update set sales_count, vgv, notes`) **sobrescreve 6 dos 8**
com dado real — correto e desejado. Mas **2026-08 (4 vendas / R$ 1.985.000,00) e 2026-09 (1 venda /
R$ 472.875,00) não têm par na origem e ficam de pé**, com `notes` dizendo "Resultado consolidado do mes
anterior." / "Resultado parcial do mes atual.".

É exatamente o defeito que a tabela existe para não ter — cabeçalho de `0012_crud_fixes.sql:301-303`:
*"Ajustar a lógica de soma dos relatórios anuais para corrigir discrepâncias de dados encontradas no sistema
anterior."* A tela de Resultados passa a mostrar agosto e setembro/2026 inventados no fim de uma série real de
5,5 anos, e nada na linha os distingue (`notes` não é exibido — o próprio mapa registra isso na §5.5).

**Total real: 68 linhas, não 66.**

### 1.2 `game_seasons` — duas temporadas `Setembro 2026`, mesmo `period_start`, indistinguíveis

`supabase/seed.sql:146-148`:

```sql
insert into public.game_seasons (label, period_start)
select public.season_label_ptbr(current_date), public.month_start(current_date)
where not exists (select 1 from public.game_seasons where closed_at is null);
```

Rodando hoje isso grava `label = 'Setembro 2026'`, `period_start = '2026-09-01'`.
A §2.1 receita (a) do mapa fecha essa linha (`closed_at = now()`, `period_end = greatest(period_start,
current_date)` = `2026-09-09`) — **e a deixa na tabela**. Em seguida a §7.1 insere a temporada legada
`6bb69ec8-8d30-520e-9f8e-ee3c4b48925b` com `label = 'Setembro 2026'` (regra `season_label_ptbr(period_start)`
da §5.1) e `period_start = '2026-09-01'`.

Nada no schema impede: `game_seasons` não tem unique em `label` nem em `period_start`
(`0010_gamification.sql:58-75` — só `game_seasons_one_open`, unique parcial sobre `(closed_at is null)`).
O resultado é **duas temporadas fechadas com rótulo e início idênticos**. `listSeasons()`
(`src/integrations/supabase/game.ts:220-227`) ordena por `period_start desc` — o empate resolve arbitrário, e o
seletor da Gamificação mostra duas entradas "Setembro 2026": uma com as 91 linhas congeladas importadas e outra
vazia. Nem o operador nem o usuário têm como escolher a certa. (Se o seed tiver rodado em outro mês, a duplicata
muda de mês mas continua existindo: o rótulo do seed é sempre `season_label_ptbr(current_date)`, e as 7 legadas
cobrem março a setembro/2026.)

Some junto a temporada de `seeds/040:73-85` (`'Temporada historica demonstrativa'`, `period_start` =
`month_start(current_date) - 3 months` = **2026-06-01**), que também cai no filtro `period_start >= '2026-03-28'`
das verificações §11 #2 e #8.

### 1.3 As contagens de aceite da §11 verificação 8 não podem bater

O mapa manda conferir `esperado: 7 · 35 · 629 · 191 · 66`. No destino semeado:

| linha da verificação 8 | filtro escrito no mapa | esperado pelo mapa | real com o seed aplicado | de onde vem a diferença |
|---|---|---:|---:|---|
| `game_seasons` | `where period_start >= '2026-03-28'` | 7 | **9** | `seed.sql:146` (2026-09-01) + `seeds/040:73` (2026-06-01) |
| `game_scoring_rules` | `where season_id is not null` | 35 | **35 ✓** | as 5 regras do `seed.sql:150-156` têm `season_id null` |
| `game_season_results` | *(sem filtro)* | 629 | **632** | `seeds/040:105-110` grava 3 linhas na temporada `64000000-…-0001` |
| `goals` | `where scope='team' and metric='sales'` | 191 | **193** | `seeds/040:134-141` grava 2 metas `team`/`sales` (ids `68000000-…-0003/0004`) |
| `annual_results` | *(sem filtro)* | 66 | **68** | 2026-08 e 2026-09 do `seeds/040:189` |

Quatro de cinco falham. O risco operacional não é o alarme falso: é o operador "acertar" a contagem apagando
linha real, ou desligar a verificação inteira por já vir vermelha.

### Correção mínima (não exige migration)

1. Acrescentar à §1, **antes** do passo 2, a remoção do dado demonstrativo destas 5 tabelas — as chaves do seed
   são reconhecíveis por prefixo de UUID (`6e000000-`, `68000000-`, `64000000-`, `7c000000-` e, se a fase 060
   tiver rodado, `89000000-`, `8b000000-`, `8f000000-`), e `seeds/069_demo_showcase_rollback.sql` já existe como
   modelo. Para `game_seasons`, **apagar** a temporada aberta do seed em vez de só encerrá-la (apagando junto as
   3 linhas de `game_season_results` de `seeds/040:105`, que apontam para a temporada `64000000-…-0001`).
2. Se a decisão for **conviver** com o demo, então filtrar as 5 consultas da §11 #8 (por `id not in (…)`) e
   corrigir a §10 para 9/35/632/193/68 — mas aí a §5.5 precisa dizer, com todas as letras, que agosto e
   setembro/2026 do painel anual são números inventados.

Consequências de cada caminho: (1) limpa o painel anual e faz o aceite bater, ao custo de perder a base de
demonstração que hoje sustenta a gravação para o cliente; (2) preserva a demo, ao custo de entregar um painel
anual com dois meses fictícios e um seletor de temporada com entrada duplicada.

---

## 2. Defeitos secundários

### 2.1 O pódio congelado precisa do papel `broker`, e o mapa não declara isso (gravidade média)

O mapa (§0, dependências) exige apenas `profiles` carregado + de-para. Mas a identidade das linhas congeladas
**não** sai de `game_season_results`: sai de `visible_game_ranking`, e essa RPC só devolve quem tem o papel
`broker` — `0060_gamificacao.sql:136-146`:

```sql
with visible_brokers as (
  select p.id
  from public.profiles p
  where exists (
    select 1 from public.user_roles ur
    where ur.profile_id = p.id and ur.role = 'broker'
  )
    and public.can_see_game_profile(p.id)
),
```

`Gamification.tsx:485-495` monta `peopleById` a partir dessa RPC e o entrega a `buildFrozenScores`
(`src/components/engagement/ranking.ts:96-122`), que faz
`.filter((row) => keepUnknown || people.has(row.profile_id))` e, quando não acha,
`brokerName = UNKNOWN_PERSON` (`"Corretor fora do escopo"`). A policy `game_season_results_select`
(`0060:220-223`, `using (public.can_see_game_profile(profile_id))`) faz o mesmo corte no banco.

Medição própria (`g5.py`, âncora `Users.GameAtual` → `gameficacaos.unique id` → `user`, a mesma da §3.1):

```
gameficacaos linhas: 1063 | com gameMes: 629 | sem gameMes: 434
Users com GameAtual: 142 | orfaos: 0 | nomes curtos ancorados: 142 | ambiguos: 0
linhas 629 cobertas: 629 de 629 | usuarios distintos nas 629: 142
Funcao dos 142 usuarios: {'CORRETOR': 132, 'DIRETOR': 3, 'GERENTE': 7}
Ativo: {'sim': 87, 'não': 55}
linhas 629 por Funcao: {'CORRETOR': 559, 'GERENTE': 49, 'DIRETOR': 21}
```

**10 das 142 pessoas não são CORRETOR na origem — 70 das 629 linhas.** Se a carga de identidade der a essas 10
apenas `director`/`manager` (papel é N:N em `user_roles`, então dar `broker` junto é decisão, não consequência),
essas 70 linhas entram no banco corretamente e **aparecem sem nome** para admin/diretor/sócio e **somem** para
corretor e gerente — deixando buraco no `rank` congelado. A promessa da D1 ("mostrar as 7 temporadas fechadas
com pódio") fica condicionada a um requisito que o mapa nunca escreve.

Correção: acrescentar à lista de dependências §0 — *"cada `profile_id` das 629 linhas precisa ter `broker` em
`user_roles`, senão a linha congelada não resolve nome"* — e repassar ao domínio de identidade a lista das 10.

### 2.2 §7.3 não "reproduz exatamente" a RPC (gravidade baixa)

O mapa diz que o backfill de `vgv` reproduz `0060:536-547`. A RPC limita por
`v_period_end := greatest(v_season.period_start, current_date)` calculado **no instante do fechamento**
(`0060:526`), não por `period_end`; e `visible_game_ranking` usa `coalesce(gs.period_end, current_date)`
(`0060:196`). Para as 7 temporadas importadas os dois coincidem, porque o `period_end` é justamente o que o
loader grava — mas a frase "exatamente" está errada sobre qual expressão a RPC usa, e quem for auditar o número
vai procurar no lugar errado.

### 2.3 `pontos` negativo não está no de-para da §6.4 (gravidade baixa)

A §6.4 lista fracionário de `pontos` (14), fracionário de `StatusVenda` (29) e negativo de `StatusVenda` (2).
Não lista `pontos` negativo. Medido (`g7.py`/`g8.py`) nas 629 linhas:

```
pontos: min -650 max 23670 | fracionarios: 14
629: pontos negativos: 1  [('Rudinei Teixeira De Souza', '-650')]
```

`game_season_results.points` é `int not null` **sem** `check (points >= 0)` (`0010:134`), então a linha carrega.
O efeito é no `breakdown['ajuste']` (a chave vai absorver um resíduo grande e negativo) e no `rank` (a pessoa
fica em último). Não é bloqueante, mas é caso não previsto na regra escrita.

Na mesma família: a §8.2 anota "222 vazios" para `pontos` e "429 vazios" para `StatusVenda`. Isso é do arquivo
inteiro (1.063 linhas); **no recorte de 629 há 0 vazios nos dois campos** — a regra "vazio → 0" nunca dispara na
carga. Confere com o que o mapa escreve ("no arquivo"), mas induz o loader a implementar caminho morto.

### 2.4 `teams.name` não é unique — a §3.3 não tem desempate (gravidade baixa)

`0002_identity.sql:117-118`: `name text not null` / `slug text not null unique`. A §3.3 resolve
`meta-equipes.equipe → teams.id` casando **nome** normalizado e só prevê "equipe não encontrada". Não prevê
"encontrada 2×", que o schema permite. Hoje não colide (as equipes do seed são `Equipe Paulista` e `Equipe Sul`;
as 12 do Bubble, nenhuma parecida), mas a regra como está aceitaria silenciosamente a primeira linha que
voltasse. Correção de uma linha: resolver por `slug` (unique) ou abortar quando o `select` devolver mais de uma.

---

## 3. O que NÃO foi possível refutar (conferido e confirmado)

Cheque esta tabela antes de reabrir qualquer um destes pontos: já foi medido.

| afirmação do mapa | comando | resultado |
|---|---|---|
| `game_seasons` tem `id/label/period_start/period_end/closed_at/closed_by/created_at/updated_at` | `sed -n 58,72p …_0010_gamification.sql` | OK, os 8 nomes e tipos |
| T6 — `closed_at` e `period_end` bicondicionais (`0010:69-71`) | idem | OK, literal: `check ((closed_at is null) = (period_end is null))` |
| `game_seasons_period check (period_end is null or period_end >= period_start)` | idem | OK — Setembro (09-01 → 09-30) e Junho/Julho compartilhando 2026-07-02 passam |
| índice parcial `game_scoring_rules_season_idx (season_id, event_code) where season_id is not null` (`0010:98-99`) | `sed -n 85,102p` | OK — e é `create unique index`, então T3 procede: `on conflict on constraint` não compilaria |
| índice parcial `goals_team_idx (team_id, period_type, period, metric) where scope='team'` (`0011:89-90`) | `sed -n 69,92p …_0011_…` | OK |
| `goals.metric` CHECK fechado em `sales,vgv,leads,visits,analyses,approvals`; `target numeric(14,2) check >= 0` | idem | OK — L2 procede, não há valor para `meta_remuneracao` |
| `goals_scope_team`/`goals_scope_profile` bicondicionais | idem | OK — `scope='team'` exige `team_id` e proíbe `profile_id`; L3 procede |
| `game_season_results` PK `(season_id, profile_id)`, **sem** coluna `id`, `profile_id` FK `on delete restrict` | `sed -n 131,143p …_0010_…` | OK |
| `rank int not null` sem default; `sales/vgv/breakdown/frozen_at` com default | idem | OK |
| `annual_results` `unique (year, month)`, `check year between 2000 and 2100`, `sales_count >= 0`, `vgv >= 0` | `sed -n 306,320p …_0012_…` | OK — faixa 2021-01→2026-07 e max VGV 22.461.886,24 cabem em `numeric(14,2)` |
| extensões: só `pgcrypto`, `citext`, `pg_trgm`, `btree_gist` (`0001:7-10`) | `sed -n 1,15p …_0001_…` | OK — `uuid_generate_v5` não existe, o UUIDv5 tem que sair do loader |
| os 7 UUIDs de temporada da §4 e a constante `NS` | `python uu.py` (`uuid.uuid5`) | OK — **NS e os 7 batem dígito a dígito** |
| pesos por temporada da §5.1 (inclusive Julho 26 = 600/250/140/10/600, que parece desalinhado e não é) | `python dg.py` sobre `DadosGames` | OK — 7 linhas, valores idênticos aos da tabela |
| `Inicio`/`Fim`: nenhum valor perto da meia-noite (mais cedo 10:00) | idem | OK — REGRA-D3 é segura |
| `MesAtivo`: 6 `não` + 1 `sim` (Setembro 2026); `Fim` de Setembro é `Sep 30, 2026` | idem | OK |
| os 14 literais de `created_at`/`updated_at`/`closed_at` da §7.1 | idem | OK — conferidos contra `Creation/Modified Date` e `Fim` das 7 linhas |
| §5.3: 201 → −2 sem `mes` → −8 sem `equipe` = 191; 191 pares distintos; 12/12 equipes casam; `mes` sempre dia 1 00:00; 160 `meta_remuneracao`; `meta` inteiro 1..135 | `python g6.py` | OK — **todos os números reproduzem** |
| §5.5: 67 linhas, 66 meses distintos, 2024-11 duplicado, 2024-10 ausente, nenhum negativo, `data` sempre dia 1 00:00 | `python g7.py` | OK |
| §3.1: 142 `GameAtual`, 0 órfãos, 0 ambiguidades, 629/629 cobertas, 142 usuários distintos | `python g5.py` | OK — **a âncora funciona exatamente como descrito** |
| §6.2: seed padrão tem `aprovado 250`, `esteira 140`, `incompleto_com_doc 10`, `venda 600`, `distrato -600` e **não** tem `ligacao` | `sed -n 150,157p supabase/seed.sql` | OK, literal — inclusive os rótulos que a §8.2 propõe |
| §2.1: os 4 gatilhos existem com esses nomes e nenhum tem exceção para `postgres`/`service_role` | `grep -rn "create trigger" \| grep award` | OK — `deals_award_points` (0060:342), `deal_participants_award_points` (0060:374), `cca_award_points` (0078:133), `deal_documents_award_points` (0060:485). Existe um quinto, `deal_participants_revoke_points` (0060:442), que o mapa não lista — inócuo sem temporada aberta |
| §2.1: sem temporada aberta, `award_game_points` descarta e grava **um** `game_paused` não lido por pessoa, canal `in_app` (`0078:174-201`) | `sed -n 149,225p …_0078_…` | OK, literal — e `notifications.kind` é `text` sem CHECK (`0011:167`), então o `kind` passa |
| §2.2: nenhuma tabela tem `FORCE ROW LEVEL SECURITY` | `grep -rn "force row level security" supabase/migrations/` | OK — 0 ocorrências; carregar como `postgres` funciona |
| §5.2: regra de `rank` é a mesma da RPC (`0060:532`) | `grep -n "row_number() over" …_0060_…` | OK — linha 532 exata, `order by r.points desc, r.full_name` |
| §5.4: `goals` não tem `developer_id` e `marketing_investments.amount` é dinheiro com `unique (developer_id, period)` | `grep -A 15 "create table public.marketing_investments"` | OK — L4 procede |
| §8.2: `funnel_targets.scope in ('global','team','director')` | `grep -A 15 "create table public.funnel_targets"` | OK |
| nenhum cron do projeto abre temporada (a trava do passo 1 basta) | `grep -rn "cron.schedule\|faceimob-" supabase/migrations/` | OK — os 7 jobs são leads, checkout, purge, notify-dispatch, assign-queued, submission-dispatch, mark-no-response |
| existe caminho de tela para o passo 8 (abrir temporada sem `close_game_season`) | `sed -n 326,350p src/integrations/supabase/game.ts` | OK — `openGameSeason()` faz `insert into game_seasons` direto |
| T10: `set_updated_at` é `before update` nas 4 tabelas com `updated_at`; `game_season_results` não tem gatilho | `grep -rn "create trigger" \| grep -i "game_\|goals\|annual"` | OK — inserir com `created_at`/`updated_at` explícitos funciona; é o `do update` que sobrescreve |
| a inferência `on conflict (cols) where <predicado>` das §7.1/§7.4 é a forma válida para índice parcial | leitura dos 3 índices + do texto do mapa | OK — os predicados escritos (`season_id is not null`, `scope = 'team'`) são idênticos aos dos índices |

---

## 4. O que falta provar (não deu para fechar só com leitura de arquivo)

1. **Estado real do destino.** Toda a §1 acima assume que `db:seed:remote` foi aplicado (é o que
   `scripts/seed-database.ps1` faz e o que a §2.1 do mapa pressupõe). Não executei nada contra banco — um
   `select count(*) from public.annual_results` e um `select label, period_start from public.game_seasons` no
   alvo fecham a questão em dois comandos.
   Se a fase 060 (`060_demo_showcase.sql`) também tiver rodado, os desvios aumentam: ela grava mais
   `game_season_results` (linha 659), mais 3 metas `team`/`sales` (linha 837) e mais um `annual_results`
   (linha 1010).
2. **Papéis das 10 pessoas não-CORRETOR** (§2.1 deste relatório): depende do mapa de identidade decidir se
   `DIRETOR`/`GERENTE` também recebem `broker`. Enquanto não decidir, 70 das 629 linhas ficam em risco de
   entrar invisíveis.
3. **Colação do `rank`.** O loader calcula `rank` em Python ordenando por `full_name`; a RPC ordena com a
   colação do Postgres. As duas divergem em nome acentuado. Como temporada fechada nunca é recalculada, o
   efeito é cosmético — mas o mapa afirma "a mesma regra da RPC", e isso só é verdade se o loader ordenar com a
   mesma colação.
