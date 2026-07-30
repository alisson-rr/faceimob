# Planejamento de entrega — FACEIMOB

Consolidação das duas atas (14/07 e 23/07) confrontada com o que existe hoje no
repositório. Levantado em 29/07/2026. **Reverificado no código em 30/07/2026** —
os pontos abaixo continuam valendo: nenhum cron agendado (`cron.schedule` não
aparece em `supabase/migrations/`, não há `vercel.json`), `Login.tsx` segue em
`signInWithPassword`, nenhuma tela chama `set_integration_secret`/
`list_integrations`, `DailyBI.tsx` ainda aponta para `daily_broker_entries`/
`daily_team_reports`, e as telas críticas da Fase 1 (Leads, LeadFunnel,
LeadDetailModal, NewLeadNotifier, Checkin, AdminAllowedIps, DealDetailModal,
Marketing, Settings, SdrModule) seguem sem `newSchema.ts`. Já migradas: Dashboard,
Pipeline, DirectorDashboard, Gamification, Equipes, Resultados, Checkpoint,
CcaPipeline, AdminLeadAutomation, AdminDailyTeams, useGameRanking, AuthContext.

**Fontes:** `DOCUMENTOS/Reunião ... 2026_07_14.docx` (18 próximas etapas + 34
tópicos de detalhamento) e `DOCUMENTOS/Reunião ... 2026_07_23.docx` (12 próximas
etapas). Estado atual medido no código, nas 12 migrations e nas 70 funções do
schema novo.

## O achado principal

**O banco está praticamente pronto. O gap é frontend e integrações.**

Das ~40 exigências levantadas nas duas atas, o schema novo já resolve 26 no
banco. O que falta é ligar as telas, agendar dois crons e construir o que nunca
foi começado (login por e-mail, tela de tokens, Meta Ads, King Host).

Duas correções ao que o `supabase/README.md` afirma:

- **`config.toml` já aponta para o projeto novo** (`mcmqgxvtwegtptfseqvw`). O
  aviso no README está desatualizado.
- **"as ~28 páginas vão quebrar" é pessimista.** Só `DailyBI.tsx` referencia
  tabela que não existe (`daily_broker_entries`, `daily_team_reports`).
  `avatars` é bucket de storage e `game_ranking` é view que existe — falsos
  positivos. O resto quebra por *forma de coluna*, não por nome de tabela, e
  `src/integrations/supabase/newSchema.ts` já é a ponte que resolve isso:
  lê `deal_participants`/`deal_clients` e devolve a forma legada
  (`broker1/2/3`, `manager1/2/3`, `cotista2`, …) que as telas esperam. Migrar
  uma tela é trocar a fonte de dados, não reescrevê-la.

## Placar por requisito

Legenda: ✅ pronto · 🟡 banco pronto, falta UI/ligação · ❌ não começado ·
🔒 depende de terceiro

### Ata 14/07 — próximas etapas

| # | Requisito | Estado |
|---|---|---|
| 1-2 | Compartilhar repo · analisar arquitetura | ✅ |
| 3 | Reuniões semanais | ✅ processo |
| 4 | Fechamento mensal zerando jogo + sistema | ✅ `close_game_season`, `closed_months`, tela migrada |
| 5 | Tela de gestão de tokens de API | 🟡 `set_integration_secret` existe, **nenhuma tela usa** |
| 6 | SDR de qualificação por IA antes da distribuição | 🟡 migration `0008` + `SdrModule.tsx`, ainda no client antigo |
| 7 | Módulo de remarketing | 🟡 `remarketing_lists/contacts` prontos, UI parcial |
| 8 | Criar templates no Meta | 🔒 Douglas |
| 9 | Cadastrar templates no sistema | 🟡 `whatsapp_templates` pronto |
| 10 | Avisar lead perdido por prazo via WhatsApp | 🟡 `notify_lead_timeout` existe, **disparo não** |
| 11 | Atividades com vencimento | 🟡 `tasks` + `tasks_sync_lead_deadline`, **sem UI** |
| 12 | Hierarquia de equipes + indicadores | ✅ |
| 13 | King Host: criar e-mail no cadastro | ❌ 🔒 depende de API deles |
| 14-17 | Pix · análise · Hostinger · acessos | ✅ |

### Ata 14/07 — detalhamento técnico

| Requisito | Estado |
|---|---|
| Supabase + VPS, sair de Bubble/N8N | ✅ schema do zero, nada importado |
| Check-in por IP + 3 turnos configuráveis | ✅ `perform_checkin`, `ip_is_allowed`, `work_shifts` |
| Grupos de distribuição por formulário | ✅ `distribution_group_forms` |
| Roleta com trava de 5 min | ✅ `claim_lead` + `release_expired_leads` — **sem cron, não dispara** |
| Bloqueio com 20 leads atrasados | ✅ `overdue_lead_count`, `checkin_eligibility`, threshold configurável |
| Rastreio UTM / campanha / página | ✅ migration `0005` |
| Relatórios por origem/corretor/período + metas | ✅ `annual_results`, `goals`, `funnel_targets` |
| Metas de funil 10% / 40% / 50% | ✅ `funnel_targets` |
| Controle de aportes de marketing | 🟡 `marketing_investments` pronto, popup no client antigo |
| Diário com link público + PIN | ✅ PIN em bcrypt, 3 RPCs anônimas |
| Painel da diretoria | ✅ `DirectorDashboard.tsx` migrada |
| Rateio de VGV automático | ✅ `recalc_deal_shares`, fecha 100% com 3 corretores |
| Ranking com animações para o top 3 | ❌ |
| White mode | ❌ `next-themes` está nas deps, não há provider |
| Som a cada venda | 🟡 existe em `NewLeadNotifier.tsx`, não no fechamento |
| Brevo para e-mails | ❌ |
| Gestão granular de campanhas Meta (budget, pausar, copiar) | ❌ só o webhook de leads existe |

### Ata 23/07 — próximas etapas

| # | Requisito | Estado |
|---|---|---|
| 1 | Campo por tipo de documento + renomeação automática | 🟡 9 tipos com `naming_pattern` no seed; **upload não aplica o padrão** |
| 2 | Botão de download por documento | ❌ |
| 3 | Múltiplos anexos em "Outros" | ✅ `allows_multiple = true` para `outros`, `comprovante_renda`, `simulacao` |
| 4 | Permissões do Rafael (só corretor) | ✅ resolvido na raiz: papel virou N:N (`user_roles`) |
| 5 | Trava do lead ao clicar em atender | ✅ `claim_lead` |
| 6 | Bloqueio com +20 atrasados | ✅ |
| 7 | Contador visual de leads por período | ❌ |
| 8 | Exigir ≥1 documento na conversão | ⚠️ **divergência — ver abaixo** |
| 9 | Login por código no e-mail | ❌ `Login.tsx` usa `signInWithPassword` |
| 10 | Funil + hierarquia + VGV automático | ✅ |
| 11 | Integrar plataforma de IA de voz/WhatsApp | 🔒 Douglas — prazo 60 dias desde 14/07 → **~12/09/2026** |
| 12 | Exibir posição na fila | 🟡 `distribution_queue` pronta, **sem UI** |

## Plano de execução

### Fase 0 — Destravar produção ✅ CONCLUÍDA em 30/07 (migration `0013`)

Era o que impedia o sistema de funcionar em produção, independente de qualquer
tela. Validado contra Postgres real com pg_cron 1.6.4 — resultados medidos em
[docs/sprints/roteiro-teste-roleta.md](docs/sprints/roteiro-teste-roleta.md).

1. ✅ **`release_expired_leads()` a cada 30s** por pg_cron, com fallback para 1
   minuto em instância sem suporte a intervalo em segundos. Vercel Cron não foi
   necessário. E2E: lead vencido saiu do corretor 11 s depois do vencimento,
   pelo cron, e foi redistribuído na mesma transação.
2. ✅ **`auto_checkout_expired()` a cada minuto** — cadência fixa em vez de
   horário por turno, porque a função é dirigida por `work_shifts.checkout_time`,
   que o admin edita pela tela. Fechou sozinho 3 check-ins abertos desde 28/07.
3. ✅ **Poda de `cron.job_run_details`** (não estava no plano): a varredura de 30s
   grava ~2.880 linhas/dia e o pg_cron não limpa. Job diário, retenção de 7 dias.
4. ✅ **`cron_jobs_health()`** (não estava no plano): leitura de saúde dos jobs
   restrita a admin, para verificação pós-deploy sem console do banco.
5. ✅ **Tipos regenerados** — 2.022 → 3.664 linhas, zero referência a
   `daily_broker_entries`/`daily_team_reports` (eram 5).
6. ✅ **`supabase/README.md`** corrigido.
7. ✅ **Regressão automatizada** — `supabase/tests/04_cron_scheduling.sql`, 12
   asserts. O harness tinha 28 asserts provando que `release_expired_leads()`
   funciona *quando chamada*, e o sistema passou 12 migrations com ninguém
   chamando. Teste de comportamento verde não detecta código morto.
8. ✅ **`0014` — quem estoura o prazo perde a vez.** O teste E2E da `0013`
   revelou que o lead vencido podia voltar na hora para o mesmo corretor que o
   ignorou. Decisão do cliente em 30/07: pode voltar, desde que passe por toda a
   fila de novo. `distribution_queue` passou a ordenar pelo **fim** da última vez
   na roleta (`last_turn_at`) em vez do começo — para uma liberação por
   `timeout`, o fim é o `released_at`. Só `timeout` conta: `manual`,
   `reassigned`, `checkout` e `sdr_handoff` não são falha do corretor.
   Reverificado no cenário exato que falhava, mais 5 asserts no harness.

**Resta do trilho A:** `supabase db push` em produção e conferir
`select * from public.cron_jobs_health();`. Exige credencial do projeto.

**Segurança do ambiente** (fora do escopo das atas, corrigido em 30/07): `.env`
estava rastreado no git e fora do `.gitignore`. Auditado o histórico — só chaves
publicáveis, nenhum service role key vazado. Agora `.env` é ignorado, com
`.env.example` versionado documentando que **tudo com prefixo `VITE_` vai para o
bundle do navegador** e que segredo de servidor vive só em secret de edge function
ou em `private.integration_credentials`.

### Fase 1 — Ligar as telas ao schema novo (1–2 semanas)

Trocar query direta pelos adaptadores de `newSchema.ts`. Ordem por criticidade
operacional, não por facilidade:

1. `Leads.tsx`, `LeadFunnel.tsx`, `LeadDetailModal.tsx`, `NewLeadNotifier.tsx` — a
   operação diária dos corretores.
2. `Checkin.tsx`, `AdminAllowedIps.tsx` — porta de entrada da roleta.
3. `DealDetailModal.tsx` — 6 campos legados (`broker1-3`, `manager1-3`).
4. `Pipeline.tsx`, `Dashboard.tsx` — parcialmente migradas, ainda com query direta.
5. `DailyBI.tsx` — **a única que precisa de reescrita real**: aponta para
   `daily_broker_entries` e `daily_team_reports`, que não existem. Remapear para
   `daily_entries` / `daily_reports`.
6. `Marketing.tsx`, `MarketingInvestmentPopup.tsx`, `Settings.tsx`, `Links.tsx`,
   `DataManagement.tsx`, `GamificationAdmin.tsx`, `BrokerEditModal.tsx`,
   `PipelineTopRanking.tsx`, `useGameRanking.ts`, `SdrModule.tsx`.
7. `src/lib/aiAnalytics.ts` e `src/lib/automationEngine.ts` — dependem de
   `broker1`; decidir se migram ou passam a consumir `deal_participants`.

`src/data/mockData.ts` pode ficar como está (mock de demo, 12 usos legados).

### Fase 2 — Edge functions ✅ CONCLUÍDA em `587aa7d` (29/07)

As 8 foram reescritas contra o schema novo e validadas. Nenhuma referencia mais
tabela inexistente:

| Function | Como ficou |
|---|---|
| `meta-ads-webhook` | `automation_settings`, campos novos (`full_name`, `phone_raw`, `raw_payload`), rastreio granular (`campaign_id`/`adset_id`/`ad_id`), e agora **chama `assign_lead`** — entra na roleta |
| `broker-checkin` | `perform_checkin` / `perform_checkout` |
| `daily-team-info` | `public_daily_team` |
| `director-weekly` | `public_director_checkpoint` |
| `submit-daily-report` | `public_daily_submit` |
| `provision-broker-user` | `profiles`, `user_roles` (papel N:N) |
| `sdr-agent-chat` | `sdr_agents/conversations/messages` + OpenAI |
| `sdr-whatsapp-broadcast` | `remarketing_*`, `whatsapp_templates` + WhatsApp Cloud API |

Validado no webhook: `status: 'queued'` e `funnel_stage: 'new'` são valores
válidos dos enums, `.eq('id', true)` casa com `automation_settings.id boolean
primary key`, usa `SERVICE_ROLE_KEY` (necessário porque `assign_lead` é revogada
de `anon`), e o grupo de distribuição é resolvido por `form_id` dentro da própria
`assign_lead` via `distribution_group_forms` — o requisito de "grupos vinculados
a formulários" funciona sem o webhook precisar saber do grupo.

`director-weekly` e `daily-team-info` viraram cascas finas sobre as RPCs
públicas; continuam candidatas a exclusão se o frontend chamar a RPC direto.

### Fase 3 — O que nunca foi começado (2–3 semanas)

Prioridade por risco, não por pedido:

1. **Login por código no e-mail** (ata 23/07). Era vulnerabilidade explícita:
   senha exposta no banco. O schema já não guarda senha — falta o fluxo OTP no
   `Login.tsx` (`signInWithOtp`) e aposentar `signInWithPassword`.
2. **Gestão de tokens — o cofre está desconectado nas duas pontas.**
   `private.integration_credentials` existe, com `list_integrations()` (nunca
   devolve o segredo), `set_integration_secret()` e a permissão
   `settings.integrations` já semeada. Mas:
   - **ninguém escreve nele** — não há tela;
   - **ninguém lê dele** — as 8 edge functions leem `Deno.env.get(...)`.

   Construir só a tela **não** entrega o requisito: o Douglas gravaria a chave
   nova e as functions continuariam usando a variável de ambiente antiga. As duas
   pontas têm que ser feitas juntas — a tela chamando as RPCs e as functions
   passando a ler via `private.get_integration_secret()`, com fallback para
   `Deno.env` durante a transição.
3. **Documentos:** aplicar `naming_pattern` na renomeação do upload + botão de
   download por documento.
4. **Contador de leads por período** e **posição na fila** (`distribution_queue`).
5. **UI de atividades** com vencimento.
6. **Disparo do aviso de lead perdido** por WhatsApp (`notify_lead_timeout`).
7. **UX de engajamento:** white mode (`next-themes` já instalado), animações do
   top 3, som na venda.

### Fase 4 — Integrações externas (destravam por terceiros)

- **Templates de WhatsApp** — Douglas cria no Meta, depois cadastramos.
- **Gestão de campanhas Meta** (budget, pausar, copiar) — escopo grande, e a ata
  registra que a verificação de empresa de imóveis impede automação total.
  Tratar como projeto próprio, não como item de lista.
- **IA de voz/WhatsApp** — Douglas, vence ~12/09/2026. Preparar só o ponto de
  integração por API.
- **King Host** e **Brevo** — sem investigação de viabilidade ainda.

## Divergências que precisam de decisão

**1. Documento obrigatório: onde?**
A ata de 23/07 pede documento obrigatório **ao converter lead em negócio**. O
schema exige na **entrada da esteira do CCA** (`required_for_conversion` é lido
em `submit_deal_for_analysis`, não em `convert_lead_to_deal`). São momentos
diferentes. Exigir na conversão trava o corretor que ainda não tem o documento
em mãos; exigir no CCA deixa negócio incompleto no pipeline. Minha
recomendação: manter no CCA e mostrar no card o que falta — mas é chamada do
Douglas.

**2. King Host.** O pedido supõe que exista API de criação de e-mail. Vale 1h de
investigação antes de entrar em qualquer cronograma; se não houver, o item morre.

**3. N8N.** A ata cogita migrar para a VPS para economizar assinatura. Com as
edge functions reescritas, parte das automações do N8N pode simplesmente
desaparecer. Decidir depois da Fase 2, não antes.

## Integrações — inventário

### Ativas (código existe e aponta para o schema novo)

| Integração | Onde | Credencial | Para quê |
|---|---|---|---|
| **Meta Lead Ads** | `meta-ads-webhook` | `META_WEBHOOK_VERIFY_TOKEN`, `META_PAGE_ACCESS_TOKEN` | recebe o lead do formulário e joga na roleta |
| **WhatsApp Cloud API** (oficial) | `sdr-whatsapp-broadcast` | `META_WHATSAPP_ACCESS_TOKEN`, `META_WHATSAPP_PHONE_NUMBER_ID` | dispara templates de remarketing |
| **OpenAI** | `sdr-agent-chat` | `OPENAI_API_KEY` | agente SDR que qualifica o lead |
| **Supabase** | tudo | `SERVICE_ROLE_KEY`, `ANON_KEY` | banco, auth, storage |
| **ipify** | frontend | — | descobre o IP para o check-in |

`wa.me` aparece no frontend, mas é link `click-to-chat`, não integração.

### Cofre de credenciais — construído, desconectado

Ver Fase 3, item 2. `private.integration_credentials` está pronto e sem uso nas
duas pontas.

### Previstas nas atas, não iniciadas

| Integração | Situação |
|---|---|
| **Meta Ads — gestão de campanhas** (budget, pausar, copiar) | só o webhook de leads existe. É o maior escopo não estimado |
| **Evolution API** | ata registra que a empresa já paga; serviria para notificação não-oficial |
| **King Host** | criar e-mail corporativo no cadastro — viabilidade não investigada |
| **Brevo** | e-mails do pipeline |
| **IA de voz/WhatsApp** | 🔒 Douglas, ~12/09/2026 |
| **N8N** | roda hoje fora do repo; decidir migrar para a VPS ou aposentar |

## Riscos

| Risco | Impacto |
|---|---|
| ~~Cron da roleta não agendado~~ | ✅ resolvido na `0013`, com assert de regressão no harness |
| ~~Lead vencido volta para quem o ignorou~~ | ✅ resolvido na `0014`, com 5 asserts de regressão |
| Tela de tokens feita sem religar as functions ao cofre | Médio — requisito parece entregue e não está |
| Migração de tela sem teste manual | Médio — RLS pode esconder dado silenciosamente em vez de dar erro |
| Meta Ads tratado como item pequeno | Médio — é o maior escopo não estimado das atas |
| Prazo da IA de voz (~12/09) | Baixo — só exige o ponto de integração pronto |

## Ordem recomendada

Com a Fase 2 já entregue em `587aa7d`, o caminho crítico é: **Fase 0 esta semana**
(dois crons — sem eles a roleta não gira, e o webhook novo já está entregando lead
para ela), depois **Fase 1** (telas). Fase 3 entra conforme as reuniões semanais
priorizarem, com login OTP e cofre de tokens na frente. Fase 4 conforme os
terceiros liberarem.
