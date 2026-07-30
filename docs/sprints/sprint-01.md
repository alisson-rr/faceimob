# Sprint 1 (31/07 – 06/08) — Destravar produção + operação diária de leads

**Meta da sprint:** a roleta de leads funciona ponta a ponta em produção
(webhook → fila → trava de 5 min → liberação automática) e as telas que o
corretor usa todo dia leem o schema novo.

---

## Épico E1 — Produção destravada `[Dev A]` ✅ CONCLUÍDO em 30/07

Sem os crons, a trava de 5 minutos nunca libera o lead e a roleta para na
primeira atribuição. É o bug mais grave em aberto (PLANEJAMENTO, Fase 0).

Validado contra Postgres real (pg_cron 1.6.4) com as 13 migrations e o seed:
resultados medidos em [roteiro-teste-roleta.md](roteiro-teste-roleta.md).

### S1.1 — Agendar `release_expired_leads()` (3 pts) ✅
Migration `0013` agenda a cada **30s** via pg_cron, com fallback automático para
1 minuto se a instância não suportar intervalo em segundos. O Vercel Cron não foi
necessário: pg_cron está disponível em todos os planos Supabase e aceitou os 30s.
- **Arquivos:** `supabase/migrations/20260731120000_0013_cron_scheduling.sql`
- **Aceite:** ✅ lead vencido saiu do corretor **11 s** após o vencimento, pelo
  cron, sem chamada manual. Job às 12:26:08.855154, `released_at` 12:26:08.855213
  — mesma transação. Redistribuído para o próximo da fila na mesma passada.

### S1.2 — Agendar `auto_checkout_expired()` (2 pts) ✅
A cada minuto, não em horário fixo por turno: a função compara `now()` com
`work_shifts.checkout_time`, então cravar horário no cron duplicaria configuração
que o admin edita pela tela.
- **Arquivos:** mesma migration da S1.1
- **Aceite:** ✅ fechou sozinho, às 12:23:00, os 3 check-ins abertos desde 28/07,
  com `auto_checkout = true`.

### S1.2b — Poda do histórico do cron (não prevista, obrigatória)
Uma varredura de 30s grava ~2.880 linhas/dia em `cron.job_run_details`, que o
pg_cron não limpa. Terceiro job, diário às 03:10, retém 7 dias.
- **Arquivos:** mesma migration da S1.1

### S1.2c — `cron_jobs_health()` (não prevista)
Um cron que falha em silêncio é indistinguível de um cron que não existe — o
estado que a sprint veio corrigir. Função `security definer` sobre `cron.*`,
restrita a admin pelo `WHERE` (retorna vazio, não erro, para poder ser consumida
por um `select` do frontend). Habilita a verificação pós-deploy e a S1.5.

### S1.3 — Regenerar tipos TypeScript (1 pt) ✅
Gerado com `--db-url` apontando para o banco local, que tem exatamente as mesmas
migrations — mesmo resultado do `--linked`, sem depender de `supabase link`.
- **Arquivos:** `src/integrations/supabase/types.ts` (2.022 → 3.664 linhas)
- **Aceite:** ✅ `daily_broker_entries`/`daily_team_reports` zerados (eram 5
  referências), 82 entidades contra 55, `cron_jobs_health` incluída.
  `npm run build` e `vitest` passam. **Inventário de tipos para o Dev B abaixo.**

### S1.4 — Atualizar `supabase/README.md` (1 pt) ✅
- **Arquivos:** `supabase/README.md`
- **Aceite:** ✅ nota do `config.toml` corrigida, contagem de asserts (73),
  `0013` na tabela de estrutura, "o que falta" reescrito, seção de verificação
  pós-deploy com `cron_jobs_health()`.

### S1.5 — Teste E2E da roleta (2 pts) ✅
- **Arquivos:** `docs/sprints/roteiro-teste-roleta.md`,
  `supabase/tests/04_cron_scheduling.sql`, `supabase/tests/00_supabase_stubs.sql`
- **Aceite:** ✅ ciclo completo com horários reais no roteiro. Além do teste
  manual, **12 asserts novos no harness** — o elo que faltava: o
  `02_business_rules.sql` já provava que `release_expired_leads()` funciona
  quando chamada, e o sistema passou 12 migrations com a função correta e ninguém
  a chamando. O harness roda em Postgres puro, então a `0013` exigiu um stub de
  `cron.*` nos stubs do ambiente.

### S1.6 — Quem estoura o prazo perde a vez ✅ (achado da S1.5, decidido em 30/07)
O teste E2E revelou que o lead vencido podia voltar na hora para o mesmo corretor
que o ignorou. **Decisão do cliente:** pode voltar, desde que passe por toda a
fila de novo.

`distribution_queue` passou a ordenar pelo **fim** da última vez na roleta
(`last_turn_at`) em vez do começo — numa liberação por `timeout`, o fim é o
`released_at`, então o corretor vai para o fim da fila no mesmo instante. Só
`timeout` conta: `manual`, `reassigned`, `checkout` e `sdr_handoff` não são falha
do corretor. `last_assigned_at` continua no retorno com o significado original,
para a tela do corretor (S4.3).
- **Arquivos:** `supabase/migrations/20260731130000_0014_queue_turn_order.sql`,
  `supabase/tests/02_business_rules.sql` (+5 asserts),
  `src/integrations/supabase/types.ts` (assinatura mudou)
- **Aceite:** ✅ reproduzido o cenário exato que falhava — Felipe na posição 1, o
  prazo estoura, o lead vai para a Elisa e Felipe cai para a posição 2.
  Detalhe e o empate conhecido na seção 5 do roteiro.

### S1.7 — `.env` na forma correta ✅ (fora das atas)
`.env` estava rastreado no git e fora do `.gitignore`. Histórico auditado: só
chaves publicáveis, nenhum service role key vazado — não precisou reescrever
histórico. Agora `.env` é ignorado e `.env.example` é versionado, documentando o
que importa: **tudo com prefixo `VITE_` vai para o bundle do navegador**, então
segredo de servidor vive só em secret de edge function ou em
`private.integration_credentials`.
- **Arquivos:** `.gitignore`, `.env.example` (novo), `.env` (limpo e destrastreado)
- **Aceite:** ✅ `git check-ignore .env` confirma; arquivo preservado no disco.

### Handoff de tipos para o Dev B
Baseline antes da S1.3: 5 erros de `tsc` (2 em `RoleSwitcher.tsx`, 3 em
`DirectorDashboard.tsx`). Depois: 9. O `RoleSwitcher` foi corrigido pelo Dev A
(papéis `sdr` e `marketing` existiam no enum do banco e faltavam nos dois
`Record<AppRole, …>` — `roleColors[role]` devolvia `undefined` para esses
usuários).

Os 6 erros que os tipos corretos expuseram, todos em telas do trilho B:

| Arquivo | Erros | Natureza |
|---|---|---|
| `src/pages/DailyBI.tsx` | 5 | esperado — é a tela que aponta para tabela inexistente (S8.1) |
| `src/pages/AdminDailyTeams.tsx` | 1 | **bug real:** insert em `teams` sem o `slug` obrigatório (linha 76) |
| `src/pages/DirectorDashboard.tsx` | 3 | pré-existentes, não vieram da S1.3 |

`npm run build` não faz typecheck (`vite build` puro), então a esteira não
quebra; os erros aparecem no editor e em `tsc --noEmit`.

---

## Épico E2 — Telas de operação de leads no schema novo `[Dev B]`

Trocar query direta pelos adaptadores de `src/integrations/supabase/newSchema.ts`
(não editar o `newSchema.ts` em si sem combinar — Dev A pode tocá-lo na S1.3).

### S2.1 — Migrar `Leads.tsx` (5 pts)
- **Arquivos:** `src/pages/Leads.tsx`
- **Aceite:** lista, filtros e ações funcionam para corretor/gerente/diretor;
  campos de rastreio (UTM, campanha) visíveis; zero `.from()` em tabela legada.

### S2.2 — Migrar `LeadFunnel.tsx` + `LeadDetailModal.tsx` (5 pts)
Inclui o histórico com comentários manuais (requisito ata 23/07 — log de toda
movimentação do lead).
- **Arquivos:** `src/components/LeadFunnel.tsx`, `src/components/LeadDetailModal.tsx`
- **Aceite:** funil reflete `funnel_stage` do schema novo; comentário manual
  grava e aparece no histórico.

### S2.3 — Migrar `NewLeadNotifier.tsx` (3 pts)
Popup + som quando lead é atribuído (requisito ata 23/07: notificação
independente de onde o corretor esteja no sistema).
- **Arquivos:** `src/components/NewLeadNotifier.tsx`
- **Aceite:** popup dispara em qualquer rota via realtime/polling no schema
  novo; som toca.

### S2.4 — Botão "Atender" com trava (`claim_lead`) (3 pts)
O clique em atender chama `claim_lead` e mostra o countdown de 5 min
(requisito "Trava de Atendimento", ata 23/07).
- **Arquivos:** `src/pages/Leads.tsx` (mesma story-branch da S2.1 se preferir),
  `src/components/LeadDetailModal.tsx`
- **Aceite:** dois corretores não conseguem atender o mesmo lead; countdown
  visível; expirou → some da tela do corretor.

---

**Capacidade:** Dev A 9 pts · Dev B 16 pts (Dev A sobra folga para suporte a
ambiente/staging nesta primeira semana).

**Dependências:** S1.5 depende de S1.1+S1.2. S2.4 depende de S2.1/S2.2.
S1.3 (types) mergear no início da sprint para o Dev B trabalhar em cima.

**Risco de pg_cron — resolvido:** disponível em todos os planos Supabase, versão
1.6.4, aceitou intervalo de 30s. O fallback Vercel Cron não foi criado, para não
commitar caminho de deploy sem teste. A `0013` aborta com mensagem explícita se
cair num ambiente sem pg_cron e sem o stub do harness — agendamento que não
acontece em silêncio é o estado que ela veio corrigir.

**Pendente da S1.1/S1.2 antes de fechar a sprint:** aplicar a `0013` em produção
(`supabase db push`) e conferir com `select * from public.cron_jobs_health();` —
três linhas `faceimob-*`, `active = true`, `failures_24h = 0`. A validação feita
aqui foi em banco local com o mesmo schema; o `db push` exige credencial que o
trilho A precisa rodar com o acesso do projeto.
