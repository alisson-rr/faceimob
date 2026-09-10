# Refutação — domínio **Leads**, lente **schema**

**Alvo:** `docs/importacao/mapa/leads.md` (lido inteiro).
**Contra o quê:** os 86 arquivos de `supabase/migrations/` + `supabase/seed.sql` + `supabase/seeds/`, mais releitura dos CSVs
de origem. Nenhuma consulta foi feita a banco algum (fase somente leitura); nenhum arquivo do repositório fora deste foi tocado.
**Data:** 09/09/2026.

**Veredito: REFUTADO — com ressalva.** O mapa é, de longe, o mais fiel ao schema que já revisei neste conjunto: os tipos,
os enums, as constraints, os triggers e os defaults citados existem exatamente como descritos, e as contagens de negócio
que sustentam o de-para reproduzem no CSV. Mas **um comando SQL que o mapa manda executar não roda**, e ele é justamente
o que carrega a tabela principal.

---

## 0. Método — o que foi executado

```bash
ls supabase/migrations | wc -l                      # 86
grep -rn "create table public.leads" -A 80          # DDL completo
grep -rn "alter table public\.leads" *.sql          # só 2 (0006 e 0074)
grep -rn "on public\.leads" *.sql | grep trigger    # 4 triggers, todos BEFORE/AFTER UPDATE
grep -rn "force row level security" *.sql           # nenhum
python chk1.py … chk4.py                            # streaming csv sobre leadfies (56 MB) e ligacoes
```

Scripts em `…/scratchpad/chk1.py`…`chk4.py`. As saídas usadas neste relatório estão coladas abaixo, sem edição.

---

## 1. R1 — **bloqueia a carga**: `on conflict (external_id)` não infere índice único **parcial**

**Onde no mapa:** §6, tabela de idempotência, linha `leads`:

> Use `insert … on conflict (external_id) do nothing` (ou `do update` se quiser reprocessar).

**O que a migration diz** (`supabase/migrations/20260725120400_0005_leads.sql:83-84`):

```sql
create unique index leads_external_id_idx on public.leads (external_id)
  where external_id is not null;
```

O índice é **parcial**. O próprio mapa reconhece isso na mesma linha ("Índice **UNIQUE parcial** já existe") e mesmo assim
escreve o `ON CONFLICT` sem o predicado.

No PostgreSQL, `ON CONFLICT (col)` faz *unique index inference*: para um índice parcial ser elegível, a instrução precisa
repetir o predicado (`index_predicate`), senão o índice é ignorado e o planejador não acha alvo:

```
ERROR:  there is no unique or exclusion constraint matching the ON CONFLICT specification
SQLSTATE 42P10
```

Não é leitura de doc isolada: **nenhum ponto do repositório usa `ON CONFLICT` contra esse índice**, e os dois
consumidores reais de `external_id` fazem o contrário —

- `supabase/functions/meta-ads-webhook/index.ts:297` — `insert(lead).select().single()` puro, com o erro de duplicidade
  tratado no `if (leadErr)`;
- `supabase/functions/voice-ai-webhook/index.ts:97,128` — `select … .eq('external_id', …)` **antes** do insert.

Os únicos `on conflict (…)` das migrations miram constraints de tabela inteira, nunca parciais:

```
20260725120800_0009_daily.sql:274:  on conflict (team_id, report_date) do update …
20260725120800_0009_daily.sql:26:     unique (team_id, report_date)          -- NÃO é parcial
```

**Consequência de ignorar:** o primeiro `INSERT` do lote principal aborta com 42P10. Como o mapa manda carregar em
"chunks de 500-1000" (§1, passo 3), o operador vê 100% dos chunks falharem antes de qualquer linha entrar — falha
barulhenta, não corrupção. O custo real é o tempo até alguém entender que o erro é de inferência e não de índice ausente.

**Correção (uma das duas):**

```sql
-- A) repetir o predicado do índice parcial (preserva a alternativa DO UPDATE citada no mapa)
insert into public.leads (…) values (…)
on conflict (external_id) where external_id is not null do nothing;

-- B) sem alvo — funciona porque só existe uma unique em leads
insert into public.leads (…) values (…)
on conflict do nothing;
```

A forma **B** é mais curta, mas silencia qualquer conflito futuro: se um dia houver outra unique em `leads`, ela engole
esse conflito também. Prefira **A**.

O mesmo cuidado **não** é necessário nos satélites — ali as uniques são de coluna e a inferência funciona:

```
20260725120200_0003_catalog.sql:191:  code       text not null unique,      -- on conflict (code) OK
20260725120300_0004_distribution.sql:125:  slug   text not null unique,     -- on conflict (slug) OK
```

---

## 2. R2 — `lead_comments` **não** cabe num usuário `admin`, só em `service_role`

**Onde no mapa:** §2, último parágrafo:

> `leads` e `lead_comments` caberiam num usuário `admin`, mas misturar caminhos não vale a pena.

**O que a migration diz** (`0005_leads.sql:678-680`):

```sql
create policy lead_comments_insert on public.lead_comments
  for insert to authenticated
  with check (author_id = auth.uid());
```

A policy exige que o autor **seja o usuário logado**. O mapa grava `author_id` = o corretor resolvido do lead
(§3, linha 27: "`author_id` = mesmo `assigned_to` resolvido"). Um `admin` autenticado inserindo 7.432 comentários
assinados por dezenas de corretores diferentes leva `new row violates row-level security policy` em **todas** as linhas
cujo autor não seja ele mesmo.

A conclusão prática do mapa (usar `service_role` para tudo) está certa; a justificativa está errada, e é o tipo de frase
que faz alguém "otimizar" para o caminho `admin` depois. **Correção:** trocar por "`lead_comments` também exige
`service_role`: `lead_comments_insert` amarra `author_id = auth.uid()`". `leads` de fato aceita `admin` — `leads_insert`
só checa `has_any_role('admin','director','manager','marketing','sdr')` (`0005:648-650`).

---

## 3. R3 — o UPDATE de `notes` previsto em §9 destrói o `updated_at` importado

**Onde no mapa:** §3, linha 39 afirma (corretamente):

> `updated_at` só é sobrescrito por trigger em **UPDATE** (`leads_set_updated_at` é BEFORE UPDATE), então o valor passado no INSERT sobrevive.

Mas §9 lista, na mesma carga:

> `leads.notes` (UPDATE no próprio insert) | 1.616 | `Obs. atividade`

**O que a migration diz** (`0005_leads.sql:98-100`):

```sql
create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();
```

O trigger é `BEFORE UPDATE` **sem `of <coluna>`**: qualquer `UPDATE`, inclusive um que só toque `notes`, carimba
`updated_at = now()`. Se "UPDATE no próprio insert" quiser dizer uma segunda instrução, 1.616 (corte de 12 meses) ou
2.790 (base inteira) leads perdem o `Modified Date` do Bubble.

Não há razão para a segunda instrução: `notes` é coluna comum de `leads` (`0005:69`), nulável, sem trigger próprio —
cabe no mesmo `INSERT`. **Correção:** incluir `notes` na lista de colunas do INSERT e apagar a linha "UPDATE" de §9.
Se o UPDATE for inevitável, note que reenviar `updated_at` **não** adianta: o trigger é `BEFORE` e sobrescreve o valor.

---

## 4. R4 — contagem de `distribution_groups` errada por um: são **48** grupos novos, não 47

**Onde no mapa:** §4.5 (cabeçalho "49 valores, incluindo vazio"; linha "os **46 restantes**") e §9
("`distribution_groups` | **+47** | 46 rótulos legados + `chatbot`").

**Medido** (`chk2.py` / `chk3.py`, com a chave canônica do próprio §5.1, streaming sobre as 102.799 linhas):

```
Grupo canon distintos (inclui vazio) = 50
Grupo canon nao-vazio = 49
itens listados no mapa como 'os 46 restantes' = 47
cobertos pelo mapa = 49 ; faltando no mapa = [] ; no mapa e nao no CSV = []
```

Ou seja: **a lista do mapa está completa e correta** — ela tem 47 itens, não 46. O errado é a aritmética ao redor dela:
47 legados + `ChatBot` = **48** grupos a criar, com `Roleta Geral` reusando `fila-geral`. E os rótulos de `Grupo` são
50 distintos contando o vazio, não 49.

Verificado também que nada colide no destino:

```
slugs gerados = 49   colisoes = {}        # nenhum rótulo legado gera o mesmo slug de outro
slug fila-geral/triagem? []               # nenhum legado colide com o catálogo já semeado
```

e o catálogo existente é só isso — `fila-geral`, `triagem-sdr-ia` (`supabase/seed.sql:111-116`),
`leads-parque-das-flores`, `leads-regiao-sul` (`supabase/seeds/020_catalog_distribution_sdr.sql:33-37`). Nenhum bate
com os 48 novos.

**Consequência de ignorar:** a carga funciona (o INSERT sai do dado, não da lista), mas a conferência pós-carga acha um
grupo "a mais" que sempre existiu. **Correção:** "47 restantes", "50 valores" e "+48" nas duas tabelas de volume de §9.

---

## 5. R5 — a cauda de `Atividade` é o dobro do declarado

**Onde no mapa:** §4.2, cabeçalho:

> 12 valores cobrem 102.079 dos 102.799 (99,3%); a cauda são 175 valores … somando 360 leads.

**Medido** (`chk4.py`, mesma função `canon` do §5.1):

```
total= 102799   nomeados(12 do mapa)= 100589   vazio= 1258
cauda: valores= 191   leads= 952
nomeados+vazio= 101847
```

Os valores **individuais** do mapa batem um a um (`em atendimento` 36.181 · `primeiro contato` 29.199 ·
`retornar para cliente` 22.758 · `ver mensagem do interessado` 7.409 · `cobrar cliente` 4.031 · vazio 1.258 ·
`em negociao` 494 · `em proposta` 133 · `aguardando documentao` 122 · `visita agendada` 119 · `enviar fotos vdeos` 60).
O que não bate é o agregado: a cauda tem **191 valores / 952 leads**, não 175/360, e os nomeados cobrem 101.847
(99,07%), não 102.079.

**Consequência:** nenhuma no schema — cauda e vazio vão ambos para `funnel_stage='new'`, valor válido do enum. O impacto
é de auditoria: quem conferir quantos leads ficaram com `raw_payload.atividade_original` vai achar 952, não 360.

Em compensação, o número que **importa de verdade** em §4.2 está exato. Cruzei `Atividade` × `Status`:

```
Primeiro contato x Status: {'em negociao': 16348, 'novo': 805, 'arquivado': 12036, 'negcio fechado': 10}
```

`Em negociação` + `Novo` são exatamente os dois status que §4.1 manda virar `in_progress`: 16.348 + 805 = **17.153**,
o número que justifica gravar `no_response` direto. Confirmado.

---

## 6. O que o mapa acertou (verificado, não presumido)

Registro isto porque ceticismo que não confirma o que está certo vira ruído.

**Colunas e tipos.** Toda coluna de destino citada existe com o nome e o tipo declarados (`0005_leads.sql:18-79`).
E o conjunto de colunas de `leads` está **fechado**: só duas migrations alteram a tabela depois —

```
20260725120500_0006_deals.sql:74-75         add column converted_deal_id uuid references public.deals(id) on delete set null;
20260906740000_0074_leads_roleta.sql:50-51  add column if not exists roulette_misses int not null default 0;
```

Nenhum `NOT NULL` sem default foi esquecido, porque **não existe nenhum** em `leads` além de `full_name`:
`status`, `funnel_stage`, `last_activity_at`, `created_at`, `updated_at` e `roulette_misses` são NOT NULL **com** default,
e §7 do mapa trata os cinco casos perigosos explicitamente. `lead_assignments.deadline` é o único NOT NULL sem default
da vizinhança (`0005:133`) — e o mapa não importa a tabela.

**Enums.** `status` e `funnel_stage` são enum, não `text` com check (`0001_foundation.sql:36-56`):

```sql
create type lead_status as enum ('queued','assigned','attending','in_progress','converted','lost','discarded');
create type lead_funnel_stage as enum ('new','first_contact','no_response','warm','hot','gathering_docs','scheduled_visit','qualified');
```

Os 4 status e os 7 estágios que o de-para produz existem. Nenhum valor proposto é inválido.

**Constraints.** As duas citadas existem com o texto exato (`0005:76-79`):

```sql
constraint leads_assigned_consistency check (status not in ('assigned','attending') or assigned_to is not null),
constraint leads_lost_consistency     check ((status = 'lost') = (lost_at is not null))
```

Confirmado o corolário: `in_progress` **aceita** `assigned_to` NULL (os 3.505 sem corretor resolvido entram) e
`discarded` **exige** `lost_at` NULL. A acusação contra a RPC também procede — `close_lead` (`0074:392-401`) grava
`lost_at = now()` sem olhar o status, então `close_lead(id,'discarded',…)` viola a própria constraint.

**Triggers — os quatro, e só quatro, que existem em `leads`:**

```
0005:98-100   leads_set_updated_at    BEFORE UPDATE
0005:118-120  leads_normalize         BEFORE INSERT OR UPDATE OF phone, phone_raw, full_name
0005:607-609  leads_log_changes       AFTER UPDATE
0074:456-458  leads_keep_next_action  BEFORE UPDATE OF next_action_at, status
```

**Três são só de UPDATE.** Logo: um INSERT não gera `lead_events`, não gera `notifications` e não mexe em `updated_at`.
A estratégia inteira do mapa (INSERT direto, sem RPC) depende disso e está correta. O `leads_normalize` faz o que o mapa
diz — `new.phone := normalize_phone(coalesce(new.phone, new.phone_raw))` — então mandar só `phone_raw` funciona, e mandar
os dois NULL deixa `phone` NULL (`normalize_phone` devolve `null` quando não sobra dígito, `0001:128-140`).

**Efeito colateral isolado corretamente.** A avalanche de notificação **não** nasce em `leads`, nasce em
`lead_assignments` (`0011_marketing_workspace.sql:227-229`):

```sql
create trigger notify_lead_assigned
  after insert on public.lead_assignments
  for each row execute function public.notify_lead_assigned();
```

e a função grava **duas** linhas por atribuição, uma `in_app` e uma `whatsapp` (`0011:200-221`). Como o mapa não importa
`lead_assignments`, o gatilho nunca dispara — a previsão "`notifications` geradas: 0" de §9 se sustenta.

**`mark_no_response_leads` — conferido no fonte** (`0043_lead_automation_rules.sql:93-141`): filtra
`funnel_stage='first_contact' and status in ('attending','in_progress')` usando
`coalesce(first_contact_at, last_activity_at)`, **não** lê `leads_paused`, e insere uma notificação `in_app` por lead.
As três afirmações do risco 2 do mapa conferem.

**`automation_settings`.** O `where id` sem comparação de §2 não é typo: a tabela é singleton com
`id boolean primary key default true check (id)` (`0004:201-216`). As sete colunas que o mapa manda anotar existem;
`no_response_hours` default 24 (`0004:207`) e `overdue_block_threshold` default 20 (`0004:206`) — os dois números citados.

**`notifications`.** A limpeza de fila de §2 é válida: `sent_at` e `channel` vêm de `0011:171-173` e `last_error` foi
acrescentada em `0020_core_fixes.sql:292`. O predicado `channel <> 'in_app' and sent_at is null` é exatamente o do índice
`notifications_pending_delivery_idx` (`0011:179-180`).

**Crons.** Levantei os dez jobs agendados nas migrations: `faceimob-release-expired-leads`, `-auto-checkout-expired`,
`-purge-cron-history`, `-notify-dispatch`, `-assign-queued`, `-submission-dispatch`, `-mark-no-response`,
`-public-link-expiry`, `-cron-failure-alert`, `-task-due`. O mapa pausa quatro. Conferi os outros seis:
`auto_checkout_expired` mexe em check-in, `dispatch_pending_submissions` em envios de construtora,
`notify_expiring_public_links` em links do diário, `notify_due_tasks` lê `public.tasks` (`0083:437`) e
`purge-cron-history`/`cron-failure-alert` leem `cron.job_run_details`. **Nenhum toca `leads`.** A lista de quatro está certa.

**Catálogo.** `lead_sources.channel` tem o CHECK citado com os sete valores (`0003:192-193`), e `meta`/`portal`/`other`
— os três usados pelas 5 origens novas — estão nele. `distribution_groups.kind` aceita `('general','specific','sdr')`
(`0004:126-127`), então `specific` passa. `distribution_groups_ensure_slug` existe, é `BEFORE INSERT` e sai antecipado
quando `slug` vem preenchido (`0004:150-152, 167-169`) — mandar slug explícito é determinístico, como o mapa quer.

**`lead_events` é mesmo intocável por `authenticated`** — só há `lead_events_select`, e o comentário em `0005:676-677`
declara a ausência de policy de INSERT de propósito. E **não há `force row level security`** em lugar nenhum
(`grep -rn "force row level security" *.sql` → vazio), então `service_role` passa. O caminho de import proposto funciona.

**Origem.** Os dois CSVs conferem com o cabeçalho do mapa: `leadfies` → 42 colunas / **102.799** registros;
`ligacoes` → `['nomecliente','numerocliente','Creation Date','Modified Date','Slug','Creator']`, **8.365** registros,
sem `unique id`. O corpo tem **337.879** ocorrências de `EF BF BD` — o número exato do mapa. `Cliente` vazio: **635**,
também exato. A distribuição de `Status` por chave canônica reproduz linha a linha:

```
{'arquivado': 36265, 'em negociao': 64885, 'novo': 871, 'negcio fechado': 59, '': 719}
```

36.265 = 1.044 + 34.226 + 995, fechando com §4.1 e com o volume da opção A de §9
(102.799 = 65.756 + 35.221 + 1.763 + 59). As 15 categorias de `Fonte` batem uma a uma com §4.4, inclusive os 43 vazios.

**Achado tranquilizador extra:** varri os 56 MB atrás de byte `0x00` — **zero**. Nenhum `text` nem `jsonb` vai recusar
linha por NUL (`unsupported Unicode escape sequence`), que é a armadilha clássica de importar export legado em Postgres.
O U+FFFD (`EF BF BD`) é UTF-8 válido e entra em `jsonb` sem reclamação.

---

## 7. O que eu **não** consegui provar

- **R1 não foi executado contra um Postgres.** Esta fase é de leitura de arquivo (proibido psql/MCP), então a falha 42P10
  está sustentada por (a) o texto da migration provando que o índice é parcial e (b) a regra documentada de *unique index
  inference*, que exige `index_predicate` para índice parcial. A confirmação empírica é um comando de três linhas num
  banco descartável — vale rodar antes de fechar o plano, não depois de 102 mil linhas.
- **Não avaliei a resolução `Corretor → profiles.id` (§5.2)**: depende do domínio Identidade carregado e é lente de integridade.
- **Não conferi datas (§5.3) nem o validador de telefone (§5.4)** contra os dados; é lente de dados.
- **Não verifiquei se `profiles` terá as linhas necessárias** antes da carga de `leads`. Se não tiver,
  `assigned_to uuid references public.profiles(id)` recusa a linha inteira por FK — mas a ordem de carga de §1 já cobre isso.

---

## 8. Resumo executável das correções

| # | Onde | Correção | Gravidade |
|---|---|---|---|
| R1 | §6, linha `leads` | `on conflict (external_id) **where external_id is not null** do nothing` (ou `on conflict do nothing`) | **alta — o comando não roda** |
| R2 | §2, último parágrafo | `lead_comments` também exige `service_role`: a policy amarra `author_id = auth.uid()` | média |
| R3 | §9 + §3 linha 39 | `notes` entra no próprio INSERT; qualquer UPDATE extra carimba `updated_at = now()` | média |
| R4 | §4.5 e §9 (2 tabelas) | 47 rótulos legados (não 46) · 50 valores de `Grupo` (não 49) · `distribution_groups` **+48** (não +47) | baixa |
| R5 | §4.2, cabeçalho | cauda de `Atividade` = 191 valores / 952 leads; nomeados cobrem 101.847 (99,07%) | baixa |

*Todo número deste relatório saiu de um `grep`/`sed` sobre `supabase/migrations/` ou de script Python com o módulo `csv`
em streaming sobre os CSVs. Nenhuma consulta a banco. Nenhum nome de pessoa, telefone, e-mail ou senha reproduzido.*
