# Refutação — `mapa/negocios.md` pela lente **schema**

Domínio: Negócios, clientes, participantes e rateio. Data: 09/09/2026.
Verificado contra `supabase/migrations/` (86 arquivos `.sql`), `supabase/seed.sql`,
`scripts/validate-schema.sh` e os CSVs do Bubble (parse com `csv.DictReader`,
`encoding="utf-8-sig"`, streaming). **Nada rodou contra banco. Nenhum arquivo de código foi alterado.**

**Veredito: REFUTADO.** Não por erro de leitura do schema — as citações de migration estão
certas quase uma a uma e todos os números do CSV se reproduzem exatamente — mas porque
**a §7.2 declara uma cadeia de fallback para três colunas `NOT NULL` que morre na única
linha que precisa dela**, e a carga da §9 aborta. Somam-se dois defeitos graves
(o DDL da §6.3 abre tabela pública a `anon`; a saída por API está descrita como se custasse
só `game_events`) e uma consulta de aceite com o valor esperado errado por 243.

---

## 1. Bloqueante — `NOT NULL` sem valor: os três fallbacks apontam para a mesma coluna vazia

A §7.2 fecha assim as colunas obrigatórias de tempo de `deals`:

| coluna | o que a §7.2 promete |
|---|---|
| `month_base` | `mes` (7.564 de 7.568) · **4 nulos → `month_start(ENVIO)`** |
| `stage_entered_at` | `mudou_status` (7.567) · **1 nulo → `ENVIO`** |
| `created_at` (§2.4) | `ENVIO` · cobertura 7.567 |

Os três caem em `ENVIO`. E `ENVIO` também tem um nulo — **o mesmo registro**:

```
$ python chk6.py     # csv.DictReader sobre export_All-pipelines-modified--_2026-09-08_19-43-56.csv
{'uid': '1780772620462x354212239768173300', 'STATUS': '(vazio)', 'mes': '(vazio)',
 'ENVIO': '(vazio)', 'mudou': '(vazio)', 'CLIENTE': 'Teste Leadfy Integ',
 'Creation': 'Jun 6, 2026 4:03 pm'}
total linhas com algum desses campos vazio: 5
```

```
$ python chk2.py
mes vazio: 4   ENVIO vazio: 1   mudou_status vazio: 1
```

O `ENVIO` vazio, o `mudou_status` vazio e um dos 4 `mes` vazios são **a mesma linha**.
Logo, para `1780772620462x354212239768173300`:

* `month_base` → `mes` nulo → fallback `month_start(ENVIO)` → `ENVIO` nulo → **sem valor**
* `stage_entered_at` → `mudou_status` nulo → fallback `ENVIO` → **sem valor**
* `created_at` → `ENVIO` → **sem valor**

O schema não perdoa:

```sql
-- supabase/migrations/20260725120500_0006_deals.sql
39:  month_base   date not null default public.month_start(current_date),
51:  stage_entered_at timestamptz not null default now(),
```

Consequências, as duas ruins:

* **ETL emite `NULL` explícito** (leitura literal da §7.2, que manda *calcular* o valor):
  `null value in column "month_base" violates not-null constraint`. A §9 embrulha a carga
  num `begin; … commit;` — **as 7.568 linhas de `deals` voltam atrás**, e junto os
  `deal_clients` / `deal_participants` / `deal_history` do mesmo bloco.
* **ETL omite a coluna** (o "conserto" instintivo): entra o default. Como a §9 manda
  `disable trigger deals_default_month_base`, o default da coluna vale
  `month_start(current_date)` = **2026-09-01** — um negócio de jun/2026 nasce em set/2026,
  e a conferência #4 da §9 (`esperado: 411`) passa a devolver 412 sem ninguém entender por quê.
  `created_at` viraria `now()`, apagando a data do fato que a §2.4 defende em parágrafo próprio.

**Correção mínima** (uma linha de regra, não mexe no resto do mapa): estender a cadeia até
`Creation Date`, preenchido em 7.568/7.568 —
`month_base = T_MES(coalesce(mes, ENVIO, "Creation Date"))` e
`stage_entered_at = created_at = T_DATA(coalesce(ENVIO, "Creation Date"))`.
Alternativa igualmente defensável e mais honesta: **descartar a linha** — é o registro
`Teste Leadfy Integ`, sem `STATUS`, sem cliente e sem data nenhuma. Nesse caso o volume da
§10 vira 7.567 e a conferência #6 do VGV não muda (a linha não tem valor).

---

## 2. Alta (segurança) — o DDL da §6.3 cria tabela pública **gravável por `anon`**

A §6.3 propõe:

```sql
create table if not exists public.import_bubble_map ( … );
```

Sem `enable row level security` e sem policy. No schema `public` deste projeto isso não é
"tabela sem policy": é **tabela aberta**. A 0023 deixou default privileges ligados justamente
para o esquecimento não custar caro:

```sql
-- supabase/migrations/20260808160000_0023_role_grants.sql:65-66
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;
```

E o cabeçalho da própria 0023 (linhas 20-21) enuncia a regra que a §6.3 quebra:

> "**RLS é o porteiro** de qual linha cada um enxerga. Toda tabela de `public` tem RLS ligada
> — o `validate-schema.sh` falha se alguma não tiver."

Não é retórica, é código:

```sh
# scripts/validate-schema.sh:110-123
echo "==> RLS em todas as tabelas de public"
… where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
if [ -n "$missing" ]; then echo "FALHA: tabelas sem RLS -> $missing" >&2; exit 1; fi
```

Duas consequências: `./scripts/validate-schema.sh --all` passa a sair com código 1, e — pior —
a superfície anônima do produto, que o CLAUDE.md fixa em **exatamente três RPCs**, ganha uma
tabela com `select/insert/update/delete` para `anon`. Um anônimo poderia reescrever o de-para
de curadoria e apontar `Zona Sul` para o perfil que quisesse antes da próxima carga.

**Correção:** acrescentar ao DDL `alter table public.import_bubble_map enable row level
security;` mais a policy restritiva do padrão da casa (só `admin`) — ou, mais barato, **não
criar tabela**: 26 entradas de curadoria cabem num CSV versionado ao lado do script de ETL,
que é onde a decisão humana já vive. A §6.1 já provou que o id→id é computável; o que sobra
não precisa de banco.

---

## 3. Alta — a saída por PostgREST está descrita como se custasse só `game_events`

A §9 encerra assim:

> "`disable trigger` exige ser **dono** da tabela: funciona por psql/migration como `postgres`,
> **não** por PostgREST com `service_role`. Se a carga for por API, a saída é limpar
> `game_events` depois."

Está incompleto, e o que falta não tem conserto posterior. Dos cinco gatilhos que a §9 manda
desligar, **três não têm escape por papel** — checado no corpo das funções:

| gatilho | escape por `current_user` / `is_admin`? | o que acontece pela API |
|---|---|---|
| `deals_award_points` (`0060:342-344`, `after insert or update`) | não | pontua — a §9 dá a limpeza |
| `deal_participants_award_points` (`0060:374-376`, `after insert`) | não | pontua — a §9 dá a limpeza |
| `deals_default_month_base` (`0032:82-84`, `before insert`) | **não** | reescreve `month_base` |
| `deals_add_creator_participant` (`0012:170-172`, redefinido em `0053:98-134`) | **não** | cria participante |
| `deal_participants_autofill` (`0006:225-227`, redefinido em `0058:79-117`) | **não** | insere gerente+diretor em `ordinal` 1 |

Só `deals_guard_esteira_label` (`0037:52`) e `deals_guard_document_review` (`0028:61-62`)
trazem `current_user not in ('postgres','service_role')`; `deals_guard_closed_month` tem
`is_admin()`. Os três de cima, não.

Volume do estrago, medido:

```
$ python chk7.py
Creator resolve: 6336
Creator resolve E nao esta em nenhum slot do negocio (linha NOVA em deal_participants): 2370
  por Funcao no Bubble: {'ADM': 1956, 'CORRETOR': 379, 'GERENTE': 28, 'DIRETOR': 5, 'SOCIO': 1, '': 1}
```

Pela API entrariam **2.370 participantes que ninguém pediu**, dos quais **379 com
`Funcao=CORRETOR`** — e cada um derruba o rateio do negócio de 100% para 50/50 (ou 33/33/33),
porque `deal_participants_resplit`, que a §9 manda **manter ligado**, recalcula em cima do
conjunto errado. Some-se `deal_participants_autofill` disparando por cada broker espúrio e
gravando gerente/diretor da equipe **atual** em `ordinal` 1 (`0058:96-113`), colidindo com o
gerente histórico que a §2.2 grava também em `ordinal` 1 — o bug que a 0025 consertou. Mais os
**411 `month_base`** reescritos (a própria T2 já mediu). Nada disso se limpa com um `delete`
depois.

**Correção:** trocar a frase por "a carga **tem** de ser por psql/migration como `postgres`;
não existe caminho por API para este domínio" — ou, se a API for imposição, listar as três
compensações (reescrever `month_base` por UPDATE depois, apagar os participantes criados na
janela, e rerodar `recalc_deal_shares` negócio a negócio).

---

## 4. Média — a conferência #2 da §9 espera o número errado (279 em vez de 36)

```sql
-- §9, conferências obrigatórias pós-carga
select count(*) from public.deals d
 where not exists (select 1 from public.deal_participants p where p.deal_id = d.id);
                                                                  -- esperado: 279
```

279 é o total de negócios **sem corretor**, não sem participante. A consulta não filtra papel:

```
$ python chk8.py
negocios sem corretor resolvivel: 279
negocios sem NENHUM participante resolvivel (o que a conferencia #2 conta): 36
sem corretor mas COM gerente/diretor: 243
```

A carga correta devolve **36**. O operador lê "esperado: 279", vê 36 e conclui que 243 negócios
não entraram — ou pior, roda a carga de novo. O mesmo erro contamina a §12, item 3: os
"invisíveis para quem não é admin/diretor/sócio/CCA" são 36, não 279, porque `can_see_deal`
aceita participante de **qualquer** papel:

```sql
-- 0006:578-591
select public.can_read_all()
    or exists (select 1 from public.deal_participants dp
               where dp.deal_id = p_deal_id
                 and dp.profile_id in (select public.auth_visible_profiles()));
```

**Correção:** `-- esperado: 36`, e uma segunda consulta com `and p.role='broker'` para o 279.

---

## 5. Média — a T4 descreve o gatilho errado da 0053

A T4 diz: "`coalesce(new.created_by, auth.uid())` (`0053:104`), retorna cedo só quando
`lead_id` não é nulo … **522 corretores espúrios** entrariam no rateio". A versão da 0053 não
é essa. Ela tem **duas** saídas antecipadas a mais e **não fixa `broker`**:

```sql
-- 20260902150000_0053_pipeline_e2e.sql:105-130
  v_who  uuid := coalesce(new.created_by, auth.uid());
  …
  if v_who is null then return null; end if;
  v_role := public.auth_effective_role(v_who);
  if v_role is null or v_role not in ('director', 'manager', 'broker') then
    return null;
  end if;
  insert into public.deal_participants (deal_id, profile_id, role)
  values (new.id, v_who, v_role::text)
```

Duas correções de fato, em direções opostas: os 1.956 `Creator` com `Funcao=ADM` (§3 acima)
**não** viram participante — a 0053 os barra; e os que viram entram com o papel **efetivo**
(`director`/`manager`), não como corretor. A mitigação da §9 (desligar o gatilho) continua
certa, então isto não muda o plano — mas o parágrafo que a justifica está descrevendo a versão
da 0012, aposentada há duas migrations.

---

## 6. Baixa — deriva de citação (cosmética, não muda decisão)

| citado no mapa | onde está de verdade |
|---|---|
| `0053:104` | `0053:105` |
| `0003:77-92` e `0003:92` para `unique (developer_id, name)` | `0003:87` |
| `0020:319-320` para `add_deal_comment` gravando `to_value` | `0020:318-319` |
| `0077:350-352` para `developer_submissions_advance_case` | `0077:349-352` |
| `supabase/seed.sql:11-22` (9 etapas) | `11-21`; o `on conflict` é a 22 |
| `0006:229-246` para o `resplit` | função `0006:229-239`, gatilho `0006:244-246` |

---

## O que **não** foi possível refutar (conferido, confirmado, não reabrir)

Cada linha saiu de um comando executado. Para discutir o mapa de novo, comece **depois** desta tabela.

| afirmação do mapa | comando | resultado |
|---|---|---|
| `deals.code` `text not null unique` **sem check de formato** (`0006:27`) | `sed -n 27p …_0006_deals.sql` | OK, literal — `BUB-<uid>` (40 chars) entra |
| `deals` **não tem** `external_id` | `grep -rn external_id supabase/migrations \| grep -i deal` | zero ocorrências — id determinístico é mesmo a única saída |
| `vgv_net` é `generated always as … stored` (`0006:45-46`) | `sed -n 45,46p` | OK — qualquer valor no INSERT dá erro |
| `deals_closed_consistency` (`0006:59-60`) | `sed -n 59,60p` | OK, literal |
| `mudou_status` cobre 100% dos que precisam de `closed_at` | `python chk2.py` | `precisam closed_at: 7072 · sem mudou_status: 0` — **exato** |
| `discount_pct numeric(5,2) check between 0 and 100` aceita `desconto/bruto*100` | `python chk1.py` | `pct>100: 0 · div/0: 0 · bruto NULL com desconto: 0` — nenhum valor estoura |
| soma esperada do VGV | `python chk1.py` | `465211260.70` e `398105909.06` (won) — **batem ao centavo** |
| o fallback "bruto vazio e líquido>0 → usar líquido" não infla a conferência #6 | `python chk3.py` | `linhas sem bruto mas com liquido>0: 0` — o fallback é no-op, a conferência continua válida |
| nenhum valor de dinheiro estoura `numeric(14,2)`/`(12,2)` nem quebra T-MOEDA | `python chk5.py` | 12 colunas, `parse_err=0` em todas; máximos 458.000 e 11.810,02 |
| `deal_clients` `ordinal in (1,2)` + `unique (deal_id, ordinal)` (`0006:86,114`) | `sed -n 86p;114p` | OK, literal |
| `deal_clients.full_name` NOT NULL e 16 vazios | `sed -n 88p` + `python chk7.py` | `CLIENTE vazio: 16` — **exato** |
| `deal_clients.has_informal_income boolean not null default false` | `0006:104` | OK |
| `deal_clients.dependents` é **text**, não boolean | `0006:96` | OK |
| `deal_participants.role` `check in ('broker','manager','director')` (`0006:130`) | `sed -n 130p` | OK, literal |
| `unique (deal_id, profile_id, role)` (`0006:136`) | `sed -n 136p` | OK — mesma pessoa em dois papéis é permitida, como o mapa diz |
| `ordinal` NOT NULL default 1, `check between 1 and 3`, **sem** unique por papel | `cat …_0025_deal_participant_ordinal.sql` | OK — a advertência do mapa procede |
| `share_pct` é recalculado e zera gestor | `sed -n 30,79p …_0058_pipeline.sql` | OK — enviar `share_pct` é mesmo trabalho jogado fora |
| `deal_history.kind` NOT NULL **sem check** de vocabulário | `sed -n 350,359p …_0006_…` | OK — `'comment'` entra |
| `add_deal_comment` grava o texto em `to_value` | `grep -A 22 add_deal_comment …_0020_…` | OK (limite 4.000 chars; máximo medido 1.285) |
| `developers.name` e `slug` unique; slug gerado **só no INSERT** (`0003:69-72`) | `sed -n 14,72p …_0003_…` | OK — normalizar o nome antes da carga é obrigatório mesmo |
| `developer_projects` `unique (developer_id, name)`, `state char(2)` | `sed -n 74,88p …_0003_…` | OK |
| as 9 etapas e os códigos usados na §4.2 existem | `sed -n 11,22p supabase/seed.sql` | OK — `incomplete, lead, proposal, visit_scheduled, under_analysis, approved, contract, closed, lost` |
| `deals_guard_stage` é **BEFORE UPDATE** (`0006:435-437`) — a inconsistência `outcome=open` + etapa `lost` passa no INSERT | `sed -n 435,437p` + `sed -n 105,120p …_0028_…` | OK |
| `deals_guard_document_review` é **BEFORE UPDATE** apenas (`0028:75-77`) | `sed -n 54,78p …_0028_…` | OK — inserir os 5 campos de auditoria como NULL não é problema |
| `document_review_status` aceita `'draft'` e `'approved'` (`0028:17-18`) | idem | OK |
| `deals_guard_esteira_label` cobre INSERT e escapa por `postgres`/`service_role` (`0037:52`) | `sed -n 39,66p …_0037_…` | OK — e `deal_status_bare` pega tanto `13. ESTEIRA AGIL` quanto `RET. ESTEIRA AGIL` |
| `deals_guard_closed_month` é INSERT **e** UPDATE, escape só por `is_admin()` (`0010:51-53`) | `sed -n 29,53p …_0010_…` | OK |
| `deals_default_month_base` troca quando é NULL **ou** = `month_start(current_date)` (`0032:63`) | `sed -n 53,84p …_0032_…` | OK |
| `deals_award_points` dispara em INSERT (`0060:342-344`) | `sed -n 288,345p …_0060_…` | OK — `if tg_op='INSERT' then v_venda := (new.outcome='won')` |
| `game_events_dedupe_idx` existe (`0010:121-123`) | `sed -n 119,124p …_0010_…` | OK |
| `deal_participants_autofill` insere gestor em `ordinal` default 1 (`0058:96-113`) | idem §3 | OK — a T6 procede |
| **inventário completo de gatilhos** de INSERT nas tabelas do domínio | `grep -rn "on public.deals\b\|on public.deal_participants\b\|on public.deal_clients\b\|on public.deal_history\b\|on public.developers\b\|on public.developer_projects\b"` | O mapa **não esqueceu nenhum**. `deals_log_changes` (`0006:462`), `deals_guard_value` (`0061:247`), `deals_set_updated_at` e `deal_participants_revoke_points` são AFTER/BEFORE **UPDATE** ou **DELETE** — inertes numa carga só de INSERT |
| nenhuma outra `alter table public.deals` acrescenta constraint | `grep -rn "alter table public.deals\b" -A 6` + `grep -rn "add constraint" \| grep -i deal` | só a `0025` (ordinal) e a `0028` (review status) |
| chave de junção é `Users.colaboradores`, não `Nome_completo` | `python chk4.py` | **298 distintos em 298 linhas, zero duplicata**; `CORRETOR 1` 7.271/7.349 = **98,94%** |
| cobertura dos 8 slots de pessoa | `python chk4.py` | **reproduz a §5.2 linha a linha**: 99,06% · 100% · 98,06% · 97,42% · 100% · 100% · 100% |
| `GERENTE 2` (com espaço) não existe no CSV | `python chk4.py` | `False` — o mapa está certo |
| volume de `deal_participants` | `python chk4.py` | `broker 8110 · manager 7490 · director 5122 = 20722` — **idêntico à §10**, com 87 duplicatas dentro do papel absorvidas |
| `unique id` sem duplicata em 7.568 linhas | `python chk2.py` | `uids distintos: 7568 · dups: 0` |
| distribuição de `STATUS` da §4.1 | `python chk2.py` | `VENDA 1829 · OFF 5077 · DISTRATO 158 · PROPOSTA 494 · PARCEIRO 8 · vazio 2` — **exato** |

---

## Nota de método

O arquivo de Users tem a coluna `senha_temporaria` (confirmado por
`"senha_temporaria" in fieldnames` → `True`). **Nenhum valor dela foi lido, impresso ou
gravado** em nenhum ponto desta verificação; os scripts só tocam `unique id`, `colaboradores`
e `Funcao`. Nenhum CPF, PIS, telefone ou e-mail aparece neste relatório.
Scripts em `<scratchpad>/chk1.py … chk8.py`, fora do repositório.

Suposição não verificável por arquivo, herdada do mapa e ainda de pé: o fuso das datas
(§11-S1). Continua valendo o que a D9 diz — só se resolve abrindo um negócio no Bubble.
