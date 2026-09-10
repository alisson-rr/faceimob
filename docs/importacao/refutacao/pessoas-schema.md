# Refutação — `mapa/pessoas.md` pela lente **schema**

Domínio: Pessoas, papéis e equipes. Data: 09/09/2026.
Verificado contra `supabase/migrations/` (86 arquivos), `supabase/seed.sql`, `supabase/seeds/010`, `supabase/seeds/050`
e os 4 CSVs do Bubble (parse com `csv.DictReader`, `encoding="utf-8-sig"`).
Nada foi executado contra banco. Nenhum arquivo de código foi alterado.

**Veredito: REFUTADO** — não por erro de leitura do schema (as citações de migration estão certas, praticamente
uma a uma), mas porque **o SQL executável da §9 não implementa a regra que a §5.2 define**, e o desvio faz a
própria consulta de aceite da §9 acusar divergência.

---

## O que NÃO foi possível refutar (conferido e confirmado)

Cheque esta tabela antes de reabrir qualquer um destes pontos: já foi medido.

| afirmação do mapa | comando | resultado |
|---|---|---|
| `profiles.id` FK `auth.users(id)` (`0002:29`) | `sed -n 29p …_0002_identity.sql` | `id uuid primary key references auth.users(id) on delete cascade,` OK |
| `profiles.full_name` NOT NULL + `length(btrim())>0` (`0002:30`) | idem `30p` | OK |
| `profiles.email` citext unique (`0002:31`) | idem `31p` | OK |
| check `(status='terminated')=(terminated_at is not null)` (`0002:44-45`) | idem `44,45p` | OK, literal |
| `teams.slug` NOT NULL unique (`0002:118`) | idem `118p` | OK |
| gatilho `teams_ensure_slug` **só em INSERT** (`0002:163-165`) | idem | OK (`before insert on public.teams`) |
| check `left_at >= joined_at` (`0002:179`) | idem `179p` | OK |
| unique parcial `team_members_one_active` (`0002:183-184`) | idem | OK — `(profile_id) where left_at is null` |
| `profiles_cpf_digits` `^[0-9]{11}$` (`0046:50-53`) e unique parcial (`0046:70`) | `sed -n 45,70p …_0046_…` | OK |
| `profiles_habilitation_values in ('CRECI','CRECI-ESTAGIARIO','OUTRO')` (`0046:55-58`) | idem | OK |
| `profiles_guard_admin_columns` levanta 42501 em `status/hired_at/terminated_at/email/bypass_ip_check` quando `auth.uid()` é nulo | `sed -n 60,120p …_0061_…` | OK (`hired_at` está na linha 113, não em 109-116 — deriva cosmética, defeito 4) |
| impersonar com `set_config('request.jwt.claims', …, true)` é o padrão da casa | `sed -n 30,60p supabase/seeds/050_test_scenarios.sql` | OK — o seed faz exatamente isso, pelo mesmo motivo declarado |
| `user_roles_guard_last_admin` é `before delete or update` e só barra a saída do ÚLTIMO admin | `sed -n 180,215p …_0061_…` | OK — `delete` de `broker` passa |
| sócio **não** vira admin: a 0094 derruba o gatilho da 0093 | `cat …_0094_…` | OK — `drop trigger if exists user_roles_partner_implica_admin` + `drop function` |
| `avatars_write` exige pasta = `auth.uid()` (`0012:397-406`) | `sed -n 380,415p …_0012_…` | OK (a policy também aceita `is_admin()`, o que o mapa não menciona — não prejudica) |
| bucket `avatars` com limite 5 MB e MIME jpeg/png/webp (`0054:78-80`) | `sed -n 60,100p …_0054_…` | OK |
| equipe órfã é adotável por diretor que enxerga o gerente (`0068:36-48`) | `sed -n 25,60p …_0068_…` | OK |
| `can_read_all()` = admin + director + partner (`0002:248-256`) | `sed -n 246,275p …_0002_…` | OK |
| a 0027 lista corretor por `user_roles.role='broker'` (`0027:58-63`) | `sed -n 55,66p …_0027_…` | OK — CTE `visible_brokers` |
| `distribution_group_members` PK `(group_id, profile_id)`, `active` NOT NULL default `true` | `grep -A 12 …_0004_distribution.sql` | OK |
| **nenhum** gatilho em `team_members` nem em `distribution_group_members` | `grep -rn "create trigger" -A 3 supabase/migrations/` | OK — 3 gatilhos em `profiles`, 2 em `teams`, 2 em `user_roles` (um derrubado pela 0094), 0 nas outras duas |
| a carga **não** gera notificação nem acorda cron | mesma varredura + `grep -rn "cron.schedule" -A 4` | OK — os jobs agendados olham `leads`, `checkins`, `tasks`, `notifications` e `developer_submissions`; nenhum reage a `profiles`/`user_roles`/`teams`/`team_members` |
| nenhuma migration posterior mexe em `profiles`/`teams`/`team_members`/`user_roles` | `grep -rn "alter table public\.(profiles\|teams\|team_members\|user_roles)"` | OK — só a 0046, que adiciona colunas e os três checks |
| nenhum `force row level security` | `grep -rn "force row level"` | OK, zero — carga por `psql`/owner não esbarra em RLS |

E os números, todos remedidos direto do CSV:

```
linhas: users 298 (34 col) · equipes 12 (14 col) · corretors 365 (11 col) · gerentes 22 (10 col)

slugify(trim(nome)) das 12 equipes == a lista da §3           -> True (diferença simétrica vazia)
  Susana ' ' -> 'susana';  Jose Portilho -> 'jose-portilho';  Daiane Dias -> 'daiane-dias'
  (slugify tira acento via unaccent_fallback, 0001:160-181 — conferido)

team_members: 267 vínculos, 88 abertos, 179 fechados, 2 pessoas sem `entrada`
VIOLAÇÕES do check team_members_period, com joined = greatest(entrada, equipe.created)  -> 0
  (as equipes nasceram entre 2024-05-11 e 2026-02-05; nenhum Modified Date cai antes)
distribuição por equipe: Victor 53/16 · Jose Portilho 45/10 · Leonardo 31/12 · Zona Sul 30/8 ·
  Alisson 24/6 · Archimedes 22/11 · Mauricio 20/5 · Daiane Dias 15/12 · Susana 14/6 ·
  Alexandre 10/0 · Faceimob 2/2 · Veronica 1/0                -> idêntico à §8
sem equipe 31 (6 ativos)                                      -> idêntico à §8

cpf: 293 com 11 dígitos, 1 com 10, 4 vazios, 0 com mais de 11
     -> 0 violam profiles_cpf_digits depois de re.sub(r'\D','',v).zfill(11)
     288 distintos, 6 grupos duplicados (12 linhas)            -> idêntico à §4.1 #4
email: 298 preenchidos, 298 distintos (case-insensitive), 0 inválidos, 0 com maiúscula, máx. 35 chars
full_name: 0 vazios após o coalesce; 1 nome repetido -> 1 colisão de slug (resolvida com `-2`)
colaboradores: 298 valores, 298 distintos depois de norm()     -> §2.2 confirmado
Funcao: CORRETOR 275 · GERENTE 8 · DIRETOR 5 · CCA 5 · SÓCIO 2 · ADM 1 · SERVICOS GERAIS 1 · vazio 1
Ativo: sim 94 · não 204
habilitacao: vazio 115 · CRECI 60 · "Não Possui (Estágio)" 77 · "Estágio" 46

distribuição final de papéis, calculada pela REGRA da §5.2:
  {broker} 271 · {broker,manager} 11 · {cca} 5 · {broker,director,manager} 4 · {partner} 2 ·
  {admin} 1 · {director,manager} 1 · {broker,director} 1
  -> 296 pessoas com papel, 317 linhas, sem papel: JR e Selmira Tia   -> idêntico à §5.2

dgm: 90 linhas ativo=sim em corretors ∩ 94 Ativo=sim em Users = 88 pessoas, 0 não resolvem
```

Ou seja: a **regra** da §5.2 está certa e reproduz 317. O que não está certo é o **SQL** que a §9 entrega.

---

## Defeito 1 (o mais grave) — o `DELETE` da §9 apaga 10 `broker`; a regra manda apagar 11

**A regra** (§5.2):

> `broker` ⟵ mantido do gatilho para `Funcao ∈ {CORRETOR, GERENTE, DIRETOR}` **COM ficha em `corretors`**;
> DELETADO para os demais → 287 mantidos, **11 apagados**

**O executável** (§9, PASSO 3, linhas 526-534 do mapa):

```sql
delete from public.user_roles ur
using public.profiles p, staging.bubble_users s
where ur.profile_id = p.id
  and p.email = s.email
  and ur.role = 'broker'
  and s.funcao in ('CCA','SÓCIO','ADM','SERVICOS GERAIS','');   -- <- só metade da regra
```

O predicado cobre apenas o ramo "Funcao fora de {CORRETOR,GERENTE,DIRETOR}". A condição
**"com ficha em `corretors`"** sumiu na tradução. Medido:

```
apagados pela regra §5.2 ..................................... 11
  por Funcao: CCA 5 · SÓCIO 2 · ADM 1 · SERVICOS GERAIS 1 · vazio 1   = 10
  por falta de ficha em corretors: Gerente Interino (Funcao=GERENTE)  =  1
linhas que o DELETE do PASSO 3 realmente pega ................ 10
```

Quem escapa é exatamente o placeholder que a §7.2 descreve:

```
colaboradores = 'Gerente Interino' | Funcao = GERENTE | Ativo = sim | equipe = Faceimob
email = int***@faceimob.com.br  |  Nome_completo = 'Gerente Interino'
linhas em corretors com user/Nome = 'Gerente Interino'  ->  []   (nenhuma)
Equipes 'Faceimob': Diretor = 'Gerente Interino', gerente = 'Gerente Interino',
                    corretores = 'Parceiro Externo'
```

### Consequências, todas verificáveis

1. **`user_roles` fecha com 318 linhas, não 317.** A consulta de aceite da própria §9 —
   `union all select 'roles', count(*) from public.user_roles -- 317` — passa a divergir. Quem executa não
   saberá se sobrou uma linha ou se faltou apagar dez; a carga simplesmente "não fecha" e vira investigação.
2. **A tabela de distribuição da §5.2 fica errada em duas linhas:** `{director, manager}: 1` vira `0`, e
   `{broker, director, manager}: 4` vira `5`. A §8 (`user_roles 317 finais = 298 + 30 − 11`) também.
3. **O placeholder entra na listagem de corretores e no pódio.** A 0027 monta `visible_brokers` com
   `exists (select 1 from public.user_roles ur where ur.profile_id = p.id and ur.role = 'broker')`
   (`0027:58-63`) — é precisamente o efeito que a §5.2 diz estar evitando ao apagar o `broker` dele.
   E como ele é `Ativo=sim`, não há `banned_until` para esconder o resultado.

### Correção mínima — uma condição a mais, no mesmo `delete`

```sql
delete from public.user_roles ur
using public.profiles p, staging.bubble_users s
where ur.profile_id = p.id
  and p.email = s.email
  and ur.role = 'broker'
  and (
        s.funcao not in ('CORRETOR','GERENTE','DIRETOR')          -- CCA/SÓCIO/ADM/SERVICOS GERAIS/vazio
     or not exists (select 1 from staging.bubble_corretors bc      -- e quem não tem ficha
                     where bc.display_norm = s.display_norm)
  );
```

Nota de comparação literal, que o próprio mapa levanta na §5.1 e que o `delete` acima preserva: `SÓCIO` tem
acento e `SERVICOS GERAIS` não tem cedilha — trocar `not in` por `in` de novo reintroduz o risco.

Alternativa barata: manter o `in (…)` e acrescentar `or s.display_norm = 'gerente interino'`. Funciona hoje,
mas congela a regra num dado; o próximo export com outro placeholder passa despercebido.

### Duas escolhas com consequência diferente, para o dono decidir

- **Apagar o `broker` do `Gerente Interino`** (o que a §5.2 manda): a equipe `Faceimob` fica com um
  diretor/gerente que não aparece como corretor. É o estado que a consulta de aceite espera. Custo: nenhum.
- **Manter o `broker`** (o que a §9 entrega hoje): então é preciso corrigir a §5.2, a §8 (`317` → `318`) e a
  consulta de aceite — senão toda execução futura vai parecer quebrada. Custo: o placeholder no pódio e na
  listagem de corretores da 0027.

---

## Defeito 2 — `staging.bubble_users` é usado três vezes e nunca é definido

A §3.1 cria `import.bubble_map` (schema `import`), com DDL completo. Os três blocos da §9, porém, leem de
**`staging.bubble_users`** — outro schema, outra tabela, sem DDL em lugar nenhum do documento:

```
$ grep -c "staging.bubble_users"       docs/importacao/mapa/pessoas.md   -> 3
    (PASSO 1 linha 520, PASSO 3 linha 528, PASSO 4 linha 555)
$ grep -c "create table.*staging"      docs/importacao/mapa/pessoas.md   -> 0
```

Quem executar precisa inventar as colunas, e uma delas é decisiva: **`u.id`**, o uuid que vira
`auth.users.id`, depois `profiles.id` pelo gatilho (FK, `0002:29`) e ainda a pasta do avatar no bucket
(`<profile_id>/avatar.<ext>`, exigido pela policy `avatars_write`, `0012:397-406`). O documento nunca diz de
onde esse uuid sai — `gen_random_uuid()` no staging? derivado do `unique id` do Bubble?

Pelo menos estas colunas são exigidas pelo próprio SQL da §9:
`id, email, full_name, phone, ativo, funcao, status, hired_at, terminated_at, cpf, creci, habilitation,
birth_date, address, indication`.

Consequência de não fechar isso: cada execução escolhe um caminho, e `import.bubble_map.target_id` — que a
§3.1 vende como "o índice apelido → uuid compartilhado com os outros domínios" — pode acabar apontando para
um uuid que não é o que ficou em `profiles`.

---

## Defeito 3 — "gravar a URL" do avatar, num bucket **privado**

A §4.1 #17 manda "baixar, subir em `<profile_id>/avatar.<ext>`, **gravar a URL**", e reconhece que o bucket é
privado. Não diz *qual* URL, e há três candidatas — duas quebram:

```
$ sed -n '350,372p' supabase/migrations/20260725121100_0012_crud_fixes.sql
  insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', false), …              <- public = false
```

O que o app faz hoje, e portanto o que a coluna precisa conter:

- `src/components/BrokerEditModal.tsx:288` — `supabase.storage.from("avatars").createSignedUrl(path, 60*60*24*365*5)`
- `src/components/BrokerEditModal.tsx:289` — grava esse `signedUrl` em `profiles.avatar_url`
- `src/components/layout/AppLayout.tsx:96` — renderiza `<img src={me.avatar_url}>` **direto**, sem assinar nada

Ou seja: `profiles.avatar_url` guarda **URL assinada**, não caminho e não URL pública. Se a carga gravar
`https://<projeto>.supabase.co/storage/v1/object/public/avatars/…` (bucket privado → erro) ou a URL do CDN do
Bubble (`//0b42…cdn.bubble.io/f176…`, medida em 87 linhas: 86 `.png` + 1 `.jpg`), as fotos aparecem quebradas
— e a §7.7 escolheu "baixar" justamente para não depender do Bubble. O passo 8 precisa dizer `createSignedUrl`
com prazo explícito e registrar que o prazo expira (a nota `ponytail` do `BrokerEditModal` já assume esse limite).

---

## Defeito 4 — derivas de citação (cosméticas, num documento que se vende como "executável sem reabrir CSV")

| citação no mapa | onde está de verdade |
|---|---|
| `seed.sql:108-110` (grupo `fila-geral`) | 108-110 é o comentário; o `insert into public.distribution_groups` está em **111-115** |
| `0061:109-116` (`hired_at` no guard) | o ramo é **108-114**; `hired_at` está na linha **113** |
| `0002:360-366` (o gatilho copia do metadata) | a leitura do metadata está em **350-358**; 360 é o `on conflict (id) do nothing` e 362-365 é o insert do `broker` |
| `0094:46-64` | `drop trigger`/`drop function` em **45-46**; o `delete` do backfill em **51-64** |

Nenhuma muda a conclusão do mapa; todas fazem quem executa abrir o trecho errado.

---

## O que ainda falta provar (fora do alcance de leitura de arquivo)

1. **`auth.identities` não tem SQL no documento.** A §6.2 promete "uma linha por usuário, senão o login por
   e-mail não resolve" e remete a `seeds/010:81-96` — que de fato preenche
   `id, provider_id (= email), user_id, identity_data, provider='email'`. Mas o PASSO 1 da §9 traz só um
   comentário `-- + auth.identities (seeds/010:81-96)`. Sem o insert, 298 contas existem e nenhuma loga.
   Colar o SQL inteiro resolve.
2. **Versão do GoTrue do projeto remoto.** As colunas NOT NULL de `auth.users` variam por versão
   (`confirmation_token`, `email_change`, `phone_change`, `reauthentication_token`, …). O molde de `seeds/010`
   cobre quatro delas; se o remoto exigir mais, o PASSO 1 quebra em 23502. Só um `\d auth.users` no destino
   fecha isso — e esta fase é somente leitura de arquivo.
3. **`import` fora do PostgREST.** `supabase/config.toml` não declara `schemas`, então o padrão
   (`public, graphql_public`) vale para o local. No projeto remoto os schemas expostos são configuração de
   dashboard: confirmar antes de confiar no "dispensa RLS" da §3.1.
4. **`distribution_groups` existir no destino.** A §8 diz que `fila-geral` "vem do `seed.sql`". Se o banco
   alvo nunca rodou `seed.sql`, o passo 7 não tem `group_id` para onde apontar.

---

## Comandos que sustentam este relatório

```bash
ls supabase/migrations | wc -l                                        # 86
grep -rn "create trigger" -A 3 supabase/migrations/ | grep -E "on public\.|on auth\."
grep -rn "alter table public.profiles|alter table public.teams" supabase/migrations/
grep -rn "force row level" supabase/migrations/                       # vazio
grep -rn "cron.schedule" -A 4 supabase/migrations/
sed -n '29p;30p;31p;44p;45p;118p;163p;179p;183p;184p' supabase/migrations/20260725120100_0002_identity.sql
sed -n '160,200p'  supabase/migrations/20260725120000_0001_foundation.sql      # slugify + unaccent_fallback
sed -n '45,70p'    supabase/migrations/20260901130800_0046_profile_extra_fields.sql
sed -n '60,230p'   supabase/migrations/20260903610000_0061_equipes_permissoes.sql
sed -n '350,415p'  supabase/migrations/20260725121100_0012_crud_fixes.sql
sed -n '55,66p'    supabase/migrations/20260810150000_0027_product_visibility.sql
cat                supabase/migrations/20260909940000_0094_socio_sem_promocao_automatica.sql
sed -n '20,115p'   supabase/seeds/010_identity_and_teams.sql
sed -n '30,60p'    supabase/seeds/050_test_scenarios.sql
sed -n '106,116p'  supabase/seed.sql
grep -rn "avatar_url|avatars" src/ --include=*.tsx --include=*.ts
python <scratchpad>/p2.py   # slugs das 12 equipes + check team_members_period
python <scratchpad>/p3.py   # cpf, email, full_name, Funcao, quem perde o broker
python <scratchpad>/p4.py   # distribuição final de user_roles (317 pela regra)
```

Os scripts estão em
`C:/Users/Alisson/AppData/Local/Temp/claude/C--Users-Alisson-CascadeProjects-FACEIMOB/2d71f16a-19ed-42bc-a96d-efa2d4b2d87c/scratchpad/`
e são descartáveis. `senha_temporaria` não foi lida por nenhum deles; CPF, e-mail e telefone aparecem
mascarados neste relatório.
