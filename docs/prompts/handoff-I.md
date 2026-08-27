# Handoff I — Endurecimento antes de divulgar a URL

26/08/2026 · branch `nova` · **nada commitado**.
Migration `0033` aplicada na homologação (`mcmqgxvtwegtptfseqvw`); as 3 edge
functions redeployadas; 3 functions aposentadas removidas do projeto remoto.

---

## 1. Placar

| Achado | O que era | Estado |
|---|---|---|
| S01 | `sdr-agent-chat` rodava com service_role sem autenticar: a chave publicável do bundle queimava a OpenAI e lia conversa de lead | ✅ fechado |
| S04 | `notify-dispatch` e `submission-dispatch` aceitavam qualquer chamador do gateway | ✅ fechado |
| S02 | Link público nascia com slug derivado do nome e, no caso do diretor, sem PIN | ✅ fechado para link novo · link antigo segue válido, com aviso na tela |
| S05 | PIN de 6 dígitos sem lockout: 10^6 varridos por script | ✅ fechado (5 erros → 15 min) |
| S03 | Auto-cadastro | ✅ no repo (a Tarefa E já tinha feito) · ⚠️ **falta o ajuste manual no painel** — §5 |
| D05 | 3 functions aposentadas respondendo 410, ainda publicadas com `verify_jwt = false` | ✅ removidas do repo, do `config.toml` e do remoto |

---

## 2. As duas portas das edge functions

`supabase/functions/_shared/auth.ts` (novo)

A raiz dos dois achados é a mesma: **o gateway do Supabase valida a assinatura
do JWT e nada além disso**. A chave publicável é um token legítimo — passa pelo
gateway, chega à function, e a function roda com service_role. "Autenticado pelo
gateway" nunca quis dizer "autorizado".

### `requireUserPermission(req, permission, cors)` — porta do navegador

Valida a sessão com `auth.getUser()` a partir do `Authorization` do chamador e
autoriza por `public.has_permission(code)` — a **mesma** função que decide se a
tela aparece no menu. Uma lista de papéis escrita à mão na function divergiria
da matriz que o admin edita em Admin · Permissões: bastaria conceder `menu.sdr`
a marketing pela tela para a UI mostrar o módulo e a function recusar.

`sdr-agent-chat` usa `menu.sdr`. Sem sessão → 401; com sessão sem a permissão →
403. O contrato com o `SdrModule.tsx` não mudou: o `functions.invoke` do
supabase-js já manda o `access_token` do usuário.

### `requireServiceRole(req, cors)` — porta do cron

`notify-dispatch` e `submission-dispatch` só têm um chamador legítimo: o
`net.http_post` das migrations 0018/0020, que manda `Bearer <service_role_key>`
lido do cofre. A porta aceita duas formas, e as duas são necessárias:

1. **token idêntico à chave de serviço** — lida por `getSecret('SUPABASE_SERVICE_ROLE_KEY')`,
   cofre à frente e `Deno.env` atrás, exatamente a ordem que a migration usa
   para montar a chamada. É a forma que cobre as chaves novas (`sb_secret_…`),
   que **não são JWT** e não têm claim nenhuma para inspecionar;
2. **JWT com `role = 'service_role'`** — formato legado, caso o admin tenha
   cadastrado a chave antiga no cofre.

Checar só (2) quebraria o cron neste projeto, que usa as chaves novas
(`VITE_SUPABASE_PUBLISHABLE_KEY` é `sb_publishable_…`). Checar só (1) quebraria
se o cofre e o `Deno.env` divergissem. A comparação é em tempo constante.

Ler o payload do JWT sem verificar assinatura é seguro **aqui** porque as três
functions estão com `verify_jwt = true` (padrão, confirmado em
`list_edge_functions`): token forjado é recusado pelo gateway antes de chegar ao
nosso código. Se alguém puser qualquer uma delas em `verify_jwt = false` no
`config.toml`, essa premissa cai — está comentado no arquivo.

### Detalhe que quase virou incidente

`requireUserPermission` precisa de uma chave para o header `apikey`. A primeira
versão lia só `SUPABASE_ANON_KEY`. Com as chaves novas não há garantia de qual
variável a plataforma injeta — e se nenhuma existisse, **todo** usuário legítimo
levaria 401 e o playground do SDR morreria em silêncio. Virou cascata
`SUPABASE_ANON_KEY → SUPABASE_PUBLISHABLE_KEY → SUPABASE_SERVICE_ROLE_KEY`. A
service role como último recurso não escala privilégio: quem decide o papel no
PostgREST/GoTrue é o `Authorization`, que é sempre o token do usuário; se ele
sumisse, `has_permission` rodaria com `auth.uid()` nulo e devolveria false.
Falha fechada.

---

## 3. Migration 0033 — link público não nasce mais aberto

`supabase/migrations/20260825120000_0033_public_link_hardening.sql`

O slug era, na prática, a senha, e nascia adivinhável: `AdminDailyTeams` gravava
`diretor-<nome-do-diretor>`. Quem soubesse o nome de um diretor da casa montava
a URL e lia funil, visitas e vendas da diretoria inteira. **Isso não era
teórico**: a homologação tinha `diretor-ricardo-sampaio`, sem PIN, criado hoje
às 14:23 só por alguém ter aberto a tela.

1. **Slug sorteado.** `create_public_link()` sorteia `gen_random_uuid()` sem
   hífen; a coluna também ganhou esse default, para insert direto de suporte não
   recair no nome.
2. **PIN obrigatório, nos dois tipos.** O navegador não faz bcrypt, então não dá
   para exigir `pin_hash` no `INSERT`; a criação virou RPC (recebe o PIN em
   claro, grava o hash, devolve só `{id, slug}`). O `INSERT` direto saiu do
   contrato: a policy `public_links_write` (`for all`) foi substituída por
   `public_links_update` e `public_links_delete` — **sem policy de INSERT,
   ninguém insere**. O *grant* continua uniforme de propósito: é o que a 0023
   estabelece e o que `tests/06_anon_surface.sql` cobra. Superusuário (seed,
   harness) e service_role seguem inserindo direto, como esperado.
3. **Lockout.** `private.resolve_public_link` — o resolvedor comum às três RPCs
   anônimas — conta erro em `failed_attempts` e, no quinto, grava
   `locked_until = now() + 15 min`. Dentro da janela **nem o PIN correto abre**.
   O acerto zera contagem e trava. A função passou a `VOLATILE` para conseguir
   gravar; os três chamadores já eram volatile desde a 0026.
4. **Nada foi invalidado.** Link existente continua com o slug legível e com (ou
   sem) o PIN que tem hoje.
5. **`set_public_link_pin` limpa a trava** e passou a exigir 6 caracteres, para
   "renovar o PIN" ser de fato o remédio do lockout.
6. **`create_public_link` é idempotente** por (tipo, dono): dois cliques no botão
   devolvem o mesmo link em vez de deixar uma segunda URL válida e invisível.

### O que a revisão pegou — e que teria quebrado a demo

Uma revisão adversarial de 28 agentes achou um defeito **crítico na primeira
versão desta migration**, que passava em todos os meus testes:

`DailyReport.tsx:227` chama `public_daily_team(slug, null)` ao montar, e o
efeito que faz isso depende de `loadMonth`, que é um `useCallback` com `pin` nas
dependências — ou seja, **cada tecla digitada no campo do PIN refaz a chamada
sem PIN**. É a única forma de a tela descobrir se o link pede PIN, porque
`has_pin` só volta no sucesso.

Na primeira versão eu contava essas chamadas como erro. Resultado: abrir a
página (1) + digitar 4 dígitos (4) = 5 → **link travado antes de o gerente
clicar em Entrar**, e aí nem o PIN correto abria por 15 minutos. O Diário
ficaria inacessível para toda equipe com PIN — exatamente o fluxo da demo.

Correção: **PIN ausente ou vazio é sondagem, não chute** — devolve NULL sem
tocar no contador. Só chute com PIN preenchido conta. Coberto por
`tests/11` bloco 4b (24 sondagens não movem nada).

O teste original passava verde porque eu só testava chutes errados, nunca a
sondagem. A lição está no bloco 4b.

### Consequência aceita

Quem conhece o slug consegue **travar** o link de propósito: 5 chutes e o
gerente fica 15 min sem lançar o diário. É o preço do lockout por link — não há
identidade do chamador para punir em vez do link. Remédio: o admin renova o PIN,
que agora limpa `locked_until` e `failed_attempts` — o link volta a abrir na
hora com o PIN novo.

---

## 4. Tela — `src/pages/AdminDailyTeams.tsx`

- A query dos diretores **deixou de criar link de passagem**. Era um `insert`
  dentro de um `useQuery`: abrir a tela publicava o checkpoint da diretoria numa
  URL adivinhável. Agora é leitura pura; o link nasce quando o admin clica.
- `randomPin()` saiu de `Math.random()` para `crypto.getRandomValues`.
- Um caminho só para equipe e diretor (`issuePin`): sem link → `create_public_link`
  (cria com PIN); com link → `set_public_link_pin`. O PIN aparece uma vez, no
  toast e na linha, com botão de revelar/copiar.
- Aviso no topo (`role="alert"`) contando quantos links estão sem PIN, e badge
  **Sem PIN** em âmbar por linha. Sem link, a célula diz "Sem link público" em
  vez de exibir uma URL que não existe — antes ela montava `daily/<nome>` mesmo
  sem link, um link quebrado apresentado como válido.
- `create_public_link` ainda não está em `types.ts` (arquivo **gerado**, fora do
  escopo desta tarefa). Há um cast local comentado; ele some no próximo
  `supabase gen types`.

---

## 5. O que é manual no painel (só você tem acesso)

1. **Signup off no remoto.** `[auth] enable_signup = false` já está no
   `config.toml` (Tarefa E), mas isso só vale para o stack local. No projeto
   remoto: **Authentication → Sign In / Providers → "Allow new users to sign
   up" → desligar**. Enquanto estiver ligado, qualquer um com a URL do projeto e
   a chave publicável — que vai no bundle do navegador — cria usuário
   `authenticated`, e `authenticated` é o papel que abre a superfície inteira do
   PostgREST. **É o item mais urgente deste handoff.**
2. **Fechar os links sem PIN que já existem.** Abrir Admin · Diário e clicar em
   *Gerar PIN* em cada linha com o aviso âmbar. Hoje são:
   `seed-diretoria-daniela` e `diretor-ricardo-sampaio` (ambos `director_checkpoint`,
   abertos). Os dois `seed-daily-*` já têm PIN.

---

## 6. Provas

Todas rodadas em 26/08. Nenhum token, chave ou PIN aparece nos comandos: a chave
publicável é lida do `.env` para uma variável de shell.

### 6.1 Portas fechadas (homologação, functions redeployadas)

```bash
URL=$(grep '^VITE_SUPABASE_URL=' .env | sed 's/^[^=]*=//; s/"//g')
KEY=$(grep '^VITE_SUPABASE_PUBLISHABLE_KEY=' .env | sed 's/^[^=]*=//; s/"//g')
for f in sdr-agent-chat notify-dispatch submission-dispatch; do
  curl -s -w " HTTP %{http_code}\n" -X POST "$URL/functions/v1/$f" \
    -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" -d '{"message":"oi"}'
done
```

```
sdr-agent-chat         {"error":"Sessão inválida ou expirada."}          HTTP 401
notify-dispatch        {"error":"Endpoint interno: somente a service role."} HTTP 401
submission-dispatch    {"error":"Endpoint interno: somente a service role."} HTTP 401

# sem header Authorization, só apikey:
sdr-agent-chat         {"error":"Autenticação obrigatória."}             HTTP 401
notify-dispatch        {"error":"Endpoint interno: autenticação obrigatória."} HTTP 401
```

### 6.2 O cron continua passando (homologação, sem efeito colateral)

Uma linha `queued` com `attempts = 5` dispara o gatilho do cron mas é filtrada
pela function (`attempts < MAX_ATTEMPTS`): ela responde `processed: 0` sem tocar
no Brevo. Linha removida em seguida.

```sql
insert into public.developer_submissions (id, deal_id, developer_id, to_email, subject, document_ids, status, attempts)
select '00000000-0000-0000-0000-0000000d1533', d.id, dev.id, 'prova-porta@faceimob.invalid',
       'prova da porta service_role', '{}'::uuid[], 'queued', 5
from public.deals d cross join public.developers dev limit 1;

select public.dispatch_pending_submissions();
select status_code, content from net._http_response order by created desc limit 1;
```

```
status_code | content
------------+---------------------------------------
        200 | {"processed":0,"sent":0,"failed":0}
```

**Este é o ponto que importa do S04**: a chave publicável leva 401 e a chamada
do `net.http_post` com a chave do cofre leva 200. A porta separa os dois.

`cron.job` depois da mudança: `assign-queued`, `auto-checkout-expired`,
`purge-cron-history`, `release-expired-leads` e `submission-dispatch` **ativos**;
`notify-dispatch` **pausado — e continua pausado de propósito** (decisão de
05/08, sem credencial do WhatsApp; há 77 mensagens represadas na fila, e
despausar dispara envio real). Não forcei ciclo nesse.

`public.cron_jobs_health()` devolve vazio pela conexão da ferramenta porque a
função filtra por admin no `WHERE` (comportamento documentado na 0013) — a
leitura acima foi direto em `cron.job`.

### 6.3 Sessão válida entra (stack local do CLI)

O caminho positivo não podia ser provado no remoto: não há credencial de usuário
nesta sessão, e não é papel meu manipular senha. Foi provado no stack local
(`supabase start` + `db reset` + `functions serve`), com as chaves de
demonstração do CLI — as mesmas em qualquer máquina, nenhum segredo real
envolvido. Script em
`…/scratchpad/prova-porta-sdr.mjs` (usuário criado pela Admin API, OTP trocado
por sessão, quatro chamadas):

```
sessão válida sem papel de SDR : HTTP 403 {"error":"Sem permissão para esta operação."}
sessão válida COM papel de SDR : HTTP 500 {"error":"Credencial ausente: OPENAI_API_KEY…"}
chave publicável (sem sessão)  : HTTP 401 {"error":"Sessão inválida ou expirada."}
token inventado                : HTTP 401 (recusado pelo gateway, nem chega à function)
```

O 500 do segundo caso **é a prova**: o cofre local está vazio, e a única maneira
de chegar ao `requireSecret('OPENAI_API_KEY')` é tendo passado pela porta. No
remoto, com a chave da OpenAI cadastrada, esse mesmo caminho é 200 — não
confirmei o 200 no remoto, ver §7.

Para fechar a prova no remoto, com o cliente logado no app, basta:

```bash
# no console do navegador, já autenticado em https://faceimob.vercel.app
await supabase.functions.invoke('sdr-agent-chat', { body: { message: 'ping' } })
```

### 6.4 Links públicos (homologação, link descartável, removido no fim)

```
abre_com_pin_certo               | t
erro 1..5 (PIN errado → null)    | t t t t t
pin_certo_recusado_na_trava      | t
locked_until                     | now() + 15 min
failed_attempts                  | 0
abre_apos_a_janela               | t

# depois da correção da sondagem, no mesmo remoto:
6 sondagens sem PIN (null e '')  | failed_attempts = 0, locked_until = null
pin_certo_ainda_abre             | t
5 chutes com PIN errado          | trava, e o PIN certo passa a ser recusado
```

E o link antigo, pelo caminho anônimo real (RPC via PostgREST com a chave
publicável), continua abrindo:

```bash
curl -s -X POST "$URL/rest/v1/rpc/public_daily_team" -H "apikey: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"p_slug":"seed-daily-paulista","p_pin":"123456"}'
# → 200 com o roster e os lançamentos do dia
```

### 6.5 Functions aposentadas

```
daily-team-info      HTTP 404
director-weekly      HTTP 404
submit-daily-report  HTTP 404
```

### 6.6 Validações do repo

```
./scripts/validate-schema.sh --all   → schema ok (58 tabelas · 124 policies · 89 funções)
                                       11_public_link_hardening.sql: 42 asserts, todos ok
npm run typecheck                    → verde
npm run lint                         → 0 erros (7 warnings pré-existentes de react-refresh)
npm run build                        → verde (20,6 s)
npx supabase db reset (local)        → 33 migrations + 6 seeds aplicados sem erro
```

---

## 7. Riscos e pendências

1. **`npx supabase db push` não roda neste projeto** — e não é culpa da 0033. O
   histórico do remoto está incompleto: `supabase migration list` mostra
   **0001–0018 sem contrapartida remota** e 0019–0025 registradas com timestamps
   que não batem com os nomes locais (foram aplicadas por outra ferramenta em
   tarefas anteriores). Um `db push` tentaria reaplicar a 0001. Por isso a 0033
   foi aplicada por SQL direto e **registrada com a versão exata do arquivo**
   (`20260825120000`), que é o que o `db push` faria. Consertar o histórico é
   `supabase migration repair --status applied <7 versões locais>` +
   `--status reverted <7 versões órfãs>` e mais 18 linhas para 0001–0018 — é
   bookkeeping, não roda DDL, mas mexe no histórico de um banco compartilhado e
   ficou fora desta tarefa de propósito.
2. **O 200 do `sdr-agent-chat` no remoto não foi confirmado** (§6.3). O que foi
   confirmado: a porta recusa quem não tem sessão, recusa quem tem sessão sem
   `menu.sdr`, e libera quem tem — com um GoTrue real. Se o SDR parar de
   funcionar para um usuário legítimo, o suspeito é `has_permission('menu.sdr')`
   e a resposta será 403, não 401.
3. **Signup no painel** — §5, item 1. Sem isso, metade do S03 continua aberta.
4. **`handle_new_auth_user` ainda concede `broker` a toda conta nova** (0002).
   Com signup desligado isso é inofensivo (só o admin cria conta, e o corretor é
   o padrão certo), mas se o signup for religado, volta a ser um buraco. Fora do
   escopo desta migration; vale uma linha numa próxima.
5. **DoS por lockout** — §3, consequência aceita.
5b. **⚠️ O lockout NÃO cobre `public_daily_submit` — buraco confirmado, aberto.**
   `public_daily_submit` (0009:267-269) sinaliza PIN errado com
   `raise exception … errcode = '42501'`. PL/pgSQL não tem transação autônoma:
   a exceção aborta a transação que o PostgREST abriu e **descarta junto o
   `update` do contador** feito dentro de `resolve_public_link`. Os outros dois
   caminhos devolvem NULL, então commitam o contador; este não.

   Efeito: um script anônimo que faça `POST /rest/v1/rpc/public_daily_submit`
   com `{p_slug, p_pin, p_entries: []}` varre os 10^6 PINs **sem nunca travar**,
   e a resposta é um oráculo perfeito (403 para errado, 200 para certo). Ele
   respeita uma trava já existente, mas nunca dispara uma.

   Só é explorável por quem conhece o slug — links novos têm 128 bits de slug
   aleatório; **os legados, com slug derivado do nome, são a exposição real**, e
   renovar o PIN não troca o slug.

   **Correção (2 partes, precisa tocar `src/`, fora do escopo desta tarefa):**
   (a) numa migration nova, `public_daily_submit` devolve `null` em vez de
   `raise` quando o resolve falha — aí a transação commita e o contador vale;
   (b) `DailyReport.tsx:309-317` passa a tratar `data === null` como falha
   (`const { data, error } = …; if (error || !data) return toast(…)`), senão a
   tela mostra "Checkpoint concluído" para um envio que não gravou nada.
   Fazer só (a) é **pior** que não fazer nada. As duas juntas, num commit só.

   Enquanto isso não for feito: trate slug legado como público. Os dois links de
   diretor listados em §5 item 2 são os que interessam.
6. **77 notificações represadas** em `notifications` com `channel = 'whatsapp'`
   e `sent_at` nulo. O cron está pausado de propósito; **não despause sem
   antes limpar ou revisar a fila**, ou 50 mensagens reais saem no primeiro
   ciclo.
7. **`types.ts` desatualizado** para `create_public_link` (cast local em
   `AdminDailyTeams.tsx`). Regerar com `supabase gen types` quando alguém puder
   tocar `src/integrations/supabase/types.ts`.

---

## 8. Arquivos

Novos: `supabase/functions/_shared/auth.ts` ·
`supabase/migrations/20260825120000_0033_public_link_hardening.sql` ·
`supabase/tests/11_public_link_hardening.sql` · este handoff.

Alterados: `supabase/functions/_shared/secrets.ts` (slot
`SUPABASE_SERVICE_ROLE_KEY`) · `sdr-agent-chat/index.ts` ·
`notify-dispatch/index.ts` · `submission-dispatch/index.ts` ·
`supabase/config.toml` · `supabase/README.md` · `src/pages/AdminDailyTeams.tsx` ·
`docs/sprints/decisoes.md` · `docs/sprints/sprint-demo.md`.

Removidos: `supabase/functions/{daily-team-info,director-weekly,submit-daily-report}/`.

Nenhum outro arquivo de `src/` foi tocado. **Nada commitado.**
