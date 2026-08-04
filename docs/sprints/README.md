# FACEIMOB — Planejamento por Sprints

Derivado de [PLANEJAMENTO.md](../../PLANEJAMENTO.md) (atas de 14/07 e 23/07,
verificado no código em 30/07/2026). Organizado para **duas pessoas
trabalhando em paralelo** sem conflito de merge.

## Trilhos

> Vale só se o time voltar a ser dupla. O [plano-entrega.md](plano-entrega.md) é
> de trilho único, então a regra de ouro abaixo não se aplica a ele — a ordem das
> stories dentro de cada épico faz o papel do contrato.

| Trilho | Papel | Domínio |
|---|---|---|
| **Dev A** | Backend / Integrações | migrations, crons, edge functions, auth, cofre de tokens, APIs externas, SDR |
| **Dev B** | Frontend / Telas | migração de telas para `newSchema.ts`, UI novas, UX |

**Regra de ouro: nenhum arquivo pertence aos dois trilhos na mesma sprint.**
A lista de arquivos de cada story é o contrato — se precisar tocar arquivo do
outro trilho, combinar antes ou abrir story separada.

## Calendário

> **Revisado em 02/08/2026 — a fonte de verdade agora é
> [plano-entrega.md](plano-entrega.md).** A Sprint 1 fechou inteira e a auditoria
> do código mostrou lacunas que o plano original não pegava (a tela de permissões
> não persiste nada, a gamificação roda toda no cliente, os documentos do negócio
> estão em 0%). `sprint-02.md`…`sprint-05.md` ficam como histórico do que foi
> planejado em 30/07; não seguir por eles.

| Sprint | Semana | Tema | Situação |
|---|---|---|---|
| [Sprint 1](sprint-01.md) | 31/07 – 06/08 | Destravar produção + operação diária de leads | ✅ concluída |
| [Sprints 2–7](plano-entrega.md) | 03/08 – 13/09 | plano revisado até 100% | ativo |
| ~~[sprint-02](sprint-02.md)…[sprint-05](sprint-05.md)~~ | — | — | superadas em 02/08 |

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
