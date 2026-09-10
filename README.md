# FACEIMOB

CRM da operação imobiliária: roleta de distribuição de leads com trava de
atendimento, check-in por IP e turno, pipeline de negócios com rateio de VGV,
esteira de crédito (CCA), SDR por IA, diário de equipe e gamificação.

Substitui a stack anterior em Bubble/N8N. Nada foi importado do banco antigo.

## Como rodar

Requisito: Node.js e npm ([instalar com nvm](https://github.com/nvm-sh/nvm#installing-and-updating)).

```sh
npm i
cp .env.example .env   # passo obrigatório: ver abaixo
npm run dev
```

O `.env.example` traz os valores como *placeholder*, então copiá-lo não basta:
preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` antes do
`npm run dev` (onde achar cada um está em comentário no próprio arquivo). Sem os
dois, a página abre **em branco** — sem título, sem mensagem: o cliente Supabase
recusa a URL no import e nada chega a montar. O motivo só aparece no console do
navegador.

## Como validar

```sh
npm run lint
npm run typecheck        # `npx tsc --noEmit` na raiz NÃO checa nada
npx vitest run
./scripts/validate-schema.sh --all   # migrations + RLS + asserts SQL; exige Docker
```

`npm run build` é `vite build` puro: não faz typecheck.

## Supabase

As migrations e o seed usam o schema novo. Para aplicar o seed
completo no projeto remoto pelo PowerShell (a senha é solicitada sem ser exibida):

```powershell
npm run db:seed:remote
```

Esse comando usa Docker para executar o `psql`, sem colocar a senha na URI nem
no histórico do terminal. Ele carrega catálogo, pessoas fictícias bloqueadas
para login, equipes, leads, negócios, CCA, SDR, daily, gamificação, marketing e
workspace. Os registros são idempotentes: o comando pode ser repetido.

Para criar o seu primeiro usuário real:

```powershell
npm run user:create -- -Email admin@faceimob.com.br -FullName "Administrador" -Role admin
```

O script lê `VITE_SUPABASE_URL` do `.env` e pede, sem exibir, apenas a
`service_role key`. Essa chave deve ser copiada de **Supabase → Project
Settings → API Keys** e nunca deve ser salva no `.env` do Vite, commitada ou
exposta no navegador.

**Dois jeitos de entrar** (`src/pages/Login.tsx`): senha
(`signInWithPassword`) ou código de 6 dígitos enviado ao e-mail
(`signInWithOtp` + `verifyOtp`). O código depende do SMTP e do template de
Magic Link configurados no painel; a senha existe justamente para não depender
disso. O usuário é criado com `email_confirm`, então já recebe o código na
primeira tentativa.

Depois, inicie o aplicativo e entre pela rota `/login`:

```powershell
npm run dev
```

## Stack

React 18 · TypeScript 5 · Vite 5 · Tailwind + shadcn/ui (Radix) · TanStack Query
· React Router 6 · Recharts. Backend Supabase (Postgres com RLS, Auth, Storage,
Edge Functions em Deno, pg_cron). Vitest e Playwright nos testes; Electron
empacota a versão desktop.

## Publicação

O front é publicado na Vercel (`npx vercel deploy --prod`). Só as variáveis
`VITE_*` do `.env.example` são cadastradas lá — elas vão para o bundle do
navegador. Chave de serviço e token de terceiro nunca: esses vivem em secret de
edge function ou em `private.integration_credentials`.

## Onde está o resto

- `.claude/CLAUDE.md` — arquitetura, invariantes do banco e armadilhas.
- `CONTEXT.md` — glossário do domínio.
- `PLANEJAMENTO.md` — placar por requisito.
- `docs/sprints/` — `sprint-demo.md` (plano ativo) e `decisoes.md` (registro).
- `supabase/README.md` — como aplicar e validar o schema.
