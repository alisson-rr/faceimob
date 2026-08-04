# Decisões pendentes e registradas

Atualizado em 02/08/2026. Cada item traz o que já está decidido, o que falta e
qual story fica bloqueada. Decisão tomada vira linha em "Registradas" com data.

---

## Pendentes — precisam do Douglas

### 1. Documento obrigatório: na conversão ou na entrada do CCA?
**Bloqueia:** D3 (Sprint 3).

A ata de 23/07 pede documento obrigatório **ao converter lead em negócio**. O
schema exige na **entrada da esteira do CCA**: `required_for_conversion` é lido
por `submit_deal_for_analysis`, não por `convert_lead_to_deal`. São momentos
diferentes do fluxo.

| Caminho | Consequência |
|---|---|
| Exigir na conversão | O corretor que fechou verbalmente e ainda não tem o RG em mãos fica travado; tende a criar negócio "de mentira" para destravar |
| Exigir no CCA (como está) | Negócio entra no pipeline incompleto, mas o CCA nunca recebe dossiê furado |

**Recomendação:** manter no CCA e mostrar no card o que falta. O painel de
documentos já calcula isso (`missingRequiredTypes`) e o `DealDocumentUpload` já
mostra "Faltam N obrigatórios" — implementar a decisão contrária é mover a
verificação, não construir do zero.

**Estado da implementação:** o aviso do que falta já está na tela. Só a trava
(bloquear a conversão) depende da decisão.

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
