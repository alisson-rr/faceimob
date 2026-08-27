# Tarefa G — Telas: Check-in + Leads (o coração da roleta)

> Contexto do agente: **limpo**. Uma sessão inteira. As Tarefas A (fundação visual), B (engajamento), C (dados de demo + Vercel), D (correções do corretor), E (ciclo do game), F (Dashboard) e I (endurecimento) já foram entregues. As Tarefas **H e K rodam em paralelo** neste diretório — respeite a lista de arquivos à risca.

## Contexto
- Repo: `C:\Users\Alisson\CascadeProjects\FACEIMOB`, branch `nova`. Leia `.claude/CLAUDE.md`, `.claude/rules/{code-style,typescript}.md`, **`docs/design-system.md`** (sua cartilha visual), **`docs/prompts/handoff-D.md` §4** (o que o D deixou explicitamente para você) e as linhas F12, P14, T13, X03, X04, X06, X07, X08, A06 da tabela em `docs/auditoria-2026-08-21.md`.
- **Você SÓ pode editar:** `src/pages/Leads.tsx`, `src/pages/Checkin.tsx`, `src/components/LeadDetailModal.tsx`, `src/components/LeadFunnel.tsx`, `src/components/LeadCounter.tsx`, `src/components/NewLeadNotifier.tsx`, arquivos **novos** em `src/components/leads/`, e `src/integrations/supabase/{leads,checkin}.ts`.
- **NÃO toque em:** `Pipeline.tsx`, `CcaPipeline.tsx`, `DealDetailModal.tsx`, `PipelineTopRanking.tsx`, `newSchema.ts` (agente H) · `DailyReport.tsx`, `supabase/**` (agente K) · `components/{dashboard,engagement,shared}/**`, `index.css`, `tailwind.config.ts`, `App.tsx`, `package.json`.
- Sem hex e sem paleta literal do Tailwind — só token. O kit é `@/components/shared`; formatação é `@/lib/format`; erro é `describeError` de `@/lib/supabaseError`.

## Regra que não pode ser quebrada
**Não adicione `celebrate()` nesta tela.** `EngagementLayer` já dispara `checkin` (INSERT em `checkins`) e `lead_claimed` (INSERT em `lead_events` com `kind='claimed'`) por realtime, filtrados pelo próprio perfil. Uma chamada direta faria o som tocar duas vezes. Se quiser o nome do lead no toast, siga a instrução do `handoff-B` e **avise no handoff** para o gatilho de realtime sair junto — nunca os dois.

## Entregas
1. **Decomposição do `Leads.tsx` (932 linhas).** Vira composição de componentes **novos** em `src/components/leads/` (ex.: `LeadsTable`, `LeadFilters`, `LeadImportDialog`, `ConvertLeadDialog`, `LeadsSummary`), com barril `index.ts`. Nenhum arquivo acima de ~250 linhas, props tipadas.
2. **Dados por `useQuery`.** Todo carregamento vira TanStack Query com chaves estáveis (`["leads", ...]`, `["checkin", ...]`); some `useEffect`+`useState` de carga. Loading = `LoadingState`, erro = mensagem pt-BR com "Tentar de novo", vazio = `EmptyState` com saída. O `defaultOptions` do QueryClient já tem `staleTime: 60_000` (Tarefa F) — não mexa no `App.tsx`.
3. **Abrir o lead pela lista** (o D deixou pronto o caminho do sino, faltou o da tabela): a célula do cliente vira `<button>` que abre o `LeadDetailModal` — resolve X06 e é o ganho mais visível da tela. **Preserve o contrato do sino:** `searchParams.get("lead")` → abre o modal → consome o parâmetro.
4. **Check-in: fila e contadores.**
   - F12 — o canal só aparece depois de `checkins`, e a aprovação do gerente/CCA não aparece sem F5. Invalide a query certa (ou assine o realtime da tabela) para a tela acompanhar sem recarregar.
   - `LeadCounter` **recebe `counts` por prop** desde o D (`getLeadCounts`): foi assim que o número parou de divergir. Não volte a buscar dentro dele.
   - `Checkin.tsx:155` ainda usa `border-amber-500/40 bg-amber-500/10 text-amber-600` — é `warning` no token novo (o D deixou de propósito para você).
5. **Kit e tipografia.** `PageHeader` (um só `<h1>`), `SectionCard` nos blocos, `StatusBadge` nos estados, `KpiCard` se houver régua de número. X07: piso de 12 px (some com `text-[8px]/[9px]`), nada de `text-white/40`. X08: `grid-cols-*` de modal e card ganham breakpoint (a 375 px hoje dá ~100 px por coluna). T13: `<button>` cru ganha `focus-visible`.
6. **`LeadDetailModal`.** X04 — cada `Field` com `useId` + `htmlFor` (o `<label>` hoje não aponta para nada). X03 — `aria-label` nos `size="icon"`, incluindo o fechar. As 7 abas já foram arrumadas pelo D (F16): confira, não refaça.
7. **Importação (`LeadImportDialog`).** O D separou `csvRows` de `csvPreview` (F03): a importação já não para em 10 linhas — **preserve isso**. P14: o dropzone que só emite toast ou passa a funcionar, ou sai da tela junto com a instrução que aponta para o lugar errado. Mostre quantas linhas serão importadas antes de confirmar.
8. **A05 — erro em pt-BR.** `describeError` nos toasts destes arquivos. Regra ao adotar: se o erro vier de função que faz `throw new Error(error.message)`, troque por `dbError(label, error)` na função primeiro, senão o `code` se perde e tudo cai no fallback.

## Fora de escopo (anote no handoff, não faça)
- `A06` — `convertLeadToDeal`/`pickDeveloper` duplicados entre `Leads.tsx` e `Pipeline.tsx`. **Você é o dono da versão nova:** extraia para `src/components/leads/ConvertLeadDialog.tsx` e deixe registrado no handoff que o Pipeline (agente H) adota depois. Não edite o `Pipeline.tsx` para isso.
- `S06` — `xlsx` 0.18.5 tem CVE conhecido e parseia planilha de terceiros. Trocar a dependência mexe no `package.json` e colide com os outros agentes: **só registre no handoff**.

## Critérios de aceite
- `npm run typecheck` · `npm run lint` (0 erros, ≤7 avisos pré-existentes) · `npx vitest run` · `npm run build` verdes.
- Zero `useEffect` de carregamento e zero "Carregando..." em texto nos seus arquivos; zero hex e zero paleta literal.
- Capturas (Playwright) em `docs/design-system/leads-*.png` e `docs/design-system/checkin-*.png`: 1280 px e 375 px, tema claro e escuro.
- **Republicar a URL do cliente:** `npm run build` + `npx vercel deploy --prod --yes` (CLI já logada; comandos em `docs/prompts/handoff-C.md` §6). Se o H ou o K publicarem no meio, republique ao final — o último build ganha. Confira o hash: `curl -s https://faceimob.vercel.app/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'` tem que bater com o do `dist/index.html`.

## Entrega
Não commite. Escreva `docs/prompts/handoff-G.md`: componentes novos e onde vivem, o que mudou de interação, o que ficou de fora e por quê, arquivos tocados, resultado das validações e do deploy. Atualize a linha da Tarefa G em `docs/sprints/sprint-demo.md`.
