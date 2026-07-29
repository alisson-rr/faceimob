# Planejamento de entrega — FACEIMOB

Consolidação das duas atas (14/07 e 23/07) confrontada com o que existe hoje no
repositório. Levantado em 29/07/2026.

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

### Fase 0 — Destravar produção (1–2 dias) · faça primeiro

O sistema **não funciona** em produção sem isto, independente de qualquer tela:

1. **Agendar `release_expired_leads()`** a cada ~30s (pg_cron ou Vercel Cron).
   Sem o agendamento a trava de 5 minutos nunca libera o lead — a roleta
   simplesmente para na primeira atribuição. É o bug mais grave em aberto.
2. **Agendar `auto_checkout_expired()`** no fim de cada turno.
3. **Regenerar os tipos:**
   `supabase gen types typescript --linked > src/integrations/supabase/types.ts`
4. Corrigir os dois pontos desatualizados do `supabase/README.md`.

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

### Fase 2 — Edge functions (3–5 dias)

As 8 em `supabase/functions/` ainda falam com as tabelas antigas:

- `broker-checkin` → chamar `perform_checkin` passando o IP
- `meta-ads-webhook` → chamar `assign_lead`
- `sdr-agent-chat`, `sdr-whatsapp-broadcast` → schema `0008`
- `submit-daily-report`, `provision-broker-user` → revisar
- `director-weekly`, `daily-team-info` → **candidatas a exclusão**: as RPCs
  públicas (`public_director_checkpoint`, `public_daily_team`) já fazem o
  trabalho. Menos código para manter.

### Fase 3 — O que nunca foi começado (2–3 semanas)

Prioridade por risco, não por pedido:

1. **Login por código no e-mail** (ata 23/07). Era vulnerabilidade explícita:
   senha exposta no banco. O schema já não guarda senha — falta o fluxo OTP no
   `Login.tsx` (`signInWithOtp`) e aposentar `signInWithPassword`.
2. **Tela de gestão de tokens.** O banco já protege (`private.integration_credentials`,
   grava por RPC e nunca devolve o valor). Falta a tela para o Douglas ser
   autônomo — foi pedido explícito.
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

## Riscos

| Risco | Impacto |
|---|---|
| Cron da roleta não agendado | **Alto** — a distribuição de leads para de funcionar por completo |
| Migração de tela sem teste manual | Médio — RLS pode esconder dado silenciosamente em vez de dar erro |
| Meta Ads tratado como item pequeno | Médio — é o maior escopo não estimado das atas |
| Prazo da IA de voz (~12/09) | Baixo — só exige o ponto de integração pronto |

## Ordem recomendada

Fase 0 esta semana (destrava a operação). Fase 1 e 2 podem correr em paralelo —
telas e edge functions não se cruzam. Fase 3 entra conforme as reuniões semanais
priorizarem. Fase 4 conforme os terceiros liberarem.
