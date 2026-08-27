# Handoff E — Migration 0032: o mês-base do negócio segue o ciclo do game

26/08/2026 · branch `nova` · **nada commitado**.
Aplicada na homologação (`mcmqgxvtwegtptfseqvw`). Nenhum arquivo de `src/` foi tocado.

---

## 1. O que a migration faz

`supabase/migrations/20260821120000_0032_game_cycle_month.sql`

O banco tinha dois conceitos de "mês" e só um deles obedecia à ata de 14/07:
`game_seasons` já era período livre (02/07 → 05/08), mas `deals.month_base`
nascia de `month_start(current_date)` (`0006:39`) — calendário puro. Negócio
criado em 03/08 com a temporada de julho ainda aberta nascia em **agosto**;
quando o admin encerrasse o ciclo "julho" em 05/08, ele ficava fora do
fechamento e do congelamento do período a que pertence.

### 1.1 `current_season_month()` — a fonte única

```sql
select public.month_start(gs.period_start)
from public.game_seasons gs
where gs.id = public.current_game_season();
```

`NULL` quando não há temporada aberta — e aí vale o calendário. Existe porque a
regra passou a ter dois leitores (o trigger e `close_month_and_season`); deixar a
mesma consulta duplicada nos dois seria a próxima divergência.
`revoke ... from public, anon` + `grant execute to authenticated, service_role`
(o tripwire de `tests/06_anon_surface.sql` reprovaria sem isso).

### 1.2 Trigger `deals_default_month_base` (BEFORE INSERT, security definer)

```sql
if new.month_base is null or new.month_base = public.month_start(current_date) then
  new.month_base := coalesce(current_season_month(), new.month_base, month_start(current_date));
end if;
```

- **Só substitui o valor que veio do default da coluna.** Mês-base digitado
  (importação, correção do admin, proposta movida pelo fechamento) continua como
  está. O teste cobre os dois lados.
- **Sem temporada aberta, cai no calendário** — o `coalesce` garante que a coluna
  nunca fica nula, mesmo com `month_base => null` explícito no INSERT.
- **Negócio existente não é reescrito.** Mês fechado é histórico; reescrevê-lo
  mudaria relatório já entregue, que é exatamente o que `closed_months` existe
  para impedir.
- **O nome do trigger importa.** Na mesma fase (BEFORE INSERT) o Postgres dispara
  em ordem alfabética, e `deals_default_month_base` < `deals_guard_closed_month`:
  o guard precisa julgar o mês que a linha vai realmente ter, não o do relógio.
  Confirmado no remoto por `pg_trigger`.
- Comentário da coluna `deals.month_base` atualizado.

### 1.3 `close_game_season` não trava mais mês

`p_close_month` **fica na assinatura** (grants e tipos gerados dependem dela) mas
não tem mais efeito, e o default virou `false` para a assinatura contar a mesma
história. Gravar `month_start(current_date)` em `closed_months` era errado por
dois motivos: é o mês do relógio (quase nunca o do ciclo) e não migrava proposta
nenhuma. Ponto único de fechamento contábil é `close_month_and_season`.

Nenhum chamador quebra: `game.ts:141` já passa `p_close_month: false` e a tela de
Gamificação já usa `closeMonthAndSeason` (agente B, entregue).

> **Correção adjacente, no mesmo `create or replace`:** `period_end = current_date`
> virou `greatest(v_season.period_start, current_date)`. A própria função abre a
> temporada seguinte em `current_date + 1`; encerrá-la no mesmo dia dava
> `period_end < period_start` e o check `game_seasons_period` derrubava a
> transação inteira com erro cru do Postgres. Foi o teste novo que esbarrou nisso.
> Dois fechamentos no mesmo dia são caminho real (corrigir o mês, refazer a demo).

### 1.4 `close_month_and_season()` sem argumento fecha o mês do ciclo

`coalesce(p_period, current_date)` → `coalesce(p_period, current_season_month(), current_date)`.
Chamada sem período em 05/08, com o ciclo de julho aberto, fechava agosto e
deixava julho aberto para sempre. O Pipeline continua podendo passar `p_period`.

### 1.5 F01 — link da notificação

`notify_lead_assigned` (`0011:207` e `0011:218`) gravava `'/leads/' || lead_id`,
que não é rota do app: quem clicava no sino caía no 404. Agora
`'/leads?lead=' || lead_id`, nos dois canais (in-app e whatsapp) — **o formato
exato registrado pelo agente D** em `handoff-D.md` §1 (`Leads.tsx` lê
`searchParams.get("lead")`, abre o `LeadDetailModal` e consome o parâmetro).

Notificações já gravadas não foram tocadas: `resolveLink`, no `NotificationBell`,
segue reescrevendo as antigas e vira no-op para as novas. Ele pode ser removido
num segundo passo, quando não houver mais notificação antiga em circulação.

---

## 2. O que o usuário precisa fazer no painel do projeto remoto

**Desligar o cadastro público (achado S03).** `supabase/config.toml` ganhou:

```toml
[auth]
enable_signup = false
```

Isso vale para o stack local. **No remoto é manual**, em
*Authentication → Sign In / Providers → "Allow new users to sign up"* (ou
`supabase config push`).

Por que importa: nenhum caminho da aplicação cria conta — o login por senha usa
`signInWithPassword` e o por código usa `signInWithOtp` com
`shouldCreateUser: false`; quem entra na empresa é provisionado pelo admin
(`provision-broker-user`). Com o signup aberto, qualquer um com o endereço do
projeto e a chave publicável — que vai no bundle do navegador — criava um usuário
`authenticated`, e é esse papel que abre a superfície inteira do PostgREST.
Usuário existente continua entrando normalmente pelos dois caminhos; o que fica
bloqueado é a criação.

Continua valendo a lista de pendências operacionais de `decisoes.md` (template de
e-mail, SMTP do Brevo, `META_APP_SECRET`).

---

## 3. Resultado do harness

`./scripts/validate-schema.sh --all` — **verde** (exit 0), incluindo o arquivo novo
`supabase/tests/16_game_cycle.sql`:

```
  -- 16_game_cycle.sql
== 1. mês-base segue a temporada aberta ==
  ok  negócio novo nasce no mês do ciclo aberto (2026-07-01), não no do calendário (2026-08-01)
  ok  mês-base informado explicitamente não é sobrescrito
== 2. close_month_and_season() sem argumento fecha o mês do ciclo ==
  ok  há proposta aberta no mês do ciclo para migrar
  ok  sem p_period, fecha o mês do ciclo (2026-07-01)
  ok  o mês do ciclo entra em closed_months
  ok  as 1 propostas abertas migraram
  ok  nenhuma proposta aberta sobra no mês fechado
  ok  a temporada seguinte abriu na mesma transação
== 3. sem temporada aberta, vale o calendário ==
  ok  current_season_month() é nulo com o jogo parado
  ok  sem temporada aberta o negócio cai no mês do calendário
== 4. close_game_season não trava mês ==
  ok  close_game_season(null, true) não grava em closed_months
== 5. link da notificação de lead (F01) ==
  ok  notify_lead_assigned grava /leads?lead=<id> nos dois canais
  ok  a rota inexistente /leads/<id> não é mais gravada

58 tabelas · 1 view · 88 funções · 123 policies · 13 enums   (eram 86 funções)
todas com RLS
```

`npm run typecheck` — verde (os 3 projects).

**O nome do arquivo de teste é `16_`, não `10_`** como o prompt pedia: `10_` já é
`10_public_daily_flows.sql`. `16_` segue a numeração real e mantém a ordem de
execução do harness.

---

## 4. Aplicação na homologação

**`npx supabase db push` não roda neste projeto** — e não é culpa da 0032:

```
LegacyDbPushMissingLocalError: Remote migration versions not found in local migrations directory.
  20260808130020 20260808175354 20260808180112 20260808181218 20260808192416 20260810131149 20260810131159
```

São as 0019–0025, aplicadas no remoto por fora (o histórico registrou o timestamp
da execução, não o do arquivo). A CLI só destrava com
`supabase migration repair --status reverted <as 7 versões>`, que **apaga essas
linhas do histórico do remoto** — mudança de estado compartilhado que não cabia
nesta tarefa decidir. Fica como item para você.

Caminho usado no lugar: `apply_migration` (MCP do Supabase) com o SQL idêntico ao
do arquivo, e a versão do histórico corrigida para `20260821120000` — o mesmo
formato das 0026–0031, para que um `db push` futuro não tente reaplicar.

### Verificado no remoto depois de aplicar

| O quê | Resultado |
|---|---|
| `select * from public.cron_jobs_health()` | 6 jobs `faceimob-*`, **0 falhas em 24h**; `notify-dispatch` pausado (decisão de 05/08). *A RPC devolve vazio pela conexão do MCP porque a checagem de papel está no `WHERE` e não há `auth.uid()` — a conferência foi feita direto em `cron.job`/`cron.job_run_details`.* |
| `current_season_month()` / `deals_default_month_base()` | existem (as 2 funções novas) |
| ordem BEFORE INSERT em `deals` | `deals_default_month_base` antes de `deals_guard_closed_month` ✅ |
| `notify_lead_assigned` | contém `/leads?lead=`, não contém `/leads/` |
| `has_function_privilege('anon', 'current_season_month()')` | `false` |
| comportamento ponta a ponta | ciclo forjado em 02/07 + INSERT em `deals` → `month_base = 2026-07-01` com o calendário em agosto. Rodado dentro de um bloco `do` encerrado por `raise`, **desfeito por completo**: 0 temporadas `SMOKE`, 0 negócios, "Agosto 2026" intacta. |

**Estado atual da homologação:** temporada aberta `Agosto 2026 (2026-08-01)`,
último mês fechado `2026-06-01`. Como o ciclo aberto começa no dia 1º de agosto,
o mês do ciclo é igual ao do calendário **hoje** — a diferença de comportamento só
aparece quando um ciclo atravessar a virada do mês. Para demonstrar ao cliente,
abra um ciclo com `period_start` no mês anterior e crie um negócio.

---

## 5. O que ficou de fora, e por quê

- **`src/integrations/supabase/types.ts` não foi regenerado.** A 0032 só
  acrescentaria uma linha (`current_season_month: { Args: never; Returns: string }`);
  nenhuma tela chama a função e o typecheck passa sem ela. Mas
  `supabase gen types --linked` com a CLI 2.110 devolve **55 linhas de diff** que
  não são desta tarefa: `PostgrestVersion` 14.5 → 14.17, as FKs da `0028`,
  reordenação de chaves e — o que pesou — a perda de `| null` em
  `visible_game_ranking` e `import_remarketing_list` (mudança do gerador, não do
  banco). Regenerar agora arrastaria isso para dentro do trabalho dos agentes que
  estão em `src/`. É tarefa própria, junto de uma varredura de quem consome esses
  campos.
- **`supabase migration repair`** (seção 4) — precisa da sua decisão.
- **Tabela de estrutura do `supabase/README.md`**: recebeu a linha da `0032`, mas
  ela **pula da `0014` para a `0032`** — as `0015`–`0031` nunca foram
  acrescentadas. Não era escopo daqui e mexer nelas colidiria com outras tarefas.
- **`resolveLink` no `NotificationBell`** continua onde está, de propósito: ainda
  há notificação antiga gravada na homologação.

---

## 6. Arquivos tocados

| Arquivo | O quê |
|---|---|
| `supabase/migrations/20260821120000_0032_game_cycle_month.sql` | **novo** |
| `supabase/tests/16_game_cycle.sql` | **novo** — 13 asserts |
| `supabase/config.toml` | `[auth] enable_signup = false` |
| `supabase/README.md` | linha da `0032` na tabela de estrutura |
| `docs/sprints/decisoes.md` | uma linha em "Registradas" (21/08) |
| `docs/prompts/handoff-E.md` | este arquivo |

Nada em `src/`, `supabase/seeds/`, `scripts/`. Nenhuma migration já aplicada foi
editada. Nenhum commit.
