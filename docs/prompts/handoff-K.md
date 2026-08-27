# Handoff K — O lockout passa a valer no envio do Diário

26/08/2026 · branch `nova` · **nada commitado**.
Migration `0034` aplicada e registrada na homologação (`mcmqgxvtwegtptfseqvw`).
Histórico de migrations do remoto **reparado** — `db push` está destravado.

---

## 1. Placar

| Achado | O que era | Estado |
|---|---|---|
| S05 (resto) | `public_daily_submit` recusava PIN errado com `raise`; o rollback do PostgREST apagava o contador do lockout, e o caminho de escrita varria 10^6 PINs sem nunca travar | ✅ fechado (banco + tela, juntos) |
| §7.1 do handoff-I | histórico incompleto impedia `npx supabase db push` neste projeto | ✅ reparado — `db push --dry-run` responde *up to date* |
| §7.4 do handoff-I | `handle_new_auth_user` concede `broker` a toda conta nova | ⬜ continua aberto (fora de escopo, ver §8) |
| handoff-I §5.2 | 2 links de diretor sem PIN, com slug derivado do nome | ⬜ **continua aberto e é seu** — ver §8.1 |

---

## 2. O que a 0034 muda

`supabase/migrations/20260826120000_0034_submit_lockout.sql`

Uma coisa só: **`public_daily_submit` devolve `NULL` na recusa em vez de
levantar exceção.** O corpo do lançamento (upsert do relatório e das linhas), a
assinatura `(text, text, jsonb) returns jsonb` e o `grant` para `anon` ficam
idênticos — a superfície anônima continua sendo exatamente três RPCs, conferido
no remoto depois de aplicar (`total_anon = 3`).

Por que isso fecha o buraco:

```
PIN errado → resolve_public_link incrementa failed_attempts
           → submit levantava 42501
           → PostgREST devolve 403 e faz ROLLBACK
           → o incremento vai junto: o contador volta a zero
```

PL/pgSQL não tem transação autônoma. Tudo o que a RPC faz vive na transação que
o PostgREST abriu para aquele POST. Os outros dois chamadores do resolvedor
(`public_daily_team`, `public_director_checkpoint`) devolvem NULL, então
commitam o contador; este era o único que não.

`NULL` cobre os cinco casos de recusa sem distinguir nenhum — slug inexistente,
link inativo, expirado, PIN errado e travado — pela mesma razão da 0033: dizer
ao atacante que ele acertou o slug e errou o PIN é entregar metade do segredo.
O `kind` errado (slug de diretoria mandado para a RPC de equipe) entrou no mesmo
balde, que antes também era um `raise`.

### Por que não dá para consertar "no ponto compartilhado"

Foi a primeira coisa que tentei. O incremento mora dentro de
`resolve_public_link`, e **um bloco `exception` em PL/pgSQL é um SAVEPOINT**:
capturar o erro do chamador desfaria o incremento do mesmo jeito, porque ele
aconteceu depois do savepoint. Sem transação autônoma — `dblink` e
`pg_background` não estão neste projeto, e `dblink` exigiria uma conexão de
volta com credencial — a única garantia possível é de contrato: **nenhum
chamador do resolvedor pode sinalizar recusa com exceção**.

O que faz esse contrato durar é o teste, não o comentário: `tests/11` bloco 6b
percorre as **três** RPCs anônimas com PIN errado e cobra que nenhuma levante e
que todas contem a tentativa. Chamador novo que nasça com `raise` quebra o
harness na hora.

---

## 3. A outra metade — `src/pages/DailyReport.tsx:309`

Fazer só o banco seria **pior que não fazer nada**. A recusa passou a voltar
como HTTP 200 com corpo `null`, e a tela só olhava `error`: ela mostraria
"🎯 Checkpoint concluído! +XP" para um envio que não gravou linha nenhuma.

```diff
-    const { error } = await supabase.rpc("public_daily_submit", { … });
+    const { data, error } = await supabase.rpc("public_daily_submit", { … });
     if (error) { … }
+    if (!data) {
+      return toast({ title: "Envio recusado", description: "PIN incorreto, ou o link está bloqueado por 15 minutos após 5 tentativas erradas. Peça um PIN novo à administração.", variant: "destructive" });
+    }
```

Não mexi em `unlocked`. Voltar a tela para o pedido de PIN esconderia o
formulário e o gerente perderia o que digitou — o toast é o suficiente: ele
tenta de novo, ou pede PIN novo ao admin (que limpa a trava, decisão da 0033).

`types.ts` já declara `Returns: Json`, então `!data` tipa sem cast. Nenhum outro
arquivo de `src/` foi tocado.

---

## 4. O resto do caminho de escrita (o item 2 do prompt)

Verifiquei, e a resposta é: **só havia um `raise` com esse defeito**.

- **Irmãos.** `public_daily_team` e `public_director_checkpoint` já devolviam
  NULL. Conferido no remoto por `position('raise exception' in prosrc)`: antes
  de aplicar, só `public_daily_submit` dava `true`; depois, nenhum dos três.
- **Depois do resolve bem-sucedido**, dentro de `public_daily_submit`, ainda
  existem exceções possíveis: `jsonb_array_elements` levanta se `p_entries` não
  for array, e `(v_entry ->> 'profile_id')::uuid` levanta em UUID malformado.
  **Não têm o mesmo defeito e deixei como estão**, de propósito:
  1. só são alcançáveis **com o PIN correto** — quem chega ali já está
     autorizado, não está adivinhando nada;
  2. o que o rollback descartaria nesse ponto é a **zeragem** do contador, não
     um incremento. O efeito é o link ficar mais perto de travar, nunca mais
     longe: falha fechada.

  Guardar esses dois casos mudaria a semântica de casamento do `profile_id`
  (comparação em texto perde a normalização do `::uuid`) para eliminar um 500
  que só um chamador autenticado por PIN consegue provocar. Troca ruim antes de
  uma demo. Fica registrado aqui como conhecido e benigno.

---

## 5. Testes — `supabase/tests/11_public_link_hardening.sql`

De 42 para 58 asserts. Três blocos novos e uma correção:

- **bloco 6** — os casos que o prompt pediu: 5 envios com PIN errado travam o
  link; a 6ª com o **PIN certo** é recusada dentro da janela; a leitura fica
  travada junto (a trava é do link, não de uma RPC); nenhuma das 6 recusas cria
  relatório do dia; passada a janela o PIN certo grava de novo e a contagem
  zera. As chamadas são feitas **sem `exception when` em volta**, de propósito:
  um handler seria um savepoint e mascararia exatamente o defeito.
- **bloco 6b** — o tripwire do §2: as três RPCs, PIN errado, nenhuma levanta e
  o contador do link anda 0 → 1 → 2 atravessando leitura e escrita.
- **bloco 6c** — caminho feliz completo: grava as 8 métricas, o reenvio corrige
  em vez de duplicar, corretor de fora da equipe é ignorado, e a leitura do dia
  enxerga o lançamento. Sem isto a correção poderia trocar um buraco por uma
  regressão silenciosa.
- **bloco 3, corrigido** — a linha que cobrava `42501` de `public_daily_submit`
  agora cobra `null`. Era o contrato antigo.

Fixtures: duas equipes novas (`Equipe Envio` I e II) e um perfil próprio para o
corretor, porque `team_members_one_active` só admite uma equipe ativa por
corretor e reusar perfil de outro arquivo de teste amarraria os dois.

---

## 6. Provas

Nenhuma chave aparece nos comandos: a publicável é lida do `.env` para uma
variável de shell. Todos os fixtures de homologação criados aqui foram
**removidos no fim** (§6.3).

### 6.1 O teste falha sem a 0034 (vermelho antes de verde)

No container do harness, com o corpo **antigo** (0009) recolocado em
`public_daily_submit` e cada chamada em sua própria transação — que é o que o
psql em autocommit faz, e o que o PostgREST faz por POST:

```
--- 5 chutes com PIN errado, cada um em sua propria transacao ---
ERROR:  Link inválido ou PIN incorreto.   (×5)

--- estado do lockout ---
 failed_attempts | locked_until
-----------------+--------------
               0 |
--- e o PIN certo continua abrindo: o atacante pode seguir varrendo ---
 pin_certo_ainda_passa | t
```

Mesmo container, mesmo link, depois de aplicar a 0034:

```
--- mesmos 5 chutes, agora com o corpo da 0034 ---
 r1..r5 | (null, HTTP equivalente 200)
--- estado do lockout ---
 failed_attempts | travado
-----------------+---------
               0 | t
--- 6a tentativa com o PIN CERTO, dentro da janela ---
 pin_certo_na_trava | (null)
```

### 6.2 Harness

```
./scripts/validate-schema.sh --all   → schema ok (58 tabelas · 124 policies · 89 funções · 13 enums)
                                       11_public_link_hardening.sql: 58 asserts, todos ok
                                       ("nenhuma função além das 3 RPCs é executável por anon" segue ok)
npm run typecheck                    → verde
npm run build                        → verde (15,6 s)
npx eslint src/pages/DailyReport.tsx → 0 problemas
```

### 6.3 Homologação, pelo caminho anônimo real (PostgREST + chave publicável)

Link descartável (`zzprovak0034descartavel`) numa equipe descartável e inativa,
para não travar link de verdade nem sujar dado de demo:

```bash
URL=$(grep '^VITE_SUPABASE_URL=' .env | sed 's/^[^=]*=//; s/"//g')
KEY=$(grep '^VITE_SUPABASE_PUBLISHABLE_KEY=' .env | sed 's/^[^=]*=//; s/"//g')
for i in 1 2 3 4 5; do
  curl -s -w ' HTTP %{http_code}\n' -X POST "$URL/rest/v1/rpc/public_daily_submit" \
    -H "apikey: $KEY" -H "Content-Type: application/json" \
    -d '{"p_slug":"zzprovak0034descartavel","p_pin":"000000","p_entries":[]}'
done
```

```
chute 1 (PIN errado 000000) -> null HTTP 200
chute 2 (PIN errado 000000) -> null HTTP 200
chute 3 (PIN errado 000000) -> null HTTP 200
chute 4 (PIN errado 000000) -> null HTTP 200
chute 5 (PIN errado 000000) -> null HTTP 200

6a tentativa, PIN CERTO, dentro da janela -> null HTTP 200
leitura (public_daily_team) com PIN certo   -> null HTTP 200
```

Estado no banco logo depois:

```
 failed_attempts | travado | minutos_restantes | relatorios_criados_pelas_recusas
-----------------+---------+-------------------+---------------------------------
               0 | t       | 15                | 0
```

Antes da 0034 essa mesma sequência deixava `failed_attempts = 0`, `locked_until`
nulo e devolvia `403` em cada chute — o oráculo perfeito descrito no handoff-I.

E o caminho feliz, com a janela vencida:

```
passada a janela, PIN CERTO -> {"saved": 0, "report_id": "62ea…5c4e"} HTTP 200
e a leitura volta a abrir   -> {"today": [], "roster": [], "has_pin": true, …} HTTP 200
```

Limpeza conferida ao final: `times=0, links=0, membros=0, relatorios=0`, e os
4 links reais da homologação intactos, todos com `failed_attempts = 0` e sem
trava.

### 6.4 A tela, rodando de verdade contra a homologação

`npm run dev` em `/daily/<slug descartável>`, com um corretor emprestado (um dos
7 perfis ativos que não estavam em equipe nenhuma — a associação foi desfeita
depois, e ele voltou a não ter equipe):

| Passo | Resultado |
|---|---|
| PIN correto → *Entrar na missão* | abre a equipe, "1 corretor ativo" |
| Leads = 5 → *Salvar Checkpoint* | **"🎯 Checkpoint concluído! +5 XP"** e o funil do mês passa a mostrar `Leads 5` — gravou e releu |
| link travado no banco → *Salvar Checkpoint* de novo | **"Envio recusado — PIN incorreto, ou o link está bloqueado por 15 minutos após 5 tentativas erradas."** |

O segundo caso é exatamente o que dizia "Checkpoint concluído" antes da correção
da tela.

---

## 7. Histórico de migrations do remoto — reparado

Era o item opcional do prompt. Fiz, porque destrava o `db push` para todo mundo
daqui em diante e não roda DDL nenhum.

### Antes

```
casadas (local == remoto): 8      (0026–0033)
só local (não registradas): 26    (0001–0025 + a 0034 recém-escrita)
só remoto (órfãs):          7     (0019–0025, gravadas por outra ferramenta
                                   com timestamps que não batem com os nomes locais)
```

Um `db push` nesse estado tentaria **reaplicar a 0001**.

### Conferência antes de mexer

O reparo só é honesto se o schema realmente já tiver o que 0001–0018 criam.
Conferi objeto a objeto, um marcador por migration (`profiles`, `developers`,
`work_shifts`, `leads`, `deals`, `cca_cases`, `sdr_agents`, `daily_reports`,
`closed_months`, `marketing_investments`, `cca_stages`, `set_updated_at`,
`cron_jobs_health`, `distribution_queue`, a linha `menu.dashboard` em
`permissions`, `get_integration_secret`, o índice
`notifications_pending_whatsapp_idx` e `dispatch_pending_notifications`):

```
marcadores_ausentes | nenhum
```

As 7 órfãs foram identificadas pelo `name` gravado — `0019_anon_surface_hardening`
… `0025_deal_participant_ordinal` —, então o pareamento com as 7 locais
correspondentes não é palpite.

### O que rodei

```bash
npx supabase migration repair --linked --status applied \
  20260725120000 20260725120100 20260725120200 20260725120300 20260725120400 \
  20260725120500 20260725120600 20260725120700 20260725120800 20260725120900 \
  20260725121000 20260725121100 20260731120000 20260731130000 20260802120000 \
  20260802130000 20260802140000 20260802150000 20260808120000 20260808130000 \
  20260808140000 20260808150000 20260808160000 20260810120000 20260810130000

npx supabase migration repair --linked --status reverted \
  20260808130020 20260808175354 20260808180112 20260808181218 20260808192416 \
  20260810131149 20260810131159
```

A 0034 em si **não** entrou por `repair`: foi aplicada por SQL direto
(`npx supabase db query --linked -f …`) e registrada com a versão exata do
arquivo, que é o que o `db push` faria:

```sql
insert into supabase_migrations.schema_migrations (version, name)
values ('20260826120000', '0034_submit_lockout') on conflict (version) do nothing;
```

### Depois

```
casadas (local == remoto): 34
só local:  0 — nenhuma
só remoto: 0 — nenhuma

npx supabase db push --linked --dry-run
→ {"upToDate":true,"migrations":[],"message":"Remote database is up to date."}
```

Daqui em diante `supabase db push` é o caminho normal neste projeto.

---

## 8. Riscos e pendências

### 8.1 O que continua **seu** e é o mais urgente

1. **Os 2 links de diretor sem PIN** (`seed-diretoria-daniela`,
   `diretor-ricardo-sampaio`). Conferido hoje: `pin_hash` continua nulo nos
   dois. **A 0034 não protege link sem PIN** — não há segredo para adivinhar,
   nem contador para incrementar: quem tem o slug lê a diretoria inteira, e o
   slug é derivado do nome. Abrir Admin · Diário e clicar em *Gerar PIN* nos
   dois. Isso é o que sobrou do S02, e o lockout não substitui.
2. **Publicar o build.** A Vercel ainda não serve a metade de tela desta
   correção. Com a 0034 já no banco e a tela antiga no ar, um envio recusado
   ainda apareceria como "Checkpoint concluído" para quem usar a URL publicada.
   **É o único ponto em que esta entrega fica pela metade**, e o remédio é um
   deploy: `npx vercel deploy --prod --yes`.
3. **Signup no painel** — item 1 do handoff-I §5, ainda aberto.

### 8.2 Riscos que ficam

4. **DoS por lockout continua valendo, e agora por mais um caminho.** Quem
   conhece o slug trava o link por 15 min de propósito — agora também pelo
   `public_daily_submit`. É a consequência aceita da 0033 (não há identidade do
   chamador para punir em vez do link); a 0034 só faz o terceiro caminho
   obedecer à mesma regra. Remédio inalterado: o admin renova o PIN, que limpa
   `locked_until` e `failed_attempts`.
5. **Slug legado não muda com o PIN.** `seed-daily-paulista` e `seed-daily-sul`
   continuam com slug derivado do nome. Agora um ataque de força bruta contra
   eles trava em 5 tentativas, mas o slug segue conhecido por quem já o viu. Se
   isso incomodar, o caminho é emitir link novo (slug sorteado) e aposentar o
   antigo — decisão de produto, não de código.
6. **`handle_new_auth_user` ainda concede `broker` a toda conta nova** (0002).
   Inofensivo com o signup desligado; volta a ser buraco se alguém religar.
   Continua sem dono.
7. **Exceções pós-resolve em `public_daily_submit`** — §4. Conhecidas, benignas,
   só alcançáveis com o PIN correto.
8. **O `UPDATE` do T14 (cor semântica do CCA) não foi aplicado.** O `handoff-H.md`
   ainda não existe quando escrevo isto — a Tarefa H não entregou. Quem fechar a
   H aplica e registra.
9. **Nit de documentação:** a linha de contagem do `supabase/README.md`
   ("58 tabelas · 123 policies · 71 funções · 86 asserts") está velha desde antes
   desta tarefa — o harness de hoje imprime 58 tabelas, 124 policies e 89
   funções. Não corrigi porque não tenho como conferir o total de asserts sem
   inventar número; deixo apontado.

---

## 9. Arquivos

Novos: `supabase/migrations/20260826120000_0034_submit_lockout.sql` · este handoff.

Alterados: `supabase/tests/11_public_link_hardening.sql` (bloco 3 corrigido,
blocos 6/6b/6c novos, fixtures) · `src/pages/DailyReport.tsx` (uma guarda) ·
`supabase/README.md` · `docs/sprints/decisoes.md` · `docs/sprints/sprint-demo.md`.

Nenhum arquivo das Tarefas G e H foi tocado. **Nada commitado** — as duas
metades (banco e tela) têm que ir no mesmo commit.
