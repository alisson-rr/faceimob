# Tarefa I — Endurecimento antes de divulgar a URL (edge functions + links públicos)

> Contexto do agente: **limpo**. Cabe em meia sessão. Exige Docker (`./scripts/validate-schema.sh --all`) e a CLI do Supabase linkada (`npx supabase link --project-ref mcmqgxvtwegtptfseqvw` — já foi feito uma vez nesta máquina pela Tarefa C). O banco é **homologação**: migration e deploy de function podem rodar sem cerimônia.

## Contexto
- Repo: `C:\Users\Alisson\CascadeProjects\FACEIMOB`, branch `nova`. Leia `.claude/CLAUDE.md`, `.claude/rules/{database,security}.md` e as linhas S01, S02, S03, S04, S05 da tabela em `docs/auditoria-2026-08-21.md`. O app está público em https://faceimob.vercel.app — estes buracos ficam expostos junto.
- **Você SÓ pode editar:** `supabase/functions/_shared/**`, `supabase/functions/sdr-agent-chat/**`, `supabase/functions/notify-dispatch/**`, `supabase/functions/submission-dispatch/**`, migration **nova** `supabase/migrations/20260825??????_0033_public_link_hardening.sql` (deixe a `0032` livre — é da Tarefa E), arquivo novo em `supabase/tests/`, `supabase/config.toml`, `supabase/README.md` (linha da 0033), `src/pages/AdminDailyTeams.tsx`, `docs/sprints/decisoes.md` (linhas novas). Nada mais em `src/`. Não edite migration já aplicada. Não commite.

## Entregas
1. **S01 — `sdr-agent-chat` autentica o chamador.** Hoje roda com service_role e qualquer um com a anon key pública queima a chave da OpenAI e lê conversas de leads. Helper em `_shared/` que valida o JWT do usuário (`auth.getUser()` a partir do `Authorization`) e o papel autorizado — copie o padrão que `sdr-whatsapp-broadcast` já usa. Sem usuário válido: 401 com corpo JSON claro. O frontend (`SdrModule.tsx`) já manda o token do usuário via `functions.invoke` — confirme antes de mudar contrato.
2. **S04 — `notify-dispatch` e `submission-dispatch` só aceitam o cron.** Leia como as migrations `0017`/`0018`/`0020` invocam essas functions (header usado pelo pg_net) e exija `role = 'service_role'` no JWT; recuse o resto com 401. Não quebre o cron: depois do deploy, confira `select * from public.cron_jobs_health();` e force um ciclo se possível.
3. **S02/S05 — links públicos deixam de nascer abertos.** Migration `0033`:
   - slug de link novo passa a ser aleatório (`gen_random_uuid()`), nunca derivado do nome;
   - link de `director_checkpoint` novo exige PIN (`pin_hash` obrigatório no caminho de criação);
   - `resolve_public_link` ganha lockout: `failed_attempts`/`locked_until`, trava de ~15 min após 5 erros de PIN, contagem zerada no acerto;
   - links existentes continuam válidos, mas `AdminDailyTeams.tsx` mostra aviso "sem PIN" nos que não têm e o botão de gerar PIN (o `regeneratePin` já existe; PIN novo via `crypto.getRandomValues`, exibido uma vez).
4. **S03 — auto-cadastro off.** `[auth] enable_signup = false` no `config.toml` **se a Tarefa E ainda não tiver feito**, e anote no handoff que o mesmo ajuste é manual no painel do remoto (Authentication → Sign In / Up). O login por senha/código não cria conta (`shouldCreateUser: false`); só o admin cria.
5. **Teste SQL** `supabase/tests/11_public_link_hardening.sql`: slug novo não contém o nome; criação de link de diretor sem PIN falha; 5 PINs errados travam e o correto dentro da janela é recusado; destrava após a janela; contagem zera no acerto.
6. **Aplicar e provar.** `./scripts/validate-schema.sh --all` verde; `npx supabase db push` na homologação; deploy das 3 functions (`npx supabase functions deploy sdr-agent-chat notify-dispatch submission-dispatch`). Prova de cada porta: `curl` com a anon key em `sdr-agent-chat` → 401; com JWT de usuário válido → 200; `notify-dispatch` com anon → 401; crons continuam saudáveis; link público antigo do Diário continua abrindo.
7. **Limpeza (se o tempo deixar):** os 3 diretórios de functions aposentadas que respondem 410 (`daily-team-info`, `director-weekly`, `submit-daily-report`) saem do repo e do `config.toml`, e `npx supabase functions delete` no remoto; registre em `decisoes.md`.

## Critérios de aceite
- `validate-schema --all` verde com o teste novo; `npm run typecheck` e `npm run build` verdes (o `AdminDailyTeams.tsx` mudou).
- As provas de 401/200 do item 6 registradas no handoff (comandos e respostas, sem tokens).
- Nenhuma credencial em arquivo, log ou saída.

## Entrega
Não commite. Escreva `docs/prompts/handoff-I.md`: o que fechou, provas, o que é manual no painel (signup off), riscos restantes. Atualize a linha da Tarefa I em `docs/sprints/sprint-demo.md`.
