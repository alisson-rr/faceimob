# WhatsApp Cloud API — o que falta e o que acontece quando chegar

O canal de WhatsApp está construído nas duas pontas. O que não existe é a
credencial. Este documento diz exatamente o que pedir ao Douglas, onde cadastrar
e o que o sistema faz sozinho depois disso.

---

## As três credenciais

Cadastradas em **Admin → Integrações**. Nenhuma delas vai para o navegador.

| Slot no cofre | De onde sai | Sem ela |
|---|---|---|
| `meta / whatsapp_access_token` | Token de sistema do app/WABA, permanente | Nenhuma mensagem sai |
| `meta / whatsapp_phone_number_id` | Id do número emissor no painel da Meta | Nenhuma mensagem sai |
| `meta / app_secret` | App secret do app da Meta | **Os dois webhooks recusam todo POST com corpo da Meta (401)** — `whatsapp-inbound-webhook` e `meta-ads-webhook`. Sem ela, lead de campanha não entra |
| `meta / whatsapp_notify_template` | Nome do template aprovado, **opcional** | O worker manda texto livre — que a Meta recusa fora da janela de 24 h. Ver a seção "O template não é detalhe" |

Pré-requisito das três: acesso ao Business Manager com a **WABA verificada** e o
número emissor aprovado.

As duas primeiras podem entrar por **qualquer um dos dois caminhos**: a tela de
Integrações (cofre) ou o secret da edge function (`supabase secrets set`). O
worker lê os dois — `getSecret` tenta o cofre e cai para `Deno.env`. Nada no
banco depende de a origem ser uma ou outra.

> **Fechado — conferido no código em 02/09/2026.** A pendência que estava aqui
> ("`meta-ads-webhook` processa o POST mesmo sem `app_secret`, só registra um
> `console.warn`") **não existe mais**: `meta-ads-webhook/index.ts:164-173`
> recusa com 401 tanto a assinatura inválida quanto a ausência da credencial,
> e o `whatsapp-inbound-webhook` faz o mesmo. As duas continuam com
> `verify_jwt = false` — é o que a Meta exige —, e a prova de origem passou a
> ser a assinatura, não o JWT.
>
> **Consequência de estar fechado:** sem `meta / app_secret` no cofre, **lead de
> campanha não entra** — não é só o aviso de WhatsApp que espera essa
> credencial. Desligar o workflow de entrada do N8N antes de cadastrá-la corta a
> entrada de leads (ver [n8n-inventario.md](./n8n-inventario.md)).

---

## O que acontece quando o token entrar

Para **ligar**, nada precisa ser feito no console do banco — o caminho já está
ligado. Para **diagnosticar** quando não funcionar, hoje ainda precisa (ver a
última seção). São coisas diferentes:

1. `notify_lead_assigned` **e** `notify_lead_timeout` gravam a mensagem em
   `notifications` com `channel = 'whatsapp'` — é essa a fila que o worker lê.
   O aviso de prazo vencido (ata 14/07, item 10) tem produtor nos dois canais.
   A duplicação que isso causava no sino foi fechada na 0065 no ponto certo: a
   policy de SELECT expõe ao cliente só `channel = 'in_app'`, e a fila de saída
   é lida pelo worker com service role, que não passa por RLS. Um aviso por
   evento na tela, uma mensagem por evento no canal.
2. O cron `faceimob-notify-dispatch` roda a cada minuto e chama o worker
   **apenas** quando existe mensagem na fila. O gatilho **não** olha credencial:
   o banco só enxerga o cofre, e o token pode estar no secret da function — um
   portão no banco travaria a fila justamente nesse caso.
3. `notify-dispatch` normaliza o telefone (DDI 55), envia, e marca a linha.
   Falha não marca como enviada: fica para a próxima passada, até 5 tentativas.
   Sem credencial nenhuma ele devolve **503 sem gastar tentativa** e escreve
   `last_error = 'credencial da WhatsApp Cloud API ausente no cofre'` em cada
   linha parada: a fila não se perde e o motivo fica registrado.
4. **A fila tem teto.** `expire_stale_outbound_notifications()` (migration
   0083), chamada pelo gatilho do cron a cada minuto, descarta a mensagem de
   saída com mais de **2 h**, escrevendo o motivo na linha. Sem esse corte a
   fila crescia sem limite (312 pendentes em 03/09, +30 em 12 minutos) e o
   primeiro minuto com credencial válida despejaria centenas de "você perdeu o
   lead X" sobre cinco corretores. A cópia `in_app` do mesmo evento continua no
   sino: o que expira é a entrega por um canal cuja utilidade tem prazo.
   **E o descarte avisa.** Toda vez que a função descarta alguma coisa, o admin
   recebe uma linha no sino ("Avisos descartados sem entrega", com link para
   Admin · Integrações), no máximo uma a cada 12 h. Sem isso o teto trocaria um
   silêncio por outro — *a fila cresce e ninguém vê* viraria *a fila some e
   ninguém vê* —, e a aba Saúde dos jobs continua verde nos dois casos, porque o
   job de fato roda. É o mesmo tipo de cegueira que deixou
   `faceimob-notify-dispatch` pausado por um mês.
5. **Sem redeploy.** `getSecret` guarda em memória o segredo encontrado, mas
   **não** guarda a ausência — com o cron de um minuto a instância fica quente
   por horas, e uma versão que cacheasse o `null` continuaria respondendo 503
   depois de a chave ser cadastrada. A instância que respondeu 503 às 14:00
   envia às 14:01.

Para o **recebimento**, registrar no painel da Meta o webhook do campo
`messages` apontando para:

```
https://<projeto>.supabase.co/functions/v1/whatsapp-inbound-webhook
```

O handshake (`GET` com `hub.verify_token`) usa o mesmo verify token do webhook
de leads, gerado em **Admin → Meta Ads**.

---

## O template não é detalhe: sem ele, credencial válida = recusa em massa

A mensagem que sai por aqui é **iniciada pela empresa** e o destinatário é o
**próprio corretor**, que nunca escreveu para o número da empresa. Isso significa
que a janela de atendimento de 24 h da Meta **nunca está aberta** e uma mensagem
de texto livre é recusada **sempre**, com o código `131047`.

Consequência prática: cadastrar só o token e o phone number id transformaria a
fila inteira em recusas, não em entregas — e o motivo escrito em cada linha
diria apenas "envio recusado pela Cloud API", que não aponta o conserto.

O que o `notify-dispatch` faz hoje:

- **Com** `meta / whatsapp_notify_template` cadastrado, envia como `template`,
  idioma `pt_BR`, com **uma única variável no corpo** (`{{1}}`) que recebe o
  aviso inteiro (título e corpo, com as quebras de linha viradas em " — ", pois
  parâmetro de template não aceita quebra de linha; corte em 1024 caracteres).
- **Sem** o slot, envia texto livre — que funciona dentro da janela de 24 h e no
  ambiente de teste da Meta, e é por isso que o caminho continua existindo.
- Ao receber `131047`/`131026`, escreve na linha: *"a Meta exige template
  aprovado para iniciar conversa (código 131047); cadastre
  meta/whatsapp_notify_template em Admin → Integrações"*. Token recusado
  (HTTP 401 ou código `190`) tem frase própria. Nunca se grava a mensagem do
  provedor, que costuma repetir o telefone do destinatário.

**O que pedir ao Douglas junto com as credenciais:** um template aprovado na
categoria *Utility*, com exatamente um `{{1}}` no corpo, e o **nome** dele.
Exemplo de corpo aprovável: `FACEIMOB: {{1}}`.

**Pendência de tela:** o slot está em `SECRET_SLOTS`
(`supabase/functions/_shared/secrets.ts`) e ainda **não** tem campo em
`src/lib/integrationCatalog.ts`, que é de outra frente. O diff exato está no
[README](./README.md#pendências-em-arquivos-de-outras-frentes-diffs-exatos).
Enquanto ele não entrar, o nome do template só pode ser definido pelo secret da
edge function (`META_WHATSAPP_NOTIFY_TEMPLATE`).

---

## A fila represada de julho — o que foi feito

Havia **77 mensagens** com `sent_at is null` e `attempts = 0`, a mais antiga de
28/07/2026. Todas represadas: o cron estava pausado e o worker nunca tentou uma
única vez.

A migration **0065** descarta o que tem mais de 24 h: marca `sent_at` (tira da
fila do worker), `read_at` (o sino contava as 77 como aviso pendente no badge —
hoje a policy de SELECT já as esconde, e a marcação ficou como registro de que
foram tratadas) e escreve o motivo em `last_error`.

**Por quê:** aviso de lead é útil por minutos. Ligar o cron sem descartar
mandaria 77 mensagens sobre leads de julho e agosto para corretores reais, em
setembro. Isso confunde a operação e queima o número novo na Meta logo na
estreia — a Meta pune volume alto de mensagens não solicitadas.

**Consequência aceita:** ninguém será avisado retroativamente sobre esses leads,
nem por WhatsApp nem pelo sino. Todos já foram redistribuídos pela roleta há
semanas; o aviso não teria mais função. As linhas continuam no banco, com o
motivo escrito — não foram apagadas.

---

## Por que a Cloud API oficial e não a Evolution API

Ver a seção correspondente no [README](./README.md). Resumo: a mensagem é aviso
ao próprio corretor sobre lead perdido; número não oficial é passível de bloqueio
e o bloqueio chegaria exatamente quando a operação mais depende do canal. A
Evolution continua como plano B, não construída.

---

## Como conferir que funcionou

Depois de cadastrar as credenciais, sem tocar em nada mais:

1. **Admin → Integrações → Credenciais**: os três slots devem dizer "no cofre"
   (ou o token estar no secret da function — o worker aceita os dois).
2. **Admin → Integrações → Saúde dos jobs**: `faceimob-notify-dispatch` ativo e
   sem falhas em 24 h.
3. Atribuir um lead a um corretor de teste com telefone preenchido no perfil. A
   mensagem chega em até um minuto.

Se a mensagem **não** chegar, o motivo está em `notifications.last_error` —
"perfil sem telefone" e "credencial da WhatsApp Cloud API ausente no cofre" são
as duas causas que não produzem erro nenhum no log da function.

**Desde a 0082 há tela para isso:** Admin → Integrações mostra "N notificação(ões)
de WhatsApp esperando envio", com a mais antiga e o último motivo registrado pelo
worker. Duas correções da 0083 fazem esse número dizer a verdade:

- o motivo passa a ser escrito em **todas** as linhas paradas, não só nas 50 mais
  antigas — o lote do worker é `order by created_at limit 50`, então toda passada
  repescava as MESMAS 50, que já tinham motivo, e as outras 262 nunca receberiam
  explicação nenhuma (53 marcadas de 312, número congelado desde 17:08);
- o corte de idade tira da conta o que já não deve sair.

Para o detalhe por motivo, a consulta continua sendo:

```sql
select count(*), last_error
  from public.notifications
 where channel = 'whatsapp' and sent_at is null
 group by last_error;
```

Está registrado como pendência de tela: uma linha em Integrações com "N
mensagens paradas — motivo". Enquanto ela não existir, este é o único caminho.
