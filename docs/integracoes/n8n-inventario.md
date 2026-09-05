# Aposentar o N8N — inventário antes de desligar

Decisão registrada em 02/08/2026 (critério do cliente: desempenho e
confiabilidade): **aposentar o N8N**. As automações foram reescritas em código
nosso.

O que falta é o passo que `docs/sprints/decisoes.md` chama de obrigatório antes
de desligar: **listar os workflows ativos no painel** e conferir contra a tabela
abaixo. Só o Douglas tem acesso ao painel na VPS. É meia hora de tela, não é
desenvolvimento.

---

## Tabela de absorção

| Automação no N8N | Quem faz hoje no FACEIMOB | Funciona agora? |
|---|---|---|
| Lead do Meta entra e é distribuído | `meta-ads-webhook`, que chama `assign_lead` na mesma requisição | **Sim** |
| Agendamento recorrente | `pg_cron`, 10 jobs `faceimob-*` (8 + os dois da 0083: alerta de job com falha e aviso de atividade vencida) | **Sim** |
| Aviso de lead perdido por prazo | `notify-dispatch` + cron | **No sino, sim; por WhatsApp, não** — falta credencial da Cloud API |
| Broadcast de remarketing | `sdr-whatsapp-broadcast` | **Não** — falta credencial da Cloud API |
| E-mail transacional | `_shared/brevo.ts` + `submission-dispatch` | **Escrito e com credencial, mas nenhum envio real registrado** |

Duas das cinco dependem da mesma credencial que falta no cofre (ver
[whatsapp-cloud-api.md](./whatsapp-cloud-api.md)). Uma nunca foi provada em
produção.

Sobre a terceira linha, para a decisão de desligar não ser tomada com
informação errada: o gatilho `notify_lead_timeout` grava as duas cópias do
aviso — a `in_app`, que **já chega ao corretor pelo sino**, e a `whatsapp`, que
fica na fila esperando o token. Enquanto o token não entrar, o canal de
WhatsApp continua sendo só o do N8N.

---

## O que pedir ao Douglas

No painel do N8N, para **cada workflow com o botão Active ligado**:

1. Nome do workflow.
2. O que dispara (webhook / agendamento / manual).
3. O que ele escreve — Supabase, WhatsApp, e-mail, planilha, outro sistema.
4. Última execução com sucesso.

Uma captura de tela da lista de workflows já resolve os itens 1, 2 e 4.

O que se procura: **workflow ativo que não tenha linha na tabela acima**. Esse é
o risco real de desligar — automação que ninguém lembra que existe e que só
aparece quando para.

---

## Quem manda enquanto os dois rodam

Hoje os dois sistemas mexem nos mesmos leads e **nenhum documento diz qual é
autoritativo**. O risco concreto é aviso duplicado ou lead distribuído duas
vezes.

**Decidido em 06/09/2026** (era recomendação; virou decisão, e o que resta é
ato no painel do Douglas, não desenvolvimento):

- **Distribuição de lead: desligar o workflow do N8N — no mesmo ato em que a
  credencial da Meta entrar, não antes.** O `meta-ads-webhook` chama
  `assign_lead` na mesma requisição, então não há janela em que o N8N chegue
  primeiro sem gerar disputa: manter os dois é convidar o lead a ser distribuído
  duas vezes. **Mas há uma ordem obrigatória**, conferida no cofre e no código em
  02/09/2026: o cofre tem quatro credenciais e **nenhuma é da Meta**
  (`brevo` × 2, `supabase` × 2), e `meta-ads-webhook/index.ts:164-173` recusa com
  401 todo POST com corpo da Meta sem assinatura válida. Ou seja: **hoje a
  entrada de lead pela Meta não funciona**, e desligar o workflow do N8N agora
  não trocaria um caminho por outro — apagaria o único que existe.

  A sequência de um ato só, na ordem:

  1. Cadastrar `meta/app_secret` e `meta/webhook_verify_token` em
     **Admin → Integrações** (sem o verify token o handshake do painel da Meta
     devolve 403 e o webhook nem chega a ser assinado).
  2. Assinar o webhook de Lead Ads no painel da Meta, apontando para
     `meta-ads-webhook`, e confirmar **um lead entrando de verdade**.
  3. Só então desligar o workflow de distribuição no N8N.

  **Consequência de inverter os passos:** a operação fica sem entrada de leads,
  e o sintoma ("parou de chegar lead") aparece horas depois, longe da causa.

  Enquanto o N8N for a ponte, vale uma limitação medida:
  `meta-ads-webhook/index.ts:163-179` só marca `origemProvada` quando o corpo
  vem assinado pela Meta **ou** quando a chamada traz a chave de serviço — o POST
  direto do N8N não traz nenhuma das duas. O lead entra e vai para a roleta
  normalmente, mas **não aciona o SDR por IA**: quem atende é humano.
- **WhatsApp: manter o N8N ligado** até a Cloud API oficial entregar a primeira
  mensagem de verdade. Hoje ele ainda é o único caminho vivo para o aviso de
  lead perdido por prazo.
- **Cancelar a assinatura só depois** de as duas mensagens (aviso de prazo e
  broadcast) terem saído pelo caminho novo, com registro.

**Consequência de desligar tudo hoje:** o corretor deixa de ser avisado quando
perde um lead por prazo, e ninguém percebe até alguém reclamar. **Consequência
de adiar:** continua-se pagando a assinatura e convivendo com dois sistemas
sobre o mesmo dado.

---

## Como ficará provado

Não há teste automatizado de paridade com o N8N e não vai haver: não temos
acesso ao painel para ler o outro lado. O que existe é cobertura das
substitutas — `supabase/tests/04_cron_scheduling.sql` e
`supabase/tests/65_notificacoes_crons.sql` provam que o agendamento substituto
existe, está ativo e chama a função certa; `supabase/tests/20_lead_automation.sql`
prova a varredura de sem-resposta.

A prova de paridade é o inventário desta página, feito uma vez, com data.

A partir da 0083 há mais uma rede embaixo: `notify_cron_failures()` roda de hora
em hora e avisa admin e diretoria, **no sino**, quando qualquer job `faceimob-*`
falha. Antes disso, `failures_24h` só existia para quem abrisse a aba de
Integrações — e o sintoma de um cron parado aparece longe da causa (lead que não
volta para a roleta, dossiê que não sai) e dias depois. Coberto por
`supabase/tests/83_notificacoes_crons.sql` §5.
