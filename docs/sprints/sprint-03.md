# Sprint 3 (14/08 – 20/08) — Cofre de tokens + negócios e documentos

**Meta da sprint:** o Douglas troca qualquer chave de API sozinho pela tela
(autonomia administrativa, ata 14/07) e o fluxo de documentos do CCA funciona
como pedido na ata 23/07 (campos por tipo, renomeação, download).

---

## Épico E5 — Cofre de tokens ponta a ponta `[Dev A]`

`private.integration_credentials` existe com RPCs prontas, mas **ninguém
escreve nele** (não há tela) e **ninguém lê dele** (as functions usam
`Deno.env`). Construir só a tela não entrega o requisito — as duas pontas
juntas, na mesma sprint (PLANEJAMENTO, Fase 3.2).

### S5.1 — Tela de gestão de integrações (5 pts)
Nova página admin listando via `list_integrations()` (nunca devolve o
segredo) e gravando via `set_integration_secret()`. Guardada pela permissão
`settings.integrations` já semeada.
- **Arquivos:** `src/pages/AdminIntegrations.tsx` (novo), rota em
  `src/App.tsx`*, item de menu em `src/components/layout/AppSidebar.tsx`*
- **Aceite:** admin cadastra/atualiza chave e vê "última atualização";
  segredo nunca aparece no client nem no network tab.

\* combinar o horário do merge com Dev B — `App.tsx`/`AppSidebar.tsx` são
compartilhados; mexer neles só nesta story, em PR pequeno e rápido.

### S5.2 — Functions leem do cofre (5 pts)
As 8 edge functions passam a chamar `private.get_integration_secret()` com
fallback para `Deno.env` durante a transição. Extrair helper compartilhado.
- **Arquivos:** `supabase/functions/_shared/secrets.ts` (novo) + as 8
  functions (`meta-ads-webhook`, `broker-checkin`, `daily-team-info`,
  `director-weekly`, `submit-daily-report`, `provision-broker-user`,
  `sdr-agent-chat`, `sdr-whatsapp-broadcast`)
- **Aceite:** trocar a chave da OpenAI pela tela (S5.1) muda o comportamento
  do `sdr-agent-chat` sem redeploy nem mexer em variável de ambiente.

### S5.3 — Migrar `src/lib/aiAnalytics.ts` e `automationEngine.ts` (3 pts)
Dependem de `broker1`; decidir migrar para `deal_participants` ou aposentar
(o que o grafo mostrar como sem uso, remover).
- **Arquivos:** `src/lib/aiAnalytics.ts`, `src/lib/automationEngine.ts`
- **Aceite:** zero referência a `broker1/2/3` em `src/lib/`.

---

## Épico E6 — Negócios e documentos do CCA `[Dev B]`

### S6.1 — Migrar `DealDetailModal.tsx` (5 pts)
A tela com mais campos legados (`broker1-3`, `manager1-3`, `cotista2`) —
`newSchema.ts` já devolve a forma legada; preenchimento automático de gerente
e diretor a partir da hierarquia (requisito ata 23/07); rateio de VGV exibido
vem de `recalc_deal_shares`.
- **Arquivos:** `src/components/DealDetailModal.tsx`
- **Aceite:** negócio com 3 corretores fecha rateio em 100%; gerente/diretor
  autopreenchidos; sem `.from()` legado.

### S6.2 — Upload com campos por tipo + renomeação automática (5 pts)
Os 9 tipos com `naming_pattern` já estão no seed; o upload não aplica o
padrão. Um slot por tipo de documento, renomeando no envio (ata 23/07).
- **Arquivos:** `src/components/DealDetailModal.tsx` (seção DOC_SLOTS),
  `src/components/DealDocumentUpload.tsx` (novo, se a seção crescer)
- **Aceite:** arquivo enviado em "Contrato" é gravado no bucket com o nome do
  `naming_pattern`; categoria "Outros" (e demais com `allows_multiple`)
  aceita vários arquivos.

### S6.3 — Botão de download + histórico de envios (3 pts)
Download por documento no histórico (ata 23/07), com URL assinada.
- **Arquivos:** mesmos da S6.2
- **Aceite:** cada documento do histórico baixa com 1 clique; versões
  substituídas (`deal_documents_supersede`) continuam listadas como
  histórico.

### S6.4 — Documento obrigatório na conversão — implementar a decisão (2 pts)
Depende da decisão do Douglas (README das sprints, decisão nº 1). Se ficar no
CCA (recomendado), a story vira: mostrar no card do pipeline o que falta.
- **Arquivos:** `src/components/DealDetailModal.tsx` e/ou
  `src/pages/CcaPipeline.tsx`
- **Aceite:** conforme decisão registrada na reunião semanal.

---

**Capacidade:** Dev A 13 pts · Dev B 15 pts.

**Dependências:** S5.2 depende de S5.1 (mesma sprint, Dev A controla a ordem).
S6.3 depende de S6.2. S6.4 bloqueada até a decisão — levantar na segunda-feira.

**Risco:** RLS nos buckets de storage pode esconder documento em vez de dar
erro — testar download como corretor, gerente, CCA e diretor.
