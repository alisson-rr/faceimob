# FACEIMOB — Plano de entrega até 100%

**Revisão de 02/08/2026.** Substitui `sprint-02.md`…`sprint-05.md`, que foram
escritos em 30/07 e ficaram desatualizados: a Sprint 1 fechou inteira, `DailyBI.tsx`
foi apagado (a rota `/admin/daily-bi` redireciona para `/checkpoint`) e os 9 erros
de `tsc` do handoff foram corrigidos. `sprint-01.md` continua válido como histórico.

Diferença estrutural: o plano antigo dividia o trabalho em dois trilhos (Dev A /
Dev B) com posse exclusiva de arquivo. **Este plano é de trilho único**, então não
há regra de "nenhum arquivo pertence aos dois trilhos". Se voltar a ser dupla, a
ordem das stories dentro de cada épico já serve de contrato.

---

## Estado medido no código (02/08/2026)

Não é leitura de documento — foi medido no repositório hoje.

| Verificação | Resultado |
|---|---|
| `npx vite build` | ✅ passa (bundle 2.03 MB, sem code-splitting) |
| `npx tsc --noEmit` | ⚠️ 0 erros — mas **checava zero arquivos** (ver nota abaixo) |
| `npx vitest run` | ✅ 26 testes em `leads.test.ts` |
| Tabelas em `public` | 58 · 14 migrations (`0001`–`0014`) |
| Funções chamáveis (RPC) | 48 — **14 usadas pelo app, 34 não** |
| Tabelas sem nenhum uso no app | **13** |
| `signInWithPassword` | ainda em `Login.tsx:36` e `Settings.tsx:59` |
| Buckets em uso | só `avatars` e `lead-attachments` — `deal-documents` **nunca usado** |

> **Correção de 02/08 (tarde):** o `npx tsc --noEmit` desta tabela era falso
> verde. `tsconfig.json` tem `"files": []` com project references e, sem `-b`,
> o tsc sai com 0 sem abrir arquivo nenhum. Com o comando certo
> (`npm run typecheck`) apareceram **9 erros reais**, todos corrigidos — entre
> eles o insert em `teams` sem `slug` que o handoff da Sprint 1 já havia
> apontado e ninguém conseguia ver.

Das 34 RPCs sem uso, ~18 são helpers internos de RLS, trigger ou cron
(`has_role`, `is_admin`, `auth_visible_profiles`, `release_expired_leads`,
`recalc_deal_shares`, …) e **não são lacuna**. As 8 que são lacuna real de
produto viraram story abaixo: `list_integrations`, `set_integration_secret`,
`get_integration_secret`, `checkin_eligibility`, `current_shift`,
`distribution_queue`, `close_game_season`, `remarketing_list_stats`,
`cron_jobs_health`.

### O que já está pronto (não replanejar)

- **Operação diária de leads.** `src/integrations/supabase/leads.ts` é um adaptador
  completo — 30+ funções, `claim_lead`, `reassign_lead`, `convert_lead_to_deal`,
  comentários, anexos com URL assinada, eventos, countdown da trava. Consumido por
  `Leads.tsx`, `LeadFunnel.tsx`, `LeadDetailModal.tsx`, `NewLeadNotifier.tsx`, com
  realtime (`postgres_changes`) em 5 arquivos.
- **Crons da roleta** (`0013`) e **ordem da fila por fim de vez** (`0014`).
- **8 edge functions** contra o schema novo.
- **Tema claro/escuro** — `useTheme.ts` + toggle no `AppSidebar`. Sobrou só varrer
  cor hardcoded (vira story pequena, não épico).
- **Telas migradas** para `newSchema.ts`: Dashboard, Pipeline, Resultados,
  Checkpoint, CcaPipeline, Equipes, Gamification, DirectorDashboard,
  AdminDailyTeams, AdminLeadAutomation.

### As 4 lacunas graves que a auditoria de hoje revelou

Nenhuma delas está nos docs de sprint antigos com a gravidade correta:

1. **`AdminPermissions.tsx` não persiste nada.** Zero referência a `supabase` no
   arquivo — o admin configura permissões, sai da tela e perde tudo. As tabelas
   `role_permissions` e `stage_permissions` e as funções `has_permission` /
   `can_enter_stage` existem e nunca são chamadas.
2. **A gamificação inteira roda no cliente.** `Gamification.tsx` calcula com
   `DEFAULT_SCORING` em `useState`. `game_scoring_rules`, `game_events`,
   `game_season_results`, `award_game_points`, `close_game_season` e
   `current_game_season` estão prontos no banco e nunca são chamados. O
   "fechamento mensal zerando o jogo" (ata 14/07, item 4) está marcado como pronto
   no PLANEJAMENTO e **não está**.
3. **Documentos do negócio: 0%.** `DealDetailModal.tsx` não tem upload, download
   nem storage. `deal_documents`, o bucket `deal-documents`, o `naming_pattern`
   dos 9 tipos semeados e o versionamento por `deal_documents_supersede` nunca
   foram usados. Toda a ata 23/07 sobre documentos está em aberto.
4. **Cofre de tokens desconectado nas duas pontas** (já conhecido, confirmado): as
   8 edge functions leem `Deno.env` e nenhuma tela grava.

### Tabelas prontas e sem UI (as 13)

`tasks` · `visits` · `notifications` · `ad_campaigns` · `annual_results` ·
`game_events` · `game_scoring_rules` · `game_season_results` · `role_permissions` ·
`stage_permissions` · `deal_history` · `cca_case_events` · `developer_submissions`

---

## Calendário

| Sprint | Semana | Tema | Pts |
|---|---|---|---|
| [2](#sprint-2--acesso-e-permissões-que-valem) | 03/08 – 09/08 | Acesso e permissões que valem | 21 ✅ |
| [3](#sprint-3--cofre-de-tokens--documentos-do-negócio) | 10/08 – 16/08 | Cofre de tokens + documentos do negócio | 23 ✅ (D3 bloqueada) |
| [4](#sprint-4--roleta-visível-e-atividades) | 17/08 – 23/08 | Roleta visível e atividades | 21 ✅ |
| [5](#sprint-5--gamificação-real--bi-consolidado) | 24/08 – 30/08 | Gamificação real + BI consolidado | 22 ✅ |
| [6](#sprint-6--sdr-whatsapp-e-avisos) | 31/08 – 06/09 | SDR, WhatsApp e avisos | 21 ✅ |
| [7](#sprint-7--integrações-externas-e-endurecimento) | 07/09 – 13/09 | Integrações externas e endurecimento | 20 ✅ (J3/J4 dependem de terceiros) |

A Sprint 7 fecha antes de **~12/09/2026**, prazo da IA de voz do Douglas.

> **Execução concluída em 02/08/2026.** As seis sprints foram implementadas de
> uma vez, em trilho único. O que sobrou está em
> [decisoes.md](decisoes.md) (decisões do Douglas) e nas pendências
> operacionais no fim deste documento — nenhuma delas é código.
>
> **Validação completa em 02/08/2026** — as quatro verificações passaram:
>
> | Comando | Resultado |
> |---|---|
> | `npm run typecheck` | 0 erros (typecheck real, ver correção acima) |
> | `npx vitest run` | 37 testes |
> | `npm run build` | ok — chunk de entrada **271 kB** (era 2,03 MB num arquivo só) |
> | `./scripts/validate-schema.sh --all` | **116 asserts**, 18 migrations, RLS em todas as tabelas |
>
> 11 edge functions · `grep "supabase as any" src/` vazio.
>
> Única story não entregue: **D3** (trava de documento obrigatório), que depende
> da decisão nº 1 em [decisoes.md](decisoes.md).

### Definition of Done (toda story)

- [ ] Critério de aceite demonstrável na tela ou em SQL
- [ ] Zero `.from()` em tabela legada e zero `(supabase as any)` no arquivo tocado
- [ ] Testado com cada papel afetado — **RLS esconde dado em silêncio**, não dá erro
- [ ] `npm run typecheck`, `npx vitest run` e `npm run build` passam
      (`npx tsc --noEmit` na raiz **não** checa nada — ver `.claude/CLAUDE.md`)
- [ ] Story que mexe em SQL: assert novo em `supabase/tests/` e
      `./scripts/validate-schema.sh --all` verde

---

## Sprint 2 — Acesso e permissões que valem
**03/08 – 09/08 · 21 pts · ✅ CONCLUÍDA em 02/08**

**Meta:** ninguém entra com senha e a tela de permissões passa a governar de
verdade o que cada papel vê e faz.

Entregue com typecheck limpo, 26 testes de front verdes, build ok e o
harness SQL verde com 15 migrations e os asserts novos de
`supabase/tests/05_menu_permissions.sql`.

Dois achados durante a implementação, que mudaram o desenho:

1. **A API de permissão do frontend era código morto.** `hasPermission`,
   `canViewStage`, `canEditStage`, `canMoveToStage` e a matriz
   `demoPermissions` existiam no `AuthContext` e não eram chamadas em **nenhum**
   arquivo fora dele — com um vocabulário (`view_deals`, `see_financial`) que
   não existe no catálogo do banco. Foram apagadas em vez de migradas.
2. **O `RoleSwitcher` deixava qualquer usuário trocar o próprio papel.** Inócuo
   enquanto o menu era hardcoded; com o menu vindo da matriz, viraria um buraco
   (um corretor escolheria "admin" e revelaria tudo no client). Virou
   pré-visualização restrita a admin, com a trava dentro do `AuthContext` — não
   só escondendo o componente.

### Épico A — Autenticação sem senha (8 pts)

Ata 23/07 pediu login por código no e-mail para eliminar senha exposta. O schema
já não guarda senha; falta o fluxo.

#### A1 — Login por OTP (5 pts)
Fluxo e-mail → código de 6 dígitos → sessão, com `signInWithOtp`.
`signInWithPassword` fica atrás de uma flag por uma sprint e depois sai.
- **Arquivos:** `src/pages/Login.tsx`
- **Aceite:** usuário entra só com e-mail e código; template do Supabase em pt-BR;
  rate limit conferido; erro de código inválido é legível.
- **Risco:** o e-mail embutido do Supabase tem limite baixo. Se travar, usar o
  SMTP da King Host já contratado — investigação dentro desta story, não depois.

#### A2 — Aposentar a senha (2 pts)
`Settings.tsx:59` reautentica com `signInWithPassword` antes de operação sensível;
trocar por reautenticação OTP. `ResetPassword.tsx` vira "reenviar código" ou sai.
- **Arquivos:** `src/pages/Settings.tsx`, `src/pages/ResetPassword.tsx`, `src/App.tsx`
- **Aceite:** `grep -rn signInWithPassword src/` retorna vazio.

#### A3 — Provisionamento sem senha fixa (1 pt)
`provision-broker-user` para de definir senha; o primeiro acesso é por OTP.
- **Arquivos:** `supabase/functions/provision-broker-user/index.ts`,
  `scripts/create-user.ps1`
- **Aceite:** usuário novo entra por código; nenhuma senha em banco, log ou planilha.

### Épico B — Permissões aplicadas (13 pts)

`AdminPermissions.tsx` é hoje uma tela de mock — **zero chamadas ao Supabase**.
Este épico é o que transforma o requisito "permissões do Rafael" (ata 23/07) de
aparência em comportamento.

#### B1 — Persistir a matriz de permissões (5 pts)
Ler e gravar `role_permissions` (papel × permissão) e `stage_permissions`
(estágio × papel × entrar/sair), substituindo o `useState` local.
- **Arquivos:** `src/pages/AdminPermissions.tsx`,
  `src/integrations/supabase/permissions.ts` (novo adaptador)
- **Aceite:** alterar permissão, recarregar a página e a alteração continuar lá;
  `select * from role_permissions` reflete a tela.

#### B2 — Menu e rotas obedecem `has_permission` (5 pts)
Hoje o menu é montado por papel hardcoded no `AppSidebar`. Passar a consultar
`has_permission`, e proteger a rota — esconder item de menu não protege a URL.
- **Arquivos:** `src/components/layout/AppSidebar.tsx`, `src/App.tsx`,
  `src/contexts/AuthContext.tsx`
- **Aceite:** corretor sem `settings.integrations` não vê o item **e** recebe
  negação ao abrir a URL direto; diretor que também é corretor vê a união dos dois
  papéis (papel é N:N).

#### B3 — Pipeline respeita `can_enter_stage` (3 pts)
Mover card para um estágio proibido tem que falhar na tela, não só no banco.
- **Arquivos:** `src/pages/Pipeline.tsx`, `src/pages/CcaPipeline.tsx`
- **Aceite:** arrastar para estágio bloqueado mostra o motivo e não grava; o
  bloqueio continua valendo se a chamada for feita direto pela API.

---

## Sprint 3 — Cofre de tokens + documentos do negócio
**10/08 – 16/08 · 23 pts**

**Meta:** o Douglas troca qualquer chave sozinho pela tela, e o fluxo de
documentos da ata 23/07 existe pela primeira vez.

### Épico C — Cofre de tokens ponta a ponta (11 pts)

Construir só a tela **não entrega o requisito**: o Douglas gravaria a chave nova e
as functions continuariam lendo `Deno.env`. As duas pontas na mesma sprint.

#### C1 — Tela de integrações (5 pts)
Lista por `list_integrations()` (nunca devolve o segredo) e grava por
`set_integration_secret()`. Guardada pela permissão `settings.integrations`, que
já está semeada e passa a valer com a B2.
- **Arquivos:** `src/pages/AdminIntegrations.tsx` (novo), rota em `src/App.tsx`,
  item em `src/components/layout/AppSidebar.tsx`
- **Aceite:** admin cadastra e atualiza chave, vê "última atualização", e o valor
  **não aparece** na resposta da rede nem no client.

#### C2 — Functions leem do cofre (5 pts)
Helper compartilhado que tenta `private.get_integration_secret()` e cai para
`Deno.env` durante a transição. Aplicar nas 5 credenciais externas
(`OPENAI_API_KEY`, `META_PAGE_ACCESS_TOKEN`, `META_WEBHOOK_VERIFY_TOKEN`,
`META_WHATSAPP_ACCESS_TOKEN`, `META_WHATSAPP_PHONE_NUMBER_ID`).
`SUPABASE_*` continua em env — é credencial de plataforma, não de integração.
- **Arquivos:** `supabase/functions/_shared/secrets.ts` (novo) +
  `meta-ads-webhook`, `sdr-agent-chat`, `sdr-whatsapp-broadcast`
- **Aceite:** trocar a chave da OpenAI pela tela muda o comportamento do
  `sdr-agent-chat` **sem redeploy e sem mexer em variável de ambiente**.

#### C3 — Painel de saúde dos crons (1 pt)
`cron_jobs_health()` existe e nunca foi chamada. Sem ela, cron que falha em
silêncio é indistinguível de cron que não existe — exatamente o bug que a `0013`
veio corrigir.
- **Arquivos:** `src/pages/AdminIntegrations.tsx` (aba) ou `Settings.tsx`
- **Aceite:** admin vê 3 linhas `faceimob-*` com `active`, `last_status` e
  `failures_24h`; não-admin vê lista vazia, não erro.

### Épico D — Documentos do negócio (12 pts)

Do zero: nem upload, nem download, nem storage. O bucket `deal-documents` existe
e nunca recebeu arquivo.

#### D1 — Upload por tipo com renomeação automática (5 pts)
Um slot por tipo de documento, aplicando o `naming_pattern` dos 9 tipos semeados
no ato do envio (ata 23/07). `allows_multiple` (hoje `outros`,
`comprovante_renda`, `simulacao`) aceita vários arquivos; os demais, um só —
regra que `deal_documents_enforce_single` já garante no banco.
- **Arquivos:** `src/components/DealDocumentUpload.tsx` (novo),
  `src/integrations/supabase/documents.ts` (novo),
  `src/components/DealDetailModal.tsx` (integração)
- **Aceite:** arquivo enviado em "Contrato" chega ao bucket com o nome do
  `naming_pattern`; enviar segundo arquivo em tipo de slot único substitui e
  **não apaga** o anterior.

#### D2 — Download e histórico versionado (3 pts)
Download por documento com URL assinada; versões substituídas continuam listadas
como histórico (`deal_documents_supersede` já grava `version`).
- **Arquivos:** os mesmos da D1
- **Aceite:** cada item do histórico baixa em 1 clique; a versão substituída
  aparece marcada, não some.
- **Risco:** RLS de storage esconde documento em vez de dar erro — testar o
  download como corretor, gerente, CCA e diretor.

#### D3 — Documento obrigatório: implementar a decisão (2 pts)
🔒 **Bloqueada até o Douglas decidir.** A ata 23/07 pede documento obrigatório
**na conversão do lead**; o schema exige **na entrada do CCA**
(`required_for_conversion` é lido em `submit_deal_for_analysis`, não em
`convert_lead_to_deal`). Recomendação: manter no CCA e mostrar no card o que
falta — exigir na conversão trava o corretor que ainda não tem o documento.
- **Arquivos:** `src/components/DealDetailModal.tsx`, `src/pages/CcaPipeline.tsx`
- **Aceite:** conforme a decisão registrada na reunião semanal.

#### D4 — Fila de envio para a construtora (2 pts)
`developer_submissions` (destinatário, cópias, assunto, corpo, `document_ids`,
status) está pronta e sem UI. É o passo que fecha a esteira do CCA.
- **Arquivos:** `src/pages/CcaPipeline.tsx`
- **Aceite:** montar o envio escolhendo documentos do negócio e acompanhar o
  status; o envio de e-mail em si entra na J2 (Brevo).

---

## Sprint 4 — Roleta visível e atividades
**17/08 – 23/08 · 21 pts**

**Meta:** o corretor enxerga a própria situação na roleta (turno, fila, atrasos) e
passa a ter agenda dentro do sistema.

### Épico E — Turno, fila e contadores (11 pts)

`Checkin.tsx` hoje calcula a janela do turno no cliente lendo `work_shifts` e usa
`overdue_lead_count` cru. As funções que já resolvem isso no banco não são chamadas.

#### E1 — Turno e elegibilidade vindos do banco (3 pts)
Trocar o cálculo local por `current_shift()` e `checkin_eligibility()`, que já
devolve **o motivo** do bloqueio (+20 atrasados, IP não liberado, fora de turno).
Remover os `(supabase as any)` do arquivo.
- **Arquivos:** `src/pages/Checkin.tsx`
- **Aceite:** bloqueio mostra o motivo específico e a contagem de atrasados; a
  janela do turno bate com o banco mesmo com o admin editando `work_shifts`.

#### E2 — Posição na fila (3 pts)
Requisito ata 23/07. `distribution_queue` está pronta e, desde a `0014`, ordena
pelo fim da última vez — então a posição mostrada já reflete a regra de "quem
estoura o prazo perde a vez".
- **Arquivos:** `src/components/QueuePosition.tsx` (novo), integrado em
  `Checkin.tsx` e `Leads.tsx`
- **Aceite:** corretor em check-in vê "você é o Nº X de Y"; atualiza por realtime
  sem recarregar; quem perde lead por timeout vê a posição cair na hora.

#### E3 — Contador de leads por período (3 pts)
Requisito ata 23/07: recebidos hoje / semana / mês.
- **Arquivos:** `src/components/LeadCounter.tsx` (novo), em `Checkin.tsx` e `Leads.tsx`
- **Aceite:** os três períodos batem com `select count(*) from lead_assignments`
  para o corretor logado.

#### E4 — `AdminAllowedIps`: usar meu IP atual (2 pts)
Facilitador de suporte da ata 23/07, para IP dinâmico. Validar com `ip_is_allowed`.
- **Arquivos:** `src/pages/AdminAllowedIps.tsx`
- **Aceite:** botão preenche o IP do próprio admin; a tela avisa se o IP já está
  coberto por uma faixa cadastrada.

### Épico F — Atividades, visitas e avisos (10 pts)

Três tabelas prontas e sem nenhuma tela.

#### F1 — Atividades com vencimento (5 pts)
Ata 14/07: agendar tarefas com vencimento para retorno ao cliente. `tasks`
(`due_at`, `status`, `priority`, `ref_type`/`ref_id`) e o trigger
`tasks_sync_lead_deadline` já existem.
- **Arquivos:** `src/components/TaskPanel.tsx` (novo),
  `src/integrations/supabase/tasks.ts` (novo), integração em `LeadDetailModal.tsx`
  e `DealDetailModal.tsx`
- **Aceite:** criar, concluir e reagendar atividade com prazo; lista "minhas
  atividades de hoje"; atividade vencida em lead conta no `overdue_lead_count` que
  governa o bloqueio dos 20.

#### F2 — Visitas (3 pts)
`visits` (`scheduled_at`, `performed_at`, `result`, ligada a lead **ou** negócio)
está pronta e sem uso — é o elo que falta entre atendimento e proposta.
- **Arquivos:** `src/components/VisitPanel.tsx` (novo), em `LeadDetailModal.tsx`
- **Aceite:** agendar visita, marcar como realizada com resultado, e a visita
  aparecer no histórico do lead.

#### F3 — Central de notificações (2 pts)
`notifications` (`kind`, `title`, `link`, `channel`, `read_at`) está pronta e
`notify_lead_assigned` grava nela — mas nada lê. Hoje só existe o popup de lead
novo por realtime, que some se o corretor não estiver na tela.
- **Arquivos:** `src/components/NotificationBell.tsx` (novo), em `AppLayout.tsx`
- **Aceite:** sino com não lidas; clicar navega pelo `link` e marca `read_at`;
  notificação gerada offline aparece no próximo login.

---

## Sprint 5 — Gamificação real + BI consolidado
**24/08 – 30/08 · 22 pts**

**Meta:** o jogo passa a ser o que o banco diz, não o que o navegador calculou, e
o fechamento mensal funciona de verdade.

### Épico G — Gamificação no banco (13 pts)

Hoje `Gamification.tsx` pontua com `DEFAULT_SCORING` em `useState`: dois usuários
podem ver rankings diferentes, e nada é auditável.

#### G1 — Regras de pontuação vindas de `game_scoring_rules` (3 pts)
Substituir `DEFAULT_SCORING` pela tabela (`event_code`, `label`, `points`,
`active`, por temporada). A tela de admin passa a gravar nela.
- **Arquivos:** `src/pages/Gamification.tsx`, `src/components/GamificationAdmin.tsx`,
  `src/integrations/supabase/game.ts` (novo)
- **Aceite:** mudar a pontuação de "Venda" na tela altera o ranking de todos;
  `select * from game_scoring_rules` reflete a tela.

#### G2 — Pontos por `game_events` (5 pts)
Parar de recalcular a partir de `deals` no cliente e passar a ler `game_events`,
que `award_game_points` e os triggers `deals_award_points` / `cca_award_points` já
alimentam. `scoring_points()` resolve o peso.
- **Arquivos:** `src/pages/Gamification.tsx`, `src/hooks/useGameRanking.ts`
- **Aceite:** o ranking bate com `select profile_id, sum(points) from game_events`;
  um negócio aprovado gera evento e move o ranking sem reload.

#### G3 — Fechamento de temporada (5 pts)
Ata 14/07, item 4 — marcado como pronto no PLANEJAMENTO e **não está**.
`close_game_season()`, `current_game_season()` e `game_season_results` existem e
nunca foram chamadas. O congelamento do resultado é o que impede o histórico de
mudar retroativamente.
- **Arquivos:** `src/pages/Gamification.tsx`, `src/components/GamificationAdmin.tsx`
- **Aceite:** fechar a temporada congela o resultado em `game_season_results`,
  zera o placar corrente e abre a próxima; temporada fechada não aceita ponto novo;
  o histórico fica consultável.

### Épico H — BI consolidado e marketing (9 pts)

#### H1 — Consolidado anual (3 pts)
`Resultados.tsx` recalcula tudo de `listLegacyDeals()` a cada abertura;
`annual_results` (ano/mês, `sales_count`, `vgv`, upsert único) existe e nunca foi
usada. Ela também é o que respeita `closed_months`.
- **Arquivos:** `src/pages/Resultados.tsx`, `src/integrations/supabase/newSchema.ts`
- **Aceite:** o anual lê o consolidado; mês fechado não muda ao editar negócio
  antigo — essa foi a queixa original de discrepância.

#### H2 — Campanhas e investimento × resultado (4 pts)
`ad_campaigns` (`external_id`, `daily_budget`, `total_spend`, `developer_id`) está
pronta e sem UI. Cruzar com o rastreio granular que o `meta-ads-webhook` já grava
(`campaign_id` / `adset_id` / `ad_id`).
- **Arquivos:** `src/pages/Marketing.tsx`, `src/components/MarketingInvestmentPopup.tsx`
- **Aceite:** custo por lead e por venda **por campanha**; aporte por construtora e
  mês continua funcionando.

#### H3 — Histórico e auditoria (2 pts)
`deal_history` e `cca_case_events` são log imutável escrito por `SECURITY DEFINER`
e ninguém lê. É o "histórico de alterações" que o CCA pediu.
- **Arquivos:** `src/components/DealDetailModal.tsx`, `src/pages/CcaPipeline.tsx`
- **Aceite:** aba de histórico mostra quem mudou o quê e quando, incluindo troca de
  estágio e substituição de documento.

---

## Sprint 6 — SDR, WhatsApp e avisos
**31/08 – 06/09 · 21 pts**

**Meta:** o ciclo template → IA → fila roda ponta a ponta e o sistema avisa o
corretor sem depender de ele estar com a tela aberta.

### Épico I — SDR e remarketing (21 pts)

#### I1 — Disparo do aviso de lead perdido (5 pts)
`notify_lead_timeout` existe no banco e **nada dispara a mensagem**. Ligar ao cron
da `0013`, que já roda a cada 30s.
- **Arquivos:** `supabase/migrations/…_0015_notify_timeout.sql` (novo),
  `supabase/functions/notify-lead-timeout/` (nova)
- **Aceite:** lead expirado gera WhatsApp ao corretor em ≤ 1 min; **idempotente** —
  reprocessar a mesma liberação não manda duas vezes; assert em
  `supabase/tests/04_cron_scheduling.sql`.

#### I2 — Cadastro de templates de WhatsApp (3 pts)
`whatsapp_templates` pronta. O template em si o Douglas cria no Meta.
- **Arquivos:** `src/pages/SdrModule.tsx` (aba)
- **Aceite:** template cadastrado aparece como opção no broadcast, com as
  variáveis validadas antes do envio.
- **Dependência externa:** ≥1 template aprovado no Meta. Cobrar na semana anterior;
  se atrasar, validar com template de sandbox.

#### I3 — Importação de planilha para remarketing (5 pts)
Ata 14/07: importar listas antigas para disparo. `xlsx` já está nas dependências.
- **Arquivos:** `src/pages/SdrModule.tsx`,
  `supabase/functions/sdr-whatsapp-broadcast/index.ts`
- **Aceite:** xlsx/csv importa para `remarketing_contacts` com `normalize_phone` e
  rejeição de telefone inválido visível; disparo em lote respeita o rate limit da
  Cloud API; resposta do contato cai no agente SDR.

#### I4 — Estatísticas de lista (3 pts)
`remarketing_list_stats()` pronta e sem uso.
- **Arquivos:** `src/pages/SdrModule.tsx`
- **Aceite:** por lista — total, válidos, já contatados, respondidos, convertidos.

#### I5 — Handoff SDR → roleta com prova (5 pts)
`sdr_handoff` existe; garantir que o lead qualificado entra na roleta por
`assign_lead` e que a liberação por `sdr_handoff` **não** penaliza o corretor na
fila (a `0014` só penaliza `timeout` — validar que continua assim).
- **Arquivos:** `src/pages/SdrModule.tsx`,
  `supabase/functions/sdr-agent-chat/index.ts`, `supabase/tests/02_business_rules.sql`
- **Aceite:** lead qualificado pela IA aparece na fila do corretor; assert provando
  que `sdr_handoff` não move `last_turn_at`.

---

## Sprint 7 — Integrações externas e endurecimento
**07/09 – 13/09 · 20 pts**

**Meta:** o ponto de integração da IA de voz está pronto **antes** do prazo do
Douglas (~12/09) e o sistema aguenta produção.

### Épico J — Terceiros (11 pts)

#### J1 — Webhook da IA de voz (5 pts) ⏰ prazo ~12/09
Endpoint autenticado que recebe evento da plataforma (lead qualificado,
transcrição, status) e injeta na roleta e no histórico. Autenticação por chave do
cofre (C1/C2), não por env.
- **Arquivos:** `supabase/functions/voice-ai-webhook/` (novo),
  `supabase/migrations/…_0016_voice_ai.sql` (se precisar de tabela de evento)
- **Aceite:** contrato documentado (payload, auth, idempotência) e testado com
  payload simulado; assinatura verificada; replay do mesmo evento não duplica lead.

#### J2 — Brevo no pipeline de e-mails (3 pts)
Escopo mínimo: credencial no cofre + disparo transacional em um evento. O melhor
candidato é o envio da D4 (fila para a construtora), que já monta destinatário,
assunto e anexos.
- **Arquivos:** `supabase/functions/_shared/brevo.ts` (novo) + function do evento
- **Aceite:** e-mail real disparado com os documentos do `developer_submissions`;
  chave vem do cofre; falha de envio marca o status, não some.

#### J3 — Spike King Host (2 pts, timebox 1 dia)
O pedido supõe que exista API de criação de e-mail. Se não houver, o item morre —
registrar a decisão. Aproveitar para responder o SMTP da A1.
- **Arquivos:** `docs/sprints/decisoes.md` (novo)
- **Aceite:** sim/não documentado + esforço estimado se sim.

#### J4 — Decisão sobre o N8N (1 pt)
Com WhatsApp (I1, I3) e e-mail (J2) dentro do sistema, inventariar o que sobrou no
N8N e recomendar: migrar para a VPS ou aposentar.
- **Arquivos:** `docs/sprints/decisoes.md`
- **Aceite:** recomendação por escrito para a reunião semanal.

### Épico L — Engajamento (5 pts) ✅

Estava na ata de 14/07 e **eu tinha deixado de fora do plano revisado** ao
priorizar banco e integrações. O cliente cobrou; entregue em 02/08.

#### L1 — Som e comemoração de venda (3 pts) ✅
A celebração dispara por realtime em `game_events` com `event_code = 'venda'`,
não por UPDATE em `deals`: o evento do jogo é gravado pelo trigger
`deals_award_points` no fechamento, então a festa vem do mesmo fato que pontua.
Escutar `deals` comemoraria qualquer edição de valor.
- **Arquivos:** `src/lib/sound.ts` (novo), `src/components/SaleCelebration.tsx`
  (novo), montado no `AppLayout`
- **Aceite:** ✅ venda fechada dispara fanfarra e card com confete para todos os
  logados; o beep de lead do `NewLeadNotifier` passou a usar o mesmo helper em
  vez de ter a própria cópia.
- **Sem arquivo de áudio:** osciladores WebAudio. O app roda em TV de loja; um
  mp3 é mais um asset para carregar e falhar.

#### L2 — Pódio animado do top 3 (2 pts) ✅
- **Arquivos:** `src/pages/Gamification.tsx`
- **Aceite:** ✅ entrada escalonada 3º → 2º → 1º, primeiro colocado elevado e com
  medalha pulsando, pontuação animando quando muda.

---

### Épico K — Endurecimento (9 pts)

#### K1 — Matriz de RLS por papel no harness (3 pts)
O maior risco recorrente do projeto: RLS esconde dado em silêncio, então tela
migrada errado parece funcionar. Um assert por (tabela × papel) fecha isso de vez.
- **Arquivos:** `supabase/tests/01_rls_visibility.sql`
- **Aceite:** corretor, gerente, diretor, CCA, SDR, marketing e admin cobertos nas
  tabelas de lead, negócio, documento e diário; `./scripts/validate-schema.sh --all` verde.

#### K2 — Tipagem honesta (3 pts)
Remover os `(supabase as any)` — eles anulam justamente os tipos gerados que a
Sprint 1 pagou para regenerar (2.022 → 3.664 linhas).
- **Arquivos:** os que restarem após as Sprints 2–6 (hoje: `Checkin.tsx`, e varrer
  o resto)
- **Aceite:** `grep -rn "supabase as any" src/` retorna vazio, com `tsc` limpo.

#### K3 — Code-splitting e varredura de tema (3 pts)
Bundle único de 2,03 MB. Rota lazy resolve sem reescrever nada. Junto, varrer cor
hardcoded que quebra o tema claro (`useTheme` já existe e funciona).
- **Arquivos:** `src/App.tsx`, `vite.config.ts`, telas com cor fixa
- **Aceite:** chunk inicial < 600 kB; telas principais legíveis nos dois temas.

---

## Fora das sprints

### Épico contínuo — Meta Ads: gestão de campanhas
Budget, pausar, copiar. É o **maior escopo não estimado das atas** e a própria ata
registra que a verificação de empresa imobiliária impede automação total. Tratar
como projeto próprio depois da Sprint 7, com sprint dedicada. Hoje existe só o
webhook de recebimento de leads.

### Pendências operacionais (não são story)
1. `supabase db push` em produção e conferir `select * from public.cron_jobs_health();`
   — três linhas `faceimob-*`, `active = true`, `failures_24h = 0`. Exige
   credencial do projeto. **É pré-requisito de qualquer coisa funcionar em produção.**
2. `src/data/mockData.ts` fica como mock de demo.
3. `director-weekly` e `daily-team-info` são cascas finas sobre RPCs públicas;
   candidatas a exclusão se o frontend chamar a RPC direto.

### Decisões que bloqueiam story
| # | Decisão | Bloqueia | Recomendação |
|---|---|---|---|
| 1 | Documento obrigatório: na conversão ou no CCA? | D3 | manter no CCA e mostrar o que falta no card |
| 2 | King Host tem API de e-mail? | J3 | timebox de 1 dia; se não houver, o item morre |
| 3 | N8N: migrar para a VPS ou aposentar? | J4 | decidir depois da Sprint 6 |
| 4 | Visitas (`visits`) são requisito ou tabela especulativa? | F2 | confirmar com o Douglas; se não for usada, **apagar a tabela** em vez de construir tela |
