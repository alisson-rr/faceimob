# Tarefa C — Cenário de demonstração na homologação + roteiro de acesso do cliente

> Contexto do agente: **limpo**. Cabe em uma sessão (1 dia). Precisa de `SUPABASE_SERVICE_ROLE_KEY` no ambiente da sessão (o usuário define; nunca grave em arquivo nem imprima). Para o deploy (entrega 6), precisa de `VERCEL_TOKEN` no ambiente **ou** de uma CLI da Vercel já logada (`npx vercel whoami`); sem isso, deixe os comandos prontos e siga. As Tarefas A (fundação visual) e B (engajamento) já foram entregues — o deploy publica o estado atual da branch `nova`.

## Contexto
- Repo: `C:\Users\Alisson\CascadeProjects\FACEIMOB`, branch `nova`. Leia `.claude/CLAUDE.md`, `.claude/rules/database.md`, `supabase/README.md`, a seção "Pendências operacionais" de `docs/sprints/decisoes.md`, o cabeçalho de `scripts/demo.mjs` e o par `supabase/seeds/050_test_scenarios.sql` / `059_test_scenarios_rollback.sql` (padrão de cenário idempotente com rollback).
- Banco de **homologação** (`VITE_SUPABASE_URL` do `.env`): pode rodar seed e SQL sem cerimônia. Produção não existe ainda.
- **Só edite:** `supabase/seeds/**`, `scripts/demo*.mjs`, `scripts/*.ps1`, `docs/demo/**` e `vercel.json` (novo, na raiz). Nada em `src/`. Não crie migration. Não commite.

## Objetivo
Em 1 dia, o banco de homologação conta uma história convincente para um diretor de imobiliária abrir o app e navegar **sozinho**: equipes com corretores, leads em vários estágios (alguns no prazo, alguns atrasados), negócios em todas as etapas do pipeline com VGV plausível, pódio de gamificação com top 3 claro, notificações, tarefas e visitas do dia, aportes de marketing, metas — incluindo a **meta global de vendas** que o Dashboard lê de `goals` (`scope='global'`, `metric='sales'`; pendência operacional nº 1 — hoje mostra "—"). Tudo fictício (nenhum dado pessoal real), idempotente e removível.

## Entregas
1. `supabase/seeds/060_demo_showcase.sql` + `069_demo_showcase_rollback.sql`, no padrão do 050/059 (mesmo mecanismo de tag para rollback). Volume alvo: 2 diretorias, 3 equipes, ~12 corretores com `avatar_url` (ex.: `https://api.dicebear.com/9.x/initials/svg?seed=<Nome>`; se o projeto tiver padrão com o bucket `avatars`, prefira ele), ~60 leads distribuídos por origem/status, ~25 negócios cobrindo todas as `pipeline_stages` com participantes (`deal_participants` com ordinal — migration `0025`) e clientes, `game_events` coerentes com `game_scoring_rules` (prefira `award_game_points`), 1 temporada aberta no mês corrente e 1 fechada no anterior com `game_season_results`, metas, tarefas/visitas de hoje, notificações não lidas para o usuário da demo, aportes de marketing e 2–3 `daily_reports`. Respeite FKs, enums e triggers — leia `deals_award_points`, `tasks_sync_lead_deadline`, `recalc_deal_shares`, `deals_guard_stage` antes de inserir.
2. `scripts/demo.mjs`: subcomandos `showcase` (aplica 060) e `showcase:limpar` (aplica 069), mantendo `preparar/lead/limpar` intactos; `--remote` já existe — reutilize.
3. Usuário do cliente **com senha** (decisão de 21/08: o login aceita senha além do código — a demo não depende de e-mail). Adicione a `scripts/create-user.ps1` o parâmetro opcional `-Password` (SecureString, nunca em texto no histórico; o Admin API aceita `password` no body) e um modo `-SetPassword` para usuário existente (`PUT /auth/v1/admin/users/{id}`). **Documente, não execute** sem o e-mail confirmado pelo usuário: `npm run user:create -- -Email <email> -FullName "<nome>" -Role admin -Password`, e como vincular o mesmo usuário também como `broker` numa equipe da demo (papel é N:N em `user_roles`). Confirme em `src/components/RoleSwitcher.tsx` como o admin pré-visualiza outros papéis e inclua no roteiro.
4. `docs/demo/roteiro-cliente.md`: passo a passo do que o cliente clica — Login (senha; código como alternativa) → Dashboard → Check-in → Leads (atender um lead) → Pipeline (mover um negócio; fechar uma venda para ver a comemoração) → Gamificação (pódio) → trocar a visão para "corretor" — com o que ele deve ver em cada passo e os números esperados. Seção **"Antes de liberar"** com o checklist de acesso:
   - template do e-mail com o código: `supabase/templates/magic_link.html` já está em `config.toml`; verifique na CLI instalada (`npx supabase --version`) se `supabase config push` aplica templates; senão, colar no painel *Authentication → Emails → Magic Link*;
   - **SMTP (desejável, não bloqueia):** o remetente embutido do Supabase recusa e-mail fora da equipe do projeto e tem cota baixa — sem SMTP (Brevo) o código por e-mail e as notificações não chegam a endereço externo; o cliente entra pela senha;
   - teste real de login com um e-mail externo;
   - crons saudáveis: `select * from public.cron_jobs_health();`.
5. Validação: aplicar `showcase --remote`, conferir por SQL (contagens por tabela; `select * from game_ranking`), aplicar `showcase:limpar --remote`, reaplicar. Registre as contagens no roteiro.
6. **Deploy na Vercel — a URL que o cliente vai abrir.**
   - `vercel.json` na raiz com o fallback de SPA do React Router: `{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }`. Sem isso, F5 em `/pipeline` dá 404.
   - Build é `npm run build` (Vite, saída `dist/`) — a Vercel detecta sozinha; não crie script novo. Rode `npm run build` localmente antes para garantir que passa.
   - Autenticação: use `VERCEL_TOKEN` do ambiente (flag `--token` ou variável) ou a CLI logada. **Se não houver credencial, não pare:** escreva os comandos exatos na seção "Antes de liberar" do roteiro e siga o resto da tarefa.
   - Passos: `npx vercel link --yes` (cria/vincula o projeto `faceimob`); cadastre em *preview* e *production* as três variáveis públicas do `.env` — `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID` — via `npx vercel env add` (são públicas por construção, vão para o bundle de qualquer forma; **jamais** a service role key ou o token da Vercel); depois `npx vercel deploy --prod`.
   - Verifique na URL publicada: o login abre, F5 numa rota interna não dá 404, console sem erro de rede/CORS, e o login por senha funciona com o usuário da demo (se já criado). Registre a URL no roteiro e no handoff.

## Critérios de aceite
- `node scripts/demo.mjs showcase --remote` e `showcase:limpar --remote` rodam duas vezes seguidas sem erro.
- Nenhuma tela do caminho fica vazia para o usuário admin da demo.
- Nenhuma credencial em arquivo, log ou saída (`SUPABASE_SERVICE_ROLE_KEY` e `VERCEL_TOKEN` incluídos).
- Com credencial da Vercel disponível: a URL publicada abre o login e F5 em rota interna não dá 404. Sem credencial: os comandos exatos de deploy estão no roteiro.

## Entrega
Não commite. Escreva `docs/prompts/handoff-C.md`: o que foi aplicado no remoto, contagens, a URL da Vercel (ou os comandos pendentes), o que o usuário precisa fazer à mão (SMTP, template, criar usuário, domínio), riscos. Atualize a coluna de status da Tarefa C em `docs/sprints/sprint-demo.md`.
