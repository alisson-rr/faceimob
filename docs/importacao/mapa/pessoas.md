# Mapa de importação — Pessoas, papéis e equipes (Bubble → Supabase)

Domínio: identidade e hierarquia comercial. Escrito para ser executado sem reabrir CSV.

- **Origem** (`DOCUMENTOS/DADOS_BUBBLE/`, parse com `csv.DictReader`, `encoding="utf-8-sig"`):

  | arquivo | registros | colunas |
  |---|---:|---:|
  | `export_All-Users-modified--_2026-09-08_19-44-45.csv` | **298** | 34 |
  | `export_All-Equipes-modified_2026-09-08_19-38-04.csv` | **12** | 14 |
  | `export_All-gerentes-modified_2026-09-08_19-38-54.csv` | **22** | 10 |
  | `export_All-corretors-modified_2026-09-08_19-37-25.csv` | **365** | 11 |

- **Destino**: `auth.users`, `auth.identities`, `public.profiles`, `public.user_roles`, `public.teams`,
  `public.team_members`, `public.distribution_group_members`, bucket `avatars`.
- **Fora de escopo por não haver origem**: `work_shifts`, `checkins`, `allowed_ips`,
  `distribution_groups`, `distribution_group_forms`, `permissions`, `role_permissions`,
  `access_provision_log`, `role_change_log`. As quatro últimas são catálogo de migration ou auditoria —
  não recebem carga (`alvo/identidade.md` §8–9).

> **Proibição de segurança:** `Users.senha_temporaria` (298/298 preenchida, texto claro) **não é lida,
> não é transportada, não aparece em log nem em relatório de carga**. Autenticação é 100% Supabase Auth
> (`0002:23-26`); `encrypted_password` recebe hash de UUID aleatório, como em `seeds/010:26-61`.

---

## 1. Ordem de carga

```
 0. import.bubble_map                        (DDL, 1 tabela nova em schema próprio)
 1. auth.users  +  auth.identities           298 + 298
      ↳ gatilho on_auth_user_created cria 298 profiles e 298 user_roles('broker')
 2. user_roles  INSERT dos papéis reais      +30 linhas
 3. user_roles  DELETE do 'broker' indevido  −11 linhas
 4. UPDATE profiles (colunas de RH)          298   ← exige impersonação de admin (§9)
 5. teams                                     12   (director_id/manager_id já resolvem: profiles existem)
 6. team_members                             267
 7. distribution_group_members                88
 8. Storage avatars + UPDATE avatar_url       87
```

Dependências duras que fixam essa ordem:

- `profiles.id` é FK para `auth.users(id)` — **não existe profile sem usuário no Auth** (`0002:29`).
- `teams.director_id`/`manager_id` são FK para `profiles` — passo 5 depois do 1.
- `team_members` depende de `teams` e `profiles` — passo 6 depois do 5.
- O passo 4 precisa que um `admin` já exista em `user_roles` no momento do UPDATE (passo 2).

**Não é preciso pausar cron nem `leads_paused` para este domínio**: nada aqui insere em `leads`,
`notifications` ou `developer_submissions`. A trava de `alvo/operacao_alvo.md` só vira obrigatória
quando os domínios de leads/negócios entrarem — mas o passo 7 (`distribution_group_members`) coloca
88 corretores na fila: **execute-o por último e só depois de conferir que `leads` ainda está vazia**,
senão a roleta começa a distribuir antes do resto da carga.

---

## 2. Resolução de FK — o algoritmo (o ponto mais importante deste documento)

### 2.1 A chave é `Users.colaboradores`, não `Nome_completo`

Todas as colunas de relacionamento dos quatro arquivos vêm como **texto de exibição**, e o texto exibido
de um `User` no Bubble é a coluna `colaboradores` (apelido curto), **não** `Nome_completo` (nome civil).

Medições (script sobre os CSVs, 09/09/2026):

| coluna de origem | preenchidas | resolvem por `colaboradores` | valores distintos | distintos que resolvem |
|---|---:|---:|---:|---:|
| `Users.diretor` | 217 | **217 (100%)** | 5 | 5/5 |
| `Users.gerencia` | 285 | **285 (100%)** | 16 | 16/16 |
| `Users.equipe` → `Equipes.nome` | 267 | **267 (100%)** | 12 | 12/12 |
| `Equipes.Diretor` | 12 | **12 (100%)** | 4 | 4/4 |
| `Equipes.gerente` | 12 | **12 (100%)** | 12 | 12/12 |
| `gerentes.gerente` | 19 | **19 (100%)** | 16 | 16/16 |
| `gerentes.diretor` | 18 | **18 (100%)** | 6 | 6/6 |
| `corretors.user` | 294 | **294 (100%)** | 289 | 289/289 |
| `corretors.Nome` | 365 | **301 (82,5%)** | 352 | 290/352 |

Por `Nome_completo` a taxa cai para ~25%. **Casar por `Nome_completo` produz 12 equipes órfãs** — é a
armadilha nº 3 de `alvo/identidade.md`, e ela desaparece usando `colaboradores`.

### 2.2 Normalização (função `norm`, idêntica em todo o import)

```python
def norm(s):
    s = unicodedata.normalize('NFKD', s or '').replace('\xa0', ' ')   # NBSP existe em endereco
    s = ''.join(c for c in s if not unicodedata.combining(c))          # remove acento
    return re.sub(r'\s+', ' ', s).strip().lower()                      # colapsa espaço, trim, minúscula
```

Isto reproduz o `slugify()` do banco (`0001:171-181`) sem a troca de separador. **Medido:** os 298 valores
de `colaboradores` continuam **298 distintos depois de normalizados — zero colisão**. É seguro usar
`norm(colaboradores)` como chave única de pessoa em todo o import (inclusive nos outros domínios,
que referenciam pessoas pelo mesmo apelido).

### 2.3 Regras de exceção

| situação | ação |
|---|---|
| valor não encontrado em coluna com cobertura medida de 100% (`diretor`, `gerencia`, `equipe`, `Equipes.*`, `gerentes.*`, `corretors.user`) | **ABORTAR a carga.** Cobertura é 100% hoje; qualquer falha significa CSV diferente do perfilado. Não inventar `null`. |
| valor não encontrado em `corretors.Nome` | **descartar a linha** e registrar no log de carga. São 56 fichas órfãs do lote `(App admin)` de 13/05/2024 (sem `user`, sem equipe; 5 delas são imobiliárias: `Prime Imob`, `Melo Imob`, `Imob Prime`, `IMOB Prime`, `Parceiro Externo`) mais 8 grafias divergentes. Nenhuma vira pessoa. |
| valor ambíguo (casa 2+ pessoas) | **ABORTAR** e resolver à mão. Medido: **0 casos** com `colaboradores` normalizado. Não escolher automaticamente. |
| duplicata dentro de `corretors` (12 nomes, 13 linhas excedentes) | manter a linha com `ativo='sim'`; empate → maior `Modified Date`. Só afeta o passo 7. |

### 2.4 Cascata para `corretors` (usada só na flag de roleta)

1. `norm(user)` em `colaboradores` → 294 linhas;
2. senão `norm(Nome)` em `colaboradores` → +7 linhas;
3. senão descartar (56 órfãs + resto).

---

## 3. Chave natural de idempotência (reimportar sem duplicar)

| tabela destino | chave natural | por quê |
|---|---|---|
| `auth.users` | `email` | 298/298 preenchidos, **0 duplicados**, 0 inválidos, já minúsculo. `where not exists (… au.email = u.email)` como em `seeds/010:60`. |
| `profiles` | `email` (citext unique, `0002:31`) | herdada do Auth. **Não use `cpf`**: 6 grupos duplicados. |
| `user_roles` | PK `(profile_id, role)` | `on conflict do nothing`. |
| `teams` | `slug` (unique, `0002:118`) = `slugify(trim(nome))` | 12 slugs distintos e estáveis: `archimedes, zona-sul, mauricio, jose-portilho, faceimob, susana, victor, veronica, alisson, alexandre, daiane-dias, leonardo`. |
| `team_members` | `(profile_id) where left_at is null` (unique parcial, `0002:183`) | reimport: fechar o vínculo aberto antes de abrir outro (é o que `people.ts:210-243` faz). |
| `distribution_group_members` | PK `(group_id, profile_id)` | `on conflict do nothing`. |
| Storage `avatars` | caminho `<profile_id>/avatar.<ext>` | `upsert` no mesmo caminho. |

### 3.1 Tabela de-para: `import.bubble_map`

`profiles` e `teams` **não têm coluna livre** para o `unique id` do Bubble (não existe `external_id`
neste domínio — só `leads.external_id`, de outro domínio). Como todos os outros domínios (leads,
negócios, documentos, gamificação) referenciam pessoas pelo **mesmo apelido `colaboradores`**, a
de-para paga o próprio custo: ela é o índice `apelido → uuid` compartilhado.

```sql
create schema if not exists import;              -- fora de `public`: PostgREST não expõe, dispensa RLS

create table if not exists import.bubble_map (
  entity       text        not null,             -- 'user' | 'equipe'
  bubble_id    text        not null,             -- coluna "unique id" do CSV
  display_norm text,                             -- norm(colaboradores) ou norm(nome) — chave dos vínculos
  target_table text        not null,             -- 'profiles' | 'teams'
  target_id    uuid        not null,
  imported_at  timestamptz not null default now(),
  primary key (entity, bubble_id)
);
create index if not exists bubble_map_display_idx on import.bubble_map (entity, display_norm);
```

Popular só `entity='user'` (298) e `entity='equipe'` (12) = **310 linhas**. `corretors` e `gerentes`
**não entram**: nenhum outro arquivo referencia o `unique id` deles (verificado no perfil de hierarquia).

*ponytail: schema `import` sem RLS porque não é exposto pelo PostgREST; ligar RLS restrita a `is_admin()`
se algum dia for exposto.*

---

## 4. Mapeamento coluna a coluna

Convenções de transformação usadas nas tabelas abaixo:

- **`DATA_US`** → `to_timestamp(valor, 'Mon DD, YYYY HH12:MI am')` interpretado em **`America/Sao_Paulo`**
  (fuso não declarado no arquivo — suposição registrada). Em Python:
  `datetime.strptime(v, '%b %d, %Y %I:%M %p')` + `ZoneInfo("America/Sao_Paulo")`.
- **`DATA_US → date`**: quando a hora é sempre `00:00` (`entrada` 294/295, `nascimento` 196/196),
  converter para `date` **sem** passar por timestamptz — senão o UTC−3 desloca um dia.
- **`CPF`**: `re.sub(r'\D','',v).zfill(11)`; vazio → `NULL`.
- **`FONE`**: `d = re.sub(r'\D','',v)`; `len(d) in (10,11)` → `'+55'+d`; senão manter o valor original
  (a coluna é texto livre; `profiles` **não** tem o gatilho `leads_normalize`, que só existe em `leads`).
- **`SIM_NAO`**: `v.strip().lower() == 'sim'`.
- **`NOME_FK`**: resolver por `norm()` contra `colaboradores` (§2).
- **Dinheiro**: não há coluna monetária neste domínio (`vendas_mes`, `VGV_mes`, `vgv_batd` são inteiros
  zerados ou contadores parciais, todos descartados). A regra de dinheiro BR→`numeric` vale para
  `mapa/negocios.md`, não aqui.

### 4.1 `export_All-Users-modified--_…csv` → `auth.users` / `profiles` / `user_roles` (34 colunas)

| # | Origem `Users.` | Destino | Regra exata | Risco |
|---|---|---|---|---|
| 1 | `Ativo` | `profiles.status` + `profiles.terminated_at` + `auth.users.banned_until` | `sim` → `active`, `terminated_at=NULL`, `banned_until=NULL`. `não` → `terminated`, `terminated_at = Modified Date::date`, `banned_until='2126-01-01+00'`. **Os três campos no MESMO statement** (check `(status='terminated')=(terminated_at is not null)`, `0002:44-45`). | UPDATE guardado: exige impersonação (§9). `terminated_at` é **proxy**, não dado real. |
| 2 | `colaboradores` | `import.bubble_map.display_norm` | `norm()`. **Não vai para `profiles`** — não há campo de apelido no alvo. | Perder essa coluna quebra a resolução de todos os outros domínios. |
| 3 | `corretor` | **DESCARTAR** | Campo morto: 11/298 preenchidas, quase sempre auto-referência. | — |
| 4 | `cpf` | `profiles.cpf` | `CPF`. Se o CPF já foi usado por outra linha, gravar `NULL` no perdedor (vence quem tem `Ativo=sim`; empate → maior `Modified Date`) e logar. | 294 preench., **288 distintos**, **6 grupos duplicados (12 linhas)**, 1 com 10 dígitos, 8 com DV inválido. Unique parcial (`0046:70`) e check `^[0-9]{11}$` (`0046:50-53`). |
| 5 | `creci` | `profiles.creci` | Só quando **numérico**: `re.sub(r'\D','',v)` (trata `32.957` → `32957`). Valores textuais (`Estágio` 16, `Não possui` 9, `Não Possui` 2, `Estagio` 2) **não vão para `creci`** — viram `habilitation` (§5.3). `078022F` (1) entra como está. | 114 preench., 83 numéricos. Sem unique no destino. |
| 6 | `diretor` | *(insumo de `user_roles`)* | `NOME_FK` → papel `director` na pessoa apontada. Não há coluna de diretor em `profiles`: a hierarquia vive em `teams`. | 217/217 resolvem, 5 distintos. |
| 7 | `divisao` | **DESCARTAR** | Constante `1` em 285 linhas. `profiles.division` existe, mas importar grava `"1"` em todo mundo — zero informação. | — |
| 8 | `endereco` | `profiles.address` | `v.replace('\xa0',' ')` + `strip`; vazio → `NULL`. | 233 preench.; texto livre, sem CEP separado. |
| 9 | `entrada` | `profiles.hired_at` | `DATA_US → date`. Vazio (3) → `NULL`. | UPDATE **guardado** (`hired_at` está na lista do `profiles_guard_admin_columns`, `0061:109-116`). Faixa 01/01/2013 → 05/09/2026, nenhuma futura. |
| 10 | `enviou` | **DESCARTAR** | Flag de ação em lote de 2024, sem destino e sem valor histórico. | — |
| 11 | `equipe` | `team_members.team_id` | `NOME_FK` contra `norm(Equipes.nome)`. **Esta é a fonte de `team_members`**, não `Equipes.corretores`: é 1 valor por pessoa (impossível duplicar), cobre 267 contra 264 e dispensa o split ambíguo `" , "`. | 267/267 resolvem. 31 pessoas sem equipe → sem `team_members`. |
| 12 | `Funcao` | `user_roles.role` | De-para §5.1. | `SERVICOS GERAIS` e vazio sem correspondente. |
| 13 | `GameAtual` | **DESCARTAR neste domínio** | `unique id` de `gameficacaos`; pertence a `mapa/gamificacao.md`. | — |
| 14 | `gerencia` | *(insumo de `user_roles`)* | `NOME_FK` → papel `manager` na pessoa apontada. | 285/285, 16 distintos. Guarda **histórico** (inclui gerentes sem equipe hoje). |
| 15 | `gerente` | **DESCARTAR** | Campo morto: 11/298, duplica `gerencia`. | — |
| 16 | `habilitacao` | `profiles.habilitation` | De-para §5.3. **Nenhum valor legado é aceito pelo check** `in ('CRECI','CRECI-ESTAGIARIO','OUTRO')` (`0046:55-58`). | 115 vazias. |
| 17 | `imgPerfil` | `profiles.avatar_url` (+ objeto no bucket `avatars`) | Prefixar `https:` (URL é protocol-relative), `urldecode` do nome (`%20`), baixar, subir em **`<profile_id>/avatar.<ext>`** (a policy `avatars_write` exige a pasta = `auth.uid()`, `0012:397-406`), gravar a URL. Bucket privado, limite 5 MB, MIME `jpeg/png/webp` (`0054:78-80`). | 87 fotos, 86 `.png` + 1 `.jpg`, 0,7–0,9 MB cada (≈60–80 MB). CDN público, `HTTP 200` verificado. |
| 18 | `indicacao` | `profiles.indication` | Texto como está, `strip`. **Não resolver como FK** (só 10 de 74 casam; há `Anuncio Instagram`). | — |
| 19 | `mostrar` | **DESCARTAR** | Flag de listagem sem destino no alvo. | — |
| 20 | `nascimento` | `profiles.birth_date` | `DATA_US → date`, **e só se `1930 ≤ ano ≤ ano_corrente−16`**; fora disso → `NULL` + log. | **23 valores absurdos** (ano > 2008, inclusive `Mar 1, 2075`): o campo foi preenchido com a data do cadastro. |
| 21 | `new_Pontuacao` | **DESCARTAR** | 0/298 preenchida. | — |
| 22 | `niver_dia` | **DESCARTAR** | Derivada de `nascimento` (196/196 consistentes). | — |
| 23 | `niver_mes` | **DESCARTAR** | Idem. | — |
| 24 | `Nome_completo` | `auth.users.raw_user_meta_data->>'full_name'` → `profiles.full_name` | `coalesce(nullif(trim(Nome_completo),''), colaboradores)`. **Não** inserir em `profiles` direto: o gatilho `handle_new_auth_user` copia do metadata (`0002:360-366`). | `full_name` é NOT NULL com `length(btrim())>0` (`0002:30`): **1 linha vazia** cai no fallback. 1 nome repetido → `profiles_ensure_slug` resolve com sufixo `-2` (`0002:80-89`). |
| 25 | `senha_temporaria` | **DESCARTAR — PROIBIDO TRANSPORTAR** | Senha em texto claro. `encrypted_password = crypt(gen_random_uuid()::text, gen_salt('bf'))`. | Aparecer em log ou script é incidente de segurança. |
| 26 | `Status_colab` | **DESCARTAR** | Campo abandonado: 156 pessoas com `Ativo=não` continuam `Status_colab=Ativo`. Virou default de formulário. A fonte de status é `Ativo` (concorda com `corretors.ativo` em 289/289). | — |
| 27 | `telefone` | `auth.users.raw_user_meta_data->>'phone'` → `profiles.phone` | `FONE`. | 260 com 11 dígitos, 30 com 10, **4 com 9** (inválidos, mantidos como texto), 4 vazios. |
| 28 | `venda` | **DESCARTAR** | 0/298. | — |
| 29 | `vendas_corretor` | **DESCARTAR** | 0/298. | — |
| 30 | `Creation Date` | `profiles.created_at` *(opcional)* | `DATA_US` → timestamptz. `created_at` tem default `now()`; sobrescrever só se quiser preservar a data de cadastro do Bubble. **Não** é data de admissão (essa é `entrada`). | Faixa 11/05/2024 → 05/09/2026 (data da migração para o Bubble, não do negócio). |
| 31 | `Modified Date` | `profiles.terminated_at` (proxy, ver #1) | `DATA_US → date`. **Verificado: `Modified Date ≥ entrada` em 298/298**, então nunca gera saída anterior à admissão. | É proxy. O legado **não tem** data de desligamento. |
| 32 | `email` | `auth.users.email` → `profiles.email` | `strip().lower()`. Chave natural. | 298 únicos, 0 inválidos. 296 `@faceimob.com.br`, 2 `@gmail.com` (ambos inativos). |
| 33 | `null` | **DESCARTAR** | Coluna-lixo do export (nome literal `null`), 0/298. | — |
| 34 | `unique id` | `import.bubble_map.bubble_id` (`entity='user'`) | Como está. | 298 distintos, sem colisão. |

### 4.2 `export_All-Equipes-modified_…csv` → `teams` (14 colunas)

| # | Origem `Equipes.` | Destino | Regra exata | Risco |
|---|---|---|---|---|
| 1 | `nome` | `teams.name` + `teams.slug` | `name = trim(nome)` (**`"Susana "` tem espaço à direita**); deixar o gatilho `teams_ensure_slug` gerar o slug (`0002:163-165`). | 12 nomes e 12 slugs distintos. O gatilho **não roda em UPDATE**: renomear depois mantém o slug antigo. |
| 2 | `Diretor` | `teams.director_id` | `NOME_FK` → `profiles.id`. | 12/12 resolvem (4 distintos). Um deles é `Gerente Interino`, **placeholder, não pessoa** (equipe `Faceimob`) — decisão §7.2. |
| 3 | `gerente` | `teams.manager_id` | `NOME_FK` → `profiles.id`. | 12/12 resolvem, 1 por equipe. |
| 4 | `gerente_gerente` | **DESCARTAR** | Cópia byte a byte de `gerente` em **12/12**. Se funcionasse deveria conter `Diretor`, e diverge em 8 de 12. | — |
| 5 | `corretores` | **DESCARTAR como fonte** (usar só como conferência) | Lista com separador `" , "`. A fonte de `team_members` é `Users.equipe` (§4.1 #11). Conferência: 264 nomes, 264/264 resolvem, 0 nome em duas equipes; `Users.equipe` cobre 3 pessoas a mais. | Separador ambíguo. Verificado: **0 itens contêm vírgula** neste export — a regra vale para este arquivo, não para um export futuro. |
| 6 | `meta` | **DESCARTAR** | Vazia nas 12 linhas. Metas vivem em `meta-equipes` (outro domínio). | — |
| 7 | `meta_equipe` | **DESCARTAR** | Vazia nas 12. | — |
| 8 | `qtd_batd` | **DESCARTAR** | Contador parcial (2 equipes com valor). O alvo deriva de `deals`. | — |
| 9 | `vgv_batd` | **DESCARTAR** | Idem (`226500`, `189000`). | — |
| 10 | `Creation Date` | `teams.created_at` + insumo de `team_members.joined_at` | `DATA_US`. Ver §4.5. | — |
| 11 | `Modified Date` | **DESCARTAR** | `updated_at` tem gatilho próprio. | — |
| 12 | `Slug` | **DESCARTAR** | Vazia nas 12. | — |
| 13 | `Creator` | **DESCARTAR** | `Douglas Gomes` nas 12. `teams` não tem `created_by`. | — |
| 14 | `unique id` | `import.bubble_map.bubble_id` (`entity='equipe'`) | Como está. | — |
| — | *(sem origem)* | `teams.active` | **`true` nas 12** — decisão §7.3. | `active=false` **cega o gestor**: a equipe some de `auth_led_team_ids()` (`0002:266-269`). |

### 4.3 `export_All-gerentes-modified_…csv` → **nenhuma tabela destino** (10 colunas)

A tabela modela a **célula de gerência**, não a pessoa, e o alvo não tem esse conceito: a gerência é
`teams.manager_id`. As 22 linhas são 8 gerentes vigentes (já vindos de `Equipes.gerente`), 5 diretores
que também gerem equipe, 6 gerências históricas sem equipe, 3 registros órfãos (`Zona Sul`,
`Paulo Rodrigues`, `Parceiro`) e 2 duplicatas de nome (`Gerente Interino`, `Luis Hahn`).

| Origem `gerentes.` | Destino | Regra |
|---|---|---|
| `nome` | **DESCARTAR** | Rótulo do registro; 20 distintos com 2 duplicatas. Nada a criar. |
| `gerente` | *(conferência)* | `NOME_FK`; confirma os 16 alvos de `Users.gerencia`. Nenhuma linha nova. |
| `diretor` | *(conferência)* | `NOME_FK`; confirma a árvore diretor→gerente. |
| `ativo` | **DESCARTAR** | A atividade da pessoa sai de `Users.Ativo`. |
| `obtd` | **DESCARTAR** | 0/22. |
| `Creation Date` / `Modified Date` | **DESCARTAR** | Sem destino. |
| `Slug` | **DESCARTAR** | 0/22. |
| `Creator` | **DESCARTAR** | Sem destino. |
| `unique id` | **DESCARTAR** | Nenhum outro arquivo referencia o `unique id` de `gerentes`. |

**Consequência de descartar o arquivo inteiro:** perde-se o histórico das gerências extintas
(`Leone Bampi`, `Junior Rezende`, `Felipe di Pompo`, `Luis Hahn`). Esse histórico sobrevive
parcialmente em `Users.gerencia`, que é o que gera o papel `manager`.

### 4.4 `export_All-corretors-modified_…csv` → `distribution_group_members` (11 colunas)

| Origem `corretors.` | Destino | Regra | Risco |
|---|---|---|---|
| `ativo` | `distribution_group_members.active` | `SIM_NAO`. Inserir **só** quem tem `ativo='sim'` **e** `Users.Ativo='sim'`, no grupo `fila-geral` (`seed.sql:108-110`). | **88 pessoas** atendem os dois critérios (90 linhas `ativo=sim` em `corretors`; 94 `Ativo=sim` em `Users`). |
| `user` | *(resolução)* | `NOME_FK`, 294/294. | — |
| `Nome` | *(resolução, fallback)* | `NOME_FK`, 301/365. 56 órfãs descartadas. | — |
| `agil_qtd` | **DESCARTAR** | Contador da roleta "ágil" do legado (32 linhas > 0). Sem destino: o alvo conta em `checkins.leads_received`, por check-in, não acumulado. | Perde-se o acumulado histórico da roleta. |
| `vendas_mes` | **DESCARTAR** | `0` em 365/365. | — |
| `VGV_mes` | **DESCARTAR** | `0` em 365/365. | — |
| `Creation Date` / `Modified Date` | **DESCARTAR** | Usados só como desempate de duplicata. | — |
| `Slug` | **DESCARTAR** | 0/365. | — |
| `Creator` | **DESCARTAR** | 2 valores (`Douglas Gomes`, `(App admin)`); serve só para identificar o lote órfão. | — |
| `unique id` | **DESCARTAR** | Não referenciado por nenhum outro arquivo. | — |

### 4.5 `team_members` — colunas derivadas

| Destino | Regra exata | Verificação |
|---|---|---|
| `team_id` | `norm(Users.equipe)` → `teams` | 267/267 |
| `profile_id` | e-mail do User → `profiles.id` | 267 |
| `joined_at` | **`greatest(Users.entrada::date, Equipes."Creation Date"::date)`** — ninguém entra na equipe antes de a equipe existir. Sem `entrada` (2 casos) → data de criação da equipe. | — |
| `left_at` | `Users.Ativo='sim'` → `NULL`; `'não'` → `Users."Modified Date"::date` | **Medido: 0 violações** do check `left_at >= joined_at` (`0002:179`) com esta regra. |

Resultado: **88 vínculos abertos + 179 fechados = 267**. Como `Users.equipe` é single-valued,
o unique parcial `team_members_one_active` (`0002:183-184`) é respeitado por construção.

---

## 5. De-para de valores

> Os de-para de **`STATUS` do pipeline → `pipeline_stages.code`/`deals.outcome`** e de
> **status de lead → `lead_status`/`lead_funnel_stage`** **não pertencem a este domínio** — estão em
> `mapa/negocios.md` e `mapa/leads.md`. Aqui o único enum do alvo é `app_role`, mais `profile_status`
> e o check de texto de `habilitation`.

### 5.1 `Users.Funcao` → `app_role` (7 valores + vazio, 298 linhas)

| `Funcao` | linhas | `app_role` | observação |
|---|---:|---|---|
| `CORRETOR` | 275 | `broker` | — |
| `GERENTE` | 8 | `manager` (+ `broker`, §5.2) | — |
| `DIRETOR` | 5 | `director` (+ `broker`, §5.2) | — |
| `CCA` | 5 | `cca` | **sem `broker`** — não atende lead |
| `SÓCIO` | 2 | `partner` | **sem `admin` junto.** A 0093 promovia; a **0094 desfez** (`0094:46-64`) e 15 asserções cobram a fronteira. Sócio com poder de admin precisa dos dois papéis marcados à mão. |
| `ADM` | 1 | `admin` | `Douglas Gomes`. |
| `SERVICOS GERAIS` | 1 | **sem papel** | Não existe correspondente. Decisão §7.5. |
| *(vazio)* | 1 | **sem papel** | Registro de teste `JR`/`sjr`, inativo. |

**Valor desconhecido (um `Funcao` fora desta lista):** abortar a linha e listar no relatório de carga.
Não mapear para `broker` por default — `broker` é o papel que coloca a pessoa na listagem de corretores
e no pódio. Atenção à comparação literal: `SÓCIO` tem acento e `SERVICOS GERAIS` não tem cedilha.

`sdr` e `marketing` **não têm origem** — nenhuma linha do legado os representa.

### 5.2 Papéis acumulados (o alvo é N:N; a origem é single-valued)

`Funcao` sozinha é insuficiente: 4 `DIRETOR` e 4 `CORRETOR` aparecem como alvo de `Users.gerencia`
(atuam como gerente sem ter `Funcao=GERENTE`). Regras de acúmulo:

```
manager  ⟵ pessoa em (distinct Users.gerencia) ∪ (distinct Equipes.gerente)   → 16 pessoas
director ⟵ pessoa em (distinct Users.diretor)  ∪ (distinct Equipes.Diretor)   →  6 pessoas
broker   ⟵ mantido do gatilho para Funcao ∈ {CORRETOR, GERENTE, DIRETOR} COM ficha em `corretors`;
           DELETADO para os demais                                            → 287 mantidos, 11 apagados
```

Por que `broker` fica nos gestores: **10 dos 12 gerentes e os 3 diretores aparecem dentro da própria
lista `Equipes.corretores`** — eles atendem de verdade. E desde a 0048 o papel de participante do
negócio usa precedência "supervisor primeiro" (`0048:16-28`), então manter `broker` **não** joga o
diretor no rateio de VGV automaticamente (o rateio olha `deal_participants.role`, não `user_roles`).
O efeito residual é aparecer na listagem de corretores da 0027 (`0027:58-63`), o que é factualmente
correto para quem atende.

Os **11 `broker` apagados**: 5 `CCA`, 2 `SÓCIO`, 1 `ADM`, 1 `SERVICOS GERAIS`, 1 sem `Funcao` (`JR`)
e 1 `Gerente Interino` (placeholder sem ficha em `corretors`).

Distribuição final medida (296 pessoas com ≥1 papel; `JR` e `Selmira Tia` ficam sem papel nenhum):

| conjunto de papéis | pessoas |
|---|---:|
| `{broker}` | 271 |
| `{broker, manager}` | 11 |
| `{cca}` | 5 |
| `{broker, director, manager}` | 4 |
| `{partner}` | 2 |
| `{admin}` | 1 |
| `{director, manager}` | 1 (`Gerente Interino`) |
| `{broker, director}` | 1 (`Luis Hahn`) |
| **linhas em `user_roles`** | **317** |

### 5.3 `Users.habilitacao` → `profiles.habilitation`

Check vigente: `habilitation in ('CRECI','CRECI-ESTAGIARIO','OUTRO')` (`0046:55-58`).
**Nenhum valor legado é aceito como está.**

| valor no Bubble | linhas | destino |
|---|---:|---|
| `CRECI` | 60 | `CRECI` |
| `Não Possui (Estágio)` | 77 | `CRECI-ESTAGIARIO` |
| `Estágio` | 46 | `CRECI-ESTAGIARIO` |
| *(vazio)* | 115 | `NULL` |
| **desconhecido** | — | `OUTRO` + log |

Complemento vindo de `creci` textual (§4.1 #5), aplicado **só quando `habilitacao` está vazia**:
`Estágio`/`Estagio` (18) → `CRECI-ESTAGIARIO`; `Não possui`/`Não Possui` (11) → `OUTRO`.

> Inconsistência conhecida do legado: 5 pessoas marcadas `Não Possui (Estágio)` **têm** CRECI numérico,
> 1 marcada `CRECI` não tem, e 48 com CRECI têm `habilitacao` vazia. Não há como resolver pelo dado;
> a regra acima privilegia `habilitacao` e não a sobrescreve.

### 5.4 `Users.Ativo` → `profile_status`

| `Ativo` | linhas | `profiles.status` | `terminated_at` | `auth.users.banned_until` |
|---|---:|---|---|---|
| `sim` | 94 | `active` | `NULL` | `NULL` |
| `não` | 204 | `terminated` | `Modified Date::date` (proxy) | `'2126-01-01 00:00:00+00'` |

`suspended` **fica sem origem** — o legado só tem booleano.
`banned_until` é o interruptor real de acesso, não `status` (armadilha 12 de `alvo/identidade.md`).

### 5.5 `corretors.ativo` → `distribution_group_members.active`

`sim` → `active=true` no grupo `fila-geral`; `não`/vazio → **não inserir a linha** (ausência é mais
limpa que `active=false`, e `distribution_queue()` filtra por `active` de qualquer forma,
`0074:270-330`).

---

## 6. Lacunas

### 6.1 Dado da origem sem destino no schema novo

| origem | volume | consequência de descartar |
|---|---:|---|
| `Users.senha_temporaria` | 298 | Nenhuma — é proibido migrar. Todo mundo entra por "esqueci minha senha". |
| `Users.colaboradores` (apelido) | 298 | **Alta.** É a chave de todos os vínculos dos outros domínios. Mitigado por `import.bubble_map.display_norm`; sem isso, leads/negócios/gamificação não resolvem pessoa. |
| `Users.divisao` | 285 | Nenhuma (constante `1`). |
| `Users.mostrar` / `enviou` | 146 / 283 | Nenhuma — flags operacionais do Bubble. |
| `Users.niver_dia` / `niver_mes` | 196 | Nenhuma (deriváveis de `birth_date`). |
| `Users.Status_colab` | 229 | Nenhuma — campo desalinhado com a realidade. |
| `Users.corretor` / `Users.gerente` | 11 / 11 | Nenhuma — campos mortos. |
| `corretors.agil_qtd` | 32 linhas > 0 | Perde-se o acumulado da roleta "ágil". O alvo recomeça do zero. |
| `corretors.vendas_mes` / `VGV_mes` | 365 (todos `0`) | Nenhuma. |
| `Equipes.qtd_batd` / `vgv_batd` | 2 linhas com valor | Baixa — o alvo deriva de `deals`. |
| `Equipes.gerente_gerente` | 12 | Nenhuma (cópia de `gerente`). |
| **arquivo `gerentes` inteiro** | 22 | Perde-se o histórico de 6 gerências extintas; parcialmente preservado em `Users.gerencia` → papel `manager`. |
| 56 fichas órfãs de `corretors` | 56 | Baixa — sem User, sem equipe, 5 são imobiliárias. Se algum negócio histórico apontar para elas por nome, vira lacuna no domínio de negócios. **Conferir no fechamento.** |

### 6.2 Coluna obrigatória do destino sem origem (com o default proposto)

| destino | NOT NULL? | origem | default proposto |
|---|---|---|---|
| `profiles.full_name` | sim (+ `length>0`) | `Nome_completo` (1 vazio) | `coalesce(nullif(trim(Nome_completo),''), colaboradores)` |
| `profiles.email` | sim, unique | `email` | — (100% presente) |
| `profiles.slug` | sim, unique | — | gerado por `profiles_ensure_slug` a partir de `full_name` |
| `profiles.status` | sim | `Ativo` | — |
| `profiles.bypass_ip_check` | sim | — | `false` (default). **Nem `service_role` altera** essa coluna via UPDATE (`0061:79-90`): só admin impersonado. |
| `profiles.terminated_at` | não, mas **obrigatória junto com `status='terminated'`** | — | `Modified Date::date` (proxy declarado) |
| `teams.name` | sim | `Equipes.nome` | `trim()` |
| `teams.slug` | sim, unique | — | gatilho `teams_ensure_slug` |
| `teams.active` | sim | — | `true` (§7.3) |
| `team_members.joined_at` | sim (default `current_date`) | `entrada` + criação da equipe | `greatest(entrada, team.created_at)::date` — **não deixar cair no default**, ou o histórico inteiro vira "hoje" |
| `distribution_group_members.active` | sim | `corretors.ativo` | `true` (só inserimos os `sim`) |
| `auth.users.encrypted_password` | sim | — | `crypt(gen_random_uuid()::text, gen_salt('bf'))` |
| `auth.users` tokens (`confirmation_token`, `recovery_token`, `email_change_token_new`, `email_change`) | sim em várias versões do GoTrue | — | **`''`, nunca `NULL`** (`seeds/010:104-111`) |
| `auth.identities` | — | — | uma linha por usuário, senão o login por e-mail não resolve (`seeds/010:81-96`) |
| `profiles.badge_requested_at` / `badge_delivered_at` | não | — | `NULL` (sem origem) |
| `profiles.division` | não | `divisao` descartada | `NULL` |

---

## 7. Decisões que só o dono do negócio pode tomar

**7.1 — Importar as 204 pessoas desligadas?**
Importar custa 204 contas em `auth.users` bloqueadas por `banned_until`, 204 profiles `terminated` e
179 vínculos de equipe fechados. Ganho: nenhum negócio, lead, documento ou pontuação histórica fica com
autor órfão — o legado referencia **290 pessoas distintas** em `corretors` e 162 em `gameficacaos`.
Não importar deixa qualquer domínio histórico sem responsável. **Recomendação: importar as 298.**
Só faz sentido cortar se o histórico de negócios também não for importado.

**7.2 — `Gerente Interino` e a equipe `Faceimob`.**
`Gerente Interino` é `Funcao=GERENTE`, `Ativo=sim`, tem e-mail, e é `Diretor` **e** `gerente` da equipe
`Faceimob`, cujo único outro membro é `Parceiro Externo` (`Funcao=CORRETOR`, ativo). É um placeholder,
não uma pessoa. Opções: (a) importar como está — a equipe fica com um "diretor" fictício carregando o
papel `director`, que dá leitura ampla (`can_read_all()`, `0002:248-256`), mitigável com `banned_until`;
(b) importar a equipe com `director_id` apontando para um diretor real; (c) não importar a equipe
`Faceimob` nem as 2 pessoas. **Não deixar `director_id` nulo**: equipe órfã com gerente preenchido é
adotável por qualquer diretor que enxergue esse gerente (`0068:36-48`) — vazamento de diretoria.

**7.3 — `teams.active` das equipes sem gente ativa.**
`Veronica` (1 membro, **0 ativos**) e `Alexandre` (10 membros, **0 ativos**) estão vazias hoje.
`active=false` some com elas de `auth_led_team_ids()` e **cega o próprio gestor** (`Alexandre Chaves`
está ativo). `active=true` mantém duas equipes vazias na tela. **Default adotado: `true` nas 12**,
desativando depois pela tela, que já sabe a ordem correta (fechar vínculos antes de desativar,
`people.ts:296-303`).

**7.4 — Os 6 CPFs duplicados (12 pessoas).**
Em 3 dos 6 pares parece ser a **mesma pessoa cadastrada duas vezes**; nos outros 3 são digitações
erradas em pessoas diferentes. O import grava o CPF no vencedor e `NULL` no perdedor. Se forem a mesma
pessoa, o certo é **fundir os cadastros antes da carga** — mas fundir apaga um e-mail que pode ser
autor de negócios históricos. Decisão caso a caso, 12 linhas.

**7.5 — `SERVICOS GERAIS` (1 pessoa ativa) e o registro de teste `JR`.**
Ficam sem papel nenhum. Consequência: logam e não veem menu algum (`has_permission` não devolve nada).
Alternativas: dar `broker` (entram na listagem de corretores e no pódio), criar o profile com
`banned_until` (não logam) ou não importar. **Default: importar, sem papel, sem bloqueio.**

**7.6 — Os 2 gerentes que gerenciam uma equipe e são membros de outra.**
`Veronica Oliveira` gerencia `Veronica` mas está em `Zona Sul`; `Alexandre Chaves` gerencia `Alexandre`
mas está em `Archimedes`. O unique parcial `team_members_one_active` **permite só um vínculo aberto**,
então não dá para colocá-los nas duas. Mantido o que `Users.equipe` diz. O schema aceita gerente que
não é membro da própria equipe (`tests/79:66-71`), mas a tela já quebrou com isso antes (motivo da 0079).

**7.7 — Fotos de perfil: baixar ou apontar para o CDN do Bubble?**
Apontar (`https:` + URL) custa 0 byte e 0 requisição, mas as 87 fotos **morrem quando a assinatura do
Bubble for cancelada**. Baixar e subir custa ≈60–80 MB no bucket `avatars` (limite de 5 MB por arquivo,
folgado). **Default: baixar.** Cobertura: só 58 das 94 pessoas ativas têm foto.

**7.8 — Recorte temporal.**
**Não há o que podar:** o export inteiro nasceu em 11/05/2024 (data da migração para o Bubble).
`entrada` chega a 2013, mas é admissão retroativa, não histórico de registros. A pergunta
"importar de 2019 ou só de 2024 em diante" não se aplica a este domínio.

---

## 8. Volume estimado por tabela destino

| destino | linhas | origem |
|---|---:|---|
| `auth.users` | **298** | 1 por User |
| `auth.identities` | **298** | 1 por User |
| `profiles` | **298** (inseridas pelo gatilho) + **298 UPDATE** | — |
| `user_roles` | **317** finais = 298 (`broker` do gatilho) + 30 inserts − 11 deletes | `broker` 287 · `manager` 16 · `director` 6 · `cca` 5 · `partner` 2 · `admin` 1 |
| `teams` | **12** | `Equipes` |
| `team_members` | **267** (88 abertos + 179 fechados) | `Users.equipe` |
| `distribution_group_members` | **88** | `corretors.ativo='sim'` ∩ `Users.Ativo='sim'` |
| Storage `avatars` | **87** objetos (≈60–80 MB) | `Users.imgPerfil` |
| `import.bubble_map` | **310** (298 `user` + 12 `equipe`) | — |
| `checkins` / `allowed_ips` / `work_shifts` / `distribution_groups` | **0** | sem origem — vêm do `seed.sql` |
| `access_provision_log` / `role_change_log` / `permissions` / `role_permissions` | **0** | catálogo/auditoria, nunca import |

Distribuição de `team_members` por equipe (total / abertos):
`Victor` 53/16 · `Jose Portilho` 45/10 · `Leonardo` 31/12 · `Zona Sul` 30/8 · `Alisson` 24/6 ·
`Archimedes` 22/11 · `Mauricio` 20/5 · `Daiane Dias` 15/12 · `Susana` 14/6 · `Alexandre` 10/0 ·
`Faceimob` 2/2 · `Veronica` 1/0. **31 pessoas sem equipe** (6 delas ativas).

---

## 9. Esqueleto de execução (o que copiar)

```sql
-- PASSO 1 — auth.users, molde de seeds/010_identity_and_teams.sql:26-61
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, banned_until,
  confirmation_token, recovery_token, email_change_token_new, email_change)
select '00000000-0000-0000-0000-000000000000'::uuid, u.id,
       'authenticated', 'authenticated', u.email,
       extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
       now(),
       jsonb_build_object('provider','email','providers',array['email']),
       jsonb_build_object('full_name', u.full_name, 'phone', u.phone),  -- o gatilho copia daqui
       now(), now(),
       case when u.ativo then null else '2126-01-01 00:00:00+00'::timestamptz end,
       '', '', '', ''                                     -- tokens '' e NUNCA null
from staging.bubble_users u
where not exists (select 1 from auth.users au where au.email = u.email);
-- + auth.identities (seeds/010:81-96), senão o login por e-mail não resolve o usuário
```

```sql
-- PASSO 3 — remover o 'broker' de brinde de quem não atende (11 pessoas)
delete from public.user_roles ur
using public.profiles p, staging.bubble_users s
where ur.profile_id = p.id
  and p.email = s.email
  and ur.role = 'broker'
  and s.funcao in ('CCA','SÓCIO','ADM','SERVICOS GERAIS','');
-- user_roles_guard_last_admin (0061:212-215) só barra a saída do ÚLTIMO admin — deletes de 'broker' passam.
```

```sql
-- PASSO 4 — UPDATE em profiles COM impersonação (padrão de seeds/050_test_scenarios.sql:41-56)
do $$
declare v_admin uuid;
begin
  select ur.profile_id into v_admin from public.user_roles ur where ur.role = 'admin' limit 1;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);  -- true = escopo da transação

  update public.profiles p set
     status        = s.status,
     hired_at      = s.hired_at,
     terminated_at = s.terminated_at,
     cpf           = s.cpf,
     creci         = s.creci,
     habilitation  = s.habilitation,
     birth_date    = s.birth_date,
     address       = s.address,
     indication    = s.indication
  from staging.bubble_users s
  where p.email = s.email;
end $$;
```

Por que impersonar: `profiles_guard_admin_columns` (`0061:73-120`) levanta **42501** em qualquer UPDATE
que toque `status`, `hired_at`, `terminated_at`, `email` ou `bypass_ip_check` quando `auth.uid()` é nulo
— e é nulo em carga por `psql`/service_role. **Não desligar o gatilho** (`seeds/050:46-48` explica por
quê). As demais colunas (`cpf`, `creci`, `address`…) passariam sem impersonação; um único UPDATE
impersonado é mais simples que dois passes.

**Verificação executável mínima** (rodar depois da carga, antes de liberar o app):

```sql
select 'profiles'      t, count(*) from public.profiles                     -- 298
union all select 'roles',        count(*) from public.user_roles             -- 317
union all select 'teams',        count(*) from public.teams                  --  12
union all select 'tm_total',     count(*) from public.team_members           -- 267
union all select 'tm_abertos',   count(*) from public.team_members where left_at is null      --  88
union all select 'dgm',          count(*) from public.distribution_group_members              --  88
union all select 'teams_orfas',  count(*) from public.teams
          where director_id is null or manager_id is null                    --   0
union all select 'term_sem_data',count(*) from public.profiles
          where status = 'terminated' and terminated_at is null;             --   0
```

---

## 10. Suposições registradas

1. **Fuso `America/Sao_Paulo`** para todas as datas (o arquivo não declara). `entrada` e `nascimento`
   viram `date` **sem** passar por timestamptz — 294/295 e 196/196 têm hora `00:00`, e converter via
   UTC deslocaria um dia.
2. **`Users.colaboradores` é a chave de junção pessoa↔pessoa** de todo o export (298 valores, 298
   distintos também depois de normalizados). Verificado em 8 colunas de relacionamento, todas com 100%
   de cobertura.
3. **`Users.Ativo` é a fonte de `profiles.status`**, não `Status_colab` (corroborado pelo cruzamento
   com `corretors.ativo`: 289/289 concordam).
4. **`terminated_at = Modified Date`** é proxy declarado: o legado não tem data de desligamento.
   Verificado que `Modified Date ≥ entrada` em 298/298, então nenhuma data de saída antecede a admissão.
5. **`Users.equipe` é a fonte de `team_members`**, com `Equipes.corretores` só como conferência.
6. **Nada foi executado contra o banco** e nenhum arquivo do repositório foi alterado além deste.
   Todos os números vieram de scripts descartáveis no scratchpad da sessão, com `csv.DictReader`.

---

## 11. Arquivos consultados

- `C:/Users/Alisson/CascadeProjects/FACEIMOB/docs/importacao/SCHEMA_ALVO.md`
- `C:/Users/Alisson/CascadeProjects/FACEIMOB/docs/importacao/alvo/identidade.md`
- `C:/Users/Alisson/CascadeProjects/FACEIMOB/docs/importacao/perfil/usuarios.md`
- `C:/Users/Alisson/CascadeProjects/FACEIMOB/docs/importacao/perfil/hierarquia.md`
- `C:/Users/Alisson/CascadeProjects/FACEIMOB/supabase/migrations/20260725120000_0001_foundation.sql`
- `…/20260725120100_0002_identity.sql` · `…/20260725120500_0006_deals.sql`
- `…/20260725121100_0012_crud_fixes.sql` · `…/20260810150000_0027_product_visibility.sql`
- `…/20260901130800_0046_profile_extra_fields.sql` · `…/20260901140000_0048_creator_participant_role.sql`
- `…/20260903540000_0054_entrada.sql` · `…/20260903610000_0061_equipes_permissoes.sql`
- `…/20260904660000_0068_equipe_orfa_recorte.sql` · `…/20260906740000_0074_leads_roleta.sql`
- `…/20260906790000_0079_equipes_permissoes.sql` · `…/20260909940000_0094_socio_sem_promocao_automatica.sql`
- `C:/Users/Alisson/CascadeProjects/FACEIMOB/supabase/seed.sql`
- `…/supabase/seeds/010_identity_and_teams.sql` · `…/supabase/seeds/050_test_scenarios.sql`
- CSVs: `DOCUMENTOS/DADOS_BUBBLE/export_All-Users-modified--_2026-09-08_19-44-45.csv` ·
  `export_All-Equipes-modified_2026-09-08_19-38-04.csv` ·
  `export_All-gerentes-modified_2026-09-08_19-38-54.csv` ·
  `export_All-corretors-modified_2026-09-08_19-37-25.csv`
