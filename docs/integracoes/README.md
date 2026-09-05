# Integrações — contratos e o que falta em cada uma

Um documento por integração que fala com sistema de terceiro. Serve para duas
coisas: **entregar o contrato ao fornecedor** sem ele precisar ler nosso código,
e **dizer em uma linha por que a integração ainda não funciona**.

Regra deste diretório: o contrato mora aqui, não num comentário de `index.ts`.
Até 02/09/2026 o contrato do webhook de voz existia só como comentário — e o
comentário documentava um campo (`source_code` como coluna de `leads`) que nunca
existiu. Ninguém percebeu porque nenhum teste tocava a function e o documento
nunca foi lido por quem o usaria.

## Estado em 06/09/2026

| Integração | Nosso lado | Falta | De quem |
|---|---|---|---|
| [IA de voz](./voice-ai-webhook.md) | pronto e corrigido | segredo compartilhado, formato do evento, ambiente de homologação | Douglas / fornecedor |
| [WhatsApp Cloud API](./whatsapp-cloud-api.md) | pronto, com envio por template e fila com teto de 2 h | `META_WHATSAPP_ACCESS_TOKEN`, `META_WHATSAPP_PHONE_NUMBER_ID`, `META_APP_SECRET` e o **nome de um template aprovado** | Douglas (Business Manager) |
| [Meta Marketing API](./meta-marketing-api.md) | nada — não dá para dimensionar sem a conta | id da conta de anúncios, token com `ads_management`, revisão do app | Douglas |
| [Aposentar o N8N](./n8n-inventario.md) | 4 das 5 automações absorvidas | inventário dos workflows ativos no painel | Douglas (30 min de tela) |
| E-mail transacional (Brevo) | pronto, com "Testar conexão" e recusa de remetente inválido | corrigir `brevo/sender_email` no cofre (hoje guarda a chave de API) e um envio real com anexo | nosso |
| King Host (e-mail corporativo) | encerrado em 02/08, **reconfirmado em 06/09** | nada — resolvido por Brevo | — |
| Evolution API (WhatsApp não oficial) | **não construída, por decisão** | nada; vira meio dia de adaptador se o token oficial não chegar | — |

## Onde as credenciais vivem

`private.integration_credentials`, um schema que o PostgREST **não** expõe. Quem
grava é **Admin → Integrações**; quem lê é `supabase/functions/_shared/secrets.ts`,
com `Deno.env` só como retaguarda.

Nada com prefixo `VITE_` é segredo: esse prefixo é substituído no build e vai
para o bundle do navegador.

## King Host — encerrado, e por quê

O item 13 da ata de 14/07 pedia que **o sistema criasse o e-mail corporativo** no
cadastro do colaborador. Encerrado por decisão de 02/08: o que o requisito
queria de fato — *o sistema mandar e-mail* — é o Brevo, que está no ar e com
credencial no cofre desde 10/08.

Criar a caixa postal continua sendo ato de administrador, uma vez por
contratação. Automatizar isso custaria uma integração inteira (API da King Host,
credencial nova, tratamento de falha, tela) para poupar cinco minutos por
pessoa contratada.

**Consequência de manter encerrado:** quem contrata precisa lembrar de criar a
caixa no painel da King Host antes do primeiro acesso. **Consequência de
reabrir:** uma integração a mais para manter viva, pelo mesmo resultado.

Reconfirmado em 06/09/2026. Registre-se o que o encerramento **não** afirma: a
viabilidade da API da King Host nunca foi investigada — a decisão é de
custo/benefício, não de impossibilidade comprovada. Se um dia a contratação
passar a ser semanal, o cálculo muda e o assunto volta.

## WhatsApp: por que a Cloud API oficial e não a Evolution API

A empresa já paga a Evolution API e a usa hoje pelo N8N. Mesmo assim o canal
implementado é o **oficial** (WhatsApp Cloud API), nas duas pontas — envio
(`notify-dispatch`, `sdr-whatsapp-broadcast`) e recebimento
(`whatsapp-inbound-webhook`).

O motivo é o conteúdo: a mensagem que sai por aqui é **aviso ao próprio
corretor** de que ele perdeu um lead por prazo. Número não oficial é passível de
bloqueio pela Meta, e o bloqueio chega no pior momento — a operação perde o
canal justamente quando está distribuindo lead.

A Evolution fica como plano B, **não construída** — reconfirmado em 06/09/2026.
Adotá-la é escrever um adaptador de envio (`sendWhatsApp` em
`supabase/functions/notify-dispatch/index.ts` já é o único ponto que fala com o
provedor) e trocar o slot de credencial. Meio dia de trabalho que **some no dia
em que o token oficial chegar**.

**Consequência de não construir agora:** enquanto a Cloud API não entregar a
primeira mensagem, o aviso de lead perdido por WhatsApp continua saindo pelo
workflow do N8N — que por isso **não pode ser desligado junto com o de
distribuição** (ver [n8n-inventario.md](./n8n-inventario.md)). **De construir:**
duas integrações de WhatsApp para manter vivas, e a de baixo é a que a Meta pode
bloquear.

## Atos do dono — não é código, e um deles deixa um teste vermelho

### 🔴 `brevo/sender_email` guarda a chave de API, não um e-mail

Conferido no cofre da homologação em 02/09/2026, **sem imprimir o valor**: 89
caracteres, começa com `xkeysib`, sem `@`, e é **byte a byte igual** a
`brevo/api_key`. A tela de Integrações mostra "no cofre" e nada a contradiz.
Todo envio de dossiê à construtora morreria na Brevo com remetente inválido.

**O conserto é de um minuto e só o dono pode fazer** (nenhum agente escreve no
banco remoto): Admin → Integrações → `brevo / sender_email` → gravar o endereço
**verificado no painel da Brevo** (ex.: `dossie@suaempresa.com.br`).
`validarCredencial("email", …)` já barra a gravação errada, e o worker recusa o
envio antes de chamar a Brevo — o dossiê não sai calado, mas também não sai.

A partir desta rodada isso **reprova um teste**:
`e2e/admin/crons.spec.ts` → *"a credencial do Brevo, quando cadastrada, é
utilizável de verdade"* pergunta ao próprio provedor (`/v3/senders`, leitura
pura, nenhum e-mail enviado) e falha com o motivo escrito. Em ambiente sem Brevo
nenhum (o alvo local) o teste se retira sozinho: o que ele cobra é a **metade
configurada**, que é pior do que nada.

### Credenciais que faltam no cofre

Quatro entradas, todas internas (`brevo` × 2, `supabase` × 2). **Nenhuma da Meta,
nenhuma da OpenAI, nenhuma do fornecedor de voz.** É essa a razão de os quatro
endpoints de borda nunca terem processado um evento. Cada documento deste
diretório diz qual slot destrava o quê.

---

## Quem enxerga a fila de dossiês (pergunta que estava em aberto)

Medido nas policies de `developer_submissions` em 02/09/2026:

| Papel | Lê a linha? | Tem tela? |
|---|---|---|
| `cca`, `admin` | sim (`has_any_role('admin','cca')`) | sim — o diálogo dentro de `/cca` |
| corretor, gerente, diretor do negócio | **sim** (`can_see_deal(deal_id)`) | **não** |
| demais | não | — |

Escrever exige `cca.review`, que só o `cca` (e o admin) tem — por isso
`requested_by` é sempre alguém que consegue abrir `/cca`, e o link do aviso de
dossiê morto (migration 0083) não aponta para uma tela fechada ao destinatário.

O que sobra é o lado da leitura: **quem toca o negócio pode ler que o dossiê
falhou e não tem onde ver isso**. Não é vazamento (a linha é do negócio dele), é
uma tela que não existe. Enquanto não existir, quem descobre é o CCA pelo
diálogo e quem pediu pelo sino.

---

## Pendências em arquivos de outras frentes (diffs exatos)

Os arquivos pertencem a outras frentes que escrevem na mesma árvore agora. O diff
fica escrito por extenso para ser aplicado sem refazer o diagnóstico. Ordem: o
que **quebra um teste verde** primeiro, depois o que mente para o usuário.

### 1. Campo do template de WhatsApp no catálogo da tela — aplicar JUNTO com a 0083

`src/lib/integrationCatalog.ts`, na lista `INTEGRATION_SLOTS`, ao lado dos outros
slots `meta`.

A 0083 acrescentou `META_WHATSAPP_NOTIFY_TEMPLATE` a `SECRET_SLOTS`
(`supabase/functions/_shared/secrets.ts`). O teste
`e2e/admin/integracoes.spec.ts` — *"todo slot lido por edge function tem campo na
tela"* — lê os dois arquivos e **reprova enquanto o par não existir na tela**. É a
única regressão conhecida introduzida por esta rodada, e este diff a fecha:

```ts
  {
    provider: "meta",
    label: "whatsapp_notify_template",
    title: "WhatsApp Cloud API — nome do template de aviso",
    envName: "META_WHATSAPP_NOTIFY_TEMPLATE",
    usedBy: "notify-dispatch",
    help: "Template aprovado (categoria Utility) com UMA variável no corpo. Sem ele o aviso sai como texto livre, que a Meta recusa fora da janela de 24 h (código 131047).",
  },
```

Aproveitar para corrigir a linha 98 do mesmo arquivo: `whatsapp_access_token` diz
`usedBy: "sdr-whatsapp-broadcast"` e quem também depende dele é o
`notify-dispatch` — quem cadastra a chave não sabe que está destravando o aviso
de lead perdido. O mesmo vale para `whatsapp_phone_number_id`.

```diff
-    usedBy: "sdr-whatsapp-broadcast",
+    usedBy: "sdr-whatsapp-broadcast, notify-dispatch",
```

### 2. "Testar conexão" do Brevo

`src/pages/AdminIntegrations.tsx`, `PROBES` (linhas 41-45).

O endpoint já existe: `submission-dispatch` aceita `action: 'probe'`, exige
`settings.integrations` (a mesma permissão da tela) e faz uma leitura pura em
`/v3/senders` — nenhum e-mail é enviado. Ele responde as duas perguntas que hoje
ninguém faz: *a chave funciona?* e *o remetente gravado está verificado?*

```diff
 const PROBES: Record<string, { fn: string; body: Record<string, unknown> }> = {
   "openai::api_key": { fn: "sdr-agent-chat", body: { action: "probe" } },
   "meta::whatsapp_access_token": { fn: "sdr-whatsapp-broadcast", body: { action: "probe" } },
   "meta::whatsapp_phone_number_id": { fn: "sdr-whatsapp-broadcast", body: { action: "probe" } },
+  "brevo::api_key": { fn: "submission-dispatch", body: { action: "probe" } },
+  "brevo::sender_email": { fn: "submission-dispatch", body: { action: "probe" } },
 };
```

**Por que importa:** `brevo/sender_email` no cofre da homologação guarda hoje uma
CHAVE DE API (89 caracteres, começa com `xkeysib`, sem arroba) — o mesmo valor de
`brevo/api_key`. A tela diz "no cofre" e nada a contradiz. `validarCredencial`
barra gravação nova; só a sonda enxerga o valor que já está gravado.

**Enquanto não entrar:** o `submission-dispatch` recusa o envio antes de chamar a
Brevo e escreve o motivo na linha do dossiê ("brevo/sender_email não é um
e-mail…"), e a 0083 avisa quem pediu o envio quando o dossiê estoura 5
tentativas. O dossiê não sai calado — mas o admin só descobre pela fila.

### 3. Botão de check-in aparece para quem o banco recusa

`src/components/pipeline/CheckinQueueBar.tsx`. A 0065 fechou `perform_checkin`
com `has_permission('menu.checkin')`. O `cca` tem `menu.pipeline = true` e
`menu.checkin = false`, abre `/pipeline`, vê o botão e recebe toast vermelho
"Seu perfil não faz check-in na roleta." — sempre. Regra 8: ou o botão some, ou
o banco permite; o banco não deve permitir (quem não recebe lead não entra na
fila da roleta).

```diff
-  const { user } = useAuth();
+  const { user, can } = useAuth();
```

```diff
-      {inQueue ? (
-        <Button ... "checkout" ... />
-      ) : (
-        <Button ... "checkin" ... />
-      )}
+      {can("menu.checkin") && (inQueue ? (
+        <Button ... "checkout" ... />
+      ) : (
+        <Button ... "checkin" ... />
+      ))}
```

`can` já existe em `src/contexts/AuthContext.tsx`. A contagem da fila continua
visível para todos — o que some é só o par de botões. Aproveitar para trocar
`err instanceof Error ? err.message : "Tente novamente."` (linha 42) por
`describeError(err, "Tente novamente.")`, que é o padrão do repositório.

### 4. O errcode do check-in agora chega à tela — e ninguém o lê

`supabase/functions/broker-checkin/index.ts` passou a devolver `error` **e**
`code`, com o código vindo direto do `raise exception` do banco: `42501` = perfil
sem `menu.checkin`, `P0001` = regra de operação (fora da janela de turno, IP não
autorizado), `P0002` = nenhum check-in aberto, `28000` = sessão perdida.

Consumidores: `src/pages/Checkin.tsx:167` e
`src/components/pipeline/CheckinQueueBar.tsx:31`. Hoje os dois distinguem os
motivos **pelo texto em português** — um ajuste de redação numa migration muda o
comportamento do cliente em silêncio. Sugestão mínima, sem mudar o texto exibido:
esconder o botão (e não só mostrar o toast) quando vier `42501`, que é o mesmo
caso da pendência 3 pelo outro lado.

### 5. A aba "Saúde dos jobs" promete três jobs; existem dez

`src/pages/AdminIntegrations.tsx`, linha ~332 (estado vazio):

```diff
-                Nenhum job visível. Em produção, espera-se três linhas
+                Nenhum job visível. Em produção, esperam-se várias linhas
```

`cron.job` tem hoje **dez** jobs `faceimob-*` (oito, mais os dois da 0083). Quem
abrir a aba num ambiente onde o agendador perdeu jobs compara contra o número
errado e conclui que está tudo certo — a falha de um mês que a 0065 fechou. Sem
contagem fixa, o texto não envelhece a cada job novo.

### 6. `cron_jobs_health()` devolve lista vazia para quem não é admin

`supabase/migrations/…_0013_cron_scheduling.sql` (a checagem está no `WHERE`) e
`supabase/tests/04_cron_scheduling.sql:139`, que **afirma esse comportamento**.

Lista vazia é indistinguível de "não há job agendado". A correção é uma troca de
regime — `raise exception … using errcode = '42501'` na função e a inversão do
assert no teste 04 — e por isso **não foi feita aqui**: mexeria num teste de
outra frente que hoje está verde. A tela já lida com o erro (`jobsErro` →
`EmptyState` com "Tentar de novo"), então aplicar é barato depois de combinado.

**Mitigação em vigor:** o próprio texto do estado vazio diz *"Lista vazia também
aparece para quem não é administrador"*.

### 7. Fila de notificações: o recorte de canal

`src/pages/AdminIntegrations.tsx` já filtra `channel !== "in_app"` no aviso do
topo (linha ~302), então o banner está correto. A RPC da 0082,
`notification_queue_health()`, agrupa por `sent_at is null` **sem** excluir
`in_app` — e linha de sino nunca recebe `sent_at`, de modo que a tabela da aba
mostra centenas de "pendentes" de `in_app` que são só o histórico do sino.

```diff
     from public.notifications n
-   where n.sent_at is null
+   where n.sent_at is null
+     and n.channel <> 'in_app'
    group by n.channel
```

Opcional: o banner já está certo e o número da tabela é cosmético. Vale quando a
frente dona daquele arquivo tocar nele.

### 8. Sem tela para a caixa de mensagens de WhatsApp não roteadas

A 0083 criou `public.whatsapp_inbound_messages` (RLS: admin, diretoria, gerente e
SDR leem; ninguém insere pelo cliente; o UPDATE existe só para marcar
`handled_at`). O webhook grava toda mensagem recebida antes de rotear, e o
gatilho avisa SDR e admin no sino quando ninguém soube rotear.

**O que falta é a tela**, e é a maior pendência desta frente: o banco tem o
contrato inteiro de uma caixa de entrada (corpo, `handled_at`, `handled_by`,
índice de pendentes, policy de leitura e de marcação) e **nenhum arquivo em
`src/` lê a tabela** — conferido com `grep -rn whatsapp_inbound_messages src/`,
que devolve zero. O item foi rebaixado no inventário por isso: o fluxo termina
no telefone escrito dentro do corpo do aviso.

A lista mínima é uma aba em `/sdr`:

```sql
select id, from_phone, body, created_at, outcome
  from public.whatsapp_inbound_messages
 where handled_at is null and outcome in ('unmatched', 'agent_error')
 order by created_at desc;
```

com colunas telefone / mensagem / quando e um botão **Tratada** que escreve
`handled_at = now()` e `handled_by = auth.uid()`. O kit já tem `SectionCard`,
`EmptyState` e `StatusBadge` para isso, a policy de UPDATE já existe e o grant
foi recortado exatamente nessas duas colunas (`grant update (handled_at,
handled_by)`), então a tela **não consegue** alterar o corpo da mensagem do
cliente nem apagá-la mesmo que alguém erre a query.

**Enquanto a tela não existir**, o aviso do sino vai sem link (apontar para uma
rota inexistente seria mentir no clique) e o corpo assume a falta: *"Responda
pelo aparelho: ainda não há caixa de entrada de WhatsApp no sistema."* Aviso sem
link que também não diz o que fazer parece uma tela que sumiu.

### 9. A tela de campanhas diz "sincronizado" sobre dado que ninguém sincronizou

`src/components/CampaignPerformancePanel.tsx:372` (frente de marketing).

```tsx
{r.syncedAt ? `sincronizado ${date(r.syncedAt)}` : "digitado"}
```

`ad_campaigns.synced_at` **não é escrita por código nenhum** — a varredura do
repositório inteiro só a encontra sendo lida
(`src/integrations/supabase/analytics.ts:87` → `src/pages/Marketing.tsx:133` →
esta linha). Medido na homologação em 02/09/2026: as seis campanhas trazem
`synced_at` de 28/07 e 26/08, todas de seed, e a tela escreve
*"sincronizado 28/07/2026"* ao lado do gasto. Quem lê conclui que houve
sincronização com a Meta — não houve, e não haverá até a Marketing API entrar
(ver [meta-marketing-api.md](./meta-marketing-api.md), que é bloqueio do
Douglas).

O rótulo honesto não custa integração nenhuma:

```diff
-                          {r.syncedAt ? `sincronizado ${date(r.syncedAt)}` : "digitado"}
+                          {"cadastro manual"}
```

Mesma tabela, mesmo problema na coluna Status: os seis registros misturam
`ACTIVE`/`PAUSED` (seed antigo) com `active`/`paused` (seed novo), e o filtro da
tela compara sem normalizar — o mesmo estado aparece como dois valores
diferentes, e editar uma campanha com status minúsculo mostra o campo em branco
(`CampaignPerformancePanel.tsx:118` e 228-235). Um `.toUpperCase()` na leitura
resolve os dois de uma vez; migration de dados **não** é necessária.

### 10. Badge do sino conta só a página carregada

`src/integrations/supabase/notifications.ts` e `src/components/NotificationBell.tsx`
(frente de entrada). O contador de não lidas é calculado sobre os 30 itens de
`listMyNotifications(30)`: quem tem 113 não lidas lê "30". Precisa de uma
contagem separada (`count: "exact", head: true` sobre `read_at is null`), não de
uma página maior.

Depois da 0083, `markAllNotificationsRead` já não suja a fila de saída: a policy
de UPDATE recorta o canal, então o `.select('id')` passa a contar exatamente o
que a tela mostrava.

### 11. Duas permissões de menu que a 0083 mede e não pode conceder

Frente de permissões (`role_permissions` é dado seedado por migration; a 0083
não escreve nele para não colidir com quem é dono do arquivo).

A 0083 tem dois produtores de aviso cujo destinatário pode não ter a tela. Como
não dá para conceder daqui, **o link é condicionado à permissão do destinatário
dentro do próprio produtor**: quem abre a tela recebe o link, quem não abre
recebe o fato e a próxima ação escrita no corpo. Isso resolve o "clique que cai
em Acesso não liberado" hoje; conceder as permissões abaixo faz o link voltar
sozinho, **sem migration nova** — o `case` lê `role_permissions` em tempo de
execução.

**(a) `menu.atividades` para `sdr`, `marketing` e `cca`.** Medido no remoto: a
permissão existe para `director`, `manager`, `broker` e `partner` (migration
0036). É menu, não poder de escrita — o conteúdo continua recortado pelo RLS de
`tasks` — e quem recebe uma atividade atribuída precisa da tela de qualquer
jeito. Hoje é latente: só há tarefa atribuída a `admin` e `broker`. Basta alguém
atribuir uma atividade a um SDR.

```sql
insert into public.role_permissions (role, permission, allowed)
select r.role, 'menu.atividades', true
from (values ('sdr'::app_role), ('marketing'), ('cca')) as r(role)
on conflict (role, permission) do nothing;
```

**(b) `menu.admin_integrations` para `director` — e só junto com a pendência 6.**
`select permission, role from role_permissions where permission =
'menu.admin_integrations'` devolve **zero linhas** no remoto: só `is_admin()`
passa. O aviso de `cron_failure` alcança a diretoria (é o primeiro produtor que
alcança o papel `director`), mas o link só acompanha o aviso do admin, porque a
rota tem **duas** portas fechadas para o diretor: `ROUTE_PERMISSION` exige a
permissão, e `cron_jobs_health()` tem `where public.is_admin()` no corpo — com a
permissão concedida sozinha, a aba abriria vazia.

As duas metades andam juntas ou nenhuma anda:

```diff
-  where public.is_admin()
+  where public.has_permission('settings.integrations')
     and j.jobname like 'faceimob-%'
```

mais a concessão de `menu.admin_integrations` a `director`. Feito isso, o `case`
do produtor volta a mandar o link para a diretoria sem que a 0083 mude.
