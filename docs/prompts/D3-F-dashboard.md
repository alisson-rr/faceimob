# Tarefa F — Tela: Dashboard (redesenho com o kit + dados por useQuery)

> Contexto do agente: **limpo**. Cabe em uma sessão. Tarefas A (fundação), B (engajamento) e C (dados de demo + deploy em https://faceimob.vercel.app) já entregues. A Tarefa D roda **em paralelo** neste diretório — respeite a lista de arquivos abaixo à risca.

## Contexto
- Repo: `C:\Users\Alisson\CascadeProjects\FACEIMOB`, branch `nova`. Leia `.claude/CLAUDE.md`, `.claude/rules/{code-style,typescript}.md`, **`docs/design-system.md`** (tokens e kit — é a sua cartilha visual) e as linhas T04, T05, T06, T07, T08, T09, A01, A03, P06 da tabela em `docs/auditoria-2026-08-21.md`.
- **Você SÓ pode editar:** `src/pages/Dashboard.tsx`, `src/pages/DirectorDashboard.tsx`, `src/pages/DashboardSwitcher.tsx`, `src/components/ComparativeFunnel.tsx`, arquivos **novos** em `src/components/dashboard/` e `src/lib/{tone,metrics}.ts` — e, **só para os `defaultOptions` do QueryClient**, `src/App.tsx` (achado A03: `{ queries: { staleTime: 60_000, retry: 1 } }`; nada mais no arquivo). **NÃO toque** em: `Leads.tsx`, `Checkin.tsx`, `LeadDetailModal.tsx`, `LeadFunnel.tsx`, `NotificationBell.tsx`, `LeadCounter.tsx`, `AuthContext.tsx`, `Settings.tsx`, `leads.ts`, `checkin.ts`, `dealStatus.ts` (agente D, em execução), nem em `Pipeline.tsx`, `Gamification.tsx`, `Marketing.tsx`, `engagement/**`, `supabase/**`, `scripts/**`, `package.json`.
- Sem cor hex e sem paleta literal do Tailwind — só tokens (`docs/design-system.md`). Se `src/lib/supabaseError.ts` já existir quando você começar (é do D), use `describeError` nos erros; senão, mensagem própria em pt-BR e anote no handoff.
- Dica do handoff-B: se o dev server quebrar com "Invalid hook call / more than one copy of React" após dependência nova otimizada, `rm -rf node_modules/.vite` e reinicie.

## Objetivo
O Dashboard é a primeira tela que o cliente vê depois do login. Ele sai de um componente de 918 linhas com `useEffect` e vira a vitrine do design system: KPIs com fonte display, gráficos com os tokens `chart-1..5`, skeletons, estados vazios com orientação — com os dados de demo que já estão na homologação.

## Entregas
1. **Decomposição.** `Dashboard.tsx` vira composição de componentes em `src/components/dashboard/` (ex.: `KpiRow`, `DeveloperOverview`, `SalesFunnelCard`, `GoalCard`, `TopBrokers`) — nenhum arquivo acima de ~250 linhas, props tipadas. `DashboardSwitcher` decide por `roles.includes('director')` (papel é N:N — nunca `role === 'director'`).
2. **Dados por `useQuery`.** Todo carregamento vira TanStack Query com chaves estáveis (`["dashboard", ...]`); some o padrão `useEffect`+`useState`. Loading = `LoadingState` (skeleton com a forma do conteúdo), erro = mensagem pt-BR com botão "Tentar de novo", vazio = `EmptyState` com orientação. Sem estado de corrida no filtro de mês.
3. **Kit e tipografia.** `PageHeader` (único `<h1>`), `KpiCard` para a régua de indicadores (valores com `brl`/`num` de `src/lib/format.ts`, delta com cor semântica), `SectionCard` nos blocos. Corrigir T04 (o `min-h-screen` + padding duplo dentro do main), T08 (piso de 12 px, escala de título única) e T09 (raios e sombras fora do padrão).
4. **Gráficos com a paleta do tema.** Recharts com `chart-1..5`, eixos/grid em `hsl(var(--border))`, texto em `hsl(var(--muted-foreground))`, tooltip com fundo `popover` — legível nos dois temas. `ComparativeFunnel` entra no mesmo padrão; extraia o `METRICS` duplicado para `src/lib/metrics.ts` (T07 — Checkpoint/DailyReport adotam depois, não os edite).
5. **Cores por entidade e pódio.** `src/lib/tone.ts` com `developerColor(name)` determinística sobre `chart-1..5` (T05: hoje MRV é verde numa tela e âmbar noutra). O bloco de top corretores usa os tokens `gold/silver/bronze` — se o dado for o mesmo do `Podium` de `@/components/engagement`, reuse o componente em vez de recriar (T06).
6. **Meta global.** O card de meta lê `goals` (`scope='global'`, `metric='sales'` — a demo semeou 14): mostre progresso realizado × meta com barra/gauge tokenizado; sem a linha no banco, `EmptyState` explicando como cadastrar (SQL por enquanto), nunca "—" seco.
7. **`DirectorDashboard`** no mesmo padrão (kit, useQuery, tokens); atenção ao P06 se exibir diretoria do gerente (`teams.director_id` via `teams.manager_id`, não `team_members`).

## Critérios de aceite
- `npm run typecheck` · `npm run lint` (0 erros, ≤7 avisos pré-existentes) · `npx vitest run` · `npm run build` verdes.
- Zero `useEffect` de carregamento e zero "Carregando..." em texto nos seus arquivos; zero hex/paleta literal.
- Capturas (Playwright) em `docs/design-system/dashboard-*.png`: 1280 px e 375 px, claro e escuro, com os dados da homologação (logue com o usuário de teste se disponível; senão use os dados que o RLS devolver e anote).
- Republicar a URL do cliente: `npm run build` + `npx vercel deploy --prod --yes` (CLI já logada; ver `docs/prompts/handoff-C.md` §6). Se o D tiver republicado no meio do caminho, republique de novo ao final — o último build ganha.

## Entrega
Não commite. Escreva `docs/prompts/handoff-F.md`: componentes novos e onde vivem, decisões de layout, o que ficou de fora, arquivos tocados. Atualize a linha da Tarefa F em `docs/sprints/sprint-demo.md`.
