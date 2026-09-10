# Alvo — Identidade, papéis, equipes e operação diária

Restrições do schema `public` que um **import em massa de dados legados** precisa
respeitar. Escopo: `profiles`, `user_roles`, `teams`, `team_members`,
`distribution_groups`, `distribution_group_members`, `distribution_group_forms`,
`work_shifts`, `checkins`, `allowed_ips`, `access_provision_log`,
`role_change_log`, `permissions`, `role_permissions`.

Fonte de verdade: `supabase/migrations/` (86 arquivos, aplicados em ordem de
nome). Onde uma migration posterior redefine um objeto, **vale a última** — as
citações abaixo já apontam para a versão vigente.

Números do Bubble citados aqui saíram de leitura com o módulo `csv` do Python
sobre `DOCUMENTOS/DADOS_BUBBLE/` (scripts descartáveis no scratchpad). Dados
pessoais aparecem mascarados; a coluna `senha_temporaria` do export de Users
**não foi lida, exibida nem contada** — ela é `<redigido>` por decisão de
segurança e o schema alvo não tem para onde levá-la (a autenticação é 100%
Supabase Auth, `0002_identity.sql:23-26`).

---

## 1. Resposta curta às sete perguntas

| # | Pergunta | Resposta |
|---|----------|----------|
| a | `profiles.id` é FK para `auth.users`? | **Sim**, `references auth.users(id) on delete cascade` (`0002:29`). **Não existe profile sem usuário no Auth.** O caminho é inserir em `auth.users` e deixar o gatilho `on_auth_user_created` criar o profile. |
| b | `auth_visible_profiles()` | 4 ramos union: admin/partner veem tudo; todos veem a si; líder vê membros abertos das equipes **ativas** que lidera; líder vê o `manager_id` dessas equipes (`0079:65-96`). Depende de `user_roles`, `teams.active`, `team_members.left_at`. |
| c | Papel N:N | PK `(profile_id, role)` (`0002:106`). Gatilho vigente: **só** `user_roles_guard_last_admin` (`0061:212-215`). **Nenhum gatilho sincroniza papel e equipe.** O par `partner→admin` da 0093 foi **desfeito** pela 0094. |
| d | `teams.director_id` / `manager_id` | **Ambos nullable** (`0002:119-120`), `on delete set null`. Equipe sem diretor é alcançável por qualquer diretor que já enxergue o gerente dela (`0068:36-53`); equipe sem diretor **e** sem gerente vira exclusiva do admin. Equipe **inativa** some de `auth_led_team_ids()` e cega o gestor. |
| e | `team_members.left_at` | Usado de verdade: unique parcial `where left_at is null` (`0002:183-184`), o app fecha/reabre vínculo (`people.ts:210-243`) e conta membros abertos (`people.ts:305`). Histórico é suportado; **filiação aberta é no máximo uma por pessoa**. |
| f | Uniques | `profiles.email` (citext), `profiles.slug`, `profiles.cpf` (parcial), `teams.slug`, `distribution_groups.slug`, `work_shifts.code`, `allowed_ips(ip_range, coalesce(team_id,…))`, `distribution_group_forms(form_id)` global, `checkins(profile_id, work_date, shift_id)`, `team_members(profile_id) where left_at is null`. Nos 298 usuários do Bubble: **0 e-mails duplicados**, **6 CPFs duplicados**, **1 CPF com dígitos ≠ 11**, **1 nome vazio**. |
| g | RLS × service_role | `service_role` ignora RLS, mas **não ignora gatilho**. Dois gatilhos barram carga: `profiles_guard_admin_columns` (UPDATE) e `work_shifts_guard`. O `access_provision_log`/`role_change_log` só aceitam escrita por service_role/superusuário. |

---

## 2. (a) `profiles.id`, `auth.users` e o caminho oficial de provisionamento

### A dependência é dura

```sql
-- supabase/migrations/20260725120100_0002_identity.sql:28-29
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
```

**Não dá para inserir profile sem usuário no Auth.** Não há coluna de "pessoa
sem login", não há tabela paralela de colaborador, e o comentário do arquivo é
explícito: `profiles` é o espelho de `auth.users` (`0002:23-26`).

Consequência para o import: **cada uma das 298 pessoas do Bubble vira uma linha
em `auth.users`**, mesmo as desligadas. Quem não deve entrar é bloqueado com
`banned_until` (é o que os seeds fazem, `seeds/010_identity_and_teams.sql:53`) ou
com `profiles.status = 'terminated'`.

### O gatilho que cria o profile

```sql
-- 0002:343-373
create or replace function public.handle_new_auth_user() ...
  insert into public.profiles (id, full_name, email, phone)
  values (new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
             split_part(coalesce(new.email, 'usuario'), '@', 1)),
    coalesce(new.email, new.id::text || '@sem-email.local'),
    nullif(new.raw_user_meta_data ->> 'phone', ''))
  on conflict (id) do nothing;

  insert into public.user_roles (profile_id, role) values (new.id, 'broker')
  on conflict do nothing;

create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_auth_user();
```

Três consequências que mudam o desenho do import:

1. **`full_name`, `email` e `phone` entram pelo `raw_user_meta_data` do Auth**,
   não por insert em `profiles`. Se você inserir em `auth.users` sem
   `raw_user_meta_data.full_name`, o nome vira a parte local do e-mail.
2. **Todo mundo nasce `broker`.** Diretor, gerente, CCA, SDR e sócio ficam com
   `broker` de brinde e é preciso `delete` explícito — os dois seeds fazem
   exatamente isso (`seeds/010_identity_and_teams.sql:118-129`,
   `seeds/060_demo_showcase.sql:120-124`). Não limpar quebra contagem de equipe,
   pódio e o rateio de VGV (a 0048 documenta o estrago).
3. O insert do profile é `on conflict (id) do nothing` — então **inserir o
   profile antes do auth user é impossível** (FK) e **inserir depois vira
   UPDATE**, que cai no gatilho de guarda da seção 8.

### Três caminhos oficiais, e qual serve para 300 pessoas

| Caminho | Arquivo | Serve para massa? |
|---|---|---|
| Edge function `provision-broker-user` | `supabase/functions/provision-broker-user/index.ts` | **Não.** Um por chamada, exige JWT de quem tem papel `admin` (`index.ts:110-124`), e o ramo de criação usa `admin.auth.admin.createUser` (`index.ts:288-292`). É a porta da TELA. |
| `scripts/create-user.ps1` | `scripts/create-user.ps1:93-117` | **Não.** Um por execução, via Admin API do GoTrue, pede a service role key interativamente. |
| **SQL direto em `auth.users` + `auth.identities`** | `supabase/seeds/010_identity_and_teams.sql:26-96` | **Sim.** É o padrão do projeto para carga em lote, idempotente e usado tanto pelo seed de catálogo quanto pelo de demonstração (`seeds/060_demo_showcase.sql:69-113`). |

O molde do seed (o que copiar):

```sql
-- seeds/010_identity_and_teams.sql:26-61 (resumido)
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, banned_until,
  confirmation_token, recovery_token, email_change_token_new, email_change)
select '00000000-0000-0000-0000-000000000000'::uuid, u.id,
       'authenticated', 'authenticated', u.email,
       extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
       now(),
       jsonb_build_object('provider','email','providers',array['email']),
       jsonb_build_object('full_name', u.full_name, 'phone', u.phone),
       now(), now(), '2126-01-01 00:00:00+00'::timestamptz, '', '', '', ''
from novos u
where not exists (select 1 from auth.users au where au.id = u.id or au.email = u.email);
```

Detalhes que **não são decorativos**:

- os quatro campos de token vão como `''` e não `null` — o GoTrue lê essas
  colunas como `text not null` em várias versões;
- `auth.identities` precisa de linha própria (`seeds/010:81-96`), senão o login
  por e-mail não resolve o usuário;
- `banned_until` no futuro = conta que existe e não entra. É o jeito do projeto
  de importar gente desligada sem dar acesso;
- `encrypted_password` recebe hash de um UUID aleatório: ninguém conhece a senha.
  **A coluna `senha_temporaria` do CSV do Bubble não tem destino no schema alvo e
  não deve ser transportada para lugar nenhum.**

### Ordem de carga

```
auth.users (+ auth.identities)      → profiles nascem pelo gatilho, todos 'broker'
  ↓
user_roles                          → concede papéis reais; APAGA o 'broker' de quem não atende
  ↓
teams                               → director_id/manager_id apontam para profiles já existentes
  ↓
team_members                        → uma filiação aberta por pessoa
  ↓
UPDATE profiles (cpf, creci, …)     → exige impersonação de admin p/ colunas administrativas (§8)
  ↓
distribution_groups / _members / _forms
  ↓
work_shifts → allowed_ips → checkins
```

`permissions` e `role_permissions` **não são carga de import**: já vêm das
migrations (§9).

---

## 3. (b) `auth_visible_profiles()` — o que retorna e do que depende

Versão vigente (`0079:65-96`), quatro ramos em `union`:

```sql
select p.id from public.profiles p where public.has_any_role('admin','partner')  -- tudo
union select auth.uid() where auth.uid() is not null                              -- eu
union select tm.profile_id from public.team_members tm
       where tm.left_at is null and tm.team_id in (select public.auth_led_team_ids())
union select t.manager_id from public.teams t
       where t.manager_id is not null and t.id in (select public.auth_led_team_ids());
```

com

```sql
-- 0002:259-270
create or replace function public.auth_led_team_ids() ...
  select t.id from public.teams t
  where t.active and (t.manager_id = auth.uid() or t.director_id = auth.uid());
```

Depende de exatamente quatro coisas gravadas pelo import:

1. `user_roles` do observador (ramo `admin`/`partner`);
2. `teams.active` — **equipe importada como `active = false` não aparece em
   `auth_led_team_ids()`**, e o gestor dela deixa de enxergar a própria equipe;
3. `teams.manager_id` / `teams.director_id`;
4. `team_members.left_at is null`.

É SECURITY DEFINER com `search_path` fixo (`0079:68-70`) porque a policy de
`profiles` consulta `user_roles`, cuja policy consultaria `profiles` — recursão
(`0002:188-195`).

Quem usa isso: `profiles_select` (`0002:432-434`), `user_roles_select`,
`team_members_select`, `checkins_select` (`0004:265-267`), `leads_select`
(`0044:106-111`), metas, negócios, diário. **Um erro de vínculo no import é um
erro de visibilidade em todo o app.**

Complemento importante para não mentir na tela: a view `team_leader_names`
(`0079:114-129`) expõe `id`, `full_name` e `avatar_url` de quem lidera equipe
**ativa**, para qualquer autenticado. Ela é `security_invoker = false` de
propósito: sem ela, o corretor lê `teams` (policy `true`, `0002:469-471`), conhece
o id do gerente e não consegue ler o nome dele. Nada precisa ser importado para
ela — é derivada.

---

## 4. (c) Papel é N:N — combinações esperadas e gatilhos

### Tabela

```sql
-- 0002:101-107
create table public.user_roles (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role       app_role not null,
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (profile_id, role));
```

`app_role = admin | director | manager | broker | cca | sdr | marketing | partner`.

### Combinações que o código espera

- **acúmulo é o normal, não a exceção**: "um diretor que também é gerente e
  corretor é o caso normal" (`0046:11-13`); o comentário da 0002 cita o pedido do
  cliente literalmente (`0002:9-13`);
- a precedência para decidir "o que esta pessoa PODE" é única e está em dois
  lugares espelhados: `auth_effective_role()` no banco
  (`0053:64-79`) e `primaryRole()` no front (`newSchema.ts:79-99`), ordem
  `admin > director > manager > cca > sdr > marketing > partner > broker`;
- **`broker` no fim da ordem é deliberado**: o gatilho do Auth concede `broker` a
  todo mundo, então `roles.includes('broker')` não distingue quem atende
  (`newSchema.ts:91-97`, `0048:16-28`);
- **`partner` sozinho = leitura ampla, escrita nenhuma.** A 0093 promoveu todo
  `partner` a `admin`; a **0094 desfez** (`0094:46-64`), porque 15 asserções em 12
  arquivos de `supabase/tests/` cobram a fronteira. Sócio com poder de admin
  precisa dos **dois** papéis marcados à mão; a tela continua escrevendo "Sócio"
  (`permissions.ts:94-97`);
- `can_read_all()` = `admin | director | partner` (`0002:248-256`).

### Gatilhos em `user_roles` (inventário completo, versão vigente)

```sql
-- 0061:212-215 — o único gatilho vivo nesta tabela
drop trigger if exists user_roles_guard_last_admin on public.user_roles;
create trigger user_roles_guard_last_admin
  before delete or update on public.user_roles
  for each row execute function public.user_roles_guard_last_admin();
```

Recusa a saída do **último** `admin` em DELETE e em UPDATE (`0061:178-210`).
Passa quando o `profiles` correspondente já não existe — é assim que o cascade de
exclusão de pessoa continua funcionando (`0061:170-174`).

```sql
-- 0094:46-47 — o gatilho partner→admin foi REMOVIDO
drop trigger if exists user_roles_partner_implica_admin on public.user_roles;
drop function if exists public.user_roles_partner_implica_admin();
```

**Não há gatilho que sincronize papel e equipe.** Nada obriga `teams.manager_id`
a ter o papel `manager`, nem membro de `team_members` a ter `broker`. A coerência
é responsabilidade do import. O teste `supabase/tests/79_equipes_permissoes.sql:38-71`
monta de propósito o caso que o schema permite e a tela odiava: gerente que **não**
é membro da equipe que lidera.

### RPC oficial de troca de papel

`set_profile_roles(p_profile_id uuid, p_roles app_role[])` (`0094:68-124`, a
versão vigente) — só admin, recusa conjunto vazio, recusa o admin rebaixar a si,
insere antes de apagar, e grava `role_change_log` quando o conjunto muda de fato.
**Para import em massa ela não serve** (exige `is_admin()` do chamador, ou seja,
JWT); o caminho é insert direto em `user_roles`, como os seeds fazem
(`seeds/010:98-116`).

---

## 5. (d) `teams` — diretor e gerente são opcionais; o que quebra sem eles

```sql
-- 0002:115-127
create table public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  director_id uuid references public.profiles(id) on delete set null,
  manager_id  uuid references public.profiles(id) on delete set null,
  active      boolean not null default true, ...);
```

- **Nenhum dos dois é obrigatório.** `name` é `not null` (sem check de vazio);
  `slug` é `not null unique` mas é preenchido pelo gatilho
  `teams_ensure_slug` (`0002:163-165`) — atenção: esse gatilho é **`before insert`
  apenas**, então um UPDATE que zere `slug` estoura NOT NULL. `profiles_ensure_slug`,
  em contraste, é `before insert or update of full_name, slug` (`0002:94-96`);
- `on delete set null` nos dois: **apagar um diretor orfana de uma vez todas as
  equipes da diretoria dele** (`0068:9-11`);
- **não existe unique em `teams(manager_id) where active`**, e isso é uma decisão
  registrada (`0079:41-46`) — a suíte E2E provisiona duas equipes ativas para o
  mesmo gerente.

### O que quebra com equipe sem diretor

```sql
-- 20260904660000_0068_equipe_orfa_recorte.sql:36-53 (policy vigente)
create policy teams_admin_write on public.teams
  for all to authenticated
  using (public.is_admin()
    or (public.has_any_role('director')
        and (director_id = auth.uid()
             or (director_id is null and manager_id in (select public.auth_visible_profiles())))))
  with check (public.is_admin()
    or (public.has_any_role('director') and director_id = auth.uid()));
```

O histórico é o aviso: a 0061 abriu `director_id is null` para **qualquer**
diretor, e como `teams_select` é `true` para todo autenticado (`0002:469-471`),
descobrir o id de uma órfã era trivial — um `PATCH /teams` bastava para adotá-la,
e adotada ela entra em `auth_led_team_ids()`, entregando **perfis, leads e
negócios de uma diretoria alheia** (`0068:14-18`). A 0068 exigiu que adotar
pressuponha enxergar o gerente.

Consequências para o import, em ordem de gravidade:

1. **Equipe importada com `director_id` nulo e `manager_id` preenchido** é
   adotável por qualquer diretor que já enxergue esse gerente. Se o gerente
   estiver em `team_members` de outra equipe, ela é adotável pelo diretor de lá.
2. **Equipe com os dois nulos** só o admin alcança — é o estado "seguro e
   travado". A tela não oferece saída para o gerente/diretor.
3. **Equipe com `active = false`** desaparece de `auth_led_team_ids()`
   (`0002:266-269`): ninguém vê os membros, `goals_write` do diretor recusa metas
   de perfil (`0061:129-146`) e `team_members_manage` (`0044:249-260`) nega o
   próprio fechamento de vínculo. `people.ts:296-303` documenta a ordem correta
   (fechar vínculos **antes** de desativar).
4. **Equipe sem diretor não impede o gerente de operar** — `auth_led_team_ids()`
   casa por `manager_id` também.

### O que os CSVs do Bubble entregam

12 equipes em `export_All-Equipes-modified…csv`, todas com `Diretor` e `gerente`
preenchidos — **mas como nome de exibição, nunca como `unique id`** (0 de 12
valores casam o formato `\d{13}x\d+`). Pior: são nomes curtos e o `Nome_completo`
dos usuários é o nome civil. Cruzando por nome normalizado (sem acento, caixa
baixa, espaços colapsados):

- **10 dos 12 gerentes de equipe não casam nenhum usuário** por nome exato
  ("Archimedes Boff" × "Antonio Archimedes Boff"; "Alisson Luiz" × "Alisson Luiz
  Soares de Oliveira");
- **11 das 12 referências de diretor** idem;
- há ambiguidade real: "Fabio Batista" tem dois candidatos plausíveis no Users
  ("Fábio Rodrigo Carvalho Batista" e "Fabio Alexandre da Silva Barbosa").

**Isto é resolução de identidade, não conversão de dado.** Um import que case por
nome exato produz 12 equipes órfãs de gerente e de diretor — o pior dos estados
acima. A coluna `corretores` das equipes vem concatenada com `" , "` (10 das 12
linhas), o separador ambíguo que o briefing já sinaliza.

---

## 6. (e) `team_members` — o histórico é usado, e a filiação aberta é única

```sql
-- 0002:171-186
create table public.team_members (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  joined_at  date not null default current_date,
  left_at    date,
  created_at timestamptz not null default now(),
  constraint team_members_period check (left_at is null or left_at >= joined_at));

create unique index team_members_one_active
  on public.team_members (profile_id) where left_at is null;
```

O app usa `left_at` de verdade, em quatro lugares:

- `getPersonDetails` faz `.is("left_at", null).maybeSingle()` **apoiado no índice
  parcial** (`people.ts:135-140`);
- `setTeamByManager` fecha a filiação aberta e abre outra, com reabertura em caso
  de recusa, porque são dois requests sem transação (`people.ts:210-243`);
- `deactivateTeam` conta os abertos no banco antes de fechar (`people.ts:305-316`);
- `listPeople` só carrega vínculo aberto (`newSchema.ts:117`).

Consequências para o import:

- **um histórico de várias equipes por pessoa é suportado** desde que **no
  máximo uma linha tenha `left_at is null`** por `profile_id`. Duas abertas =
  `23505` no índice `team_members_one_active`;
- `joined_at` tem default `current_date`: sem data no legado, todo mundo entra
  "hoje" e o histórico de desempenho fica achatado;
- `left_at >= joined_at` é check — datas invertidas do legado estouram `23514`;
- o gerente **não precisa** estar em `team_members` da própria equipe (o schema
  permite, `tests/79:66-71`), e a 0079 existe justamente porque isso quebrava a
  tela. Import consistente: gerente também como membro.

---

## 7. (f) Uniques, checks e o que colide num import de ~300 pessoas

### Inventário (o que um insert em massa precisa respeitar)

| Tabela | Restrição | Onde |
|---|---|---|
| `profiles` | `id` FK `auth.users` on delete cascade | `0002:29` |
| `profiles` | `full_name` not null, `length(btrim(full_name)) > 0` | `0002:30` |
| `profiles` | `email` **citext not null unique** | `0002:31` |
| `profiles` | `slug` unique (nullable, mas o gatilho sempre preenche) | `0002:34`, `0002:60-96` |
| `profiles` | `(status='terminated') = (terminated_at is not null)` | `0002:44-45` |
| `profiles` | `cpf ~ '^[0-9]{11}$'` (só dígitos) | `0046:50-53` |
| `profiles` | unique parcial `cpf where cpf is not null` | `0046:70` |
| `profiles` | `habilitation in ('CRECI','CRECI-ESTAGIARIO','OUTRO')` | `0046:55-58` |
| `profiles` | `badge_delivered_at >= badge_requested_at` e exige o pedido | `0046:60-64` |
| `user_roles` | PK `(profile_id, role)` | `0002:106` |
| `teams` | `slug` not null **unique** (gatilho só no INSERT) | `0002:118`, `0002:163-165` |
| `team_members` | unique `(profile_id) where left_at is null` | `0002:183-184` |
| `team_members` | `left_at is null or left_at >= joined_at` | `0002:179` |
| `work_shifts` | `code` unique; `checkin_start <= distribution_start < checkout_time` | `0004:19,29-30` |
| `checkins` | unique `(profile_id, work_date, shift_id)` | `0004:106` |
| `checkins` | `checked_out_at >= checked_in_at`; `leads_received >= 0` | `0004:103,107` |
| `checkins` | `shift_id` FK **on delete restrict** | `0004:97` |
| `checkins` | default de `work_date` = `current_work_date()` (São Paulo) | `0057:69-70` |
| `allowed_ips` | unique `(ip_range, coalesce(team_id,'000…0'))` | `0075:210-211` |
| `distribution_groups` | `slug` unique; `kind in ('general','specific','sdr')` | `0004:126-127` |
| `distribution_groups` | `attend_timeout_seconds is null or > 0` | `0004:129` |
| `distribution_group_members` | PK `(group_id, profile_id)` | `0004:176` |
| `distribution_group_forms` | PK `(group_id, form_id)` **+ unique global `form_id`** | `0004:189,194-195` |
| `role_permissions` | PK `(role, permission)`, FK `permission → permissions.code` | `0002:388-393` |
| `access_provision_log` | `action in ('create','reset','denied','revoked','restored')` | `0079:272-276` |

### Colisões medidas nos 298 usuários do Bubble

Contagens sobre `export_All-Users-modified--_2026-09-08_19-44-45.csv`
(298 linhas de dados, 34 colunas):

| Risco | Medido | Efeito no import |
|---|---|---|
| `profiles.email` unique | **0 duplicados, 0 vazios**, 298 distintos | ✅ passa direto |
| `profiles.cpf` unique parcial | **6 CPFs duplicados**; 4 vazios | ❌ `23505` em 6 pessoas — decidir quem fica com o CPF |
| `profiles.cpf` check dígitos | **1 valor com ≠ 11 dígitos** após remover pontuação | ❌ `23514` — normalizar com `replace(/\D/g,'')`, como a tela já faz (`people.ts:113`) |
| `full_name` não vazio | **1 `Nome_completo` vazio** | ❌ `23514` — o gatilho do Auth cairia no fallback (parte local do e-mail) se o nome vier vazio no `raw_user_meta_data` |
| `profiles.slug` unique | 297 nomes distintos, **1 nome repetido** ("andre felipe hernandez da silva" ×2) | ✅ o gatilho resolve com sufixo `-2` (`0002:80-89`) |
| `habilitation` check | valores do legado: `''` (115), `Não Possui (Estágio)` (77), `CRECI` (60), `Estágio` (46) | ❌ **nenhum dos três valores legados é aceito** — mapear para `CRECI` / `CRECI-ESTAGIARIO` / `OUTRO` ou deixar `null` |
| `status` / `terminated_at` | `Ativo` = `não` em 204 linhas; `Status_colab` = `Ativo` em 227 e vazio em 69 | ⚠️ **as duas colunas se contradizem**; escolher uma e, ao marcar `terminated`, gravar `terminated_at` no mesmo statement (`0002:44-45`) |
| `Funcao` → `app_role` | `CORRETOR` 275, `GERENTE` 8, `DIRETOR` 5, `CCA` 5, `SÓCIO` 2, `ADM` 1, `SERVICOS GERAIS` 1, vazio 1 | ⚠️ `SERVICOS GERAIS` e vazio não têm papel correspondente; `SÓCIO` → `partner` **sem** `admin` junto (§4) |
| `teams.slug` unique | 12 nomes de equipe, todos distintos | ✅ o gatilho gera slug |

Um detalhe de codificação: os arquivos abrem limpos com `utf-8-sig` no módulo
`csv` do Python; a aparência de mojibake em terminal Windows é do console, não do
arquivo. Ainda assim, **acento faz parte da chave de resolução por nome** — normalize
com NFD antes de comparar, exatamente como `slugify()` faz no banco
(`0001_foundation.sql:171-181`).

---

## 8. (g) RLS, `service_role` e os gatilhos que barram a carga

### O `service_role` entra — o RLS não é o obstáculo

`0023_role_grants.sql:28-35` concede `select, insert, update, delete` em todas as
tabelas de `public` a `anon`, `authenticated` e `service_role`, e
`0023:65-70` repete via `alter default privileges` para tabelas futuras. O
`service_role` ignora RLS por definição. Exceções que a 0075 reintroduziu, e que
não afetam o import por service role:

```sql
-- 0075:96-98
revoke select, insert, update, delete on public.checkins    from anon;
revoke select, insert, update, delete on public.work_shifts from anon;
revoke select, insert, update, delete on public.allowed_ips from anon;
```

### O que realmente barra: dois gatilhos

**1. `profiles_guard_admin_columns` — o mais importante do documento.**

```sql
-- 0061:73-120 (versão vigente), gatilho criado em 0012:64-66
create trigger profiles_guard_admin_columns
  before update on public.profiles
  for each row execute function public.profiles_guard_admin_columns();
```

Fluxo: `is_admin()` passa → tudo liberado. `auth.role() = 'service_role'` →
liberado **menos `bypass_ip_check`**. `manages_profile(new.id)` → liberado menos
`bypass_ip_check` e `email`. Senão:

```sql
-- 0061:109-116
if new.status is distinct from old.status
or new.bypass_ip_check is distinct from old.bypass_ip_check
or new.email           is distinct from old.email
or new.terminated_at   is distinct from old.terminated_at
or new.hired_at        is distinct from old.hired_at then
  raise exception 'Campos administrativos do perfil só podem ser alterados pelo administrador.'
    using errcode = '42501';
```

**A armadilha:** o import por `psql` / Management API / `supabase db query` roda
**sem `request.jwt.claims`**. Então `auth.uid()` é NULL, `is_admin()` é falso,
`auth.role()` é NULL, `manages_profile()` é falso — e **qualquer UPDATE que toque
`status`, `hired_at`, `terminated_at`, `email` ou `bypass_ip_check` levanta
42501**, mesmo como superusuário, porque gatilho não se importa com RLS.

`hired_at` está na lista, e "entrada" é justamente uma das colunas do CSV do
Bubble. Isso significa: **carregar data de admissão e status de desligamento é um
UPDATE bloqueado por padrão.**

A saída correta já está escrita no projeto — assumir a identidade de um admin no
escopo da transação, **sem desligar o gatilho**:

```sql
-- supabase/seeds/050_test_scenarios.sql:41-56
do $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from public.seed_tester_ref)::text,
                      'role', 'authenticated')::text,
    true);   -- true = escopo da transação; some ao fim deste bloco
  update public.profiles set bypass_ip_check = true where id = (select id from public.seed_tester_ref);
end $$;
```

O comentário do próprio seed diz por que não desligar o gatilho: "desligar
removeria a proteção para todo mundo enquanto o seed roda"
(`seeds/050:46-48`). O `sub` tem de ser um perfil que **já tenha o papel `admin`**
em `user_roles` no momento do UPDATE.

O gatilho é `before update` — **INSERT direto em `profiles` não passa por ele**.
Mas insert direto exige que o profile ainda não exista, e o gatilho do Auth já o
criou. Na prática: ou você aceita o UPDATE com impersonação, ou insere em
`auth.users` já com tudo o que o gatilho do Auth sabe copiar (`full_name`,
`email`, `phone`) e deixa as colunas administrativas para uma segunda passada
impersonada.

**2. `work_shifts_guard`** (`0075:174-176`): recusa horários fora de ordem e turno
atravessando a meia-noite **sempre**; recusa sobreposição **só** quando
`current_user = 'authenticated'` (`0075:139-158`) — carga por `postgres` ou
`service_role` escapa da regra de sobreposição de propósito. O ramo de DELETE
recusa apagar turno que tem presença (`0075:113-121`), coerente com o
`on delete restrict` da FK.

**3. `allowed_ips_guard`** (`0075:236-238`): recusa máscara `/0` na criação **e na
reativação**. Import de faixa `0.0.0.0/0` do legado é recusado — é a trava
antifraude do check-in.

### Gatilhos que não barram, mas transformam

| Gatilho | Momento | Efeito no import |
|---|---|---|
| `profiles_ensure_slug` | `before insert or update of full_name, slug` (`0002:94-96`) | Gera slug do nome, com sufixo `-2` em colisão. Não reescreve slug já preenchido — **trocar o nome depois não muda o slug**. |
| `teams_ensure_slug` | `before insert` (`0002:163-165`) | Gera slug do nome da equipe. **Não roda em UPDATE.** |
| `distribution_groups_ensure_slug` | `before insert` (`0004:167-169`) | Idem para grupos. |
| `handle_new_auth_user` | `after insert on auth.users` (`0002:371-373`) | Cria profile + concede `broker`. |
| `user_roles_guard_last_admin` | `before delete or update` (`0061:212-215`) | Bloqueia remoção do último admin. |
| `*_set_updated_at` | `before update` | `profiles`, `teams`, `work_shifts`, `allowed_ips`, `distribution_groups`, `role_permissions`. |

### Tabelas de auditoria: leitura de admin, escrita de ninguém pela API

- `access_provision_log` (`0061:348-375`): RLS só `select` para `is_admin()`;
  `grant select, insert on … to service_role`, `revoke all from anon`. Escrita real
  é da edge function.
- `role_change_log` (`0079:141-168`): RLS só `select` para `is_admin()`; escrita
  só por `set_profile_roles()` (SECURITY DEFINER) ou service role.

**Nenhuma das duas deve receber carga do legado.** O Bubble não tem o dado
equivalente, e inventar linha de auditoria é pior que não ter.

---

## 9. `permissions` e `role_permissions` — catálogo, não import

As duas tabelas são preenchidas **pelas migrations**, com `on conflict do
nothing`, e o `supabase/seed.sql:162-201` reinsere o mesmo conjunto. **Não há nada
para importar do Bubble aqui.**

34 códigos no catálogo vigente, distribuídos assim:

- `0015_menu_permissions.sql:18-38` — 19 códigos `menu.*` + as concessões que
  reproduzem o que o `AppSidebar` mostrava;
- `0016_vault_service_reader.sql:52-54` — `menu.admin_integrations`;
- `0036_menu_atividades.sql:15-16` — `menu.atividades`;
- `0044_feature_permissions_enforced.sql:51-64` — 12 códigos de funcionalidade
  (`leads.view_queue`, `leads.reassign`, `leads.delete`, `deals.view_all`,
  `deals.edit_value`, `deals.delete`, `cca.review`, `reports.view_finance`,
  `teams.manage`, `users.manage_roles`, `settings.integrations`,
  `game.close_season`);
- `0092_pipeline_export.sql:28-38` — `pipeline.export`.

Dois pontos que afetam o import indiretamente:

- `has_permission()` curto-circuita em `is_admin()` (`0002:402-418`): **admin não
  precisa de linha e não pode se trancar fora**. Linha de `partner` na matriz é
  quase decorativa só quando ele também é admin;
- três códigos (`deals.view_all`, `users.manage_roles`, `game.close_season`) **não
  têm leitor** e continuam no catálogo de propósito, documentado em `0061:256-281`.
  A tela os marca "Ainda sem efeito".

---

## 10. Operação diária: `work_shifts`, `checkins`, `allowed_ips`, grupos

Nada disso vem do Bubble como dado histórico útil, mas o import precisa deixar o
estado coerente para a roleta funcionar no dia 1.

**Catálogo mínimo já existente** (`supabase/seed.sql:100-116`):

```sql
insert into public.work_shifts (code, label, checkin_start, distribution_start, checkout_time, position)
values ('manha','Manhã','08:00','08:30','12:00',1),
       ('tarde','Tarde','13:00','13:30','18:00',2),
       ('noite','Noite','18:30','19:00','21:30',3) on conflict do nothing;

insert into public.distribution_groups (name, slug, kind, attend_timeout_seconds)
values ('Fila Geral','fila-geral','general',300),
       ('Triagem SDR IA','triagem-sdr-ia','sdr',null) on conflict do nothing;
```

**Para um corretor importado receber lead**, `distribution_queue()`
(`0074:270-330`) exige, todos ao mesmo tempo:

1. `checkins` aberto no `work_date` de **São Paulo** (`current_work_date()`,
   `0057:55-64`) e `checked_out_at is null`;
2. linha em `distribution_group_members` com `active = true`;
3. `distribution_groups.active = true`;
4. `profiles.status = 'active'`;
5. horário ≥ `work_shifts.distribution_start`;
6. leads atrasados abaixo de `automation_settings.overdue_block_threshold`.

Ou seja: **`user_roles.role = 'broker'` não coloca ninguém na roleta.** Faltando
o vínculo de grupo, a tela de check-in diz "você não está em nenhum grupo"
(é o que `seeds/050:61-65` corrige para o testador).

**`work_date` é do banco, nunca do navegador** (`0029_checkin_work_date.sql:16-17`,
corrigido para São Paulo em `0057:55-64` e reafirmado em `0066:1-33` depois de a
0065 ter reintroduzido `current_date` por ordem de arquivo). Importar `checkins`
históricos calculando a data em UTC produz linhas invisíveis para a fila no
intervalo 21:00–00:00.

**Escrita direta em `checkins` é ato de administrador** desde `0075:87-92`
(`checkins_admin`, `using is_admin()`), mais o auto-checkout do próprio
(`0012:76-79`). O ponto real passa por `perform_checkin()` (`0066:58-118`), que
exige `menu.checkin`, janela de turno, elegibilidade e **IP identificado** — e por
isso `checkins.ip_address is null` é a marca de correção manual
(`0075:90-92`, comentário da policy). Carga de check-in histórico entra com
`ip_address` nulo e isso é semanticamente correto.

---

## 11. Armadilhas, em ordem de dano

1. **UPDATE em `profiles` sem impersonação de admin falha com 42501** para
   `status`, `hired_at`, `terminated_at`, `email`, `bypass_ip_check`
   (`0061:109-116`). Use o padrão `set_config('request.jwt.claims', …, true)` de
   `seeds/050:51-53`. Não desligue o gatilho.
2. **Todo perfil nasce `broker`** (`0002:362-365`). Sem `delete` explícito,
   diretor e gerente entram no rateio de VGV e no pódio (`0048:9-14`).
3. **Relacionamentos nos CSVs `-modified` são nome de exibição curto**, e o
   `Nome_completo` é o nome civil: 10 de 12 gerentes de equipe e 11 de 12
   referências de diretor **não casam por nome exato**. Resolver identidade antes
   de gerar `teams.director_id`/`manager_id`, ou as 12 equipes nascem órfãs.
4. **Equipe órfã de diretor com gerente preenchido é adotável** por qualquer
   diretor que enxergue esse gerente (`0068:36-48`) — vazamento de diretoria.
   Equipe com `active = false` cega o próprio gestor (`0002:266-269`).
5. **6 CPFs duplicados e 1 com dígitos errados** nos 298 usuários — `23505` no
   índice `profiles_cpf_key` e `23514` no check `profiles_cpf_digits`.
6. **`habilitation` do legado não tem nenhum valor aceito** pelo check
   (`0046:55-58`): `Estágio` e `Não Possui (Estágio)` precisam virar
   `CRECI-ESTAGIARIO` ou `OUTRO`.
7. **`status` e `terminated_at` andam sempre juntos** (`0002:44-45`), e as duas
   colunas de status do Bubble (`Ativo` = não em 204, `Status_colab` = Ativo em
   227) se contradizem — a escolha muda quem enxerga o quê.
8. **Duas filiações abertas para a mesma pessoa é `23505`**
   (`team_members_one_active`, `0002:183-184`). Histórico multi-equipe precisa de
   `left_at` preenchido em todas menos uma.
9. **`teams_ensure_slug` não roda em UPDATE** (`0002:163-165`): renomear equipe
   depois do import mantém o slug antigo, e zerar o slug estoura NOT NULL.
10. **`distribution_group_forms.form_id` é unique GLOBAL** (`0004:194-195`), não
    por grupo: o mesmo formulário não pode alimentar duas roletas.
11. **`checkins.shift_id` é `on delete restrict`** e o gatilho da 0075 traduz o
    erro (`0075:113-121`): turno com presença não se apaga, só se desativa.
12. **`banned_until` é o interruptor de acesso**, não `profiles.status`. Marcar
    `terminated` sem bloquear o Auth deixa a pessoa entrando — foi exatamente o
    furo que a 0079 fechou com `action = 'revoked'` (`0079:255-264`).
13. **Fuso**: `current_work_date()` é `America/Sao_Paulo` (`0057:55-64`).
    `created_at`/`hired_at` do Bubble vêm sem fuso declarado — a suposição
    conservadora é `America/Sao_Paulo`, e ela precisa estar escrita no script de
    conversão, não implícita.
14. **`senha_temporaria` não tem destino no schema alvo.** Autenticação é 100%
    Supabase Auth (`0002:23-26`); o campo é descartado, não migrado.

---

## 12. Arquivos consultados (caminhos absolutos)

- `C:/Users/Alisson/CascadeProjects/FACEIMOB/docs/importacao/SCHEMA_ALVO.md`
- `C:/Users/Alisson/CascadeProjects/FACEIMOB/supabase/migrations/20260725120000_0001_foundation.sql`
- `…/20260725120100_0002_identity.sql` · `…/20260725120300_0004_distribution.sql`
- `…/20260725121100_0012_crud_fixes.sql` · `…/20260802120000_0015_menu_permissions.sql`
- `…/20260802130000_0016_vault_service_reader.sql` · `…/20260808160000_0023_role_grants.sql`
- `…/20260810180000_0029_checkin_work_date.sql` · `…/20260901120100_0036_menu_atividades.sql`
- `…/20260901130600_0044_feature_permissions_enforced.sql` · `…/20260901130800_0046_profile_extra_fields.sql`
- `…/20260901140000_0048_creator_participant_role.sql` · `…/20260902150000_0053_pipeline_e2e.sql`
- `…/20260903570000_0057_checkin.sql` · `…/20260903610000_0061_equipes_permissoes.sql`
- `…/20260904570000_0066_checkin_fuso_e_acl.sql` · `…/20260904660000_0068_equipe_orfa_recorte.sql`
- `…/20260906740000_0074_leads_roleta.sql` · `…/20260906750000_0075_checkin.sql`
- `…/20260906790000_0079_equipes_permissoes.sql` · `…/20260908920000_0092_pipeline_export.sql`
- `…/20260908930000_0093_socio_igual_admin.sql` · `…/20260909940000_0094_socio_sem_promocao_automatica.sql`
- `C:/Users/Alisson/CascadeProjects/FACEIMOB/supabase/seed.sql`
- `C:/Users/Alisson/CascadeProjects/FACEIMOB/supabase/seeds/010_identity_and_teams.sql`
- `…/seeds/020_catalog_distribution_sdr.sql` · `…/seeds/050_test_scenarios.sql` · `…/seeds/060_demo_showcase.sql`
- `C:/Users/Alisson/CascadeProjects/FACEIMOB/supabase/tests/79_equipes_permissoes.sql`
- `C:/Users/Alisson/CascadeProjects/FACEIMOB/supabase/functions/provision-broker-user/index.ts`
- `C:/Users/Alisson/CascadeProjects/FACEIMOB/scripts/create-user.ps1`
- `C:/Users/Alisson/CascadeProjects/FACEIMOB/src/integrations/supabase/newSchema.ts`
- `C:/Users/Alisson/CascadeProjects/FACEIMOB/src/integrations/supabase/people.ts`
- `C:/Users/Alisson/CascadeProjects/FACEIMOB/src/integrations/supabase/permissions.ts`
- CSVs: `DOCUMENTOS/DADOS_BUBBLE/export_All-Users-modified--_2026-09-08_19-44-45.csv` (298 linhas),
  `export_All-Equipes-modified_2026-09-08_19-38-04.csv` (12),
  `export_All-corretors-modified_2026-09-08_19-37-25.csv` (365),
  `export_All-gerentes-modified_2026-09-08_19-38-54.csv` (22)
