# Refutação pela lente "schema" — mapa `Catálogo: construtoras, empreendimentos, fontes e conteúdo`

Alvo: `docs/importacao/mapa/catalogo.md` (lido inteiro).
Fonte de verdade: `supabase/migrations/` (86 arquivos, aplicados em ordem de nome) + `supabase/seed.sql` +
`supabase/seeds/010`–`050` (a lista que `supabase/config.toml:22-35` e `scripts/seed-database.ps1:15-24` aplicam).
Data: 09/09/2026. Nenhum comando tocou o banco — só `grep`/`awk` nas migrations e `python`/`csv` nos CSVs.

**Veredito: REFUTADO — gravidade alta.**

A checagem coluna a coluna não achou **nenhuma** divergência de existência, tipo ou nulidade: as 7 tabelas
destino existem com os nomes citados, os CHECK aceitam todos os valores propostos, nenhuma coluna NOT NULL sem
default ficou de fora, e a leitura de gatilhos do mapa está certa (a §3 deste documento lista o que confirmei).

O que o mapa erra é o **estado inicial do destino**. Ele trata o banco como vazio para 5 das 7 tabelas e como
semeado para 1 (`lead_sources`) — no mesmo documento. O banco alvo **não está vazio**: os seeds `020` e `040`
já plantaram 2 construtoras, 4 empreendimentos, 3 links, 3 dicas ativas e 2 avisos ativos dentro da janela.
Consequência: **5 das 8 verificações pós-carga da §11 acusam falha numa carga perfeitamente correta**, e as duas
promessas de demo do mapa (§4.5 "o banner nasce mostrando a dica de 25/06/2026" e §4.6 "o banner de avisos nasce
vazio") são **as duas falsas**.

---

## 1. Achado principal — o destino já tem catálogo semeado; a §11 e a §4.5/§4.6 assumem que não

### 1.1 O próprio arquivo que o mapa cita como destino já diz isso

`docs/importacao/SCHEMA_ALVO.md:90-93` — o arquivo que o mapa aponta no cabeçalho como referência de destino:

```
## Estado do banco remoto no snapshot (dados de seed/demo, não produção)

profiles 24 · leads 72 · deals 32 · deal_participants 101 · notifications 1839 · lead_events 1070 ·
teams 3 · developers 2 · pipeline_stages 9 · cca_stages 6 · document_types 9 · game_seasons 4
```

`developers 2`. O mapa foi escrito contra este arquivo e mesmo assim a §11 espera `41`.

### 1.2 De onde vêm as linhas — as inserções são explícitas nos seeds

`supabase/seeds/020_catalog_distribution_sdr.sql:5-21`:

```sql
insert into public.developers (
  id, name, slug, flow, submission_email, contact_name, contact_phone, notes
)
values
  ('30000000-...-0001', 'Horizonte Urbanismo', 'horizonte-urbanismo', 'internal', null, ...),
  ('30000000-...-0002', 'Viva Lar Incorporadora', 'viva-lar-incorporadora',
   'external', 'credito@vivalar.example.invalid', ...)
on conflict do nothing;

insert into public.developer_projects (id, developer_id, name, city, state)
values
  ('31000000-...-0001', '30000000-...-0001', 'Parque das Flores',  'Sao Paulo',     'SP'),
  ('31000000-...-0002', '30000000-...-0001', 'Reserva Paulista',   'Campinas',      'SP'),
  ('31000000-...-0003', '30000000-...-0002', 'Viva Centro',        'Curitiba',      'PR'),
  ('31000000-...-0004', '30000000-...-0002', 'Jardins do Sul',     'Porto Alegre',  'RS')
on conflict do nothing;
```

`supabase/seeds/040_reports_game_workspace.sql:167-186`:

```sql
insert into public.useful_links (id, label, url, icon, category, sort_order)
values
  ('6b...0001', 'Central de ajuda do Supabase',      'https://supabase.com/docs', 'book-open', 'ferramentas',   1),
  ('6b...0002', 'Consulta de CPF - Receita Federal', 'https://servicos.receita.fazenda.gov.br/', 'search', 'consultas', 2),
  ('6b...0003', 'Portal CAIXA Habitacao',            'https://www.caixa.gov.br/voce/habitacao/', 'home', 'financiamento', 3)
on conflict do nothing;

insert into public.important_notices (
  id, title, body, severity, starts_at, ends_at, active, created_by
)
values
  ('6c...0001', 'Base demonstrativa carregada', '...', 'info',
   now() - interval '1 day',  now() + interval '30 days', true, '10000000-...-0001'),
  ('6c...0002', 'Documentos pendentes no CCA',  '...', 'warning',
   now() - interval '2 days', now() + interval '10 days', true, '10000000-...-0011')
on conflict do nothing;

insert into public.gold_tips (id, title, body, author_id, sort_order)
values
  ('6d...0001', 'Responda enquanto o interesse esta quente', '...', '10000000-...-0002', 1),
  ('6d...0002', 'Registre o proximo passo',                  '...', '10000000-...-0003', 2),
  ('6d...0003', 'Documentacao completa acelera o credito',   '...', '10000000-...-0011', 3)
on conflict do nothing;
```

Repare nas **colunas ausentes** dos dois últimos inserts: `gold_tips` não recebe `active` nem `created_at`, e
`important_notices` não recebe `created_at`. Os defaults de `0011_marketing_workspace.sql:304-312` entram no
lugar — `active boolean not null default true` e `created_at timestamptz not null default now()`. Ou seja:
**as 3 dicas de seed nascem ativas e com `created_at` = data do seed**, que é setembro/2026.

Esses arquivos não são opcionais: `supabase/config.toml:24-35` e `scripts/seed-database.ps1:15-24` listam
`seed.sql`, `010`, `020`, `030`, `040`, `045` e `050` — `020` e `040` estão nos dois caminhos (reset local e
`npm run db:seed:remote`). Verifiquei também que `050` e `060` **não** tocam nenhuma dessas 5 tabelas.

### 1.3 O que a §11 realmente devolve

| Verificação da §11 | Esperado pelo mapa | Real com o seed aplicado | Delta |
|---|---:|---:|---|
| 1. `count(*) from developers` | 41 | **43** | +2 (`Horizonte Urbanismo`, `Viva Lar Incorporadora`) |
| 1. `count(*) filter (where active)` | 33 | **35** | +2 (as duas de seed nascem `active` por default) |
| 3. `count(*) from developer_projects` | 625 | **629** | +4 |
| 5. `count(*) from gold_tips` | 10 | **13** | +3 |
| 5. `count(*) from important_notices` | 18 (ou 17) | **20** (ou 19) | +2 |
| 5. `max(created_at) gold_tips` | 2026-06-25 | data do seed (set/2026) | as 3 de seed são as mais novas |
| 6. `count(*) from gold_tips where active` | **1** | **4** | +3 |
| 6. avisos ativos na janela | **0** | **2** | +2 (o seed usa `now() ± dias`, sempre na janela) |
| 7. `count(*) from useful_links where url ~* '^https?://'` | 3 | **6** | +3 |
| 4. `lead_sources` | 12 | **12** ✔ | única em que o mapa contou o seed |

Cinco das oito verificações acusam falha numa carga que rodou certo. Um operador seguindo o documento conclui
que a carga quebrou e pode desfazer ou reexecutar — que é justamente o risco que uma seção de verificação
existe para eliminar.

### 1.4 As duas promessas de demo caem junto

O mapa justifica a regra de `active` das dicas com o comportamento do front, e cita certo —
`src/components/PipelineTopRanking.tsx:64-65`:

```ts
supabase.from("gold_tips").select("body").eq("active", true).order("created_at", { ascending: false }).limit(1),
supabase.from("important_notices").select("title,body").eq("active", true).order("created_at", { ascending: false }).limit(1),
```

Só que o vencedor de `order by created_at desc limit 1` entre as ativas não é a dica do Bubble
(`2026-06-25 00:03 −03`, medida no CSV) e sim uma das 3 dicas de seed, cujo `created_at` é o `now()` do seed
(setembro/2026, posterior). Então:

- §4.5: *"o banner do pipeline nasce mostrando a dica de 25/06/2026 — material de demo pronto"* → **falso**.
  Nasce mostrando `Responda enquanto o interesse esta quente` (seed).
- §4.6: *"o banner de avisos do pipeline nasce vazio"* → **falso**. Nasce mostrando
  `Base demonstrativa carregada` (seed, `active`, janela `now()-1d .. now()+30d`).

### 1.5 O que falta no mapa (correção)

O mapa precisa declarar o baseline e escrever os passos que faltam. Três saídas, com consequências diferentes:

| Opção | O que fazer | Consequência |
|---|---|---|
| **(A) Convivência — recomendada** | Antes da carga: `update public.gold_tips set active = false where id::text like '6d%';` e `update public.important_notices set active = false where id::text like '6c%';`. Reescrever a §11 com os números de 1.3, ou escopar cada assert ao conjunto importado (via `import_bubble_map`) | Demo fica com o conteúdo do Bubble no banner e o histórico de seed continua no admin. Nenhum dado perdido |
| (B) Limpar o catálogo de seed | Apagar as 2 construtoras e os 4 empreendimentos de seed | `deals.developer_id` é `on delete restrict` (`0006_deals.sql:30`) e `seeds/030_commercial_operation.sql` cria negócios apontando para elas — o `delete` é **recusado pelo banco**. Exigiria limpar negócios de seed antes: fora do escopo do catálogo |
| (C) Reset sem seed | `supabase db reset` com `[db.seed] enabled = false` | A §11 passa como está escrita, mas derruba os 24 profiles de seed — e `gold_tips.author_id` / `important_notices.created_by` dependem do profile `Douglas Gomes`, que o agente de identidade cria. Só serve se identidade rodar antes |

Escopar os asserts (A) é o menor diff e o único que não depende de outro domínio.

---

## 2. Achados secundários

### 2.1 A "tripwire" da §11 item 2 não pode disparar nunca

```sql
-- 2. nenhuma construtora externa sem e-mail (a constraint garante; serve de tripwire para D1)
select count(*) from public.developers
 where flow = 'external' and submission_email is null;          -- esperado: 0
```

O próprio mapa cita a constraint que torna essa linha impossível de existir
(`supabase/migrations/20260725120200_0003_catalog.sql:33-34`):

```sql
  constraint developers_external_needs_email
    check (flow <> 'external' or submission_email is not null)
```

A consulta devolve `0` sempre, tenha D1 sido decidido ou não. Ela não detecta o erro que diz vigiar. A
verificação útil de D1 é a inversa — quantas das 41 continuam `internal` esperando decisão:
`select count(*) from public.developers where flow = 'internal' and submission_email is null;`, cruzado com a
lista das 22 `CCA Externo` da §5.1.

### 2.2 A opção (B) de D1 esbarra numa segunda constraint que o mapa não cita

`supabase/migrations/20260903630000_0063_marketing_dados.sql:84-91`:

```sql
  if not exists (select 1 from pg_constraint where conname = 'developers_submission_email_format') then
    alter table public.developers
      add constraint developers_submission_email_format
      check (
        submission_email is null
        or submission_email::text ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      );
  end if;
```

Não afeta a recomendação (A), que grava `NULL`. Mas a tabela de opções de D1 está incompleta: um placeholder de
e-mail em (B) precisa passar por essa regex — `construtora-22` ou `sem-email` são recusados **pelo banco**, não
só pela tela. E `submission_email` é `extensions.citext` (`0003:25`), não `text`: comparação
case-insensitive, o que muda o resultado de qualquer `on conflict`/`where` escrito à mão sobre essa coluna.

### 2.3 `lead_sources`: reaproveitar `meta_ads` herda o agente de SDR que o mapa proíbe

A §4.3 é categórica: *"`sdr_agent_id` — **`NULL` obrigatoriamente**. Origem com agente de SDR **desvia da
roleta**"*, e a §11 item 4 checa isso **só "nas 6 novas"**. Só que o maior volume do de-para (`Facebook Leads`
94.421 + `Facebook` 267 + `Facebot` 68 = **94.756 leads**) cai no código **reaproveitado** `meta_ads`, e o seed
já preencheu esse registro — `supabase/seeds/020_catalog_distribution_sdr.sql:148-168`:

```sql
update public.lead_sources
set form_id = coalesce(form_id, case code
      when 'meta_ads' then 'seed-form-parque-flores'
      when 'portal'   then 'seed-form-regiao-sul'
      else null end),
    sdr_agent_id = coalesce(sdr_agent_id,
      (select id from public.sdr_agents where id = '36000000-0000-0000-0000-000000000001'), ...),
    welcome_template_id = coalesce(welcome_template_id,
      (select id from public.whatsapp_templates where name = 'boas_vindas_faceimob'))
where code in ('meta_ads', 'portal');
```

O `insert ... on conflict (code) do nothing` da §4.3 **não limpa** esses três campos. Na prática, a origem que
vai receber 94.756 leads chega à carga com `sdr_agent_id` e `form_id` preenchidos — exatamente a condição que o
mapa descreve como "desvia da roleta". Não quebra a carga de catálogo (é `do nothing`), mas quebra a premissa
que a carga de **leads** vai herdar. Correção: a §11 item 4 tem de checar as 12, não as 6 novas, e a §4.3 tem de
dizer o que fazer com o `sdr_agent_id` de `meta_ads`/`portal` — limpar, ou mantê-lo conscientemente.

### 2.4 §4.2: "variante bruta" sem `.strip()` explícito coloca espaço nas pontas em 64 dos 625 nomes

A regra escrita é *"gravar como `name` a variante bruta mais frequente do grupo"*. Tomada ao pé da letra (sem
`strip()`), medi **64 dos 625** nomes escolhidos com espaço nas pontas: `'PQ ITALIA '`,
`' JD UNIQUE PARQUE RESIDENCIAL'`, `' PARQUE PORTO BOA VISTA'`, `'PORTO HORTENCIAS '`… Isso não viola
`unique (developer_id, name)` (`0003:88`) na carga, mas **desarma** a idempotência que a §3 promete: o mesmo
empreendimento criado depois pela tela, com o nome aparado, entra como uma **segunda linha** legítima.

Que o `strip()` está implícito dá para provar pelos próprios números do mapa: *"variantes brutas distintas de
`EMPREENDIMENTO` (com construtora): 686"* só reproduz com `.strip()` — medi **686 aparado contra 856 sem
aparar**. Falta uma palavra na regra.

### 2.5 Números da §4.2 que não reproduzem como descritos

Reproduzi com o módulo `csv` do Python 3.12 sobre `export_All-pipelines-modified--_2026-09-08_19-43-56.csv`:

| Afirmação da §4.2 | Medido | Situação |
|---|---|---|
| 7.568 registros · 633 pares · 8 placeholders · **625** finais | idêntico | ✔ |
| órfãos após `COALESCE(CONSTRUTORA2, construtora)` + `norm2` = **0** | 0 | ✔ |
| sem construtora **17** · sem empreendimento **39** | 17 · 39 | ✔ |
| pares com >1 grafia **90** · com 1 ocorrência **330** · com ≥5 **158** | 90 · 330 · 158 | ✔ |
| *"variantes brutas distintas de EMPREENDIMENTO (**com construtora**): 686 → a normalização funde 53"* | 686 é o `distinct` **global** do valor aparado, não por par. Por par: **743**, fundindo **110** | rótulo errado; o número responde outra pergunta |
| *"empreendimentos sob mais de uma construtora: **54**"* | 54 **incluindo** os 8 placeholders descartados; **51** entre os 625 que entram | precisa dizer qual dos dois |

Nenhum dos dois muda uma linha do que será inserido. Registro porque a §12 promete rastreabilidade e esses dois
não reproduzem pelo enunciado.

### 2.6 O mapa nunca diz com que papel a carga roda

As 7 tabelas têm RLS ligada e política de escrita restrita — `developers_write` exige
`has_any_role('admin','cca')` (`0003:221-223`), `useful_links_write` exige `is_admin()` (`0011:494-496`),
`important_notices_write` exige `admin`/`director` (`0011:504-507`), `gold_tips_write` exige
`admin`/`director`/`manager` (`0011:511-513`). Rodando por PostgREST com uma sessão sem esses papéis, o insert
não estoura erro: a policy simplesmente **descarta a linha** e o script conclui "sucesso" com 0 gravações.
`service_role` ou `psql` como `postgres` passam por cima. Uma linha na §1 resolve — hoje não há nenhuma.

---

## 3. O que confirmei e **não** refuto

Para o próximo agente não refazer trabalho. Tudo abaixo foi lido na migration e/ou medido no CSV.

**Existência, tipo e nulidade — nenhuma divergência:**

- `developers` (`0003:20-35`): `name text not null unique`, `slug text not null unique`,
  `flow developer_flow not null default 'internal'`, `submission_email extensions.citext`,
  `active boolean not null default true`.
- `developer_projects` (`0003:75-85`): `developer_id ... on delete cascade`, `name text not null`, `city text`,
  `state char(2)`, `unique (developer_id, name)`.
- `lead_sources` (`0003:189-201`): CHECK de `channel` em
  `('meta','whatsapp','organic','indication','import','portal','other')` — está em **`0003:193-194`**; o mapa
  cita 192-193 (deriva de 1 linha). `create unique index lead_sources_form_idx ... where form_id is not null`
  em `0003:201` ✔. `sdr_agent_id` e `welcome_template_id` **existem**, adicionados em `0008_sdr.sql:74-76` ✔.
- `useful_links` / `important_notices` / `gold_tips` (`0011:271-317`): todas as colunas citadas existem com o
  tipo e o default descritos; `severity` com CHECK `('info','warning','critical')`;
  `category text not null default 'geral'`.
- `useful_links_url_absolute` em `0063:93-97` ✔ — e as 3 URLs do CSV passam na regex
  `^https?://[^[:space:]]+$` (testado).
- `ad_campaigns`: `external_id` unique global em `0067` ✔; `ad_campaigns_status_maiusculo` em **`0084:41-43`** ✔;
  CHECK `total_spend >= 0` **existe** — não em `0011`, e sim em `0063:67-70`
  (`ad_campaigns_spend_not_negative`) ✔; `lifetime_budget`/`starts_on`/`ends_on`/`lead_source_id` em
  `0089:29-33` ✔.
- `deals.developer_id ... on delete restrict` (`0006:30`) ✔ · `deals.project_id ... on delete set null`
  (`0006:31`) ✔ · `deals.lead_origin text` sem CHECK em **`0006:48`** ✔ ·
  `leads.source_id` / `campaign_id` / `campaign_name` (`0005:31,36-37`) ✔.

**Gatilhos — a leitura do mapa está certa.** `grep 'create trigger'` nas 86 migrations devolve, para as 7
tabelas, exatamente: `developers_set_updated_at` (**before update**, `0003:38-39`), `developers_ensure_slug`
(**before insert**, `0003:70-71`), `developer_projects_set_updated_at`, `lead_sources_set_updated_at`,
`useful_links_set_updated_at`, `important_notices_set_updated_at`, `gold_tips_set_updated_at`. Nenhum de
notificação, pontuação ou roleta. A afirmação da §1 ("a carga é silenciosa") **procede**, e `updated_at` vindo do
`Modified Date` **sobrevive ao INSERT** porque o gatilho é `before update`.

**Réplica do `slugify`.** `0001_foundation.sql:171-182` usa `public.unaccent_fallback`, que é um `translate()`
sobre uma lista **fixa** de acentos latinos — não é NFKD. A réplica em Python do mapa (NFKD + remoção de
combining) diverge em qualquer caractere fora dessa lista (`ñ`, `ý`…). Rodei as duas versões sobre os 41 nomes:
**resultado idêntico, 0 divergências, 0 caracteres não-ASCII**. Não é problema hoje; é armadilha se a mesma
réplica for reusada em outro domínio com nome acentuado fora da lista.

**Números medidos que batem:** 41 construtoras · 41 nomes distintos · **41 slugs distintos, 0 colisão** (rodei o
`slugify` do Postgres, não o do mapa) · 0 colisão de `norm2` · `CCA`: 22 `CCA Externo` / 16 `CCA Faceimob` / 3
vazio · 3 links · 10 dicas · 18 mensagens · `Creator = 'Douglas Gomes'` em 28/28 · 144 datas parseadas, 0 falhas ·
`OrigemLead`: 3.601 vazio / 2.832 `Lead Próprio` / 576 `Leadfy` / **359 `Lead\xa0Indicação` com NBSP** / 166
`Lead Loja` / 34 `Lead Feirão`.

**`title` e `body` NOT NULL:** rodei a heurística da §4.5 sobre os 28 registros reais — **0 títulos vazios, 0
corpos vazios, 0 títulos acima de 80 caracteres**. Nenhum NOT NULL é violado.

**`ends_at` = `starts_at` do seguinte:** nenhum par de `Creation Date` empatado nos 18 avisos, então nenhum
`ends_at` sai igual ao `starts_at`.

**`unique (developer_id, name)` na derivação:** simulei o agrupamento `(developer, norm(EMPREENDIMENTO))` com a
escolha "variante mais frequente, desempate por comprimento e alfabético" sobre os 7.568 negócios —
**0 colisões**, com e sem `strip()`. A chave escopada aguenta os nomes repetidos entre construtoras, como o mapa
afirma.

**Privilégios da `import_bubble_map` proposta na §7:** `0023_role_grants.sql:66-71` tem
`alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated,
service_role`. A tabela nova nasce com grant; com RLS ligada e uma policy, passa nos dois portões de
`scripts/validate-schema.sh:107-145` e no assert de `supabase/tests/06_anon_surface.sql:115-131`. A DDL proposta
está correta.

---

## 4. Comandos executados

```
cat  docs/importacao/SCHEMA_ALVO.md ; sed -n '85,93p' docs/importacao/SCHEMA_ALVO.md
cat  docs/importacao/mapa/catalogo.md
ls   supabase/migrations/                                  # 86 arquivos
sed -n '1,120p'   supabase/migrations/20260725120200_0003_catalog.sql
awk  'NR>=189&&NR<=205' supabase/migrations/20260725120200_0003_catalog.sql
sed -n '160,230p' supabase/migrations/20260725120200_0003_catalog.sql
sed -n '265,320p;485,520p' supabase/migrations/20260725121000_0011_marketing_workspace.sql
awk  'NR>=45&&NR<=60'  supabase/migrations/20260725121000_0011_marketing_workspace.sql
sed -n '55,110p;195,235p' supabase/migrations/20260903630000_0063_marketing_dados.sql
cat  supabase/migrations/20260904631500_0067_ad_campaigns_external_id_unico.sql
sed -n '25,55p'   supabase/migrations/20260907840000_0084_ad_campaigns_status_normalizado.sql
cat  supabase/migrations/20260908890000_0089_ad_campaigns_gestao.sql
sed -n '160,190p' supabase/migrations/20260725120000_0001_foundation.sql
sed -n '1,80p'    supabase/migrations/20260808160000_0023_role_grants.sql
grep -rn "create trigger" supabase/migrations/ | grep -E "developers|developer_projects|lead_sources|useful_links|gold_tips|important_notices|ad_campaigns"
grep -rn "alter table public.(developers|developer_projects|useful_links|gold_tips|important_notices|lead_sources)" supabase/migrations/ -A3
grep -rn "sdr_agent_id|welcome_template_id|total_spend" supabase/migrations/
grep -n "developer_id|project_id|lead_origin" supabase/migrations/20260725120500_0006_deals.sql
grep -n "campaign_id|campaign_name|source_id" supabase/migrations/20260725120400_0005_leads.sql
grep -rn "into public.(developers|developer_projects|useful_links|gold_tips|important_notices)" supabase/seed.sql supabase/seeds/*.sql
sed -n '1,30p;120,175p' supabase/seeds/020_catalog_distribution_sdr.sql
sed -n '160,200p'  supabase/seeds/040_reports_game_workspace.sql
sed -n '110,140p'  supabase/seed.sql
sed -n '20,45p'    supabase/config.toml ; sed -n '10,30p' scripts/seed-database.ps1
sed -n '90,145p'   scripts/validate-schema.sh ; sed -n '105,150p' supabase/tests/06_anon_surface.sql
sed -n '50,90p'    src/components/PipelineTopRanking.tsx

python r1.py   # Construtoras: 41 regs, 41 nomes, slugify do Postgres vs NFKD, colisões, CCA
python r2.py   # pipelines sem strip: 7.568, 633 pares, 8 placeholders, 625, 0 órfãos, 64 nomes com espaço nas pontas
python r3.py   # pipelines com strip: 743 variantes, 90/330/158, 0 colisões de unique, OrigemLead
python r4.py   # reprodução do 686 (distinct global aparado) e do 54 (com placeholders)
python r5.py   # títulos/corpos das 10 dicas e 18 avisos, parse de 144 datas, regex das 3 URLs
```

Scripts em `<scratchpad>/r1.py`…`r5.py`, fora do repositório. Nenhum comando tocou o banco; nenhum arquivo do
repositório foi alterado além deste relatório.
