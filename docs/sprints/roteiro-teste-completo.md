# Roteiro de teste — o que dá para validar hoje

Levantado em 02/08/2026 **contra o projeto remoto real** (`mcmqgxvtwegtptfseqvw`),
não contra o código. Os números abaixo vieram de consulta ao banco.

---

## Onde o app aponta

**Supabase remoto.** O `.env` tem
`VITE_SUPABASE_URL="https://mcmqgxvtwegtptfseqvw.supabase.co"`, então
`npm run dev` fala com o projeto de verdade.

O Docker **não** serve o app. Ele tem três containers rodando e nenhum é usado
pelo frontend:

| Container | O que é |
|---|---|
| `supabase_db_mcmqgxvtwegtptfseqvw` | stack local do Supabase CLI — ligado, mas ocioso |
| `mvcore_db`, `mvcore_redis` | outro projeto seu |

Docker só entra em `./scripts/validate-schema.sh`, que sobe um
`postgres:15-alpine` descartável, roda as 18 migrations e os 116 asserts, e
destrói o container. Nada disso toca o remoto.

Para apontar o app no banco local seria preciso trocar `VITE_SUPABASE_URL` para
`http://127.0.0.1:54321`. **Não recomendo agora**: o remoto já está com seed
completo e crons rodando; o local não.

---

## Estado do remoto (medido)

✅ 58 tabelas · 73 funções · 123 policies · 18 migrations aplicadas
✅ 4 jobs de cron ativos, todos `succeeded`, 0 falhas em 24h
✅ Seed completo: 15 perfis, 12 leads, 6 negócios, 9 tipos de documento,
   3 turnos, 4 grupos de distribuição, 5 regras de pontuação
✅ Cofre já tem `supabase/functions_url` e `supabase/service_role_key`

---

## Entrega de e-mail — o que ainda pode travar o login

O login é por código no e-mail e não existe mais senha na tela (`Login.tsx` só
chama `signInWithOtp` + `verifyOtp`). Sem receber o código, não se entra.

### ~~Bloqueio 1 — e-mail do testador~~ — RESOLVIDO em 05/08

O usuário era `admin@admin.com`, domínio de terceiros. Trocado para
`dev.alisson.rosa@gmail.com` direto no banco, nas três fontes que precisam
concordar:

| Onde | Por quê |
|---|---|
| `auth.users.email` | é por onde o GoTrue procura o usuário no `signInWithOtp` |
| `auth.identities.identity_data->>'email'` | a coluna `email` da tabela é gerada (`stored`) a partir daí |
| `public.profiles.email` | não há trigger de sync — o único em `auth.users` é de INSERT |

`profiles.id` não mudou, então perfil, papéis (`admin`, `broker`), leads,
check-ins e todo o seed continuam apontando para o mesmo usuário.

**Não dá para fazer isso pela tela de Users do dashboard** — ela não expõe
edição de e-mail. Os caminhos são SQL (como acima) ou a Admin API
(`PUT /auth/v1/admin/users/{id}` com a service_role key).

Os 14 usuários do seed seguem em `@example.invalid`, domínio reservado por RFC
que nunca entrega. Eles não servem para login; existem para popular cenário.

### Se o código não chegar

O remetente embutido do Supabase **recusa entregar para endereços fora da
equipe da organização** — o erro é *"Email address not authorized"*. Também é
limitado a poucas mensagens por hora, então testar login em sequência esgota a
cota e o código simplesmente para de chegar.

Duas saídas: adicionar o endereço à equipe em **Organization → Team**, ou
configurar o Brevo em **Authentication → Emails → SMTP Settings** — que também
remove o limite por hora.

### ~~Bloqueio 2 — edge functions não publicadas~~ — RESOLVIDO em 02/08

As **11 functions foram publicadas** (`supabase functions deploy`). As 8 antigas
foram para a v2 com a leitura do cofre; as 3 novas (`notify-dispatch`,
`submission-dispatch`, `voice-ai-webhook`) entraram na v1.

`voice-ai-webhook` foi publicada com **`verify_jwt = false`** de propósito: ela
autentica pelo segredo do cofre no header, não por JWT do Supabase. Com a
verificação ligada, o gateway responderia 401 antes de a function rodar e a
plataforma de voz nunca chegaria ao nosso código.

### Credenciais: o que cada uma trava de verdade

Nenhuma delas impede rodar este roteiro. Cada uma trava **um** ponto, e o resto
da tela continua funcionando sem ela.

| Credencial | O que trava sem ela | O que continua funcionando |
|---|---|---|
| WhatsApp — token + phone id | a mensagem sair no celular | o sino in-app, o card de lead, a fila em `notifications` |
| Brevo — chave + remetente | o e-mail chegar na construtora | criar o envio, anexar dossiê, ver o histórico |
| OpenAI — chave | **só** o playground de chat do SDR | agentes, fontes de lead, listas de remarketing, templates |

O SDR é a confusão mais provável: a tela inteira é CRUD no banco. A chave da
OpenAI só é lida por `sdr-agent-chat`, que é a caixa de conversa de teste
(`SdrModule.tsx:300`). Sem ela, todo o resto da tela salva e lê normalmente.

**Modo de teste sem WhatsApp** — o cron `faceimob-notify-dispatch` foi
**pausado em 05/08** (`active = false`). Sem credencial ele batia na function a
cada minuto e voltava 500; nada se perdia, mas enchia o log de erro que não é
erro. As notificações continuam entrando na fila (`notifications`, canal
`whatsapp`, `sent_at is null`) — dá para conferir a regra sem enviar nada.

Reativar quando cadastrar o token:

```sql
select cron.alter_job((select jobid from cron.job where jobname = 'faceimob-notify-dispatch'), active := true);
```

---

## Preparo: rode o seed de cenários

`dev.alisson.rosa@gmail.com` está sem equipe, sem grupo de roleta, sem leads e sem
notificações. Sem preparo, Check-in, Posição na fila e o Sino abrem vazios e
você vai achar que quebraram.

`supabase/seeds/050_test_scenarios.sql` resolve isso e monta os casos que este
roteiro manda observar. Ele descobre sozinho quem é o testador (procura
`dev.alisson.rosa@gmail.com`, senão qualquer admin), então funciona em qualquer ambiente.

```bash
npm run db:seed:remote
```

O comando é idempotente — pode repetir. Ele reaplica as fases 1-4 (que já usam
`on conflict do nothing`) e a fase 5.

Prefere rodar só a fase 5? Cole o conteúdo de
`supabase/seeds/050_test_scenarios.sql` no **SQL Editor** do Supabase.

Ao fim, o script imprime um resumo. Espere algo assim:

```
[050] Testador ....................... Alisson Rosa
[050] Leads do testador .............. 2
[050] Atribuições (contadores) ....... 7
[050] Leads atrasados do Felipe ...... 22 (bloqueio em 20)
[050] Check-ins hoje ................. 3
[050] Notificações não lidas ......... 3
```

### O que cada bloco do seed monta

| Bloco | Cenário | Onde você vê |
|---|---|---|
| 1 | Testador com equipe, grupo e IP liberado | `/checkin` deixa de dizer "sem grupo" |
| 2 | 7 atribuições espalhadas no tempo | contadores hoje/semana/mês **diferentes** |
| 3 | Felipe com 22 leads atrasados | check-in dele travado com o motivo |
| 4 | Ana perdeu por timeout, Diego por handoff | **Diego na frente da Ana** na fila |
| 5 | Lead com prazo vencido há 1 min | o cron devolve sozinho em ≤ 1 min |
| 6 | Check-ins de Ana, Bruno e Diego | fila com mais de uma pessoa |
| 7 | Tarefa vencida, em dia e concluída; 3 visitas | aba Agenda |
| 8 | 3 notificações não lidas + 2 lidas | badge no sino |
| 9 | 14 eventos de jogo, com distrato negativo | pódio com 3 colocações distintas |
| 10 | Anos preenchidos + um mês fechado | `/resultados` e a trava do mês |
| 11 | Campanha com lead e campanha sem lead | custo por lead vs "—" |
| 12 | Envio na fila, enviado e falhado | histórico em `/cca` |

### Para limpar depois

```bash
psql "$DATABASE_URL" -f supabase/seeds/059_test_scenarios_rollback.sql
```

Remove só a faixa de UUID da fase 5 e devolve o testador ao estado anterior.
As fases 1-4 ficam intactas.

### Duas armadilhas do cenário da fila

**A fila fica vazia fora da janela de distribuição.** `distribution_queue` exige
`now() >= distribution_start` do turno, e o seed só cria check-in se houver
turno aberto. Fora da janela a fila aparece zerada — não é bug.

| Turno | Check-in | Distribuição | Checkout |
|---|---|---|---|
| Manhã | 08:00 | **08:30** | 12:00 |
| Tarde | 13:00 | **13:30** | 18:00 |
| Noite | 18:30 | **19:00** | 21:30 |

Os vãos (12:00–13:30, 18:00–18:30, depois das 21:30) não têm turno. O seed
avisa em `notice` quando cai num deles; é só rodar de novo dentro da janela.

**Quem está bloqueado por atrasos não aparece na fila.** Por isso o Felipe (22
atrasados) é usado só no teste de bloqueio, e o cenário de ordenação usa Ana e
Diego. Se os dois cenários usassem a mesma pessoa, um invalidaria o outro.

## Telas testáveis 100% (sem depender de terceiro)

Nove telas fecham ponta a ponta hoje. Comece por elas.

### 1. Login por código — `/login`

1. Abra `/login`. Não deve existir campo de senha.
2. Digite seu e-mail → **Enviar código**.
3. Confira a caixa de entrada, digite os 6 dígitos → entra no dashboard.
4. **Teste o essencial:** digite um e-mail que não existe no sistema. A mensagem
   deve ser genérica ("se este e-mail estiver cadastrado…") e **nenhuma conta
   deve ser criada** — a trava é `shouldCreateUser: false`.
5. Peça um código e espere passar de 1 minuto para conferir a expiração.
6. Clique **Reenviar** logo em seguida: deve aparecer contagem regressiva de 60s.

### 2. Permissões — `/admin/permissions`

Era a tela que não gravava nada. Agora grava nas três abas.

1. Aba **Acesso ao Menu**: desligue "Resultados" para **Gerente**.
2. **Recarregue a página (F5).** O switch tem que continuar desligado — é a prova
   de que persistiu em `role_permissions`.
3. Aba **Funcionalidades**: mesma coisa com "Ver dados financeiros".
4. Aba **Etapas do Pipeline**: escolha "Corretor" e desligue "Pode entrar" em
   "Aprovado". Guarde para o teste 4.
5. Confira no banco: `select * from public.role_permissions where role='manager'`.

### 3. Menu e rota por permissão — header + URL

1. No cabeçalho, use o seletor **"Ver como…"** (só admin enxerga) → escolha
   **Corretor**.
2. O menu lateral encolhe: some Resultados, Marketing, Checkpoint, SDR e o
   bloco inteiro de Administração.
3. **Digite `/admin/permissions` na barra de endereço.** Tem que aparecer
   "Acesso não liberado" — esconder o item não pode bastar.
4. Volte para "Alisson Rosa (você)" e confirme que o menu volta inteiro.

### 4. Pipeline e trava de etapa — `/pipeline`

1. Arraste um card para outra coluna → toast de sucesso, card fica lá após F5.
2. Com a preview de **Corretor** ligada, arraste um card para **Aprovado**
   (bloqueado no teste 2). Deve aparecer "Movimentação não permitida" e **o card
   volta para a coluna original** — não pode ficar na nova.
3. Clique no ícone de calendário de um card → agende uma visita. Confirme que
   ela persiste (é o bug que corrigi): `select * from public.visits`.

### 5. Documentos do negócio — `/pipeline` → card → aba **Anexos**

Do zero: o bucket nunca tinha recebido arquivo.

1. Abra um negócio, aba **Anexos**. Veja o aviso "Faltam N obrigatórios".
2. Envie um PDF em **RG / CPF**. O arquivo é renomeado pelo padrão do tipo —
   confira em `select stored_name from public.deal_documents order by created_at desc`.
3. Envie **outro** arquivo no mesmo slot. O anterior não some: clique em
   **Ver histórico** e ele aparece marcado como "substituído", com `v1` e `v2`.
4. Clique em **Baixar** em qualquer versão → abre com URL assinada e o nome
   amigável.
5. Em **Outros**, selecione vários arquivos de uma vez — esse tipo aceita
   múltiplos, os demais não.

### 6. Agenda: atividades e visitas — card → aba **Agenda**

1. Crie uma atividade com prazo **no passado** → ela aparece marcada em vermelho
   como vencida.
2. Conclua com o ✓ → some da lista de abertas.
3. Agende uma visita, depois registre o resultado ("Realizada").
4. Mesma aba existe no modal de **Lead** (`/leads` → abrir lead → Agenda).

### 7. Gamificação — `/gamification`

Era 100% calculada no navegador; agora vem de `game_events`.

1. Veja o pódio: entrada animada 3º → 2º → 1º, primeiro colocado elevado com a
   medalha pulsando.
2. Confira que os pontos batem com o banco:
   `select profile_id, sum(points) from public.game_events group by 1 order by 2 desc`.
3. Como admin, abra **Fechar Gameficação**, altere o peso de "Venda" e confirme.
4. Depois do fechamento: o placar corrente zera, o resultado antigo vira
   histórico consultável e a nova temporada abre.
   Confira: `select * from public.game_season_results`.

> ⚠️ **Fechar temporada é irreversível.** Faça por último, ou aceite que o
> placar atual vira histórico.

### 8. Resultados — `/resultados`

1. Abra o ano corrente. Os números vêm de `annual_results` (3 linhas semeadas).
2. Edite Vendas/VGV de um mês e salve no ícone de disquete → F5 e continua lá.
3. Clique **Recalcular … pelo pipeline** e veja os valores serem sobrescritos
   pelos negócios fechados. A diferença é o ponto: antes isso acontecia sozinho
   a cada abertura, ignorando mês fechado.

### 9. Marketing — `/marketing`

1. No topo, cadastre uma campanha com o **ID da campanha na Meta**, nome e valor
   investido.
2. A tabela mostra custo por lead e por venda. Campanha sem lead mostra "—",
   não "R$ 0,00".
3. Para ver o cruzamento funcionando, garanta que algum lead tenha o mesmo
   `campaign_id`: `select campaign_id, count(*) from public.leads group by 1`.

### 10. Integrações e saúde dos crons — `/admin/integrations`

1. Aba **Credenciais**: os slots já configurados aparecem como "no cofre"; os
   demais mostram "usando secret …".
2. Cadastre qualquer valor num slot e salve. **Abra o DevTools → Network**: a
   resposta de `list_integrations` traz `has_secret: true` e **nunca o valor**.
3. Aba **Saúde dos jobs**: devem aparecer 4 linhas `faceimob-*`, todas ativas,
   `failures_24h = 0`.

### 11. Check-in, fila e contadores — `/checkin`

Requer o preparo do usuário acima.

1. Dentro da janela de um turno, o cabeçalho mostra o turno ativo — vem de
   `current_shift()`, respeitando o fuso de São Paulo.
2. Clique **Fazer Check-in** → confirmação com mensagem de incentivo.
3. Aparece **"você é o Nº X de Y"** na fila do grupo.
4. Os três contadores (hoje / semana / mês) batem com
   `select count(*) from public.lead_assignments where profile_id = '<seu id>'`.
5. **Teste o bloqueio:** com `bypass_ip_check = false` e seu IP fora da lista, o
   botão trava e a tela explica o motivo — não fica só cinza.

### 12. IPs autorizados — `/admin/allowed-ips`

1. Clique **Descobrir meu IP**.
2. Abaixo aparece se ele já está coberto por uma faixa cadastrada — a checagem é
   feita por `ip_is_allowed`, então uma faixa `/24` conta como coberta.
3. Cadastre e remova um IP; a mensagem de cobertura reavalia sozinha.

---

## Telas que dependem do deploy das functions

Depois de `npx supabase functions deploy`:

| Tela / fluxo | O que passa a funcionar |
|---|---|
| Sino de notificações | as 11 mensagens presas na fila saem por WhatsApp |
| `/cca` → **Enviar à construtora** | o envio sai do status "Na fila" e vira "Enviado" (precisa também da chave do Brevo no cofre) |
| Equipes → criar acesso | para de gerar e devolver senha |
| `/sdr` → broadcast | usa a chave do cofre em vez do secret antigo |

Enquanto não publicar, o **enfileiramento** funciona e é testável: a submissão
aparece com status "Na fila" e o histórico registra. Só a entrega não acontece.

---

## O que não dá para testar sem terceiro

| Item | Falta |
|---|---|
| Disparo real de WhatsApp | número e token da Cloud API no cofre |
| E-mail para a construtora | chave do Brevo + remetente verificado |
| Webhook da IA de voz | a plataforma do Douglas (prazo ~12/09) |
| Lead entrando pela Meta | webhook configurado no painel da Meta |
| Trava de documento na conversão | **decisão sua** — ver `decisoes.md`, item 1 |

---

## Ordem sugerida

1. Trocar o e-mail do usuário admin (senão nada abre)
2. Rodar o SQL de preparo
3. Telas 1 → 6 (o núcleo da operação)
4. Publicar as functions
5. Telas 7 → 12
6. Fechar temporada (teste 7.3) **por último**, porque é irreversível
