# Auditoria consolidada — FACEIMOB

Data: 21/08/2026 · Fonte: 8 auditorias independentes (arquitetura, design system, fluxo do corretor, fluxos de gestão, docs, gamificação, a11y, segurança), deduplicadas e rankeadas.
Evidência é de leitura estática de código; nada foi renderizado nem executado contra o banco remoto.

## 1. Placar

| Severidade | Qtd |
|---|---|
| Crítica | 3 |
| Alta | 31 |
| Média | 52 |
| Baixa | 21 |
| **Total (após dedupe)** | **107** |

Antes da dedupe havia 122 achados; 15 eram o mesmo problema visto por lentes diferentes (modo claro, conversão de lead, erro cru do Postgres, abas do LeadDetailModal, verify token do Meta, preview de papel, reduced-motion, PLANEJAMENTO desatualizado, "Novo Lead" do Pipeline, cores fixas do game).

## 2. Os 10 que mais importam

| # | ID | Por quê | Esforço |
|---|---|---|---|
| 1 | T01 | Tokens `success`/`warning` não existem no Tailwind: ~40 classes mortas e o botão "Converter em Negócio" fica transparente | 4 linhas |
| 2 | T02 | `body { background-color:#0a090b }` fixo depois do `@apply`: modo claro tem fundo preto com texto navy em todas as telas | 1 linha |
| 3 | G01 | "Fechar Gameficação" grava o mês corrente em `closed_months` e trava todo negócio do mês para não-admin, sem migrar propostas | 1 argumento |
| 4 | S01 | `sdr-agent-chat` roda com service_role sem autenticar o chamador; a anon key pública basta para queimar OpenAI e ler conversas de leads | ~20 linhas (copiar de `sdr-whatsapp-broadcast`) |
| 5 | S02 | Link público do diretor nasce sem PIN e com slug = nome: funil e vendas da diretoria abertos a anônimo | slug aleatório + `set_public_link_pin` |
| 6 | F02 | "Novo Lead" do Pipeline insere direto em `leads`: corretor leva erro de RLS; gestor grava `queued` e o corretor escolhido é ignorado pela roleta | trocar por `createLead`/`reassignLead` + gate |
| 7 | F05 | "17. DISTRATO"/"18. QUEDA" na tabela não marcam perdido (o modal marca): negócio segue somando VGV e ranking | 1 regex em `normalizeStatus` |
| 8 | F06 | Corretor/gerente do negócio identificados por nome: homônimos colidem e o rateio de VGV cai sempre no primeiro `find` | usar `id` no formulário |
| 9 | P03/P04 | BrokerEditModal exibe gerente/diretor/CPF/CRECI e só persiste nome/e-mail/telefone; trocar a função adiciona papel sem remover o anterior | reduzir formulário + tratar `user_roles` como conjunto |
| 10 | F01 | Notificação "lead atribuído" leva a `/leads/<id>`, rota que não existe: 404 em inglês no clique mais importante do corretor | migration de 1 linha ou normalização no `openItem` |

## 3. Temas e intervenções de causa raiz

### 3.1 Tema e design system (T01–T15)
Raiz: metade do design system não foi ligada (tokens no CSS sem espelho no Tailwind, body sobrescrevendo o token) e as telas foram escritas para fundo escuro com cores literais.

1. `tailwind.config.ts`: expor `success`, `warning` (já existem no CSS) e criar `--info`, `--chart-1..5`, `--gold/--silver/--bronze` com versão `.light`. Resolve T01, dá base para T03, T05, T06, T07.
2. `index.css:90`: apagar `background-color:#0a090b`; `main` do AppLayout (ou `SidebarInset`) com `bg-background`. Resolve T02 e metade de A02.
3. Substituição mecânica nas telas: `emerald/green→success`, `amber/yellow→warning`, `rose/red→destructive`, `cyan/sky/blue→info`, `text-white/40→text-muted-foreground`, `bg-white/[.02] border-white/10→bg-card border-border`. Dashboard concentra tudo em 2 constantes (`panel`, `headerCell`). Resolve T03, T04, cores fixas do game.
4. Três helpers em `src/lib`: `tone(kind)`, `podiumTone(rank)`, `developerColor(name)`; `METRICS` num módulo só. Resolve T05, T06, T07, T14 (CcaPipeline passa a persistir chave semântica + 1 UPDATE de migração).
5. Utilities em `index.css`: trocar `hsl(217 91% 60%)` por `hsl(var(--primary)/.35)` etc. (8 linhas); apagar `@import` do Google Fonts, `.font-display`, `.text-display-*`, `.ring-soft`, `.hover-lift`, `.gradient-accent`, `.gradient-warm`, variants `hero/heroOutline` e cor `hero`. Resolve T11, T13 (parte), T15.
6. Convenções curtas (sem tooling): h1 = `text-2xl font-bold`; rótulo = `.text-eyebrow`; piso 12px; ícones h-3.5/h-4/h-5; `rounded-sm/md/lg/full`; `glass` só em superfícies sobrepostas; `glow-primary` só no item ativo da sidebar. Resolve T08, T09, T10, T12 ao longo das migrações de tela.

### 3.2 Arquitetura e decomposição do frontend (A01–A11)
Raiz: "uma página = um componente que faz tudo", sem primitivos compartilhados nem camada de dados; cada tela reinventou erro, loading, formatação e fetch.

1. `QueryClient` com `defaultOptions { staleTime: 60_000, retry: 1 }`; `usePeople()` substituindo os 7 chamadores de `listPeople()`; migrar `useEffect+useState` para `useQuery` tela a tela (padrão já existe em Dashboard). Resolve A03 e destrava A01/A04.
2. `src/lib/supabaseError.ts` com `describeError(e, fallback)` mapeando `code` (23505, 42501, 23503, 22P02, P0001) para pt-BR; regra "toda chamada destrutura `{data,error}` e lança". Resolve A04, A05 (30–45 toasts) e o achado de segurança de vazamento de schema.
3. `src/components/app/PageState` (loading/error/empty com retry) + `PageHeader` + `KpiCard`; remover `pageTitles` do AppLayout. Resolve A01, A08, A09.
4. `src/features/leads/components/ConvertLeadDialog.tsx` único (dono do estado, upload e toast). Resolve A06 e F07.
5. `src/lib/format.ts` (`brl`, `date`, `dateTime`) substituindo 15 definições. Resolve A07.
6. Quebrar `Pipeline.tsx` em `DealFilters`, `DealsTable`, `DealsKanban`, `CheckinQueueBar`, `CloseMonthDialog`; usar `DealDetailModal` também para criação. Resolve A02. Um único `AppRole` em `src/types/auth.ts`; remover `monthly_sales/monthly_vgv` de `Broker`; apagar `CredLine`/senha morta em Equipes. Resolve A10, A11.

### 3.3 Fluxos quebrados do corretor (F01–F16)
Raiz: o Pipeline carrega uma camada legada (insert direto em `leads`, 34 status em string, rótulos hard-coded) que discorda de Leads, do modal e do banco; navegação pós-evento aponta para rota/aba errada.

1. `normalizeStatus`: `s.replace(/^\d+\.\s*/, "")` antes de comparar + caso de teste. Resolve F05 em tabela, modal e `saveLegacyDeal` de uma vez.
2. Pipeline deixa de chamar `.from("leads")`: botão "Novo Lead" só para `GESTOR_ROLES`; salvar via `createLead({source_id})` e, se escolher corretor, `reassignLead`. Resolve F02 (os dois sub-achados).
3. Formulário e filtros de negócio por `id` (`broker1_id`…), `nameToId` morre. Resolve F06.
4. Migration corrigindo `notify_lead_assigned` para `link='/leads'`; `NotFound` em pt-BR; `NewLeadNotifier` navega para `/leads` (ou `/pipeline?tab=leads` lido no estado inicial). Resolve F01, F04.
5. `Leads.tsx`: `csvRows` separado de `csvPreview`. Resolve F03.
6. Apagar avisos de documento obrigatório (Leads.tsx:794, comentário 315, LeadDetailModal:383) e alinhar comentário de `convertLeadToDeal`. Resolve F07.
7. Um mapa de rótulo por código de etapa, preferencialmente `pipeline_stages.label` já carregado em `listLegacyDeals`; coluna Status lê `deal.stage`. Resolve F09, F10, F11.
8. `applySession`: `setLoading(true)` antes do `Promise.all`. Resolve F08.
9. Assinar `deals` no mesmo canal realtime do Pipeline. Resolve F12. Confirmação antes do switch "Off". Resolve F14. Contadores de check-in sobre `lead_assignments` + `getCurrentWorkDate()` + `catch` no LeadCounter. Resolve F13. `grid-cols-7`. Resolve F16.

### 3.4 Permissões e fluxos de gestão (P01–P14)
Raiz: o banco já recorta a visibilidade via `auth_visible_profiles()`/RLS, mas as telas aplicam um segundo recorte por `role` primário (mais restrito e ignorando o N:N), e vários formulários exibem campos que não persistem.

1. Confiar no RLS: `inScope` de Equipes vira `true`; `visibleTeams` do Checkpoint inclui `partner` e usa `roles`. Resolve P01, P02.
2. `listPeople()`: `director_id` do gerente vem de `teams.director_id where teams.manager_id = profile.id`, não de `team_members`. Mesmo em `Checkpoint.directorGroups`. Resolve P06.
3. BrokerEditModal: manter só campos que `profiles` tem; `user_roles` tratado como conjunto (delete + insert); incluir `sdr`/`marketing`. Resolve P03, P04.
4. Equipes `load()` lê `goals` (scope profile, metric vgv, período corrente). Resolve P05.
5. Expor `role` efetivo no AuthContext (derivado de `effectiveRoles`) e trocar `role === "admin"` por `isAdmin`/`can()`; banner fixo "pré-visualizando" em todas as larguras. Resolve P07.
6. Espelhar policies na UI: Resultados `canEdit = isAdmin || roles.includes('director')`; Campanhas `…'marketing'`; CcaPipeline `canAct = isAdmin || roles.includes('cca')` e select de `status` no editor de estágio. Resolve P08, P09, P10.
7. Matar o que não persiste ou engana: card "Tempo máx. por etapa" (ou ler/gravar `lead_funnel_stages.max_minutes`), dropzones do DataManagement, `VERIFY_TOKEN` do MetaAdsSetup (mostrar `has_secret` do cofre), botão "Conectar Meta Ads" só com `can('menu.admin_lead_automation')` e via `<Link>`, card com copy de chat. Resolve P11, P12, P13, P14. PublicDirectorCheckpoint: renomear cards para "semana" até a RPC expor mês/visitas/gerente. Resolve P15.

### 3.5 Gamificação e engajamento (G01–G13)
Raiz: dois caminhos para fechar mês com semânticas diferentes; celebração e ranking não compartilham escopo nem canal; som/animação sem preferências.

1. Gamification.tsx:238 → `closeGameSeason(undefined, false)` ou reusar `close_month_and_season` do Pipeline; um único ponto fecha mês. Resolve G01.
2. Opções de temporada indexadas por `season.id`, `isClosed` por `closed_at`. Resolve G02.
3. SaleCelebration: nome via `listRanking(seasonId)` (escopo do ranking) e dedupe por `ref_id` acumulando nomes por ~500 ms. Resolve G03, G04 e dá o filtro de escopo para G05 (decisão a registrar em decisoes.md: loja inteira ou equipe; se equipe, restringir `game_events_select`).
4. O canal `game_events` já aberto dispara `reload` do `useGameRanking` — o `key={s.points}` existente passa a animar. Resolve G07. Aviso "Jogo parado — abra uma temporada" quando `getCurrentSeasonId()` é null. Resolve G06. Rótulo "Campeões por Diretoria — {período}" até existir recorte semanal. Resolve G08.
5. `sound.ts`: `AudioContext` singleton desbloqueado no primeiro `pointerdown`; `localStorage faceimob-sound` como multiplicador de ganho; toggle ao lado do Sun/Moon. Resolve G09, G10. `<MotionConfig reducedMotion="user">` + bloco `@media (prefers-reduced-motion)` global. Resolve G11/A09.
6. Migration: `insert into notifications` no ramo aprovado de `document_review` (espelho do ramo devolvido). Resolve G12. NewLeadNotifier: filtrar por grupos do gestor; substituir `isFresh` por `commit_timestamp`. Resolve G13. Demais gatilhos (esteira/aprovado/claim/checkin/goals) reaproveitam o mesmo canal e toque curto. G14.

### 3.6 Acessibilidade e responsividade (A01–A12 da lente a11y → IDs X01–X12)
Raiz: interações só por mouse (drag, hover), controles sem nome acessível e grids fixos; tudo corrigível no componente compartilhado.

1. Card do kanban: `tabIndex=0 role=button onKeyDown`; liberar o `Select` de etapa do DealDetailModal por permissão (o `onDrop` já valida via `canEnterStage`). Resolve X01. CCA: `group-focus-within:opacity-100` + visível abaixo de `md`, fonte ≥11px, ou um Select "Mover para…". Resolve X02.
2. `aria-label` nos 20 `size="icon"` e 16 `Switch`; `Field` do DealDetailModal com `useId` + `htmlFor`; `<tr>` clicável vira botão na célula do cliente; Badge-toggle vira Switch. Resolve X03–X06.
3. Piso 11px e `text-muted-foreground` sem `/40`; `grid-cols-1 sm:grid-cols-3` nos grids do modal/Checkpoint/pódio. Resolve X07, X08.
4. `index.html`: `lang="pt-BR"`, `theme-color` escuro, `color-scheme`; `sr-only sm:not-sr-only` no h1 do Dashboard; h1 sr-only no Login; `title` nas células truncadas; erro inline com `aria-invalid` no Login. Resolve X09–X12.

### 3.7 Segurança (S01–S11)
Raiz: edge functions com service_role confiam no gateway (que aceita a anon key pública); links públicos nascem sem segredo; dependências/Electron sem validação de origem.

1. Helper em `_shared/` que (a) faz `auth.getUser()` + checa papel (copiar de `sdr-whatsapp-broadcast`) para `sdr-agent-chat`, e (b) exige `role === 'service_role'` no JWT para `notify-dispatch` e `submission-dispatch`. Resolve S01, S04.
2. `public_links`: slug aleatório (`gen_random_uuid()`), PIN obrigatório também para diretor (`regeneratePin` já existe), `failed_attempts/locked_until` dentro de `resolve_public_link`, PIN via `crypto.getRandomValues`. Resolve S02, S05.
3. `[auth] enable_signup = false` no `config.toml` + desligar no painel; remover `insert into user_roles` do trigger `handle_new_auth_user` (admin concede papel). Resolve S03.
4. `npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`; filtrar `extra` para chaves conhecidas. Resolve S06. Electron: `openExternal` só `^https?://`, `will-navigate` bloqueado, meta CSP; validar URL em Links.tsx. Resolve S07.
5. Storage `with check` amarrado ao prefixo do caminho; avatar com `getPublicUrl` (bucket já é legível por autenticado); TTL do dossiê 1–2 h ou anexo base64; remover `build:dev`. Resolve S08–S11.

### 3.8 Documentação (D01–D15)
Raiz: código andou 13 migrations e 4 edge functions à frente dos docs-guia; existem dois "estados atuais" divergentes (PLANEJAMENTO.md e plano-entrega.md) e o plano vivo não é citado.

1. `CLAUDE.md`: 31 migrations (0001–0031), 58 tabelas + `private.integration_credentials`, 9 edge functions ativas + 3 stubs 410, `_shared` = secrets/brevo/meta/sdrAgent, seeds reais (catálogo → 010–040 → 045 → 050, rollback 059), plano ativo = `docs/sprints/plano-100-funcional.md`, Validar inclui `npm run e2e`/`e2e:remote`, Desenvolver inclui `npm run demo*`, typecheck tríplice. Resolve D01, D02, D08, D09.
2. Cabeçalho "histórico, superado por plano-100-funcional.md" em `PLANEJAMENTO.md`, `plano-entrega.md`, `roteiro-teste-completo.md`; `docs/sprints/README.md` vira índice (vivo × histórico + DoD atual). Resolve D03, D07, D13, D15.
3. `supabase/README.md`: tabela Estrutura até 0031, 6 jobs `faceimob-*`, apagar "O que ainda falta". Resolve D04.
4. Remover os 3 diretórios 410 e suas seções em `config.toml`; registrar em decisoes.md. Resolve D05.
5. README raiz reescrito a partir do CLAUDE.md; remover Lovable (`.lovable/plan.md`, `lovable-tagger` se não usado). Resolve D06.
6. Miúdos: `.env.example` (VITE_BYPASS_AUTH, nota de SERVICE_ROLE), comentário `RequirePermission`, `--tests` no teste SQL, `graphify update .`. Resolve D10–D12, D14.

## 4. Tabela de achados

Tema: T=tema/design · A=arquitetura · F=fluxo corretor · P=permissões/gestão · G=gamificação · X=a11y · S=segurança · D=docs.

| ID | Sev | Tema | Arquivo | Evidência resumida |
|---|---|---|---|---|
| T01 | Crítica | Tema | tailwind.config.ts:26-70 · index.css:29-32 · Pipeline.tsx:1233 | `--success/--warning` no CSS, ausentes em `colors`; 0 regras compiladas; twMerge derruba `bg-primary` do botão Converter |
| T02 | Crítica | Tema | index.css:85-91 · AppLayout.tsx:103 | `background-color:#0a090b` após `@apply bg-background`; main sem bg; `SidebarInset` com 0 usos |
| G01 | Crítica | Gamificação | Gamification.tsx:238 · game.ts:133-140 · 0010:284-289 | `closeGameSeason(undefined,true)` insere `closed_months` do mês corrente; trigger `deals_guard_closed_month` bloqueia não-admin; não migra propostas |
| T03 | Alta | Tema | Pipeline.tsx (70) · DailyReport.tsx (60) · Equipes.tsx (39) · Checkpoint.tsx (29) · PipelineTopRanking:45-62 | ~200 literais `-300/-400`, 0 `dark:/light:`; contraste 1,4–2,7:1 sobre branco; pódio prata invisível no claro |
| T04 | Alta | Tema | Dashboard.tsx:71-72,271,319,439,475 | `bg-[#05070A] text-white`, 34 hex, 54 `text-white`; `min-h-screen` + padding duplo dentro do main |
| T05 | Alta | Tema | Dashboard.tsx:21-29 · Pipeline.tsx:54-62 | MRV verde na home e âmbar no kanban; Tenda âmbar vs vermelho; chaves CAIXA ALTA vs Title Case |
| T06 | Alta | Tema | AppLayout:77 · PipelineTopRanking:47-61 · Gamification:116-118 · Dashboard:576-578 | quatro paletas ouro/prata/bronze |
| T07 | Alta | Tema | ComparativeFunnel:35-37 · Checkpoint:243-247 · DailyReport:42-49 · PublicDirectorCheckpoint:15-22 | emerald-300/400/500 para "acima da meta"; erro em rose/red/destructive; `METRICS` copiado 2× |
| A01 | Alta | Arquitetura | Pipeline.tsx:197-209,1007-1011,891-905 | `catch` só toasta; deals=[] vira "Nenhum negócio encontrado"; kanban sem loading/erro; 3 padrões distintos (Leads, Dashboard) |
| F01 | Alta | Fluxo | 0011:207,218 · NotificationBell:64-67 · App.tsx:111,135 · NotFound.tsx:15-17 | `link='/leads/'||lead_id`; só existe `/leads`; NotFound em inglês |
| F02 | Alta | Fluxo | Pipeline.tsx:534-546,747 · 0005:648-650 · 0022:12-38 | botão sem gate + `.from("leads").insert` (policy só gestores); `status:'queued'` + `assigned_to` sobrescrito por `assign_lead`; sem `source_id` |
| F03 | Alta | Fluxo | Leads.tsx:396,417,439 | `csvPreview = rows.slice(0,11)`; `importCSV` usa `csvPreview.slice(1)` — máximo 10 leads |
| F04 | Alta | Fluxo | NewLeadNotifier:137,196 · Pipeline:149 | `navigate("/pipeline")` abre aba `deals` por padrão |
| F05 | Alta | Fluxo | Pipeline.tsx:113-114,592-603 · dealStatus.ts:13-20 · DealDetailModal:33-35 | `normalizeStatus("17. DISTRATO")` = null → etapa mantida, `lost_reason` null; modal sem prefixo move para `lost` |
| F06 | Alta | Fluxo | Pipeline.tsx:1270-1276 · crm.ts:103-106 · newSchema.ts:568-569 | `SelectItem value={b.name}`; `nameToId` usa `find` pelo nome; filtros por nome |
| F07 | Alta | Fluxo | Leads.tsx:315,794 · LeadDetailModal:383 · Pipeline:414,1166 · 0028:141-144 | Leads/modal dizem documento obrigatório; 0028 e Pipeline dizem opcional; Leads nem tem upload |
| P01 | Alta | Permissões | Equipes.tsx:240-251,405,454,511,603 | `inScope=false` para todo papel ≠ admin/director; 0015 dá `menu.equipes` a partner/manager/broker/cca; RLS devolve dados |
| P02 | Alta | Permissões | Checkpoint.tsx:105-112,166 | `visibleTeams` só admin/director/manager; partner tem menu e `can_read_all()` |
| P03 | Alta | Permissões | BrokerEditModal.tsx:80-97,233-292 | `save()` grava só full_name/email/phone/avatar/status; manager_id, director_id, cpf, creci, crachá ficam no useState |
| P04 | Alta | Permissões | BrokerEditModal.tsx:59,90-93,121-125 | `upsert user_roles` sobre PK (profile_id, role) adiciona linha; corretor promovido fica broker+manager; lista omite sdr/marketing |
| P05 | Alta | Permissões | Equipes.tsx:36-37,168-182,411-412 | `load()` não lê `goals`; metas voltam 0; botão Salvar fica disabled |
| P06 | Alta | Permissões | newSchema.ts:113-133 · Equipes.tsx:209,320-323,410 · Checkpoint.tsx:294-312 | `director_id` do gerente derivado de `team_members`, que só o seed cria; diretor nunca "ganha" gerentes pela UI |
| G02 | Alta | Gamificação | Gamification.tsx:170,215-217,256-258,332 · 0010:291-296 | nova temporada começa `current_date+1` no mesmo mês; chave `YYYY-MM` colide → "Mês fechado", botão some |
| G03 | Alta | Gamificação | SaleCelebration.tsx:32-39 · 0002:279-300,432-434 | nome via `profiles` (RLS esconde colegas) → corretor vê "Equipe" |
| G04 | Alta | Gamificação | SaleCelebration.tsx:28-43 · 0010:316-323 | um `game_events` por corretor; dedupe por `id` → 2-3 fanfarras e card trocando nome |
| X01 | Alta | A11y | Pipeline.tsx:915-926,967-970 · DealDetailModal:426 | card `draggable` sem tabIndex/role; Select de etapa `disabled={!isAdmin}`; sem toque |
| X02 | Alta | A11y | CcaPipeline.tsx:299-309 | botões "Mover p/" em `opacity-0 group-hover:opacity-100`, `text-[8px]`; invisíveis em toque/teclado |
| S01 | Alta | Segurança | sdr-agent-chat/index.ts:15-40 · _shared/sdrAgent.ts:62-75 | service_role sem `auth.getUser()`; anon key pública passa no gateway; cria/lê conversa por qualquer id |
| S02 | Alta | Segurança | AdminDailyTeams.tsx:58-69,206 · 0026:34-37,47-108 | insert `director_checkpoint` com slug `diretor-<nome>` sem `set_public_link_pin`; RPC só pede PIN se `pin_hash` existe |
| S03 | Alta | Segurança | Login.tsx:49-52 · 0002:343-372 · config.toml | `shouldCreateUser:false` só no cliente; trigger dá `broker` a toda conta nova; `enable_signup` não fixado no repo |
| D01 | Alta | Docs | .claude/CLAUDE.md:10-11,19 | "18 migrations, 11 edge functions, 4 fases, só leads.ts" vs 31 / 9+3 stubs / 7 seeds / 14 adaptadores / typecheck tríplice |
| D02 | Alta | Docs | .claude/CLAUDE.md:14 · docs/sprints/README.md | plano-entrega.md declarado concluído 02/08; plano-100-funcional.md (10/08) não citado; "decisões pendentes" já resolvidas |
| D03 | Alta | Docs | PLANEJAMENTO.md:4-16,80-82 | "Login em signInWithPassword", "DailyBI.tsx", "12 migrations/70 funções", "white mode ❌", "ranking animado ❌", "mockData fica" — todos contrariados pelo código |
| D04 | Alta | Docs | supabase/README.md:42-61,171-185 | Estrutura para em 0014; "123 policies · 71 funções · 3 jobs"; "O que ainda falta" já feito (cofre, OTP, Brevo) |
| T08 | Média | Tema | Dashboard:282,368,384 · DailyReport:339 · Gamification:305 · index.css:155 | h1 de text-sm a text-4xl; text-[10px]×183, [9px]×41, [8px]×7; `.text-eyebrow` 0 usos |
| T09 | Média | Tema | Dashboard:71,363 · Pipeline:1030 · PipelineTopRanking:54 | `rounded`×40, `rounded-2xl`, 9 `shadow-[…]` rgba fixos fora de `--radius`/`.shadow-elevate` |
| T10 | Média | Tema | Marketing, Leads, DailyReport, Login:163, Checkin:219,230, AppSidebar:103 | `glass` em 9/9 cards numa tela e 0/10 noutra; `glow-primary` = ativo e CTA |
| T11 | Média | Tema | index.css:132-141,161-166,202-205 · tailwind.config.ts:95-96 | `.glow-primary` com `217 91% 60%` vs `--primary 210 100% 66%`; `.glow-success` 49% vs 55%/42%; `.ring-soft` branco |
| T12 | Média | Tema | button.tsx:8 · GamificationAdmin:75,98 · AdminDailyTeams:131 | 5 tamanhos de ícone; `[&_svg]:size-4` do Button sobrescreve `h-3.5`/`h-3` silenciosamente |
| T13 | Média | Tema | Pipeline:710-725,854-857 · NotificationBell:78-118 · Leads:828 · LeadDetailModal:258 · button.tsx:18-19 | 43 `<button>` crus sem focus-visible; duas abas "ativas" diferentes; WhatsApp em 2 verdes; variant `hero` aponta para classes inexistentes |
| T14 | Média | Tema | CcaPipeline.tsx:185,194,257,271,341-346 | persiste `text-amber-400` no banco; classes derivadas em runtime sem safelist |
| A02 | Média | Arquitetura | Pipeline.tsx:146-280,552-577,1240-1300 | 1375 linhas, 44 useState, 26 toasts; diálogo inline + DealDetailModal editam o mesmo registro |
| A03 | Média | Arquitetura | App.tsx:38 · DealHistoryPanel:38 · Pipeline:155-168,215-218 | `useQuery` em 5 de 47 arquivos; `QueryClient` sem defaults; `listPeople()` 7× |
| A04 | Média | Arquitetura | Equipes.tsx:181-193 · AdminDailyTeams · DataManagement · BrokerEditModal | 20 `const { data } = await supabase…` sem `error`; falha vira lista vazia e campo em branco salvável |
| A05 | Média | Arquitetura | Equipes:316,324 · AdminLeadAutomation:118-196 · Links:41,49 · Pipeline:546 · functionError.ts | 30–45 toasts com `error.message` cru (RLS, unique, cast em inglês com nome de tabela); dois estilos de toast |
| A06 | Média | Arquitetura | Pipeline.tsx:370-420 · Leads.tsx:277-322 | `convertForm`, `pickDeveloper`, `convertLeadToDeal` duplicados; Pipeline tem upload, Leads não |
| A07 | Média | Arquitetura | Dashboard:67 · Marketing:43 · Resultados:70 · DataManagement:95 · CampaignPerformancePanel:11 · CcaPipeline:287 · DealHistoryPanel:20 | 6 formatadores BRL (0 vs 2 decimais), `toLocaleString` inline 3×, 5 formatadores de data |
| F08 | Média | Fluxo | AuthContext.tsx:68-81,111-113 · App.tsx:62-74 | `loading` nunca volta a true; `can()` false até `Promise.all` → flash "Acesso não liberado" e sidebar vazia |
| F09 | Média | Fluxo | Pipeline.tsx:1029 | `<span>PROPOSTA {statusDate}</span>` literal para todo deal |
| F10 | Média | Fluxo | Pipeline.tsx:84,94,1041 | "08. VIROU NEGOCIO" ≠ "08. VIROU NEGÓCIO": cor `bg-muted` e Select vazio em `closed` |
| F11 | Média | Fluxo | crm.ts:152-161 · Pipeline:79-88 · DealDetailModal · newSchema (listLegacyDeals) | `DEAL_STAGES` vs `tableStageLabels` divergem; `pipeline_stages.label` nunca lido |
| F12 | Média | Fluxo | Pipeline.tsx:335-342 · Leads.tsx:137-143 | canal só em `checkins`; aprovação do gerente/CCA não aparece sem F5 |
| F13 | Média | Fluxo | Checkin.tsx:176,188-189 · checkin.ts:129-154 · LeadCounter:19-26 · 0005:436-441,564 | badge usa `leads_received` (só `assign_lead`); card conta `lead_assignments` com meia-noite local; `try/finally` sem catch |
| F14 | Média | Fluxo | Pipeline.tsx:580-588,1065 | Switch `scale-75` grava `stage=lost` sem confirmação; tela diz que não reabre |
| F16 | Média | Fluxo/A11y | LeadDetailModal.tsx:294-302 · tabs.tsx:15 | 7 `TabsTrigger` em `grid-cols-6` com `h-10` |
| P07 | Média | Permissões | AuthContext:133-167 · DashboardSwitcher:7 · Equipes:100,122 · Marketing:80 · RoleSwitcher:33-35,75-77 | preview altera só `effectiveRoles`; `role === …` ignora; dados continuam do admin; aviso `hidden sm:inline` |
| P08 | Média | Permissões | Resultados.tsx:36 · CampaignPerformancePanel:30 · seed.sql:163-177 · 0012:330-333 · 0011:443-446 | `reports.view_finance` libera edição a marketing/partner/director; policies aceitam admin/director e admin/marketing |
| P09 | Média | Permissões | CcaPipeline.tsx:255-257,292-313 · 0007:240-262 · 0012:293-296 | sem gate; `cca_*_write` só admin/cca; partner tem `menu.cca` |
| P10 | Média | Permissões | CcaPipeline.tsx:131,146-147,183-196 | estágio criado nasce `under_review`; "Aprovado" customizado não decide nem move |
| P11 | Média | Permissões | Marketing.tsx:140,283-287 · routePermissions.ts:30 | `<a href="/admin/meta-ads">` exige `menu.admin_lead_automation`; card com copy de chat |
| P12 | Média | Permissões/Seg | MetaAdsSetup.tsx:10,45,53 · meta-ads-webhook:115-123 | `VERIFY_TOKEN` fixo na tela vs `getSecret('META_WEBHOOK_VERIFY_TOKEN')`; badge "Webhook ativo" estático |
| P13 | Média | Permissões | AdminLeadAutomation.tsx:56-63,107-120,261-279,135,140,433 | `stage_max_minutes` só no useState (coluna não existe; real é `lead_funnel_stages.max_minutes`); turnos chamados de "grupo" |
| P14 | Média | Permissões | DataManagement.tsx:140-141,154 · Leads.tsx:470 | dropzones só toastam; instrução aponta para tela errada |
| P15 | Média | Permissões | PublicDirectorCheckpoint.tsx:14-23,229,240-252 · 0026 | RPC devolve 7 dias; tela rotula "mês"; `visits_*` não somados; `manager_name` fixo null |
| G05 | Média | Gamificação | SaleCelebration.tsx:46-56 · 0010:407-410 · decisoes.md:159 | celebração global vs ranking por equipe; `game_events_select using(true)` expõe pontos de todos |
| G06 | Média | Gamificação | 0010:194-196 · SaleCelebration:10-13 | sem temporada, `award_game_points` retorna null em silêncio |
| G07 | Média | Gamificação | useGameRanking.ts:46-56 · Gamification:208,410-418 · AppLayout:35,56-58 | fetch único; `key={s.points}` nunca muda; header defasado |
| G08 | Média | Gamificação | Gamification.tsx:265-276,469-471 | "Campeões da Semana" agrupa a temporada inteira; não há recorte semanal no banco |
| G09 | Média | Gamificação | sound.ts:15-43,52,72 | `peakGain` fixo; sem mudo/volume/preferência |
| G10 | Média | Gamificação | sound.ts:8-20,39 | `AudioContext` novo por toque, nasce `suspended`; sem modo TV |
| G11 | Média | Gamif/A11y | MotivationalPopup:40-41 · Gamification:402-403 · SaleCelebration:79-100 · Login:108-122 · index.css:146,202 | 0 ocorrências de `prefers-reduced-motion`/`MotionConfig`; `repeat: Infinity` e `pulse-glow` |
| G12 | Média | Gamificação | 0028:509-518 vs 525-537 | devolução insere `notifications`; aprovação só `deal_history` |
| G13 | Média | Gamificação | NewLeadNotifier.tsx:29-35,103-114 · 0005:625-630 | gestor assina todo INSERT em `leads` sem filtro de grupo; `isFresh` compara com relógio local (20 s) |
| X03 | Média | A11y | DealDetailModal:214 · Pipeline:791,854,857,1059,1074,1076 · Links:84-88 · SdrModule:179,317,527 | 20 `size="icon"` sem aria-label; fechar modal e paginação sem nome |
| X04 | Média | A11y | DealDetailModal:535-541,547,566,225-234 · AdminAllowedIps:100-101 · Equipes:89-90 | `Field` com `<label>` sem `htmlFor` (~30 campos); inputs só com placeholder |
| X05 | Média | A11y | AdminPermissions:172-266 · Pipeline:1065 · AdminLeadAutomation:225-458 · BrokerEditModal:272 | 16 `<Switch>` sem nome acessível |
| X06 | Média | A11y | Pipeline:1025 · SdrModule:168 · AdminAllowedIps:115 · LeadFunnel:276-277 | `<tr onClick>`, `<div onClick>`, `<Badge onClick>`, `<Card onClick>` sem teclado |
| X07 | Média | A11y | Dashboard:72,368,429,731,779 · Pipeline:968 · Checkpoint:239-240 · CcaPipeline:305 | 48 `text-[8px]/[9px]`; `text-white/40` ≈3,7:1; `text-muted-foreground/40` |
| X08 | Média | A11y | DealDetailModal:223,271-290,298-378,490 · Checkpoint:229,420 · Gamification:388 · Marketing:225 | `grid-cols-3/4` sem breakpoint em modais e cards (≈100px por coluna a 375px) |
| S04 | Média | Segurança | notify-dispatch/index.ts:69-75 · submission-dispatch:49-52 | só cliente service_role, sem ler `Authorization`; anon key dispara o worker |
| S05 | Média | Segurança | AdminDailyTeams.tsx:15-16,98 · 0009:156-180 · DailyReport:261 | PIN `Math.random`, slug = nome do gerente, `resolve_public_link` sem lockout; bcrypt por tentativa (DoS de CPU) |
| S06 | Média | Segurança | package-lock.json:8438-8441 · Leads.tsx:388 · SdrModule.tsx:447-457 | xlsx 0.18.5 (CVE-2023-30533, CVE-2024-22363) parseando planilhas de terceiros na thread principal |
| S07 | Média | Segurança | electron/main.cjs:22-25 · index.html:1-41 · Links.tsx:85 · 0011:271-281 | `shell.openExternal(url)` sem validar esquema; sem `will-navigate`; sem CSP; `useful_links.url` livre |
| D05 | Média | Docs | supabase/config.toml:26-33 · functions/daily-team-info, director-weekly, submit-daily-report | stubs 410 ainda publicados com `verify_jwt=false`; decisão de 08/08 já os aposentou |
| D06 | Média | Docs | README.md:1-15,82-108 · .lovable/plan.md · package.json | boilerplate Lovable com `REPLACE_WITH_PROJECT_ID`; plan.md cita tabelas inexistentes; `lovable-tagger` nas devDeps |
| D07 | Média | Docs | docs/sprints/plano-entrega.md:19-27,172-173,444,548-560 | "14 migrations", "13 tabelas sem uso", `ResetPassword.tsx`, `notify-lead-timeout`, "3 jobs" — nada existe assim hoje |
| D08 | Média | Docs | .claude/CLAUDE.md:16-17 · package.json · e2e/README.md | 9 de 23 scripts (`e2e*`, `demo*`, `user:create`) fora de qualquer doc-guia; E2E 134/134 não citado |
| T15 | Baixa | Tema | index.css:1,148-155,162-166,177-178 · useTheme.ts:8-16 · AppSidebar:61 | `@import` Instrument Serif sem uso (falha offline/Electron); 7 utilities mortas; tema aplicado só após montar sidebar (login pisca) |
| A08 | Baixa | Arquitetura/A11y | src/pages/*.tsx · App.tsx:51,97 · skeleton.tsx | 27 "Carregando" em 13 variantes; Skeleton só em ui/sidebar; 54 empty states ad hoc sem ação |
| A09 | Baixa | Arquitetura | AppLayout.tsx:15-28,33,71 · Gamification:305 · Checkin:124 | `pageTitles` cobre 12/27 rotas; `/dashboard` → "Pipeline de Vendas"; 25 h1 com classes diferentes; KPI reimplementado 14× |
| A10 | Baixa | Arquitetura | Equipes.tsx:119-166,219-226 | `CredLine` declarado dentro do componente; `password` sempre null → UI de senha morta (login é OTP) |
| A11 | Baixa | Arquitetura | crm.ts:1,18-25 · AuthContext:12 · newSchema:12 · Pipeline:171-184 · Leads:38 | `UserRole` (3) vs `AppRole` (8) vs `NewAppRole`; `GESTOR_ROLES` sem tipo; `monthly_sales: 0` falso |
| F15 | Baixa | Fluxo | Pipeline.tsx:324,328,758 · QueuePosition:30 · 0005 (distribution_queue) | "Fila: N" conta `listOpenCheckins()` sem grupo/horário/atrasados; Check-in usa `distribution_queue` |
| G14 | Baixa | Gamificação | 0010:344-377 · 0005:474-489 · 0020:196-202 · 0011:69-86 · 0014:89-90 | `esteira/aprovado`, `claimed`, check-in, `goals`, mudança de posição já existem no banco e não geram feedback |
| X10 | Baixa | A11y | Pipeline.tsx:1030,1031,1060-1064 · AppLayout:82 · Equipes:419,470,527 | `.slice(0,10)` e `truncate max-w-[100px]` sem `title` |
| X11 | Baixa | A11y | Login.tsx:45,59,78,89,152-159 · BrokerEditModal | erro só por toast; 0 `aria-invalid`; input de e-mail sem label |
| X12 | Baixa | A11y | index.html:2,11 · index.css:8-42 · Dashboard:282 · Login:138 | `lang="en"`, `theme-color #fff` com tema escuro, sem `color-scheme`, h1 `hidden` no mobile, Login sem h1 |
| S08 | Baixa | Segurança | 0012:412-438 · leads.ts:606 · documents.ts:186 | `with check` só confere bucket; `storage.remove` falha sem linha → órfão |
| S09 | Baixa | Segurança | BrokerEditModal.tsx:114-116 · 0012:365-393 | URL assinada de 5 anos em `profiles.avatar_url`; bucket já legível por autenticado |
| S10 | Baixa | Segurança | submission-dispatch/index.ts:29,87 | links de 24 h para RG/CPF por e-mail; front assina 300 s/60 s |
| S11 | Baixa | Segurança | package.json (build:dev) · App.tsx:41-48,66 | `vite build --mode development` arma `bypassAuth`; nada usa o script |
| D09 | Baixa | Docs | scripts/seed-database.ps1:16-23 · config.toml:11-23 · README.md:40 | seed remoto aplica fase 5 (050 cenários de teste); docs falam em 4 fases; rollback 059 não citado |
| D10 | Baixa | Docs | .env.example:1-29 · App.tsx:42 · scripts/demo.mjs:47-57 | `VITE_BYPASS_AUTH` e uso de `SUPABASE_SERVICE_ROLE_KEY` como var de sessão não documentados |
| D11 | Baixa | Docs | src/lib/routePermissions.ts:2-3 · App.tsx:44,62-83 | comentário cita `RequireAuth`; guard real é `RequirePermission` |
| D12 | Baixa | Docs | supabase/tests/01_rls_visibility.sql:4 · scripts/validate-schema.sh:24-27 | cita `--rls`; harness só aceita `--seed/--tests/--keep/--all` |
| D13 | Baixa | Docs | docs/sprints/roteiro-teste-completo.md:21-33 | "18 migrations, 116 asserts, 4 jobs" — snapshot de 02/08 ainda apontado por decisoes.md |
| D14 | Baixa | Docs | graphify-out/GRAPH_REPORT.md:1 | grafo de 08/08, anterior a 0024–0031, plano-100 e E2E; CLAUDE.md manda consultá-lo primeiro |
| D15 | Baixa | Docs | docs/sprints/README.md:27-55 | regras de dupla (Dev A/B, branch por story) e DoD sem `typecheck`, contrariando CLAUDE.md e memória do projeto |

## 5. Inventário

### 5.1 Rotas (src/App.tsx)
- **Públicas (4):** `/login`, `/daily/:teamId/:slug`, `/daily/:slug`, `/diretor/:slug`.
- **Protegidas (21, via `RequirePermission` + `routePermissions.ts`):** 20 no menu da sidebar (20 códigos `menu.*` da migration 0015, consistentes com `routePermissions.ts`) + `/admin/meta-ads` (fora do menu; link em `Marketing.tsx:145`). Páginas citadas pelas auditorias com rota: `/dashboard` (DashboardSwitcher → Dashboard ou DirectorDashboard), `/pipeline`, `/leads`, `/checkin`, `/checkpoint`, `/gamification`, `/sdr`, `/admin/meta-ads` e as 5 telas `/admin/*` (Permissions, AllowedIps, LeadAutomation, DailyTeams, Integrations). Demais telas com página própria: Equipes, Resultados, Marketing, Links, Settings, DailyReport, CcaPipeline, DataManagement.
- **Redirects (6):** `/`, `/team`, `/profile`, `/admin/teams`, `/admin/daily-bi → /checkpoint`, `/reset-password → /login`.
- **Curinga:** `*` → `NotFound` (texto em inglês).
- **Rota faltante usada pelo banco:** `/leads/:id` (gravada por `notify_lead_assigned`).
- **Título da barra superior:** `pageTitles` cobre 12 das 27 rotas; `/gamification`, `/checkin`, `/checkpoint`, `/sdr` e `/admin/*` exibem "Faceimob".

### 5.2 Edge functions (supabase/functions)
- **Ativas (9):** `broker-checkin`, `meta-ads-webhook`, `notify-dispatch`, `provision-broker-user`, `sdr-agent-chat`, `sdr-whatsapp-broadcast`, `submission-dispatch`, `voice-ai-webhook`, `whatsapp-inbound-webhook`.
- **Aposentadas, respondem 410 mas ainda deployadas com `verify_jwt=false` (3):** `daily-team-info`, `director-weekly`, `submit-daily-report`.
- **`_shared/`:** `secrets.ts` (cofre), `brevo.ts`, `meta.ts` (assinatura), `sdrAgent.ts`.
- **Invocadas pelo front (`functions.invoke`):** `broker-checkin`, `sdr-agent-chat`, `sdr-whatsapp-broadcast`. As demais são webhooks externos ou chamadas pelo cron.
- **Sem autenticação do chamador:** `sdr-agent-chat`, `notify-dispatch`, `submission-dispatch` (S01, S04).
- **pg_cron (6 jobs `faceimob-*`):** `assign-queued`, `auto-checkout-expired`, `notify-dispatch`, `purge-cron-history`, `release-expired-leads`, `submission-dispatch`.
- **Citada em docs e inexistente:** `notify-lead-timeout` (a real é `notify-dispatch`).

### 5.3 Banco
- 31 migrations (`0001`–`0031`, última `20260810200000_0031_sprint3_core_flows.sql`); 58 tabelas em `public` + `private.integration_credentials`; 132 `create policy`; 88 funções; 15 arquivos de regressão SQL; seeds: `seed.sql` + `010–040` + `045_tester_ref` + `050_test_scenarios` (+ `059` rollback manual).
- **Tabelas sem `.from()` em src/ (acessadas só por RPC/realtime):** `game_events` (realtime em SaleCelebration + `visible_game_ranking`), `remarketing_contacts` (`import_remarketing_list`/`remarketing_list_stats`), `private.integration_credentials` (`list_integrations`/`set_integration_secret`). A lista de "13 tabelas prontas e sem UI" do plano-entrega não existe mais.
- **Tabelas/colunas com UI parcial:** `goals` (gravada em Equipes, nunca lida), `lead_funnel_stages.max_minutes` (sem UI; a tela edita um campo fantasma), `pipeline_stages.label` (renomeável, nunca exibido), `public_links` para diretor (sem PIN), `cca_stages.status` (não editável pela tela).
- **Superfície anônima:** 3 RPCs (`public_daily_team`, `public_daily_submit`, `public_director_checkpoint`), sem rate-limit nem lockout de PIN.

### 5.4 Afirmações desatualizadas nos docs
| Onde | Diz | Real |
|---|---|---|
| CLAUDE.md:11 | 18 migrations, 11 edge functions, seed em 4 fases, só `leads.ts` | 31 migrations, 9 ativas + 3 stubs, 7 arquivos de seed, 14 adaptadores |
| CLAUDE.md:14 | `plano-entrega.md` é o plano ativo | concluído em 02/08; vivo é `plano-100-funcional.md` (10/08) |
| CLAUDE.md:13 | `PLANEJAMENTO.md` = estado e prioridades | congelado em 30/07 |
| CLAUDE.md:16-17 | Validar = lint, typecheck, vitest, validate-schema | faltam `e2e`, `e2e:remote`, `demo*`; typecheck também cobre `tsconfig.e2e.json` |
| PLANEJAMENTO.md | `signInWithPassword`, `DailyBI.tsx`, 12 migrations/70 funções, white mode ❌, ranking animado ❌, Brevo ❌, `mockData.ts` fica, 8 edge functions | OTP, arquivo não existe, 31/88, tema claro existe, pódio anima, `brevo.ts` existe, mockData apagado, 12 diretórios |
| supabase/README.md | estrutura até 0014; 123 policies · 71 funções · 86 asserts; 3 jobs cron; "8 functions leem de Deno.env"; Login com senha | até 0031; 132 · 88 · 15 arquivos; 6 jobs; `_shared/secrets.ts` em 6 functions; OTP |
| plano-entrega.md | 14 migrations; `signInWithPassword` em Login/Settings; 13 tabelas sem uso; bucket `deal-documents` nunca usado; `ResetPassword.tsx`; `notify-lead-timeout`; 3 jobs | ver acima; `documents.ts:12` usa o bucket; rota redireciona; `notify-dispatch`; 6 jobs |
| docs/sprints/README.md | plano-entrega ativo até 13/09; 3 decisões pendentes; migrations exclusivas do Dev A a partir de 0013; branch por story; DoD sem typecheck | decisões resolvidas em decisoes.md; branch única `nova`; typecheck é obrigatório |
| roteiro-teste-completo.md | 18 migrations, 116 asserts, 73 funções, 4 jobs | 31, 15 arquivos, 88, 6 |
| README.md raiz | projeto Lovable, deploy via Share → Publish | Supabase + Vite + Electron |
| routePermissions.ts:2 | guard é `RequireAuth` | `RequirePermission` |
| tests/01_rls_visibility.sql:4 | `validate-schema.sh --rls` | flag não existe (`--tests`/`--all`) |
| .env.example | sem `VITE_BYPASS_AUTH`; sem nota de `SUPABASE_SERVICE_ROLE_KEY` para `e2e:remote`/`demo --remote` | ambos usados em código/scripts |
| graphify-out | grafo de 08/08 | código mudou em 10/08 (0024–0031, E2E, plano-100) |
| Arquivos citados que não existem | `src/pages/DailyBI.tsx`, `src/pages/ResetPassword.tsx`, `src/data/mockData.ts`, `supabase/functions/notify-lead-timeout/` | — |

## 6. Ordem sugerida de ataque
1. **Dia 1 (horas):** T01, T02, G01, F05, F03, F04, F07, F16, D05 — todos de 1 a 10 linhas, alto impacto.
2. **Semana 1:** S01, S02, S03, S04, S05 (borda), F01, F02, F06, P01, P02, P06, P05, P03/P04 (fluxos quebrados de verdade).
3. **Semana 2:** helpers compartilhados (tone/podium/developerColor/format/supabaseError/PageState/usePeople) e substituição mecânica de cores — resolve a maioria dos médios de tema/arquitetura/a11y sem mexer em layout.
4. **Contínuo:** decompor Pipeline tela a tela ao migrar para useQuery; docs (CLAUDE.md, READMEs, cabeçalhos de histórico) junto do primeiro PR, para o próximo agente não partir de estado errado.
