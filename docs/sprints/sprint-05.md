# Sprint 5 (28/08 – 03/09) — Engajamento (UX) + integrações externas

**Meta da sprint:** o sistema "dá vontade de usar" (gamificação visual pedida
pelo Douglas na ata 14/07) e os pontos de integração com terceiros ficam
prontos antes do prazo da IA de voz (~12/09).

---

## Épico E9 — Preparação para terceiros `[Dev A]`

### S9.1 — Ponto de integração da IA de voz/WhatsApp (5 pts)
Douglas contratou plataforma de IA com entrega em ~60 dias desde 14/07
(~12/09). Preparar o lado de cá: endpoint autenticado que recebe eventos da
plataforma (lead qualificado, transcrição, status) e injeta na roleta/histórico.
- **Arquivos:** `supabase/functions/voice-ai-webhook/` (nova),
  `supabase/migrations/...0015_voice_ai.sql` (se precisar de tabela de eventos)
- **Aceite:** contrato do endpoint documentado (payload, auth por chave do
  cofre) e testado com payload simulado; pronto para plugar quando a
  plataforma chegar.

### S9.2 — Spike King Host (2 pts, timebox 1 dia)
O pedido de criar e-mail corporativo no cadastro supõe que exista API. Vale
1h de investigação antes de entrar em qualquer cronograma; se não houver API,
o item morre (registrar a decisão).
- **Arquivos:** anotação em `docs/sprints/decisoes.md` (novo)
- **Aceite:** resposta documentada sim/não + esforço estimado se sim.

### S9.3 — Brevo no pipeline de e-mails (3 pts)
Ata 14/07: integração com Brevo para e-mails do pipeline. Escopo mínimo:
credencial no cofre + disparo transacional em 1 evento (ex.: negócio aprovado).
- **Arquivos:** `supabase/functions/_shared/brevo.ts` (novo) + function que
  dispara o evento escolhido
- **Aceite:** e-mail real disparado no evento; chave vem do cofre.

### S9.4 — Decisão N8N (1 pt)
Com o disparo de WhatsApp dentro do sistema (S3.4, S7.3), inventariar o que
resta no N8N e propor: migrar para a VPS ou aposentar.
- **Arquivos:** `docs/sprints/decisoes.md`
- **Aceite:** recomendação por escrito para a reunião semanal.

---

## Épico E10 — UX de engajamento e gamificação `[Dev B]`

### S10.1 — White mode (3 pts)
`next-themes` já está nas dependências; falta o provider e o toggle.
- **Arquivos:** `src/App.tsx`*, `src/components/layout/AppLayout.tsx`,
  `src/components/ThemeToggle.tsx` (novo)
- **Aceite:** tema claro/escuro persiste entre sessões; telas principais
  legíveis nos dois temas (varrer cores hardcoded).

\* `App.tsx` foi tocado pelo Dev A na Sprint 3 (rota) — sprints diferentes,
sem conflito.

### S10.2 — Animações do top 3 no ranking (5 pts)
Ata 14/07: rankings visualmente atrativos, com animação destacando os três
primeiros ("mais fluidos que o Bubble").
- **Arquivos:** `src/components/PipelineTopRanking.tsx`,
  `src/pages/Gamification.tsx`
- **Aceite:** top 3 com destaque animado (pódio/transições); performance ok
  em TV/telão (uso típico da loja).

### S10.3 — Som e celebração na venda (3 pts)
Som já existe no `NewLeadNotifier` para lead novo; replicar no fechamento de
venda, com celebração visual (referência do Douglas: sons de torcida,
insígnias).
- **Arquivos:** `src/components/SaleCelebration.tsx` (novo), gatilho em
  `src/pages/Pipeline.tsx` ou via realtime em `AppLayout.tsx` (combinar com
  S10.1 pois toca no mesmo arquivo — mesmo dono, ok)
- **Aceite:** venda marcada como fechada dispara som + animação para o time.

### S10.4 — UI de atividades com vencimento (5 pts)
`tasks` + `tasks_sync_lead_deadline` prontos no banco, sem UI (ata 14/07:
agendamento de tarefas com vencimento para retorno aos clientes).
- **Arquivos:** `src/components/TaskPanel.tsx` (novo), integração em
  `src/components/LeadDetailModal.tsx`* e `src/components/DealDetailModal.tsx`*
- **Aceite:** criar/concluir atividade com prazo; atrasadas contam no
  `overdue_lead_count` (bloqueio dos 20); lista "minhas atividades de hoje".

\* arquivos que foram do Dev B nas Sprints 1 e 3 — mesmo trilho, sem conflito.

---

**Capacidade:** Dev A 11 pts · Dev B 16 pts.

**Depois da Sprint 5 (backlog aberto):**
- **Meta Ads — gestão de campanhas** (budget, pausar, copiar): maior escopo
  não estimado das atas; projeto próprio com sprint(s) dedicada(s).
- Aposentar `director-weekly`/`daily-team-info` se o frontend chamar as RPCs
  públicas direto.
- Migração/aposentadoria do N8N conforme S9.4.
- `src/data/mockData.ts` permanece como mock de demo.
