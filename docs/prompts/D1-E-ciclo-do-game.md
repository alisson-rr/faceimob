# Tarefa E — Migration 0032: o mês-base do negócio segue o ciclo do game (+ link da notificação)

> Contexto do agente: **limpo**. Meia sessão. Exige Docker (`./scripts/validate-schema.sh --all`) e a CLI do Supabase linkada (feito uma vez nesta máquina pela Tarefa C). **Decisão aprovada pelo usuário em 25/08** — pode rodar. As Tarefas D, F e I podem estar rodando em paralelo neste diretório: respeite a lista de arquivos.

## Decisão a implementar (cliente, 21/08/2026)
O "mês" da gamificação **não é mês de calendário**: começa quando o admin abre o game e termina quando fecha (ex.: 02/07 → 05/08). A ata de 14/07 já dizia que o fechamento de mês e de jogo "não dependa do calendário tradicional" e que propostas só mudam de mês quando o admin valida o encerramento.

Hoje o banco tem dois conceitos: `game_seasons` (período livre — já correto) e `deals.month_base` (default `month_start(current_date)` — calendário, migration `0006:39`), travado por `closed_months` + `deals_guard_closed_month` (migration `0010:20-53`). Consequência do descasamento: negócio criado em 03/08 com a temporada de julho ainda aberta nasce com mês-base agosto; quando o admin fecha o ciclo "julho" em 05/08, esse negócio fica fora do fechamento e do congelamento.

## Contexto
- Repo: `C:\Users\Alisson\CascadeProjects\FACEIMOB`, branch `nova`. Leia `.claude/CLAUDE.md`, `.claude/rules/database.md`, `supabase/migrations/20260725120900_0010_gamification.sql` (seasons, `close_game_season`, `closed_months`), `20260808140000_0021_close_month_rpc.sql` (`close_month_and_season`), `20260725120500_0006_deals.sql` (`month_base`) e um teste existente em `supabase/tests/` como modelo.
- **Só edite:** `supabase/migrations/20260821120000_0032_*.sql` (novo), `supabase/tests/` (novo arquivo), `supabase/config.toml`, `supabase/README.md` (tabela de estrutura), `docs/sprints/decisoes.md` (uma linha). Nada em `src/`, `supabase/seeds/`, `scripts/`. Não edite migration já aplicada. Não commite.

## Entregas
1. **Mês-base segue a temporada aberta.** Trigger `before insert` em `deals` (security definer, como as demais) que, quando `month_base` vier com o valor default (ou nulo), grava `month_start(period_start)` da temporada aberta (`current_game_season()` → `game_seasons.period_start`); sem temporada aberta, mantém o calendário. Não altere `month_base` de negócios existentes. Atualize o comentário da coluna.
2. **`close_game_season` sem efeito colateral de mês.** O parâmetro `p_close_month` passa a ser ignorado (ou a função lança se `true`), porque o único ponto que trava mês é `close_month_and_season` — a tela de Gamificação passa a usá-lo (agente B). Mantenha a assinatura para não quebrar `grant`/tipos gerados.
3. **`close_month_and_season` com período padrão = mês da temporada aberta** (hoje `coalesce(p_period, current_date)`): sem `p_period`, usar `month_start(period_start)` da temporada aberta; sem temporada, calendário. O Pipeline continua podendo passar `p_period`.
4. **F01 — link da notificação.** `notify_lead_assigned` (migration `0011:207`) grava `link = '/leads/' || lead_id`; a rota não existe. Recriar a função gravando `'/leads?lead=' || lead_id`. **Antes, confira `docs/prompts/handoff-D.md` (se já existir):** o agente D está implementando a abertura por `?lead=<id>` no front — use o formato exato que ele registrou. Não mexa nas notificações já gravadas.
5. **`[auth] enable_signup = false`** em `supabase/config.toml` (achado S03): o login por senha/código não cria conta; só o admin cria. Anote no handoff que o mesmo ajuste precisa ser feito no painel do projeto remoto.
6. **Teste SQL** `supabase/tests/10_game_cycle.sql`: negócio criado com temporada aberta de outro mês recebe o mês-base da temporada; sem temporada, recebe o calendário; `close_month_and_season()` sem argumento fecha o mês da temporada e move as propostas abertas; `close_game_season(null, true)` não grava em `closed_months`; `notify_lead_assigned` grava o link novo.
7. `supabase/README.md`: linha da `0032` na tabela. `docs/sprints/decisoes.md`: linha em "Registradas" (21/08/2026) com a decisão e onde ficou.

## Critérios de aceite
- `./scripts/validate-schema.sh --all` verde (inclui o teste novo); `npm run typecheck` verde (tipos não mudam de forma; se mudarem, rode `supabase gen types` conforme o README e inclua `src/integrations/supabase/types.ts` — é o único arquivo de `src/` que você pode tocar, e só se gerado).
- Aplicação na homologação: `npx supabase db push` (a homologação é livre — decisão registrada; a Tarefa C já aplicou `0026`–`0031` por lá) e `select * from public.cron_jobs_health();` continua saudável.

## Entrega
Não commite. `docs/prompts/handoff-E.md`: o que a migration faz, o que o usuário precisa fazer no painel (signup off), resultado do harness e do `db push`.
