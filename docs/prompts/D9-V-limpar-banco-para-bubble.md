# Tarefa V — Limpar o banco de homologação antes da carga do Bubble

> Contexto do agente: **limpo**. **Não rode em paralelo** com tarefa que use o banco ou o E2E.
> Esta tarefa **só limpa** — a carga do Bubble é a próxima. **Nada é apagado antes de eu aprovar o
> Checkpoint 1.** Intocáveis: as 2 contas reais, o cofre `private.integration_credentials`,
> `automation_settings` e o catálogo do `supabase/seed.sql`.

## Objetivo

Zerar todo dado fictício e de teste do Supabase de homologação, para a carga do Bubble
(`scripts/import/run.mjs`) entrar num banco sem mistura — com backup que permita desfazer.

## Contexto (medido em 11/09/2026 — revalide antes de agir)

- Repo `C:\Users\Alisson\CascadeProjects\FACEIMOB`, branch `main`, árvore limpa. Leia
  `.claude/CLAUDE.md`, `.claude/rules/{database,security}.md`, `docs/importacao/COMO_RODAR.md`
  (§2, §3, §5, §7) e `docs/importacao/PLANO.md` §2.2–2.3.
- Banco: homologação `mcmqgxvtwegtptfseqvw` (o mesmo do `.env` e do MCP do Supabase). Opere como
  `postgres` pelo MCP (`execute_sql`).
- A importação **nunca rodou**: `import_bubble_map` = 0. Todo o resto veio dos seeds ou de teste
  manual, exceto:
  - 2 contas reais (e-mail sem `.invalid`): uma `@faceimob.com.br` (admin, broker, director,
    manager) e uma `@gmail.com` (admin, broker). Último login em 10/09.
  - `private.integration_credentials` (4 linhas).
  - `automation_settings` (1 linha): nasce no `seeds/020`, mas é a configuração única que o
    importador lê — sem ela o `run.mjs` aborta.
- 22 contas de seed (`@*.invalid`, banidas). Storage: 96 objetos (`deal-documents` 89,
  `lead-attachments` 3, `avatars` 4). 10 crons `faceimob-%` ativos, roleta ligada, 2 meses fechados.
- A linha divisória já existe: `supabase/seed.sql` = catálogo estável (etapas, estágios de CCA,
  tipos de documento, turnos, permissões, `lead_sources`, `distribution_groups` com `fila-geral`,
  `funnel_targets` globais, temporada e regras do jogo). `supabase/seeds/010`–`060` = fictício.
  O `seeds/020` também fez `update` em `lead_sources` (`form_id = 'seed-form-*'`, `sdr_agent_id`,
  `welcome_template_id`).
- Os exports do Bubble estão em `DOCUMENTOS/DADOS_BUBBLE/`. O importador depende de
  `automation_settings`, de `fila-geral` (sem ela a carga de pessoas pula a roleta) e do catálogo
  do `seed.sql`.

## Armadilhas já medidas

- FK `on delete cascade` para `teams`/`profiles`: `allowed_ips.team_id`,
  `funnel_targets.team_id`/`director_id`, `public_links.team_id`/`director_id`. Apagar equipe ou
  pessoa de seed apaga essas linhas calado.
- FK `restrict`: `marketing_investments.developer_id`; contra `profiles`: `deal_participants`,
  `game_events`/`game_season_results`, `daily_entries`. A ordem filho→pai está no cabeçalho de
  `supabase/seeds/069_demo_showcase_rollback.sql` — use como mapa, não rode o arquivo.
- `DELETE` dispara gatilho de linha (ex.: `closed_months_log_reopen` grava reabertura falsa em
  `month_reopenings`). `TRUNCATE` não dispara.
- Apagar linha de `storage.objects` por SQL deixa o arquivo órfão. Arquivo sai pela Storage API.

## Regra de classificação

1. **Operacional → zera, qualquer origem:** leads e tudo pendurado neles; negócios, clientes,
   participantes, documentos, histórico; CCA e eventos; jogo (eventos, pódios, metas, resultados
   anuais, temporadas que não são do `seed.sql`); diário; tarefas; visitas; check-ins;
   notificações; remarketing; conversas e mensagens de SDR; `closed_months`, `month_reopenings`,
   `access_provision_log`, `role_change_log`; campanhas e investimentos de marketing; construtoras
   e empreendimentos; links úteis, dicas, avisos; equipes e membros; membros de grupo de
   distribuição (exceto os das 2 contas reais).
2. **Pessoas:** saem as 22 contas `.invalid` (auth, perfil, papéis). As 2 reais ficam intactas.
3. **Catálogo/configuração:** fica o que o `seed.sql` criou e o que foi criado pela tela; sai o que
   veio de `seeds/010–060`. Em `lead_sources`, os três campos que o `seeds/020` preencheu voltam
   para `null` onde ainda têm o valor do seed.
4. **Dúvida → pergunte, não decida:** `sdr_agents`, `whatsapp_templates`, `allowed_ips` e qualquer
   linha de seed editada depois de criada. Para cada uma, diga a consequência de apagar,
   confirmada no código (ex.: sem IP liberado, alguém ainda faz check-in?).

## Entregas, em ordem

1. **Revalidar.** Repita as medições do Contexto. Pare se o projeto não for
   `mcmqgxvtwegtptfseqvw`, se `import_bubble_map` > 0 ou se houver conta sem `.invalid` além das 2.
2. **CHECKPOINT 1 — só leitura.** Por tabela (public, private, auth e buckets): linhas agora,
   linhas depois, regra aplicada e vítimas de cascade. Mais a lista de dúvida com a consequência.
   **Pare e espere meu "ok".**
3. **Congelar a operação:** COMO_RODAR §2, passos 0 a 2 (anote os crons ativos). Deixe congelado
   no fim — a carga vem em seguida.
4. **Backup** no schema `backup_pre_bubble`: `create table … as table …` de toda tabela que perde
   linha. De `auth.users`, só `id, email, created_at` das contas apagadas — sem hash, sem token.
   Sem grant para `anon`/`authenticated`. Mostre que a contagem do backup = contagem atual.
5. **Limpeza em UMA transação:** `TRUNCATE` sem `CASCADE` no que zera; `DELETE` filtrado em
   catálogo, configuração e pessoas. Se o Postgres recusar por FK de tabela que fica, pare e me
   mostre — não acrescente `CASCADE`. Erro = rollback inteiro.
6. **Storage** pela Storage API, reaproveitando `supa()` de `scripts/import/lib/bubble.mjs` (URL do
   `.env`; chave só de `SUPABASE_SERVICE_ROLE_KEY` no ambiente): esvazie `deal-documents` e
   `lead-attachments`; em `avatars`, mantenha só os das 2 contas. Sem a variável, **não peça a
   chave no chat** — me entregue o comando para eu rodar no meu terminal.
7. **Ensaio da carga:** `node scripts/import/run.mjs --dry-run` termina sem `ABORTADO` e com as
   contagens de COMO_RODAR §3. Travou em Node 20 ou falta de chave? Registre como pendência, não
   contorne.
8. **Handoff** em `docs/prompts/handoff-V.md`: SQL executado, contagens antes/depois, crons
   anotados, dúvidas e o que eu decidi, e os specs do E2E que dependiam de seed
   (`grep -rlE "\.invalid|70000000|80000000" e2e/`) — só listar.

## Critérios de aceite (cada um com a consulta que prova)

- [ ] Toda tabela "sai" com 0 linhas; toda "fica" com a contagem do Checkpoint 1.
- [ ] `auth.users` = 2, não banidas, mesmos papéis; `profiles` = 2; nenhuma órfã em
      `auth.identities`.
- [ ] `private.integration_credentials` = 4; `automation_settings` = 1 com `leads_paused = true`;
      `fila-geral` existe.
- [ ] `lead_sources` sem `seed-form-*` e sem FK para linha apagada.
- [ ] `deal-documents` = 0, `lead-attachments` = 0, `avatars` só das 2 contas.
- [ ] `import_bubble_map` = 0; crons `faceimob-%` ativos = 0.
- [ ] `backup_pre_bubble` bate com o Checkpoint 1 e `has_schema_privilege` dá `false` para `anon`
      e `authenticated`.
- [ ] Dry-run sem `ABORTADO`.

## Limites

- **Pode criar:** `docs/prompts/handoff-V.md`; script descartável só no scratchpad, fora do repo.
- **NÃO toque em:** `supabase/migrations/`, `supabase/seed.sql`, `supabase/seeds/`,
  `scripts/import/`, `src/`, `e2e/`, `.env`. Não commite.
- **Proibido:** `supabase db reset --linked` (recria tudo; cofre e configuração feita pela tela não
  voltam); qualquer seed (`npm run db:seed:remote`, `scripts/demo.mjs`, `db:seed:documents`);
  `run.mjs` sem `--dry-run`; alterar as 2 contas, seus papéis ou o cofre; religar crons ou
  roleta; dropar o backup.
- **Pare e pergunte antes de:** qualquer `DELETE`/`TRUNCATE` sem o Checkpoint 1 aprovado; item da
  lista de dúvida; cascade que atinja tabela que fica; DDL além do schema de backup. Transação
  falhou duas vezes? Pare e me traga o erro com duas alternativas.
