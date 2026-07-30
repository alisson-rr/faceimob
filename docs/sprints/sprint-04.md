# Sprint 4 (21/08 – 27/08) — SDR/WhatsApp + BI e marketing

**Meta da sprint:** o fluxo de SDR por IA e remarketing funciona de ponta a
ponta (template → conversa IA → fila de corretores, ata 14/07) e os painéis
de BI/marketing saem do client antigo.

---

## Épico E7 — SDR, remarketing e templates `[Dev A]`

O Dev A assume o domínio SDR inteiro (tela + functions) para manter a
separação de arquivos — é o épico mais acoplado a integração externa.

### S7.1 — Migrar `SdrModule.tsx` para o schema novo (5 pts)
`sdr_agents`, `sdr_conversations`, `sdr_messages`, `remarketing_lists/contacts`
já existem (migration 0008).
- **Arquivos:** `src/pages/SdrModule.tsx`
- **Aceite:** conversa do agente IA visível; handoff de lead qualificado cai
  na roleta (`assign_lead`).

### S7.2 — Cadastro de templates de WhatsApp (3 pts)
Tabela `whatsapp_templates` pronta. UI de cadastro dentro do SdrModule
(nome, idioma, variáveis) para usar a API oficial — os templates em si o
Douglas cria no Meta (dependência externa).
- **Arquivos:** `src/pages/SdrModule.tsx` (aba nova)
- **Aceite:** template cadastrado aparece como opção de disparo no broadcast.

### S7.3 — Remarketing: importação de planilha (5 pts)
Ata 14/07: importar listas de leads antigos para disparo de template, com
fluxo template → SDR IA → fila.
- **Arquivos:** `src/pages/SdrModule.tsx`,
  `supabase/functions/sdr-whatsapp-broadcast/index.ts` (ajustes)
- **Aceite:** planilha xlsx/csv importa para `remarketing_contacts` com
  validação de telefone; disparo em lote respeita rate limit da Cloud API;
  respostas caem no agente SDR.

---

## Épico E8 — BI diário e marketing `[Dev B]`

### S8.1 — Reescrever `DailyBI.tsx` (8 pts)
A única tela que precisa de reescrita real: aponta para
`daily_broker_entries`/`daily_team_reports`, que não existem. Remapear para
`daily_entries`/`daily_reports`, mantendo os indicadores do Diário (funil
10/40/50, XP, ranking de gerentes — ata 14/07).
- **Arquivos:** `src/pages/DailyBI.tsx`
- **Aceite:** painel abre sem erro com dados reais; metas de funil
  (`funnel_targets`) aparecem contra o realizado; datas sem preenchimento
  destacadas (requisito do painel da diretoria).

### S8.2 — Migrar `Marketing.tsx` + `MarketingInvestmentPopup.tsx` (5 pts)
Controle de aportes por construtora/mês (`marketing_investments` pronto,
popup ainda no client antigo — ata 14/07 00:53:22).
- **Arquivos:** `src/pages/Marketing.tsx`,
  `src/components/MarketingInvestmentPopup.tsx`
- **Aceite:** registrar aporte por construtora e mês; relatório de
  investimento × leads por campanha usa o rastreio granular
  (`campaign_id`/`adset_id`/`ad_id`).

### S8.3 — Migrar telas administrativas restantes (5 pts)
O rescaldo da Fase 1: `Settings.tsx` (parte de dados — o bloco de auth já foi
do Dev A na Sprint 2), `DataManagement.tsx`, `Links.tsx`,
`GamificationAdmin.tsx`, `BrokerEditModal.tsx`, `PipelineTopRanking.tsx`.
- **Arquivos:** os 6 acima
- **Aceite:** `grep` de tabelas legadas nesses arquivos retorna vazio; cada
  tela testada com papel adequado.

---

**Capacidade:** Dev A 13 pts · Dev B 18 pts (S8.3 pode escorregar para a
Sprint 5 sem quebrar nada — é o buffer da sprint).

**Dependências:** S7.2 depende de Douglas ter criado ≥1 template aprovado no
Meta (cobrar na semana anterior). S7.3 depende de S7.1 e S7.2.

**Risco:** aprovação de template no Meta leva dias — se atrasar, S7.3 testa
com template de sandbox e valida em produção depois.
