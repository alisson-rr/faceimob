# Decisões pendentes e registradas

Atualizado em 10/08/2026. Cada item traz o que já está decidido, o que falta e
qual story fica bloqueada. Decisão tomada vira linha em "Registradas" com data.

> **Auditoria de 08/08:** uma varredura multi-agente comparou as duas atas com o
> código real e derrubou o "tudo entregue" do plano: o modal de negócio não
> persistia nada, quatro telas rodavam sobre mock, o realtime estava vazio no
> remoto, os triggers de log derrubavam UPDATE de usuário autenticado e 43
> funções estavam executáveis por `anon`. Tudo corrigido nas migrations
> 0019–0022 + retrabalho de frontend e edge functions; as decisões novas estão
> na tabela abaixo.

---

## Pendentes — precisam do Douglas

### ~~1. Revisão gerencial dos documentos antes do CCA~~ — RESOLVIDO em 10/08

**Decidido em 10/08:** o dossiê não sai direto do corretor para o CCA. O fluxo é
**corretor → conferência do gerente → CCA**. A etapa de conferência precisa
permitir aprovar ou devolver o dossiê ao corretor.

Regras confirmadas e implementadas:

1. O negócio pode nascer sem anexos. Os documentos obrigatórios travam somente
   **Enviar para conferência do gerente**.
2. Com vários gerentes vinculados, a aprovação de um deles basta; a auditoria
   registra quem decidiu.
3. A devolução exige motivo e gera notificação persistente para os corretores.

**Estado da implementação:** migration `0028`, status e filtro no Pipeline,
ações na aba Anexos, histórico e notificações. A aprovação cria a entrada do CCA
ou da construtora externa e move o negócio para Em análise na mesma transação.
Chamada direta e arraste de card não pulam a conferência. SQL e E2E cobrem
corretor, dois gerentes, devolução e aprovação.

---

### ~~2. King Host tem API de criação de e-mail?~~ — ENCERRADO em 02/08

**Decisão do cliente: usar o Brevo.** O item morre como previsto no timebox.

Consequência: o e-mail corporativo do colaborador continua sendo criado à mão
pelo admin; o sistema não cria caixa postal. O Brevo cobre o que o requisito
realmente queria (o sistema mandar e-mail), e `_shared/brevo.ts` já está pronto.

**Story J3 encerrada sem código.** Nada a implementar.

---

### ~~3. N8N: migrar para a VPS ou aposentar?~~ — DECIDIDO em 02/08

O cliente delegou a escolha, com critério de **desempenho e confiabilidade**.

**Decisão: aposentar o N8N.** Por esses dois critérios ele perde nos dois.

**Confiabilidade.** O N8N na VPS é um ponto de falha fora do Supabase: uptime
próprio, cópia própria das credenciais (fora do cofre, portanto sem rotação
pela tela) e nenhuma relação com o RLS — um workflow com credencial ampla
ignora toda a hierarquia de visibilidade que o banco garante. As edge functions
rodam no mesmo runtime gerenciado do resto e leem o cofre.

**Desempenho.** Todo salto pelo N8N adiciona latência ao caminho do lead — e o
caminho do lead tem trava de 5 minutos, onde segundos contam. O
`meta-ads-webhook` hoje recebe e chama `assign_lead` na mesma requisição.

**O que já foi absorvido** (nada disso precisa do N8N):

| Automação | Onde roda agora |
|---|---|
| Lead do Meta entra na roleta | `meta-ads-webhook` |
| Aviso de lead perdido por prazo | `notify-dispatch` (Sprint 6) |
| Broadcast de remarketing | `sdr-whatsapp-broadcast` |
| E-mail transacional | `_shared/brevo.ts` + `submission-dispatch` |
| Agendamento recorrente | pg_cron (`0013`, `0018`) |

**Passo obrigatório antes de desligar** — e é o único que não consigo fazer
daqui, porque exige o painel do N8N: listar os workflows ativos e conferir
contra a tabela acima. Se aparecer automação fora dela, ela vira story antes do
desligamento. Se não aparecer, cancelar a assinatura.

---

### ~~4. `visits` é requisito real ou tabela especulativa?~~ — RESOLVIDO em 02/08

É requisito real: é a **visita ao imóvel com o cliente** — data marcada, data
realizada, resultado (realizada / não compareceu / cancelada) e observações. É o
elo entre atendimento e proposta, e o funil já tinha a etapa "Visita Agendada".

A pergunta expôs um problema pior que a dúvida original: **existiam dois
conceitos de visita e nenhum persistia direito.** O Pipeline tinha um botão de
marcar visita que só mudava a etapa do negócio e guardava a data em estado
local — sumia no reload —, enquanto a tabela `visits`, com o modelo completo,
nunca recebia nada.

**Resolvido:** o agendamento pelo Pipeline agora grava em `visits` além de mover
o card, e o `VisitPanel` (lead e negócio) lê e fecha a visita com resultado.

---

## Registradas

| Data | Decisão | Onde ficou |
|---|---|---|
| 30/07/2026 | Lead que estoura o prazo pode voltar ao mesmo corretor, desde que passe pela fila inteira de novo | Migration `0014`, ordenação por `last_turn_at` |
| 02/08/2026 | Login sem senha: acesso só por código no e-mail (OTP) | `Login.tsx`, `provision-broker-user`, `create-user.ts` |
| 02/08/2026 | Item de menu vira código de permissão no catálogo existente, em vez de tabela nova | Migration `0015` |
| 02/08/2026 | Leitura do cofre pelas edge functions passa por wrapper em `public` restrito a `service_role` — `private` não é exposto pelo PostgREST | Migration `0016` |
| 02/08/2026 | Pré-visualização de papel é ferramenta de admin, travada no `AuthContext` | `RoleSwitcher.tsx`, `AuthContext.tsx` |
| 02/08/2026 | Pontuação do jogo sai de `game_events`; os códigos são os do banco (`aprovado`, `distrato`), não os inventados no front | `game.ts`, `Gamification.tsx` |
| 02/08/2026 | Consolidado anual é fonte de verdade; recálculo pelo pipeline vira ação explícita | `Resultados.tsx` |
| 02/08/2026 | E-mail é pelo Brevo; King Host sai de escopo | `_shared/brevo.ts` |
| 02/08/2026 | N8N será aposentado (critério: desempenho e confiabilidade), após inventário dos workflows ativos | este documento |
| 02/08/2026 | `visits` é a visita ao imóvel; o Pipeline passa a persistir nela | `Pipeline.tsx`, `VisitPanel.tsx` |
| 02/08/2026 | Som e comemoração de venda disparam por `game_events` (`event_code = 'venda'`), não por UPDATE em `deals` | `SaleCelebration.tsx`, `lib/sound.ts` |
| 02/08/2026 | Typecheck do projeto é `npm run typecheck`; `npx tsc --noEmit` na raiz não checa arquivo nenhum | `package.json`, `.claude/CLAUDE.md` |
| 02/08/2026 | Agendamento da fila de WhatsApp lê URL e chave do cofre, não de GUC | Migration `0018` |
| 05/08/2026 | Cron `faceimob-notify-dispatch` pausado (`active = false`) enquanto não há credencial do WhatsApp — a fila em `notifications` segue sendo populada e é o que se verifica em teste | `cron.job` no remoto, `roteiro-teste-completo.md` |
| 05/08/2026 | Testador passa a ser `dev.alisson.rosa@gmail.com`. Troca de e-mail exige as três fontes juntas (`auth.users`, `auth.identities.identity_data`, `profiles`) — não há trigger de sync e o dashboard não expõe edição de e-mail | `auth`/`profiles` no remoto, seeds `050`/`059` |
| 08/08/2026 | Superfície anônima volta a ser exatamente as 3 RPCs do Diário: revoke em massa + default privileges + tripwire no harness | Migration `0019`, `tests/06_anon_surface.sql` |
| 08/08/2026 | Triggers de log (`leads/deals/cca`) viram SECURITY DEFINER — update direto por authenticated derrubava no RLS de `lead_events` e o front engolia o erro | Migration `0020`, `tests/07_core_fixes.sql` |
| 08/08/2026 | Matriz de estágios vale no servidor: `deals_guard_stage` aplica `can_enter`/`can_exit` (automação com `auth.uid()` nulo passa direto) | Migration `0020` |
| 08/08/2026 | "Status 2" (34 rótulos) persiste em `deals.status_detail`; a aba CCA do modal persiste em `cca_cases.analysis` (jsonb) | Migration `0020`, `saveLegacyDeal` |
| 08/08/2026 | Check-in exige IP identificado (RPC recusa nulo) e o `broker-checkin` confia só no último salto do `x-forwarded-for` | Migration `0020`, `broker-checkin` |
| 10/08/2026 | **Revoga a linha acima na parte do header**: medição na hospedagem mostrou que o último salto do XFF é o Global Accelerator da AWS (`13.248.114.x`, rotativo) — check-in negava ou passava conforme o nó. Fonte confiável é `sb-forwarded-for`/`cf-connecting-ip` (forja testada e descartada pelo gateway); o último salto do XFF fica só como fallback do stack local. A faixa `13.248.114.149/32` cadastrada por engano virou o IP real do testador | `broker-checkin` (v4 no remoto), `allowed_ips` |
| 10/08/2026 | Kit de demo ganha `--remote` (homologação via `.env` + `SUPABASE_SERVICE_ROLE_KEY`) e `--email` para usar o corretor real; ensaio completo da roleta validado no remoto (check-in → lead → `assign_lead` escolhendo o testador) e desfeito | `scripts/demo.mjs` |
| 08/08/2026 | Lead preso em `queued` é revarrido por cron a cada minuto; conversa SDR ativa fica fora da varredura | Migrations `0020`/`0022` |
| 08/08/2026 | Fila de dossiês à construtora ganhou o gatilho que faltava (`dispatch_pending_submissions` + cron); `requeueSubmission` zera `attempts` | Migration `0020`, `developerSubmissions.ts` |
| 08/08/2026 | "Fechar Mês" do Pipeline usa `close_month_and_season()`: propostas migram, mês trava e temporada encerra numa transação | Migration `0021`, `Pipeline.tsx` |
| 08/08/2026 | SDR ponta a ponta: origem com `sdr_agent_id` abre conversa + template de boas-vindas em vez de cair na roleta; `whatsapp-inbound-webhook` roteia respostas (lead e remarketing) para o agente; qualificação por tag `[QUALIFICADO]` dispara `sdr_handoff` | `meta-ads-webhook`, `whatsapp-inbound-webhook`, `_shared/sdrAgent.ts` |
| 08/08/2026 | Webhooks da Meta validam `X-Hub-Signature-256` quando `META_APP_SECRET` estiver no cofre; sem ele, modo de transição com aviso no log. Fallback hardcoded do verify token removido | `_shared/meta.ts`, catálogo de integrações |
| 08/08/2026 | `daily-team-info`, `submit-daily-report` e `director-weekly` aposentadas (respondem 410) — eram código morto que convertia team_id em slug com service role | stubs nas três functions |
| 08/08/2026 | `mockData.ts` apagado; Pipeline, modal de negócio, Marketing, AdminDevelopers, Dashboard e Gamification só usam dados do banco | telas citadas |
| 08/08/2026 | Modal de negócio persiste tudo por `saveLegacyDeal` (deals + 2 clientes + corretores + gerentes); comentário manual do negócio via RPC `add_deal_comment` | `newSchema.ts`, `DealDetailModal.tsx` |

| 08/08/2026 | Privilégios de tabela passam a viver nas migrations (`0023`). Um banco criado só pelas migrations nascia com as 58 tabelas inacessíveis — o remoto só funcionava porque o Supabase concedeu na criação do projeto, e o harness *simulava* os grants nos stubs | Migration `0023`, `tests/06_anon_surface.sql`, `tests/00_supabase_stubs.sql` |
| 08/08/2026 | Escalada de privilégio fechada no remoto: `assign_lead`, `award_game_points`, `release_expired_leads` e `auto_checkout_expired` eram executáveis por qualquer usuário logado. O `revoke ... from public, anon` das migrations originais não remove a concessão nominal que a plataforma dá a `authenticated` | Migration `0023`, `tests/08_frontend_rpc_grants.sql` |
| 08/08/2026 | Concessão de `execute` é em bloco para `authenticated` com revogação nominal das internas — lista de permitidos não funciona porque as policies de RLS chamam helpers e a expressão roda como o usuário | Migration `0023` |
| 08/08/2026 | E-mail de acesso passa a conter o código (`{{ .Token }}`). O template padrão do Supabase manda só o link, e a tela pede seis dígitos: quem recebesse aquele e-mail não teria o que digitar | `supabase/templates/magic_link.html`, `config.toml` |
| 08/08/2026 | `seed_tester` sai de `pg_temp` e vira arquivo próprio (`045_tester_ref.sql`). O seeder do CLI manda cada arquivo como um lote só, então criar e usar o objeto no mesmo arquivo falha — era isto que quebrava `npm run db:reset` | `seeds/045_tester_ref.sql`, `seeds/050`, `config.toml` |
| 08/08/2026 | Suíte E2E autentica pelo OTP de produção, com o código vindo da Admin API. Nada de bypass, usuário falso ou volta da senha — sem JWT real o RLS não é exercitado e a suíte passaria com corretor vendo a empresa inteira | `e2e/README.md`, `e2e/support/session.ts` |

| 10/08/2026 | **IP de host único voltou a liberar o check-in.** `ip_is_allowed` comparava com `<<` (contido *estritamente*): para um `/32` isso é sempre falso, então o IP fixo da loja era cadastrado, aparecia na lista com toast verde e não liberava ninguém. Agora `<<=` | Migration `0024`, `tests/09_ip_host.sql` |
| 10/08/2026 | Tela de SDR deixou de quebrar: `<SelectItem value="">` é recusado pelo Radix (string vazia é o valor que limpa a seleção) e derrubava a aba Agentes inteira no ErrorBoundary. Sentinela `SEM_SELECAO` | `SdrModule.tsx` |
| 10/08/2026 | Um `<h1>` por página: o título da barra do topo virou `<p>`. Dois `<h1>` quebram a navegação por cabeçalho do leitor de tela; Configurações e Gestão de dados ganharam o próprio | `AppLayout.tsx`, `Settings.tsx`, `DataManagement.tsx` |
| 10/08/2026 | Modal de negócio ganhou `DialogTitle` (visualmente oculto): sem ele o Radix avisa no console e quem usa leitor de tela ouve só "diálogo" | `DealDetailModal.tsx` |
| 10/08/2026 | Trigger `profiles_guard_admin_columns` **não** foi afrouxada para o teste passar. `service_role` não é admin (não tem `auth.uid()`), então o cenário que libera bypass de IP usa o JWT do admin E2E — o caminho real de quem concede | `e2e/support/fixtures.ts` (`comoAdmin`) |
| 10/08/2026 | Asserção de placar compara tela × `game_ranking`, não tela × número fixo: o banco é compartilhado entre projects e o número absoluto testava o isolamento do ambiente, não a regra | `e2e/{admin,broker}/gamificacao.spec.ts` |
| 10/08/2026 | **Corretor 1/2 e Gerente 1/2 trocavam de lugar no reload.** `deal_participants` não guardava o slot e a leitura o reconstruía por `created_at` — que é idêntico para todas as linhas do mesmo insert. Pior que cosmético: o corretor reabria o negócio, via o nome errado no slot obrigatório e "corrigia", trocando de verdade quem responde pelo negócio | Migration `0025`, `newSchema.ts` |
| 10/08/2026 | **Corretor perdia o próprio negócio ao salvar.** `saveLegacyDeal` apagava os participantes antes de reinserir — e é justamente estar em `deal_participants` que dá o direito de editar (`can_edit_deal`). O delete passava, o insert voltava 403 e o negócio saía da vista dele, sem como desfazer. Agora grava primeiro (upsert) e remove só as sobras | `newSchema.ts` |
| 10/08/2026 | Campo de participante vazio significa "não sei", não "remova": o corretor não enxerga o nome do gerente (RLS de `profiles` devolve só ele mesmo), então salvar apagaria o gerente do negócio — e o acesso dele junto. A limpeza é por papel e só quando o formulário trouxe alguém daquele papel | `newSchema.ts` |
| 10/08/2026 | Indicador de posição na fila passa a ouvir `checkins`, não só `lead_assignments`: quem batia ponto continuava lendo "fora da fila agora" até recarregar | `QueuePosition.tsx` |
| 10/08/2026 | Filtros do Pipeline ganharam `aria-label`. O gatilho do Select passa a mostrar o valor escolhido, então sem nome próprio o campo deixa de ser identificável — para leitor de tela e para qualquer um que precise achá-lo depois de filtrar | `Pipeline.tsx` |
| 10/08/2026 | Preparo da suíte exige o runtime de edge functions de pé. Com ele fora, o check-in não confirma e a falha aparece como "não achei 'check-in confirmado'" — ambiente disfarçado de defeito | `e2e/global-setup.ts` |
| 10/08/2026 | Dois `fixme` do SDR viraram teste de verdade junto com a correção do `SelectItem`: escolher agente de handoff e agente inicial da simulação passaram a funcionar — era o orquestrador multi-agente da ata, que não existia pela tela | `e2e/sdr/agentes.spec.ts` |
| 10/08/2026 | Roteiro de demonstração da fila de leads (`npm run demo` → `demo/fila-de-leads.webm`): app real, sessão real, e cada passo confere no banco antes de seguir — demonstração que "funciona só na tela" falha em vez de virar vídeo | `e2e/demo/fila-de-leads.spec.ts` |
| 10/08/2026 | Corretor pode ver os nomes de todos os gerentes vinculados ao próprio negócio; um negócio pode ter vários corretores e vários gerentes. A abertura vale só para participantes do mesmo negócio e não amplia a visibilidade de leads | Migration `0027`, RPC `deal_participant_names`, E2E do corretor |
| 10/08/2026 | Ranking do corretor mostra todos os corretores da equipe ativa dele. A consulta é separada da autorização de leads/negócios, portanto a carteira dos colegas continua privada | Migration `0027`, RPC `visible_game_ranking`, Gamificação e pódios |
| 10/08/2026 | Dossiê passa por corretor → gerente → CCA; negócio nasce sem anexos, obrigatórios travam o envio ao gerente, um gerente aprova e devolução exige motivo/notifica os corretores | Migration `0028`, Pipeline/Anexos, testes SQL e E2E |
| 10/08/2026 | A data exibida do check-in vem do mesmo `current_date` usado pelo banco; o navegador não recalcula “hoje”, evitando a presença invisível entre 21h e 21h30 | Migration `0029`, `current_work_date`, E2E da roleta |
| 10/08/2026 | O papel CCA recebe `menu.pipeline` porque o formulário de análise fica na aba CCA do modal de negócio; as policies já limitavam a edição ao CCA/admin | Migration `0030`, E2E completo da CCA |
| 10/08/2026 | Suíte E2E roda **serial** (`workers: 1`): todos os projects apontam para o mesmo banco e vários mexem no mesmo corretor (um atribui lead e o modal "Lead atribuído a você!" cobre a tela de outro; outro fecha a temporada no meio da contagem de pontos). Paralelismo volta quando houver um banco por worker | `playwright.config.ts` |
| 10/08/2026 | Erro de console esperado passa a ser **declarado** (`test.use({ errosEsperados: [...] })`), nunca silenciado em bloco: um teste que provoca 400/403/503 de propósito precisa do erro como prova, e qualquer outro continua reprovando | `e2e/support/fixtures.ts` |
| 10/08/2026 | Diário e Checkpoint públicos registram `last_seen_at`, portanto as RPCs são `VOLATILE`; o Checkpoint consome o contrato real `director`/`team_id`/`team_name` e link protegido devolve apenas `pin_required` antes da validação | Migration `0026`, `PublicDirectorCheckpoint.tsx`, testes anônimos |

| 10/08/2026 | O SDR pode cadastrar `lead_sources` e vincular agente/template existente; editar o conteúdo do template continua restrito a admin/marketing | Migration `0031`, `SdrModule.tsx` |
| 10/08/2026 | Importação de remarketing é atômica: lista e contatos nascem na mesma RPC e qualquer telefone inválido desfaz tudo | Migration `0031`, `import_remarketing_list`, E2E SDR |
| 10/08/2026 | Métrica de campanha usa agregado `security definer` autorizado por papel; marketing conta leads já distribuídos sem ganhar SELECT dos dados pessoais | Migration `0031`, `marketing_campaign_stats`, E2E Marketing |
| 10/08/2026 | Broadcast do WhatsApp autentica e autoriza antes de ler o cofre; o frontend mostra o corpo JSON da Edge Function em vez do erro genérico do SDK | `sdr-whatsapp-broadcast`, `functionError.ts` |
| 10/08/2026 | Aporte segue a policy existente: admin e marketing escrevem; diretor e sócio apenas leem | `Marketing.tsx`, `marketing_investments_write` |

### Pendências operacionais novas (não são código)

1. **Meta global de vendas**: o Dashboard agora lê `goals` (`scope='global'`,
   `metric='sales'`) e mostra "—" até existir a linha — não há UI para meta
   global; inserir via SQL ou evoluir a tela Equipes.
2. **`META_APP_SECRET`**: cadastrar em Integrações quando o Douglas fornecer,
   para o webhook passar a recusar POST sem assinatura.
3. **Webhook de mensagens no painel da Meta**: apontar o campo *messages* do
   app WhatsApp para `/functions/v1/whatsapp-inbound-webhook` (mesmo verify
   token do meta-ads).
4. **Cron `faceimob-notify-dispatch`** segue pausado até haver credencial do
   WhatsApp (decisão de 05/08 continua valendo).
5. **Template de e-mail no remoto**: colar o conteúdo de
   `supabase/templates/magic_link.html` em Authentication → Emails → Magic Link
   (ou `supabase config push`). Enquanto não for feito, quem tentar entrar
   recebe um e-mail **sem código nenhum** para digitar — a tela pede seis
   dígitos e o template padrão só manda link. É o item mais urgente da lista.
6. **SMTP do Brevo em Authentication → Emails**: o remetente embutido do
   Supabase recusa endereço fora da equipe e tem cota baixa por hora.
