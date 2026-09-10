# Alvo — Gamificação, metas, resultados e diário

Restrições do domínio no schema alvo, do ponto de vista de quem vai **inserir dados legados em massa**.
Fonte: `supabase/migrations/` (86 arquivos), `supabase/tests/` (47), `supabase/seeds/`, `supabase/seed.sql` e o front em `src/`.
Toda afirmação não óbvia leva `arquivo:linha`. Nada foi executado contra o banco.

Tabelas cobertas (13): `game_seasons`, `game_events`, `game_scoring_rules`, `game_season_results`, `goals`, `funnel_targets`, `annual_results`, `marketing_investments`, `daily_reports`, `daily_entries`, `gold_tips`, `important_notices`, `useful_links`.

---

## 0. Resumo executivo — o que decide a carga

1. **O jogo se auto-alimenta.** `game_events` quase nunca deve ser inserida à mão: ela é escrita por **cinco gatilhos** em `deals`, `deal_participants`, `cca_cases` e `deal_documents`. Importar negócios já ganhos **pontua na temporada aberta** (`0060_gamificacao.sql:61-68` diz isso explicitamente). Ver §3 e §9.T1.
2. **Só existe uma temporada aberta por vez** (índice `game_seasons_one_open`, `0010_gamification.sql:74-75`). Toda temporada histórica precisa nascer **já fechada**, e fechada tem regra de par: `closed_at` e `period_end` são ambos nulos ou ambos preenchidos (`0010:69-71`).
3. **`game_season_results` é congelamento, não agregação viva.** É materializada pela RPC `close_game_season()` (`0060:495-567`), mas nada impede o INSERT direto — e é esse o caminho para o histórico do Bubble, porque o legado só tem agregado (§2 e §4).
4. **O legado do Bubble tem placar agregado, não log de eventos.** `gameficacaos` traz `pontos` + contagem por categoria por (usuário, temporada); 622 de 629 linhas reconciliam exatamente `pontos = Σ contagem × peso da temporada`. Não há `ref_id` de negócio: reconstruir `game_events` linha a linha é inventar dado. Ver §2.
5. **Importar diário histórico é viável pela tabela, inútil pela superfície anônima.** As três RPCs anônimas só escrevem/leem uma janela curta (hoje ou até 2 dias atrás para escrita, mês corrente para leitura). Histórico entra por INSERT direto e só é lido pelas telas autenticadas. Ver §7.
6. **RLS:** carregue como `postgres` (dono, e **nenhuma tabela tem `FORCE ROW LEVEL SECURITY`**) ou como `service_role` (`BYPASSRLS`). Ver §8.

---

## 1. `game_seasons` — como criar temporada histórica

### DDL vigente (`0010_gamification.sql:58-79`)

```sql
create table public.game_seasons (
  id           uuid primary key default gen_random_uuid(),
  label        text not null,
  period_start date not null default current_date,
  period_end   date,
  closed_at    timestamptz,
  closed_by    uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint game_seasons_period check (period_end is null or period_end >= period_start),
  constraint game_seasons_closed_consistency
    check ((closed_at is null) = (period_end is null))
);

create unique index game_seasons_one_open
  on public.game_seasons ((closed_at is null)) where closed_at is null;
```

Nenhuma migration posterior altera a tabela (`grep "alter table public.game_"` só devolve o `enable row level security` de `0010:384`).

### (a) `label` — o formato pt-BR é obrigatório?

**Não há CHECK constraint sobre `label`.** É `text not null` e nada mais (`0010:60`). O formato "Mês YYYY" em pt-BR é **convenção**, não invariante do banco:

- `season_label_ptbr(date)` (`0035_season_label_ptbr.sql:21-31`) monta o rótulo por tabela fixa dos 12 meses — existe porque `to_char(..., 'TMMonth')` caía no inglês (o container não tem locale `pt_BR`, `0035:1-19`).
- Quem usa a função são `close_game_season` (`0035:103`, mantido em `0060:560`) e o seed (`seed.sql:147`).
- A 0035 termina com um **UPDATE de backfill** que traduz rótulos em inglês já gravados (`0035:119-121`), casando o regex `'^(January|…|December) \d{4}$'`.

**Consequência para a importação:** o legado do Bubble traz `Mes_nome` já em pt-BR, mas irregular — os 7 valores reais são `Março`, `Abril`, `Maio`, `Junho 26`, `Julho 26`, `Agosto 2026`, `Setembro 2026` (`DadosGames`, coluna `Mes_nome`). Nenhum desses casa o regex inglês da 0035, então nenhum seria reescrito. Normalizar para `season_label_ptbr(period_start)` é recomendação, não exigência — e mantém o histórico coerente com o que o produto vai gerar daqui pra frente.

Não há unique em `label`: duas temporadas podem ter o mesmo rótulo. O legado tem 7 rótulos distintos, então não é um problema real aqui.

### `period_start` / `period_end` / `closed_at` — a regra de par

| Estado | `period_start` | `period_end` | `closed_at` | permitido? |
|---|---|---|---|---|
| aberta | data | **NULL** | **NULL** | sim, no máximo **uma** no banco inteiro |
| fechada | data | data ≥ `period_start` | timestamptz | sim, quantas quiser |
| fechada sem `period_end` | data | NULL | timestamptz | **não** — `game_seasons_closed_consistency` |
| aberta com `period_end` | data | data | NULL | **não** — mesma constraint |
| `period_end < period_start` | — | — | — | **não** — `game_seasons_period` |

`closed_by` é FK para `profiles(id)` com `on delete set null` — pode ficar NULL se o admin que fechou não existir no destino.

### Receita para temporada histórica

Como as 7 temporadas do legado já terminaram (só `Setembro 2026` tem `MesAtivo = sim`), **todas menos uma entram já fechadas**:

```sql
insert into public.game_seasons (id, label, period_start, period_end, closed_at, closed_by)
values (
  '<uuid determinístico do unique id do Bubble>',
  public.season_label_ptbr('2026-03-28'::date),   -- ou o Mes_nome normalizado
  '2026-03-28',                                    -- Inicio
  '2026-04-01',                                    -- Fim (>= Inicio, senão 23514)
  '2026-04-01 10:00:00-03',                        -- closed_at: pode ser o Fim
  null
)
on conflict (id) do nothing;
```

Precedentes no repositório, ambos idempotentes:

- **Temporada histórica pronta, num INSERT só** — `seeds/040_reports_game_workspace.sql:73-84`: id fixo, `period_end`, `closed_at` e `closed_by` preenchidos juntos.
- **Fechar a temporada aberta sem a RPC** (útil se você quiser importar o histórico *depois* de já haver uma aberta) — `seeds/060_demo_showcase.sql:646-681`, e a mesma manobra em `tests/16_game_cycle.sql:49-51`:
  ```sql
  update public.game_seasons
     set closed_at = now(), period_end = greatest(period_start, current_date)
   where closed_at is null;
  ```
  O `greatest` existe porque fechar no mesmo dia da abertura daria `period_end < period_start` e derrubaria a transação (`0060:521-525`).

**Ordem obrigatória:** encerre a aberta **antes** de inserir a nova aberta. `seeds/060:640-642` registra o porquê — o índice `game_seasons_one_open` recusa a segunda, e um `on conflict do nothing` engoliria o erro deixando o resto da carga apontando para temporada inexistente.

**Períodos podem se sobrepor.** Não há constraint de exclusão entre temporadas fechadas. O legado tem sobreposição real: `Fim` de março = `Apr 1, 2026 10:00 am` e `Inicio` de abril = `Apr 2, 2026 10:29 pm` (folga), mas `Fim` de junho = `Jul 2, 2026 2:04 pm` e `Inicio` de julho = `Jul 2, 2026 2:04 pm` (mesmo instante). Como as colunas são `date`, ambos viram `2026-07-02` — dois dias de temporada compartilhados. Isso **não** viola nada no banco, mas o VGV congelado de `close_game_season` usa `d.closed_at::date between period_start and period_end` (`0060:542-543`), então uma venda em 02/07 contaria nas duas se o congelamento fosse recalculado. Como você vai gravar `game_season_results` à mão (§4), o ponto é irrelevante para a carga — só não recalcule.

---

## 2. `game_scoring_rules` — event_codes válidos hoje

### DDL (`0010_gamification.sql:85-99`)

```sql
create table public.game_scoring_rules (
  id         uuid primary key default gen_random_uuid(),
  season_id  uuid references public.game_seasons(id) on delete cascade,
  event_code text not null,
  label      text not null,
  points     int not null,
  active     boolean not null default true,
  ...
);
create unique index game_scoring_rules_default_idx
  on public.game_scoring_rules (event_code) where season_id is null;
create unique index game_scoring_rules_season_idx
  on public.game_scoring_rules (season_id, event_code) where season_id is not null;
```

**`event_code` NÃO tem check constraint.** É texto livre. O catálogo real é o do seed e o que os gatilhos emitem.

### (b) Os 5 códigos válidos e a semântica de cada

Catálogo em `supabase/seed.sql:150-156`:

| `event_code` | `label` | pontos padrão | quem emite | semântica |
|---|---|---|---|---|
| `incompleto_com_doc` | Incompleto com documento | 10 | `deal_documents_award_points` (`0060:453-487`), gatilho `after insert on deal_documents` | documento anexado a negócio que ainda está na etapa `incomplete`. Idempotente **por negócio** (`ref_id = deal_id`): cinco arquivos valem 10 pontos, não 50 (`0060:449-452`, asserção em `tests/23_gamificacao.sql:124-132`) |
| `esteira` | Envio para esteira ágil | 140 | `cca_award_points` (`0078:77-135`), gatilho `after insert or update on cca_cases` | o caso de crédito entra em `under_review`. Era `after update` até a 0078 e **nunca disparava na primeira submissão** — `submit_deal_for_analysis` cria o caso já em `under_review` (`0078:8-23`) |
| `aprovado` | Análise aprovada | 250 | mesmo gatilho | `cca_cases.status` vira `approved` |
| `venda` | Venda | 600 | `deals_award_points` (`0060:289-344`, `after insert or update on deals`) e `deal_participants_award_points` (`0060:352-376`, `after insert on deal_participants`) | negócio com `outcome = 'won'`. Pontua **cada corretor do rateio** (`deal_participants.role = 'broker'`) |
| `distrato` | Distrato | −600 | `deals_award_points` | negócio que **estava** ganho e virou `lost`/`cancelled`. **Não estorna a venda** (decisão de 03/09, `0060:16-18`): ficam +600 e −600 |

Pesos são editáveis pela tela (`src/integrations/supabase/game.ts:150-196`), sem migration.

**Precedência:** `scoring_points(season_id, event_code)` (`0010:160-174`) prefere a regra **da temporada** sobre a **padrão** (`season_id is null`); só considera `active`. Sem regra ativa, `award_game_points` **descarta o ponto** com `raise warning` (`0078:206-211`).

### Legado do Bubble: um código a mais, um a menos

`DadosGames` (7 linhas) tem pesos por temporada nas colunas `Pontos_Aprovado Total ou condicionado`, `Pontos_Esteira agil (1* envio)`, `Pontos_Incompleto com doc`, `Pontos_Ligacao` e `Venda`. Mapeamento:

| coluna legada | `event_code` alvo | observação |
|---|---|---|
| `Venda` | `venda` | direto |
| `Pontos_Aprovado Total ou condicionado` | `aprovado` | direto |
| `Pontos_Esteira agil (1* envio)` | `esteira` | direto |
| `Pontos_Incompleto com doc` | `incompleto_com_doc` | direto |
| `Pontos_Ligacao` | **não existe** | ver abaixo |
| — | `distrato` | **não existe no legado** |

**`ligacao` não tem equivalente.** Nenhum gatilho do FACEIMOB emite esse código e ele não está no seed. Duas saídas, com consequência:

- **Criar a regra `ligacao` só para as temporadas históricas** (`season_id` preenchido, `active = false` para não valer nas próximas). Consequência: a tela de Gamificação vai listar um código que nada produz — e `award_game_points` nunca vai emiti-lo, então é decoração histórica.
- **Descartar `ligacao`.** Consequência: os `pontos` congelados do legado (que incluem ligações — 3.425 ligações somadas nas 7 temporadas) **não vão bater** com a soma dos códigos do `breakdown`. Se você gravar `game_season_results.points` com o total do legado e o `breakdown` sem ligações, a tela mostra pontos > soma do detalhamento.

Os pesos legados **variaram por temporada** e não batem com o padrão atual — março tinha `esteira = 200` e `venda = 700`; agosto/setembro caíram para `esteira = 15`, `venda = 160`, `aprovado = 20`. Se você quiser preservar isso, é exatamente para isso que serve `season_id` preenchido em `game_scoring_rules`. Cuidado com o índice parcial: `on conflict (event_code)` **não** funciona (o arbiter é parcial e o Postgres recusa com 42P10 em tempo de plano — o front documenta o mesmo problema em `game.ts:139-148`). Use `update` filtrado + `insert` quando não houver linha, ou `on conflict on constraint game_scoring_rules_season_idx`.

---

## 3. `game_events` — ref_type/ref_id, e agregado vs. evento a evento

### DDL (`0010_gamification.sql:108-125`)

```sql
create table public.game_events (
  id          uuid primary key default gen_random_uuid(),
  season_id   uuid not null references public.game_seasons(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete restrict,
  event_code  text not null,
  points      int not null,
  ref_type    text,
  ref_id      uuid,
  occurred_at timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create unique index game_events_dedupe_idx
  on public.game_events (season_id, profile_id, event_code, ref_id)
  where ref_id is not null;
```

### (c) `ref_type` / `ref_id` apontam para quê

**`ref_type` não tem check constraint** e **não há FK em `ref_id`** — é um ponteiro solto, deliberadamente (o mesmo desenho de `tasks.ref_type/ref_id`, `0011:114`). Valores usados na prática:

- `ref_type = 'deal'`, `ref_id = deals.id` — **todos os cinco gatilhos** gravam assim, inclusive os de CCA e de documento (`0060:319`, `0060:328`, `0060:364`, `0060:475`, `0078:105`, `0078:114`). Note que `cca_award_points` grava `new.deal_id`, **não** `cca_cases.id`.
- `ref_type = 'cca_case'` aparece **só no seed** (`seeds/040:95`), e a 0078 registra isso como divergência conhecida que duplica pontos (`0078:44-48`): `game_events_dedupe_idx` não colapsa `('deal', deal_id)` com `('cca_case', case_id)` porque o `ref_type` **não entra no índice** — a chave é `(season_id, profile_id, event_code, ref_id)`.

**Para que serve `ref_id`:** é a idempotência. O índice é **parcial** (`where ref_id is not null`), então:

- com `ref_id` preenchido, reprocessar não duplica — `award_game_points` usa `on conflict do nothing` (`0078:216`);
- com `ref_id = NULL`, **não há trava nenhuma**: rodar a carga duas vezes duplica tudo.

### Dá para importar só o agregado?

**Sim, e é o único caminho honesto.** O que o Bubble exportou:

- `gameficacaos` (1.063 linhas) é **um agregado por (usuário, temporada)**, não um log. Colunas: `pontos` (total), `StatusAprovado`, `StatusEsteiraAgil`, `StatusIncompleto`, `StatusVenda`, `ligacoes`.
- Verificado por script: das **629 linhas com `gameMes` preenchido**, **622 reconciliam exatamente** `pontos = Σ (Status_x × peso_x da temporada) + ligacoes × Pontos_Ligacao`. Ou seja, as colunas `Status*` são **contagens de eventos**, e `pontos` é o total ponderado. As 7 divergências são todas da temporada `1785849124693…` (Agosto 2026), cujo peso foi alterado no meio do ciclo (`Modified Date` = `Sep 1, 2026`).
- **434 linhas não têm `gameMes`** (as mais antigas, de Jan/2026). Nelas os `Status*` estão em outra escala (ex.: `StatusEsteiraAgil = 400` com `pontos = 2534`) — provavelmente pontos, não contagem. **Não são conversíveis com confiança**; trate como fora de escopo ou descarte.
- **Não existe `ref_id`:** nada liga uma linha de `gameficacaos` ao negócio que gerou o ponto. `Diretor`, `equipe` e `user` vêm como **nome de exibição**, não `unique id` — só `gameMes` é um id do Bubble (confere com `DadosGames.unique id`).
- Contagens fracionárias existem: `StatusAprovado = 4,5`, `StatusIncompleto = 6,5` (venda/aprovação rateada entre dois corretores — o mesmo meio-ponto que `daily_entries` aceita, §7). **Meia venda não vira meia linha de `game_events`.**

Portanto:

| caminho | viável? | consequência |
|---|---|---|
| `game_season_results` a partir do agregado | **sim, recomendado** | placar histórico correto na tela de temporadas fechadas; sem log detalhado |
| `game_events` sintetizado (N linhas por categoria) | tecnicamente possível, **não recomendado** | `ref_id` seria NULL → **sem idempotência**; contagem fracionária não cabe em linhas inteiras; o log passa a afirmar eventos que ninguém consegue rastrear a um negócio |
| `game_events` reconstruído dos negócios importados | **acontece sozinho** | ver §9.T1 — é o risco, não a solução |

**Se ainda assim quiser `game_events` histórico**, invente um `ref_id` determinístico (ex.: UUIDv5 de `unique id do Bubble + event_code + índice`) só para reativar o índice de dedupe, e use `ref_type = 'legacy'`. Não use `'deal'` com um `ref_id` que não é um negócio — quebra a semântica que os cinco gatilhos mantêm.

### RLS de `game_events` (`0060:210-218`)

```sql
create policy game_events_select on public.game_events
  for select to authenticated
  using (event_code = 'venda' or public.can_see_game_profile(profile_id));
```

Escrita: `game_events_write` continua `is_admin()` (`0010:413-415`). `award_game_points` tem EXECUTE só para `service_role` (`0010:426`, reforçado em `0023:60`).

---

## 4. `game_season_results` — materializada por qual RPC

### DDL (`0010_gamification.sql:131-142`)

```sql
create table public.game_season_results (
  season_id  uuid not null references public.game_seasons(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  rank       int not null,
  points     int not null,
  sales      int not null default 0,
  vgv        numeric(14,2) not null default 0,
  breakdown  jsonb not null default '{}'::jsonb,
  frozen_at  timestamptz not null default now(),

  primary key (season_id, profile_id)
);
```

**Não tem coluna `id`.** A chave natural é `(season_id, profile_id)` — é por ela que se faz `on conflict do nothing`.

### (d) Sim: `close_game_season()`

A RPC é `public.close_game_season(p_next_label text, p_close_month boolean)`. A versão vigente é a da **0060** (`0060:495-567`), quarta reescrita do corpo (0010 → 0032 → 0035 → 0060). O que ela faz, na ordem:

1. exige `is_admin()`, senão 42501 (`0060:509-511`);
2. trava a temporada aberta com `for update` (`0060:513-515`);
3. calcula `v_period_end := greatest(period_start, current_date)` (`0060:525`);
4. **INSERT em `game_season_results`** a partir da view `game_ranking` (`0010:216-230`), com `rank = row_number() over (order by points desc, full_name)`, e o `vgv` somado de `deal_participants × deals` limitado ao período (`0060:528-548`) — o teto de data entrou na 0060 porque antes uma temporada fechada com atraso absorvia venda posterior (`0060:490-494`);
5. fecha a temporada (`closed_at`, `closed_by`, `period_end`);
6. abre a próxima com `season_label_ptbr(current_date + 1)`.

`p_close_month` **é ignorado desde a 0032** (`0032:154`, `0060:556`); quem trava mês é `close_month_and_season()` (`0032:176-225`), que chama `close_game_season` por dentro.

### Para a importação: **não chame a RPC**

Ela exige JWT de admin, sempre encerra a temporada **aberta** (não uma histórica) e calcula o placar a partir de `game_events` — que você não vai ter. Grave direto, como fazem o seed e o showcase:

- `seeds/040_reports_game_workspace.sql:105-112` — INSERT literal com `rank`, `points`, `sales`, `vgv`, `breakdown` e `frozen_at` explícitos, `on conflict do nothing`.
- `seeds/060_demo_showcase.sql:659-673` — a versão "faz o que a RPC faria", passo a passo, porque num seed não há JWT (`060:640-642`).

Mapeamento a partir de `gameficacaos`:

```
season_id  ← game_seasons.id resolvido por gameMes (unique id do Bubble)
profile_id ← profiles.id resolvido por `user` (NOME de exibição — ver §9.T4)
rank       ← row_number() por (points desc, full_name) dentro da temporada  [NOT NULL, sem default]
points     ← pontos                                                        [int, arredondar]
sales      ← StatusVenda                                                   [int; 4,5 precisa de decisão]
vgv        ← não existe no legado → 0 (default) ou somado de `vendas`/`pipelines`
breakdown  ← {"venda": StatusVenda*peso, "aprovado": …, "esteira": …, "incompleto_com_doc": …}
frozen_at  ← Modified Date da linha, ou o closed_at da temporada
```

`breakdown` segue a semântica da view `game_ranking`: `jsonb_object_agg(event_code, sum(points) por código)` — ou seja, **pontos por código, não contagem** (`0010:222-227`). A soma dos valores do `breakdown` deve dar `points`.

`points` e `sales` são `int`: contagem fracionária (`4,5`) precisa de arredondamento explícito — registre a regra escolhida.

### RLS (`0060:220-227`)

```sql
create policy game_season_results_select on public.game_season_results
  for select to authenticated using (public.can_see_game_profile(profile_id));
```

Consequência declarada em `0060:229-237`: corretor e gerente **não** veem no congelado o colega que saiu da equipe (`can_see_game_profile` só reconhece vínculo ativo). Admin/diretor/sócio veem tudo por `can_read_all()`. Se o histórico importado for de gente já desligada, **só a diretoria vai enxergar** — comportamento correto, mas vale avisar antes de alguém reclamar que "o ranking de março sumiu".

---

## 5. `goals` e `funnel_targets` — os valores válidos

### (e) `goals` (`0011_marketing_workspace.sql:69-96`)

```sql
scope       text not null check (scope in ('global','team','profile'))
period_type text not null check (period_type in ('month','year'))
metric      text not null check (metric in ('sales','vgv','leads','visits','analyses','approvals'))
target      numeric(14,2) not null check (target >= 0)
period      date not null                      -- SEM default, SEM check de formato

constraint goals_scope_team    check ((scope = 'team')    = (team_id is not null))
constraint goals_scope_profile check ((scope = 'profile') = (profile_id is not null))
```

Os dois `goals_scope_*` são **bicondicionais**: `scope = 'team'` **exige** `team_id` e `scope = 'global'` **proíbe** `team_id` e `profile_id`.

Unicidade por índice parcial (`0011:87-92`) — três índices, um por escopo:

```
goals_global_idx  (period_type, period, metric)             where scope = 'global'
goals_team_idx    (team_id, period_type, period, metric)    where scope = 'team'
goals_profile_idx (profile_id, period_type, period, metric) where scope = 'profile'
```

Mesma armadilha de `game_scoring_rules`: **`upsert` do PostgREST não acha arbiter em índice parcial**. O front resolve com update filtrado + insert (`game.ts:139-148` documenta o padrão, usado também em `Equipes.tsx`).

**Convenção de `period`, não imposta pelo banco:**

- `period_type = 'month'` → `period = 'YYYY-MM-01'` (`month_start`, `0001_foundation.sql:147-153`);
- `period_type = 'year'` → `period = 'YYYY-01-01'` (`seeds/060:849`, `date_trunc('year', current_date)::date`).

O front **depende** disso: `goalsByProfile` casa o par `(period_type, period)` e descarta quem não bater (`src/components/equipes/metas.ts:40-68`), com o comentário explicando que só `period_type` não basta porque a meta mensal de janeiro tem o mesmo `period` da anual. `getGlobalMonthlyGoal` filtra `.eq("period_type","month").eq("period", periodIso)` com `maybeSingle()` (`src/integrations/supabase/newSchema.ts:583-597`) — meta gravada em dia diferente do dia 1 simplesmente **não aparece na tela**.

**Escrita (`goals_write`, reescrita em `0061_equipes_permissoes.sql:128-147`):** admin escreve tudo; diretor escreve `global`, `team` das equipes que lidera e `profile` de quem enxerga.

**Legado do Bubble:**

- `meta-equipes` (201 linhas): `equipe`, `mes`, `meta`, `meta_remuneracao` → `goals` com `scope='team'`, `period_type='month'`, `period = month_start(mes)`, `metric='sales'` (o valor é contagem de vendas: 18, 23, 18). **`meta_remuneracao` não tem coluna alvo** — `goals.metric` não tem 'remuneracao' e o check recusa. Descarte ou registre a perda.
- `meta-constutoras` (402 linhas): `construtora`, `equipe`, `mes`, `meta`. **Não cabe em `goals`**: não existe escopo por construtora (`scope` só aceita global/team/profile) e não existe coluna `developer_id`. Também **não é `marketing_investments`** — lá `amount` é dinheiro aportado, não meta de unidades. Sem tabela alvo; precisa de decisão de produto antes da carga.
- `equipe` vem como **nome de exibição** ("Archimedes", "Zona Sul"), não `unique id` — resolver contra `teams.name`/`slug` (§9.T4).

### `funnel_targets` (`0009_daily.sql:71-98`)

```sql
scope text not null check (scope in ('global','team','director'))
lead_to_analysis_pct     numeric(5,2) not null default 10 check (between 0 and 100)
analysis_to_approval_pct numeric(5,2) not null default 40 check (between 0 and 100)
approval_to_sale_pct     numeric(5,2) not null default 50 check (between 0 and 100)
effective_from date not null default current_date

constraint funnel_targets_scope_team     check ((scope = 'team')     = (team_id is not null))
constraint funnel_targets_scope_director check ((scope = 'director') = (director_id is not null))
```

Unicidade também por índice parcial (`0009:89-94`), chaveada por `effective_from` — o histórico de metas é versionado por data, não sobrescrito.

**Precedência de leitura, fonte única desde a 0062** (`0062_diario.sql:596-612` e `0062:829-845`): `team` > `director` > `global`, com `effective_from <= current_date` e `order by effective_from desc limit 1`. Antes disso o Diário cobrava 10/40/50 literais enquanto a diretoria lia `funnel_targets` — "o mesmo número medido por duas réguas" (`0062:38-43`).

Nenhum CSV do Bubble corresponde a `funnel_targets`. Se não houver dado legado, a linha `global` do `seed.sql:133-136` (10/40/50) já cobre.

---

## 6. `annual_results` e `marketing_investments`

### (f) `annual_results` — chave `(year, month)` é única? **Sim.**

`0012_crud_fixes.sql:306-317`:

```sql
create table public.annual_results (
  id          uuid primary key default gen_random_uuid(),
  year        int not null check (year between 2000 and 2100),
  month       int not null check (month between 1 and 12),
  sales_count int not null default 0 check (sales_count >= 0),
  vgv         numeric(14,2) not null default 0 check (vgv >= 0),
  notes       text,
  updated_by  uuid references public.profiles(id) on delete set null,
  ...
  unique (year, month)
);
```

Unique **de tabela**, não índice parcial → `upsert(..., { onConflict: "year,month" })` funciona, e é exatamente o que o front faz (`src/integrations/supabase/analytics.ts:63-66`). É o único upsert genuíno deste domínio.

Sem `developer_id`, sem `team_id`: é o consolidado da **casa inteira**, editado à mão. A tabela existe porque o cliente reclamou de discrepância no anual do sistema antigo (`0012:299-303`) — a saída foi lançamento manual auditável em vez de agregação implícita.

**RLS:** leitura para `admin, director, partner, manager, marketing`; escrita para `admin, director` (`0012:326-333`).

**Legado:** `resultado-anuals` (67 linhas) — `data` (`Jan 1, 2024 12:00 am`), `vendas`, `vgv`. Mapeia limpo: `year = extract(year from data)`, `month = extract(month from data)`, `sales_count = vendas`, `vgv = vgv`. Atenção: **`vgv` vem em formato pt-BR** (`11095182,46` — vírgula decimal, sem separador de milhar). 67 linhas ≈ 5,5 anos, então o check `year between 2000 and 2100` não incomoda.

### `marketing_investments` (`0011:20-38`)

```sql
developer_id uuid not null references public.developers(id) on delete restrict
period       date not null
amount       numeric(14,2) not null check (amount >= 0)

unique (developer_id, period)
constraint marketing_investments_is_month_start check (period = public.month_start(period))
```

O check de `month_start` é **obrigatório**: `period` tem que ser dia 1. Unique de tabela → upsert funciona.

`on delete restrict` no `developer_id`: a construtora não pode ser apagada enquanto tiver aporte (`0063_marketing_dados.sql:165` explica: "o dinheiro histórico dela não sai do lugar"). Consequência para a carga: **importe `developers` antes**.

**RLS:** desde a 0045 a leitura é por permissão, não por papel — `has_permission('reports.view_finance')` (`0045_menu_marketing_dados.sql:42-46`). Escrita continua `admin, marketing` (`0011:435-438`).

Nenhum CSV do Bubble mapeia direto para `marketing_investments` (ver a nota sobre `meta-constutoras` em §5).

---

## 7. `daily_reports` / `daily_entries` e a superfície anônima

### DDL vigente

`daily_reports` (`0009:16-33`, + `filled_by_name` em `0038:36-37`):

```sql
id             uuid pk default gen_random_uuid()
team_id        uuid not null references teams(id) on delete cascade
report_date    date not null default current_date
submitted_by   uuid references profiles(id) on delete set null
submitted_at   timestamptz
notes          text
filled_by_name text            -- nome digitado no link público (0038:39-40)
unique (team_id, report_date)
```

`daily_entries` (`0009:40-64`, tipos alterados em `0038:48-78`):

```sql
report_id  uuid not null references daily_reports(id) on delete cascade
profile_id uuid not null references profiles(id) on delete RESTRICT   -- 0009:37-38
leads, calls, doc_collections, visits_scheduled, visits_done,
analyses_sent, analyses_approved, sales
           numeric(6,1) not null default 0 check (>= 0)
unique (report_id, profile_id)
constraint daily_entries_half_steps check (cada métrica * 2 = trunc(métrica * 2))
```

Duas mudanças da 0038 que importam para a carga:

1. **As 8 métricas viraram `numeric(6,1)`** (eram `integer`). O SCHEMA_ALVO já reflete isso. Meio ponto é venda dividida entre dois corretores (`0038:11-15`).
2. **`daily_entries_half_steps`**: o valor anda de 0,5 em 0,5. `2.5` passa, `2.3` levanta **23514**. Teto de `numeric(6,1)`: 9999,9.

`profile_id` é `on delete restrict` de propósito — "o histórico do mês tem que sobreviver ao desligamento do corretor" (`0009:37-38`).

### (g) A superfície anônima — e por que ela não serve para histórico

São **exatamente três RPCs** com EXECUTE para `anon` (`0009:480-483`; a guarda é reafirmada em `0080_diario.sql:96-113` depois de o invariante ter ficado 30 dias falso no remoto — `0080:8-20`):

| RPC | assinatura vigente | o que faz |
|---|---|---|
| `public_daily_team` | `(text, text)` — `0062:566…` | devolve equipe, escala, meta vigente, `today_date`, `today` e `month` (o **mês corrente**, dia a dia) |
| `public_daily_submit` | `(text, text, jsonb, text, text, date)` — `0080:656-762`, mais o invólucro de 5 args `0080:776-795` | **upsert** de um dia |
| `public_director_checkpoint` | `(text, date, text)` — `0080:~450-620` | funil agregado por equipe da semana + dias sem lançamento |

Limites de escrita do `public_daily_submit` (todos em `0080:656-762`, herdados de `0062:459-560`):

- **janela de 2 dias**: `if v_date > current_date or v_date < current_date - 2 then return {"error":"date_out_of_window","max_days_back":2}` (`0080:692-698`). **Não é NULL** de propósito, para a tela não dizer "PIN incorreto" a quem acertou o PIN;
- **teto de 200 linhas** por chamada (`0080:701-703`);
- só aceita `profile_id` que é **membro ativo** da equipe do link (`0080:728-735`) — quem saiu é ignorado em silêncio;
- métricas passam por `private.daily_metric` (`0062:439-449`): não-número vira 0, teto 9999. **Não arredonda** para o passo de 0,5 — fora do passo o insert bate na constraint e devolve 23514;
- recusa de acesso é sempre **NULL, nunca exceção** (`0034`, reafirmado em `0080:684-688`): exceção faria rollback do contador de lockout gravado por `resolve_public_link`.

Limites de leitura: `public_daily_team` só devolve `report_date >= date_trunc('month', current_date)` (`0062:683-685`). **Diário de meses passados é invisível pelo link público.**

### Importar diário histórico é viável? É útil?

**Viável: sim, por INSERT direto na tabela.** Não há gatilho de negócio em `daily_reports`/`daily_entries` (só `set_updated_at`, `0009:31-33` e `0009:62-64`), nenhuma constraint de data futura/passada e nenhum limite de volume. O padrão idempotente está em `seeds/060_demo_showcase.sql:1039-1080`, incluindo a armadilha que vale a pena copiar: o `on conflict (team_id, report_date) do nothing` **não cobre** `daily_reports_pkey`, então id fixo com data variável estoura o INSERT (`060:1032-1038`). A saída do seed foi id derivado da data.

**Útil: parcialmente, e só para quem tem sessão.** Quem consome o histórico:

- `/checkpoint` — lê `daily_reports` + `daily_entries` da **semana** escolhida, direto pelas tabelas (`src/pages/Checkpoint.tsx:74-100`); navega semanas para trás sem limite;
- `/dashboard` aba diretoria — mesma leitura por tabela (`src/components/dashboard/directorData.ts:176-191`);
- `/daily` (link público) — **não vê** nada fora do mês corrente.

RLS de leitura (`0009:419-445`): `can_read_all()`, ou equipe liderada (`auth_led_team_ids()`), ou ser membro da equipe. Escrita (`0009:431-434`, `447-462`): `is_admin()` ou liderar a equipe.

**Recomendação:** importe se e somente se o `/checkpoint` histórico for um requisito. Cada dia útil × equipe vira uma linha de `daily_reports` e ~N linhas de `daily_entries`; não há CSV de daily no export do Bubble analisado (`ligacoes`, 762 KB, é chamada telefônica por lead, não checkpoint de equipe). Sem fonte legada, isto é escopo zero.

### Efeito colateral do que **não** importar

O `missing_days` do checkpoint da diretoria mudou de régua na 0080 (`0080:589-606`): dia preenchido é dia com pelo menos uma linha em **`daily_entries`**, não só linha em `daily_reports` (`0080:63-69`) — um relatório vazio deixava de acusar sem ter registrado nada. Sábado, domingo e **hoje** saem da cobrança (`0080:591-593`, `0062:75-80`). Ou seja: importar `daily_reports` sem `daily_entries` **não** limpa a cobrança — comportamento correto, mas não conte com o contrário.

---

## 8. RLS e permissão para inserir em massa

### Grants de tabela

`0023_role_grants.sql:28-35` dá `select, insert, update, delete` em **todas** as tabelas de `public` para `anon`, `authenticated` e `service_role`. O grant abre a porta; **o RLS é o porteiro** (`0023:19-21`).

### Como não esbarrar no RLS

**Nenhuma tabela do projeto tem `FORCE ROW LEVEL SECURITY`** (`grep -rn "force row level" migrations/` → nenhum resultado). Portanto:

| identidade | RLS | recomendação |
|---|---|---|
| `postgres` (dono das tabelas) | **ignorado** (sem FORCE) | **preferida** para carga por `psql` / migration. É a identidade que os seeds usam |
| `service_role` | **ignorado** (`BYPASSRLS`) | preferida para carga via PostgREST/edge function |
| `authenticated` com papel `admin` | aplicado, mas as policies liberam | funciona para tudo deste domínio, exceto `marketing_investments` fora do par admin/marketing |
| `anon` | só as 3 RPCs do Diário | inútil para carga |

**Atenção `service_role` ≠ isento de gatilho.** `deals_guard_esteira_label` (`0037:39-65`) e `deals_guard_document_review` deixam passar `current_user in ('postgres','service_role')`, mas os gatilhos de **pontuação** (`deals_award_points`, `cca_award_points`, `deal_documents_award_points`, `deal_participants_award_points`) **não têm exceção nenhuma** — disparam para qualquer identidade. Ver §9.T1.

### Policies de escrita, por tabela

| tabela | quem escreve | onde |
|---|---|---|
| `game_seasons`, `game_scoring_rules`, `game_events`, `game_season_results` | `is_admin()` | `0010:397-421` |
| `goals` | admin; diretor no próprio recorte | `0061:128-147` |
| `funnel_targets` | `admin, director` | `0009:466-469` |
| `annual_results` | `admin, director` | `0012:330-333` |
| `marketing_investments` | `admin, marketing` | `0011:435-438` |
| `daily_reports` / `daily_entries` | `is_admin()` ou equipe liderada | `0009:431-434`, `447-462` |
| `useful_links` | `is_admin()` | `0011:494-496` |
| `important_notices` | `admin, director` | `0011:504-507` |
| `gold_tips` | `admin, director, manager` | `0011:511-514` |

---

## 9. Armadilhas

### T1 — Importar negócio já ganho **pontua na temporada aberta** (a mais cara)

O cabeçalho da 0060 avisa, com todas as letras (`0060_gamificacao.sql:61-68`):

> "com o item 3 valendo, negócio ganho que ENTRA no banco passa a pontuar na temporada aberta — seed de demonstração e importação de planilha incluídos. […] **Importar histórico com o jogo aberto joga tudo na temporada corrente; se não for isso o desejado, feche a temporada antes da carga.**"

São quatro gatilhos que disparam durante uma carga de pipeline/CCA:

| gatilho | evento | código |
|---|---|---|
| `deals_award_points` | `after insert or update on deals` | `0060:341-344` |
| `deal_participants_award_points` | `after insert on deal_participants` | `0060:373-376` |
| `cca_award_points` | `after insert or update on cca_cases` | `0078:132-135` |
| `deal_documents_award_points` | `after insert on deal_documents` | `0060:484-487` |

Como `saveLegacyDeal` grava o negócio primeiro e o rateio depois, **quem realmente pontua a venda é o INSERT em `deal_participants`** (`0060:346-351`).

**Mitigação, em ordem de preferência:**

1. **Feche a temporada aberta antes de importar** (`update game_seasons set closed_at = now(), period_end = greatest(period_start, current_date) where closed_at is null`). Com `current_game_season()` nulo, `award_game_points` descarta o ponto e retorna NULL — **mas** desde a 0078 ele também **grava uma notificação `game_paused` no sino** de cada corretor (`0078:174-201`, um não-lido por pessoa). Com dezenas de corretores, são dezenas de notificações a limpar depois: `delete from public.notifications where kind = 'game_paused'`.
2. **Aceite os pontos** e recalcule/limpe `game_events` da temporada corrente ao final da carga. Só admin/`postgres` consegue (`game_events_write`).
3. `alter table … disable trigger` durante a carga. Requer dono da tabela; **preserve a ordem de reativação** e lembre que `deals_default_month_base` e `deals_guard_closed_month` também são gatilhos de `deals` (`0032:82-84`, `0010:51-53`) — desligar tudo muda o `month_base`.

### T2 — Importar `venda` toca a fanfarra em todas as telas abertas

`game_events` está na publication `supabase_realtime` (`0020_core_fixes.sql:47`) e o `EngagementLayer` assina `INSERT` nela (`src/components/engagement/EngagementLayer.tsx:272-300`): cada linha com `event_code = 'venda'` dispara a comemoração e invalida o cache do ranking em **todo navegador conectado**. Uma carga em massa vira uma sequência de fanfarras (e a TV da loja tocando por minutos).

Mitigação: importe fora do horário, ou grave o histórico só em `game_season_results` (§4) — essa tabela **não** está na publication.

### T3 — Índice parcial não aceita `upsert` do PostgREST

Vale para `game_scoring_rules` (`0010:96-99`), `goals` (`0011:87-92`) e `funnel_targets` (`0009:89-94`). O `on conflict (col)` que o PostgREST monta **não acha arbiter** e o Postgres recusa com **42P10 em tempo de plano — sempre, mesmo sem linha em conflito** (`src/integrations/supabase/game.ts:139-148`). Use `update` filtrado + `insert`, ou SQL direto com `on conflict on constraint <nome_do_indice>`.

Só `annual_results` (`unique (year, month)`), `marketing_investments` (`unique (developer_id, period)`), `daily_reports` (`unique (team_id, report_date)`) e `daily_entries` (`unique (report_id, profile_id)`) têm unique **de tabela** e aceitam upsert normal.

### T4 — Relacionamentos do legado vêm como **nome**, não id

Nos exports `-modified`, só uma coluna deste domínio é um `unique id` do Bubble: **`gameficacaos.gameMes`** (confere com `DadosGames.unique id`; 7 valores distintos + vazio). Todas as demais são texto de exibição:

- `gameficacaos.user` → resolver contra `profiles.full_name` (homônimo = ambiguidade);
- `gameficacaos.Diretor`, `gameficacaos.equipe` → `profiles` / `teams.name`;
- `meta-equipes.equipe`, `meta-constutoras.equipe` → `teams`;
- `meta-constutoras.construtora` → `developers.name`.

`export_All-links_*.csv` **não tem coluna `unique id`** — 3 linhas, chave natural é `nome`+`link`.

### T5 — `game_seasons_one_open` derruba a carga se a ordem estiver errada

Insira as temporadas históricas **já fechadas** ou encerre a aberta antes. E **não** use `on conflict do nothing` na inserção da temporada aberta: `seeds/060:696-699` registra que o silêncio custou uma depuração inteira — a colisão era engolida e todo o resto do seed ficava apontando para uma temporada inexistente.

### T6 — `closed_at` sem `period_end` (e vice-versa) = 23514

`game_seasons_closed_consistency` (`0010:69-71`) é bicondicional. O legado tem `Inicio` e `Fim` em **todas** as 7 linhas, inclusive na ativa (`Setembro 2026`, `Fim = Sep 30, 2026`). Se importar a temporada ativa com `Fim` preenchido e `closed_at` nulo, **a constraint recusa**. A temporada ativa entra com `period_end = null, closed_at = null`.

### T7 — `daily_entries` recusa valor fora do passo de 0,5

`daily_entries_half_steps` (`0038:69-78`). `2,5` passa; `2,3` levanta 23514 e **derruba a transação inteira**, não só a linha. Normalize antes. Idem `numeric(6,1)`: teto 9999,9.

### T8 — `useful_links.url` exige URL absoluta

`useful_links_url_absolute` (`0063_marketing_dados.sql:93-97`): `check (url ~* '^https?://[^[:space:]]+$')`. Sem `http(s)://` o card viraria link relativo (`0063:24-26`, e `src/pages/Links.tsx:30`). As 3 linhas do legado já vêm com `https://`, mas valide.

### T9 — Colunas obrigatórias que o legado não tem

| tabela | coluna sem par no legado | consequência |
|---|---|---|
| `gold_tips` | `title` (NOT NULL) — o legado só tem `dica`, um bloco único com emoji e quebras de linha | sintetizar título (ex.: primeira linha, ou até o primeiro `–`) e pôr o resto em `body`. As 10 dicas começam por `💡 Dica de Ouro – …`, `📞 DICA DE OURO – …` — a heurística "até o primeiro `–`" funciona |
| `important_notices` | `title` (NOT NULL) — `mensagemdodias` só tem `mensagem` | idem. Também: `severity` default `'info'`; `starts_at` default `now()` — o legado tem `Creation Date`, use-a. `ends_at` nulo = eterno, e a policy só mostra o que está na janela (`0011:498-503`) |
| `game_season_results` | `vgv` | sem fonte no legado; usar o default `0` ou somar de `vendas`/`pipelines` |
| `game_season_results` | `rank` (NOT NULL, sem default) | calcular por `row_number() over (order by points desc, full_name)` dentro da temporada, como faz a RPC (`0060:532`) |
| `goals` | `meta_remuneracao` (legado) | **sem coluna alvo**; `goals.metric` não aceita 'remuneracao' |
| — | `meta-constutoras` (402 linhas) | **sem tabela alvo**; ver §5 |

### T10 — `updated_at` do legado se perde no primeiro UPDATE

Todas as 13 tabelas com `updated_at` têm gatilho `set_updated_at` **BEFORE UPDATE** (`0001_foundation.sql:109-117`). No INSERT o valor que você gravar é preservado; **qualquer UPDATE posterior o sobrescreve com `now()`**. Se `Modified Date` do Bubble importa como registro histórico, ele só sobrevive se a carga for INSERT puro (sem `on conflict do update`).

`game_events` e `game_season_results` **não têm** `updated_at` — imunes.

### T11 — `ref_type` livre já produziu pontuação em dobro

`0078:44-48` registra o caso: o seed 030 gera `aprovado` com `ref_type='deal'` e o seed 040 grava o **mesmo** `aprovado` com `ref_type='cca_case'`; como o índice de dedupe é `(season_id, profile_id, event_code, ref_id)` — **sem `ref_type`** — os dois coexistem e o corretor fica com 250 pontos duplicados. Se você inserir `game_events` histórico, escolha **uma** convenção de `ref_type`/`ref_id` e não misture com a dos gatilhos.

### T12 — Fuso e formato das datas do legado

Datas do Bubble vêm em en-US sem fuso declarado (`Mar 28, 2026 3:21 pm`). Trate como **America/Sao_Paulo** e registre a suposição. Onde o alvo é `date` (`period_start`, `period_end`, `period`, `report_date`, `effective_from`), a conversão de fuso pode mover o dia — `Apr 1, 2026 10:00 am` em São Paulo é `Apr 1 13:00 UTC`, mesmo dia; mas `Jul 2, 2026 2:04 pm` seria `Jul 2 17:04 UTC`, também mesmo dia. O risco real está nas horas próximas da meia-noite; o export deste domínio não tem nenhuma. Números decimais vêm em pt-BR (`11095182,46`, `4,5`).

### T13 — `profile_id` e `developer_id` são `on delete restrict`

`game_events.profile_id` (`0010:111`), `game_season_results.profile_id` (`0010:133`), `daily_entries.profile_id` (`0009:43`) e `marketing_investments.developer_id` (`0011:22`) são **RESTRICT**. Consequência dupla: (1) importe `profiles`/`developers` **antes**; (2) depois da carga, apagar um perfil importado por engano exige apagar antes tudo o que ele produziu neste domínio.

### T14 — Ordem de carga

```
profiles, teams, team_members, developers          (pré-requisito, fora deste domínio)
  ↓
game_seasons (históricas fechadas → ativa por último)
  ↓
game_scoring_rules (padrão season_id=null; por temporada se quiser preservar os pesos legados)
  ↓
game_season_results   ← agregado do `gameficacaos`
game_events           ← só se decidir sintetizar (não recomendado, §3)
  ↓
goals, funnel_targets, annual_results, marketing_investments   (independentes entre si)
daily_reports → daily_entries                                   (nessa ordem, FK)
gold_tips, important_notices, useful_links                      (independentes)
```

Se a carga de **negócios/CCA** rodar na mesma janela, ela precisa acontecer **depois** de a temporada aberta ser decidida (T1).

---

## 10. Obrigatórios sem default (por tabela)

| tabela | NOT NULL sem default |
|---|---|
| `game_seasons` | `label` |
| `game_scoring_rules` | `event_code`, `label`, `points` |
| `game_events` | `season_id`, `profile_id`, `event_code`, `points` |
| `game_season_results` | `season_id`, `profile_id`, `rank`, `points` |
| `goals` | `scope`, `period_type`, `period`, `metric`, `target` |
| `funnel_targets` | `scope` |
| `annual_results` | `year`, `month` |
| `marketing_investments` | `developer_id`, `period`, `amount` |
| `daily_reports` | `team_id` |
| `daily_entries` | `report_id`, `profile_id` |
| `gold_tips` | `title`, `body` |
| `important_notices` | `title`, `body` |
| `useful_links` | `label`, `url` |

Tudo o mais é nulável ou tem default (`id` = `gen_random_uuid()`, `created_at`/`updated_at` = `now()`, `active` = `true`, métricas de `daily_entries` = `0`, `sales`/`vgv` de `game_season_results` = `0`, `breakdown` = `'{}'`, `frozen_at` = `now()`, `severity` = `'info'`, `starts_at` = `now()`, `category` = `'geral'`, `sort_order` = `0`, os três percentuais de `funnel_targets` = 10/40/50, `effective_from` = `current_date`, `report_date` = `current_date`, `period_start` = `current_date`, `occurred_at` = `now()`).

---

## 11. Verificações pós-carga sugeridas

```sql
-- 1. no máximo uma temporada aberta (o índice garante, mas confirme que existe UMA)
select count(*) from public.game_seasons where closed_at is null;   -- esperado: 0 ou 1

-- 2. par closed_at/period_end íntegro (a constraint garante; serve de tripwire)
select count(*) from public.game_seasons
 where (closed_at is null) <> (period_end is null);                 -- esperado: 0

-- 3. breakdown fecha com points no congelado
select season_id, profile_id, points,
       (select sum(v::numeric) from jsonb_each_text(breakdown) as e(k, v)) as soma
  from public.game_season_results
 where points <> coalesce((select sum(v::numeric) from jsonb_each_text(breakdown) as e(k,v)), 0);

-- 4. rank sem buraco nem empate dentro da temporada
select season_id, count(*), count(distinct rank) from public.game_season_results group by 1;

-- 5. event_code órfão (sem regra cadastrada)
select distinct e.event_code from public.game_events e
 where not exists (select 1 from public.game_scoring_rules r where r.event_code = e.event_code);

-- 6. pontuação acidental na temporada corrente durante a carga
select event_code, count(*) from public.game_events
 where season_id = public.current_game_season() and created_at > '<início da carga>'
 group by 1;

-- 7. notificações "jogo parado" geradas pela carga (limpar se houve)
select count(*) from public.notifications where kind = 'game_paused';

-- 8. goals no dia 1 do período (convenção que o front exige)
select count(*) from public.goals
 where (period_type = 'month' and period <> public.month_start(period))
    or (period_type = 'year'  and period <> date_trunc('year', period)::date);
```

---

## 12. Referências principais

- `supabase/migrations/20260725120800_0009_daily.sql` — `daily_reports`, `daily_entries`, `funnel_targets`, `public_links` e as 3 RPCs anônimas originais
- `supabase/migrations/20260725120900_0010_gamification.sql` — as 4 tabelas do jogo, `award_game_points`, view `game_ranking`, `close_game_season`
- `supabase/migrations/20260725121000_0011_marketing_workspace.sql` — `marketing_investments`, `goals`, `useful_links`, `important_notices`, `gold_tips`
- `supabase/migrations/20260725121100_0012_crud_fixes.sql:299-333` — `annual_results`
- `supabase/migrations/20260808130000_0020_core_fixes.sql:38-58` — `game_events` na publication realtime
- `supabase/migrations/20260821120000_0032_game_cycle_month.sql` — `current_season_month`, `close_month_and_season`
- `supabase/migrations/20260901120000_0035_season_label_ptbr.sql` — `season_label_ptbr` e o backfill de rótulo
- `supabase/migrations/20260901130000_0038_daily_notes_and_month.sql` — `filled_by_name`, `numeric(6,1)`, passo de 0,5
- `supabase/migrations/20260902120000_0050_esteira_label_backfill.sql` — rótulo de esteira retroativo (contexto do `esteira`)
- `supabase/migrations/20260903600000_0060_gamificacao.sql` — os 4 gatilhos de pontuação, RLS por escopo, `close_game_season` vigente
- `supabase/migrations/20260903620000_0062_diario.sql` — dono do link, metas reais, teto de 200 linhas, `private.daily_metric`
- `supabase/migrations/20260906780000_0078_gamificacao.sql` — `cca_award_points` em INSERT, notificação `game_paused`
- `supabase/migrations/20260906800000_0080_diario.sql` — janela de 2 dias, régua de `missing_days`, superfície anônima
- `supabase/seed.sql:130-156` — catálogo de `funnel_targets` global e das 5 regras de pontuação
- `supabase/seeds/040_reports_game_workspace.sql` — o exemplo canônico de temporada histórica + `game_season_results`
- `supabase/seeds/060_demo_showcase.sql:630-720`, `820-860`, `1025-1080` — fechar/abrir temporada sem RPC, metas, diário idempotente
- `supabase/tests/16_game_cycle.sql`, `23_gamificacao.sql`, `78_gamificacao.sql`, `80_diario.sql`, `10_public_daily_flows.sql`
- `src/integrations/supabase/game.ts`, `src/integrations/supabase/analytics.ts:23-67`, `src/components/equipes/metas.ts`, `src/lib/dailyFunnel.ts`, `src/components/engagement/EngagementLayer.tsx:265-300`

### Suposições registradas

- Datas do Bubble sem fuso declarado: tratadas como **America/Sao_Paulo**.
- `gameficacaos.Status*` são **contagens de eventos** (não pontos) — confirmado por reconciliação em 622 de 629 linhas com `gameMes`; as 7 divergências são todas de `Agosto 2026`, temporada cujos pesos mudaram no meio do ciclo.
- As 434 linhas de `gameficacaos` **sem `gameMes`** usam outra escala e não foram consideradas conversíveis.
