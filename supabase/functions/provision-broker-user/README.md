# provision-broker-user

Cria o acesso de um colaborador no Auth, troca o e-mail de acesso de quem já
existe, e bloqueia ou devolve a entrada de quem saiu da empresa. Só
administrador chama; cada chamada deixa uma linha em `access_provision_log`.

## Ramos

| Corpo | O que faz |
|---|---|
| `{ email, full_name }` | cria a conta — o trigger `on_auth_user_created` grava perfil e papel `broker` |
| `{ broker_id, email, reset: true }` | troca o e-mail de acesso (Auth + `profiles.email` juntos, ou nenhum) |
| `{ profile_id, access: "revoke" \| "restore" }` | **bloqueia ou devolve a entrada** (`ban_duration`) |

## Respostas

| Situação | Status | Corpo |
|---|---|---|
| Criou, trocou, bloqueou ou liberou | 200 | `email`, `user_id`, `login_ready` (nos tres ramos) e `access` no de bloqueio/liberacao |
| E-mail já em uso (**nos dois ramos**) | 409 | `existing_profile_id`, `existing_full_name` — a tela abre a ficha de quem já tem o endereço |
| Admin tentando bloquear a si mesmo | 409 | recusado: a volta exigiria service role |
| Quem chamou não é admin | 403 | linha `action='denied'` em `access_provision_log` |
| Perfil inexistente | 404 | — |

## Bloqueio de entrada (`access`)

Antes deste ramo, desligar alguém marcava `profiles.status = 'terminated'`,
tirava a pessoa das listas — e **deixava a conta entrando**: quem saía da
empresa continuava lendo os próprios leads, negócios e o diário da equipe.
Bloquear era "tarefa do painel do Supabase", isto é, de ninguém.

É **bloqueio, não exclusão**: `ban_duration` de 100 anos em `revoke`, `"none"`
em `restore`. Apagar a conta seria irreversível e ainda levaria junto a
auditoria — `access_provision_log.profile_id` é `on delete set null`, e some
exatamente quando alguém pergunta quem saiu e quando.

Quem chama é a ficha do colaborador: "Desligar definitivamente" manda `revoke`
junto do `status`, e ligar o Switch "Ativo" de um desligado manda `restore`. Se
o `status` gravar e o bloqueio falhar, a ficha diz isso em vermelho — "a entrada
NÃO foi bloqueada, ele ainda consegue entrar" — em vez de dar por concluído.

O 409 do ramo de TROCA é novo (0079): antes o e-mail duplicado caía no catch
geral e virava 500 com a mensagem crua do GoTrue, sem auditoria e sem saída — o
ramo de criação já respondia 409 para a mesma condição.

A trilha guarda `actor_email` como texto: `actor_id` é `on delete set null`, e
"quem provisionou o acesso de quem" costuma ser perguntado depois de a pessoa
sair da empresa.

O login do FACEIMOB é por código de 6 dígitos (Magic Link/OTP) — **não há senha
para repassar**. O código chega por e-mail, e é aí que entra o segredo abaixo.

## Segredo: `SMTP_CONFIGURED`

| | |
|---|---|
| Onde | Secret da edge function (`supabase secrets set`) — **não** é `VITE_` |
| Valores aceitos | `true` ou `1` ligam. Qualquer outra coisa (`false`, `0`, vazio, ausente) = **não configurado** |
| Efeito | Entra na resposta como `login_ready` — inclusive no ramo `access`, porque devolver a entrada nao faz o codigo sair. A ficha do colaborador e o dialogo de cadastro leem esse campo |

Enquanto ele não for `true`/`1`, a tela avisa em amarelo que o endereço **já vale
no login mas o código de 6 dígitos ainda não sai**, e o operador sabe que não
adianta pedir para a pessoa entrar. Ele não bloqueia nada: o acesso é criado do
mesmo jeito.

Só `true`/`1` ligam de propósito. `Boolean(Deno.env.get(...))` seria verdadeiro
para a string `"false"` — o valor que se escreve naturalmente para dizer "ainda
não" —, e aí a tela prometeria um e-mail que ninguém envia. Campo ausente
também cai no aviso: o front exige `login_ready === true`, então uma versão
antiga da função no ar erra para o lado seguro.

## Como ligar

1. Configure o SMTP do projeto (Brevo) em Authentication · Emails · SMTP Settings.
2. Aplique o template de Magic Link.
3. Envie um convite de teste e confirme que o código chega.
4. Só então: `supabase secrets set SMTP_CONFIGURED=true` e faça o deploy desta função.

Para desligar o aviso de volta, `SMTP_CONFIGURED=false` (ou remova o segredo).
