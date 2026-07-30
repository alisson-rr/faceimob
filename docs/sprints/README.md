# FACEIMOB — Planejamento por Sprints

Derivado de [PLANEJAMENTO.md](../../PLANEJAMENTO.md) (atas de 14/07 e 23/07,
verificado no código em 30/07/2026). Organizado para **duas pessoas
trabalhando em paralelo** sem conflito de merge.

## Trilhos

| Trilho | Papel | Domínio |
|---|---|---|
| **Dev A** | Backend / Integrações | migrations, crons, edge functions, auth, cofre de tokens, APIs externas, SDR |
| **Dev B** | Frontend / Telas | migração de telas para `newSchema.ts`, UI novas, UX |

**Regra de ouro: nenhum arquivo pertence aos dois trilhos na mesma sprint.**
A lista de arquivos de cada story é o contrato — se precisar tocar arquivo do
outro trilho, combinar antes ou abrir story separada.

## Calendário proposto

| Sprint | Semana | Tema |
|---|---|---|
| [Sprint 1](sprint-01.md) | 31/07 – 06/08 | Destravar produção + operação diária de leads |
| [Sprint 2](sprint-02.md) | 07/08 – 13/08 | Login seguro + check-in e fila |
| [Sprint 3](sprint-03.md) | 14/08 – 20/08 | Cofre de tokens + negócios e documentos |
| [Sprint 4](sprint-04.md) | 21/08 – 27/08 | SDR/WhatsApp + BI e marketing |
| [Sprint 5](sprint-05.md) | 28/08 – 03/09 | Engajamento (UX) + integrações externas |

Épico contínuo fora das sprints: **Meta Ads — gestão de campanhas** (budget,
pausar, copiar). A ata registra que a verificação de empresa imobiliária impede
automação total; tratar como projeto próprio após a Sprint 5.

## Fluxo de trabalho em dupla

1. **Branch por story**: `sprint-N/dev-a/S<id>-slug` ou `sprint-N/dev-b/...`.
2. **PR pequeno por story**, revisado pelo outro dev (revisão cruzada é o
   principal ponto de sincronização técnica).
3. **Merge diário em `main`** — nunca acumular mais de uma story sem mergear.
4. `src/integrations/supabase/types.ts` é **gerado** (`supabase gen types`):
   só o Dev A regenera, sempre em commit isolado, avisando o Dev B.
5. Migrations SQL são exclusivas do Dev A e numeradas sequencialmente
   (`0013_...` em diante).
6. Sync de 15 min no início do dia: o que mergeou ontem, o que trava hoje.

## Definition of Done (toda story)

- [ ] Critérios de aceite atendidos e demonstráveis
- [ ] Sem referência a tabelas/colunas do schema legado (`broker1/2/3`,
      `daily_broker_entries`, etc.) nos arquivos tocados
- [ ] Teste manual com usuário de cada papel afetado (RLS esconde dado em
      silêncio — testar como corretor, gerente e diretor quando aplicável)
- [ ] `npm run build` e `npx vitest run` passam
- [ ] PR revisado pelo outro dev e mergeado em `main`

## Decisões pendentes (levar ao Douglas na reunião semanal)

1. **Documento obrigatório**: na conversão do lead (ata 23/07) ou na entrada do
   CCA (como `submit_deal_for_analysis` faz hoje)? Bloqueia S3.7.
2. **King Host**: existe API de criação de e-mail? Spike de 1h na Sprint 5;
   se não houver, o item morre.
3. **N8N**: migrar para a VPS ou aposentar? Decidir após Sprint 4, quando o
   disparo de WhatsApp estiver no sistema.
