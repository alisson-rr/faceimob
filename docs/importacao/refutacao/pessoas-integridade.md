# Refutação — `mapa/pessoas.md` pela lente **integridade**

Data: 09/09/2026 · Escopo: só leitura de arquivos (nenhum comando contra o banco, nenhum arquivo de
código alterado). Todos os números abaixo saem de scripts `csv.DictReader` no scratchpad da sessão e de
`grep`/`sed` nas migrations; os comandos estão citados linha a linha.

**Veredito: REFUTADO.** O mapa acerta a aritmética — reproduzi 298 / 267 / 88 / 317 / 12 exatamente —
mas erra na **mecânica de integridade**: a chave de idempotência de `team_members` não existe no banco,
e a receita de reimport que o próprio documento prescreve corrompe o histórico dos 88 ativos.

---

## 0. O que foi confirmado (para não jogar fora o que está certo)

Rodei o perfil independente e a maior parte do documento **se sustenta**:

| afirmação do mapa | medido | resultado |
|---|---|---|
| 298 users / 12 equipes / 22 gerentes / 365 corretors | idem | ✔ |
| 298 e-mails preenchidos, 0 duplicados | 298 distintos, 0 dup | ✔ |
| `norm(colaboradores)` → 298 distintos, zero colisão | 298 | ✔ |
| `Funcao`: 275/8/5/5/2/1/1/1 | idem | ✔ |
| `Ativo`: 94 sim / 204 não | idem | ✔ |
| 12 slugs distintos (`slugify` de `0001:171-181` reimplementado) | 12 | ✔ |
| `team_members` 267 = 88 abertos + 179 fechados | idem | ✔ |
| 0 violações de `left_at >= joined_at` (`0002:179`) | 0 | ✔ |
| distribuição por equipe (Victor 53/16 … Veronica 1/0) | idem | ✔ |
| `user_roles` = 317 com a regra §5.2 | 317, e os 8 conjuntos batem linha a linha | ✔ |
| `Modified Date >= entrada` em 298/298 | 0 violações | ✔ |
| `Equipes.corretores`: 264 itens, 0 com vírgula, 264/264 resolvem | idem | ✔ |
| 6 grupos de CPF duplicado / 12 linhas | idem | ✔ |
| `fila-geral` existe (`seed.sql:108-110`) | confirmado | ✔ |
| `profiles_guard_admin_columns` é **`before update`** (não `insert`) | `0012:64-66` | ✔ — o passo 1 não é bloqueado |
| `user_roles_guard_last_admin` só barra o último admin | `0061:178-215`, ramo `old.role = 'admin'` | ✔ — os DELETEs de `broker` passam |

Ou seja: o problema **não** é contagem nem casamento por nome. É o que acontece na **segunda execução**
e uma contradição interna entre duas seções.

---

## 1. BLOQUEANTE — `team_members` não tem chave de idempotência; o reimport duplica 179 linhas e falsifica a saída de 88 pessoas

### 1.1 A chave que o documento declara não cobre o que ele carrega

§3 lista, para `team_members`, a chave natural `(profile_id) where left_at is null` (unique parcial,
`0002:183`). Conferido no DDL:

```
$ sed -n '171,186p' supabase/migrations/20260725120100_0002_identity.sql
create table public.team_members (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  joined_at  date not null default current_date,
  left_at    date,
  created_at timestamptz not null default now(),
  constraint team_members_period check (left_at is null or left_at >= joined_at)
);
create unique index team_members_one_active
  on public.team_members (profile_id) where left_at is null;
```

A PK é `id uuid default gen_random_uuid()`. **Não existe nenhuma restrição sobre linhas com
`left_at is not null`.** E 179 das 267 linhas do passo 6 são exatamente essas.

Consequência: rodar o passo 6 duas vezes insere **+179 linhas fechadas idênticas**, sem erro, sem
conflito, sem log. Não há `on conflict` possível — não há constraint na qual conflitar.

### 1.2 A receita de reimport que o documento indica piora o quadro

§3 diz: *"reimport: fechar o vínculo aberto antes de abrir outro (é o que `people.ts:210-243` faz)"*.
Fui ler o que aquele trecho faz de fato:

```
$ sed -n '210,243p' src/integrations/supabase/people.ts
  const closed = await supabase
    .from("team_members").update({ left_at: today() }).eq("profile_id", profileId).is("left_at", null)…
  const opened = await supabase.from("team_members").insert({ team_id: teamId, profile_id: profileId });
```

`setTeamByManager` é uma operação **de ficha individual** para *trocar* alguém de equipe. Aplicada a um
reimport dos MESMOS dados, ela:

1. carimba `left_at = today()` (09/09/2026) nos **88 vínculos abertos** — inventa uma data de saída para
   todas as 88 pessoas ativas, que nunca saíram de equipe nenhuma;
2. insere 88 vínculos abertos novos;
3. não faz nada pelos 179 fechados, que a carga duplica.

Estado após a 2ª execução: **534 linhas** em `team_members` (267 → 534), sendo 88 abertas e 446
fechadas, das quais **88 são desligamentos fabricados datados de hoje**. O check `left_at >= joined_at`
passa (hoje é maior que qualquer `joined_at`), o unique parcial passa (continua 1 aberto por pessoa) —
**nenhuma trava do banco dispara**. É exatamente o tipo de estrago que §6.2 tenta evitar ao escrever
*"não deixar cair no default, ou o histórico inteiro vira 'hoje'"*: o documento previne o `joined_at`
virar hoje e cria o mesmo problema no `left_at`.

### 1.3 Por que isso importa mesmo com o unique parcial protegendo as leituras correntes

Grepei os consumidores e a maioria filtra `left_at is null`, então visibilidade e roleta ficam de pé:

```
$ grep -rn "join public.team_members\|from public.team_members" supabase/migrations/*.sql
… 0058:96, 0060:186, 0079:84, 0002:298/331 → todos com `tm.left_at is null`
```

O dano fica no que o schema foi construído para guardar: `0002:9-11` registra o requisito
*"mantendo o histórico de desempenho do mês mesmo após o desligamento"*. É esse histórico que duplica
e que ganha 88 saídas falsas. E o `import.bubble_map` de §3.1 **não protege** — §3.1 diz explicitamente
que ele só recebe `entity='user'` (298) e `entity='equipe'` (12); `team_members` não tem de-para.

### 1.4 Correção mínima

Antes do passo 6, criar a chave que falta e usá-la:

```sql
create unique index if not exists team_members_import_key
  on public.team_members (profile_id, team_id, joined_at);
-- passo 6 vira: insert … on conflict (profile_id, team_id, joined_at) do nothing;
```

`joined_at` é determinístico pela regra de §4.5 (`greatest(entrada, Equipes."Creation Date")`), então a
mesma pessoa na mesma equipe reimportada colide e é ignorada. **Não** usar a receita
`people.ts:210-243` em carga em lote. Alternativa equivalente: apagar os vínculos das pessoas do lote
antes do insert — mas só é seguro enquanto ninguém tiver mexido em equipe pela tela.

---

## 2. ALTA — §4.4 põe o **único administrador** na roleta de leads, contra o que §5.2 decidiu

§5.2 apaga o `broker` de `Douglas Gomes` (`Funcao=ADM`) — e o motivo declarado em §5.1 para o grupo
todo é *"sem `broker` — não atende lead"*. §4.4 insere em `distribution_group_members` **quem tem
`corretors.ativo='sim'` e `Users.Ativo='sim'`**, sem nenhum filtro de papel. Douglas atende os dois:

```
corretors Douglas Gomes | user: Douglas Gomes | ativo: sim
Users Douglas Gomes     | Funcao=ADM | Ativo=sim | equipe=(vazia)
```

Rodei o cruzamento completo dos 88: **1 pessoa entra na fila sem o papel `broker`** — Douglas Gomes.

E a fila **não olha papel**:

```
$ sed -n '270,330p' supabase/migrations/20260906740000_0074_leads_roleta.sql
  from public.checkins c
  join public.profiles p on p.id = c.profile_id
  join public.distribution_group_members m on m.profile_id = c.profile_id and m.active
  join public.distribution_groups g on g.id = m.group_id and g.active
  join public.work_shifts s on s.id = c.shift_id
  where c.work_date = public.current_work_date() … and p.status = 'active' …
```

Nenhum `user_roles`, nenhum `has_role('broker')`. Basta o admin fazer check-in para começar a receber
lead da fila geral. Duas seções do mesmo documento se contradizem e o banco não arbitra.

**Correção:** o filtro de §4.4 tem de ser `corretors.ativo='sim'` **∩** `Users.Ativo='sim'` **∩**
pessoa que mantém `broker` após o passo 3 → **87**, não 88. Isso muda §8 (`distribution_group_members`
= 87) e a verificação executável de §9 (`dgm` = 87).

---

## 3. MÉDIA — o SQL do §9 apaga 10 `broker`, não 11; o total fica 318 e a verificação do próprio §9 falha

§5.2 define os 11 a apagar como *"Funcao ∈ {CORRETOR, GERENTE, DIRETOR} **COM ficha em `corretors`**;
DELETADO para os demais"*. Reimplementei e obtive exatamente 11:

```
douglas gomes ADM | jr (vazio) | maria fernanda … CCA | cintia almeida CCA | inajara gaspar CCA
thayse oliveira CCA | olavio dal magro SÓCIO | ricardo gomes SÓCIO | selmira tia SERVICOS GERAIS
gerente interino GERENTE  ← sem ficha em corretors | joice milchareck CCA
```

Mas o esqueleto executável de §9 filtra por `Funcao`, não pela ficha:

```sql
and s.funcao in ('CCA','SÓCIO','ADM','SERVICOS GERAIS','');
```

Medido: esse `IN` casa **10 linhas**. Falta `Gerente Interino` (`Funcao=GERENTE`, sem ficha em
`corretors`). Ele mantém `broker`, `user_roles` fecha em **318**, e a verificação do próprio §9
(`union all select 'roles', count(*) … -- 317`) reprova a carga que o §9 mandou fazer.

**Correção:** trocar o predicado por "não tem ficha em `corretors` OU `Funcao` fora de
{CORRETOR,GERENTE,DIRETOR}", que é o que §5.2 diz em português.

---

## 4. MÉDIA — a cascata de §2.4 não é "resolução", é **fusão de fichas**, e o número de órfãs está errado

§2.4 diz: *"senão `norm(Nome)` em `colaboradores` → **+7 linhas**; senão descartar (**56 órfãs** + resto)"*.

Medido:

| etapa | mapa | medido |
|---|---:|---:|
| resolve por `user` | 294 | **294** ✔ |
| fallback por `Nome` | +7 | **+8** |
| descartadas | 56 (+8 grafias) | **63** |
| linhas sem `user` | — | 71 (= 8 + 63) |
| linhas com `user` que não resolvem | — | **0** ✔ |

Os 63 órfãos são **todos** do lote `(App admin)` e **nenhum** tem `ativo='sim'` — então não contaminam
a fila. Mas o ponto grave não é o ±1: das 8 linhas que o fallback "resolve", **7 caem em pessoas que
JÁ têm ficha via `user`**:

```
Fernando Santos · Kevyn Bueno · ROBERTO CAUDURO · TAMARA CORREA · Felipe Di Pompo ·
ALICE ALVES · Juliana Torres da Silva      (todas Creator='(App admin)', sem `user`)
```

Só `Ricardo Gomes` é pessoa nova. Ou seja, o fallback não está recuperando fichas perdidas: está
**fundindo duas fichas do legado numa pessoa só**. Para `distribution_group_members` isso é inócuo
(nenhuma das 7 tem `ativo='sim'`), mas §2.3 dedupa `corretors` por `Nome` — essas 7 duplicatas passam
pelo dedup porque têm `Nome` diferente do da ficha principal, e a regra "manter a linha com `ativo='sim'`"
não as vê. Se `mapa/negocios.md` usar a mesma cascata para atribuir negócio por ficha de corretor,
essas 7 fichas passam a apontar para a mesma pessoa **sem que nada registre a fusão**.

**Correção:** logar as 7 explicitamente como fusão de ficha (não como resolução) e corrigir §2.4/§6.1
para 8 / 63.

---

## 5. BAIXA — `zfill(11)` fabrica um CPF que não é da pessoa

§4.1 #4 manda `re.sub(r'\D','',v).zfill(11)`. Medido: **1 linha com 10 dígitos**. `zfill` completa à
**esquerda** — `1234567890` vira `01234567890`, que passa no check `^[0-9]{11}$` (`0046:50-53`) e ocupa
o unique parcial `profiles_cpf_key` (`0046:70`). O resultado é um CPF sintático válido e factualmente
falso, gravado como se fosse dado real, num campo que a operação usa para identificar pessoa.

**Correção:** `len(d) != 11 → NULL + log`. É 1 linha; o custo de errar é maior que o de perder o dado.

---

## 6. Pontos que **não** consegui refutar (registrados como abertos, não como defeitos)

- **Ordem de carga vs FKs:** correta. `profiles.id → auth.users(id)` (`0002:29`), `teams.director_id/
  manager_id → profiles` (`0002:118-121`), `team_members → teams/profiles` (`0002:172-174`),
  `distribution_group_members → distribution_groups/profiles` (`0004:171-177`). Nada quebra na sequência
  0→8. `distribution_groups.fila-geral` existe no `seed.sql:108-110` — mas isso é uma **dependência de
  pré-condição não declarada em §1**: se o alvo tiver só migrations aplicadas e o `seed.sql` não tiver
  rodado, o passo 7 falha por FK. Vale uma linha de pré-checagem.
- **Impersonação do passo 4:** necessária e correta. `profiles_guard_admin_columns` é `before update`
  (`0012:64-66`), então o passo 1 (INSERT pelo gatilho) não é afetado; `is_admin()` = `has_role('admin')`
  lendo `auth.uid()` (`0002:237-245`), sem checar `status`, então até um admin `terminated` serviria.
  Douglas está `Ativo=sim`, ponto não crítico.
- **Chaves de idempotência das outras 6 tabelas:** todas reais e conferidas — `auth.users(email)` (298
  distintos), `profiles.email` (citext unique, `0002:31`), `user_roles` PK `(profile_id, role)`,
  `teams.slug` unique (`0002:118`, 12 slugs distintos), `distribution_group_members` PK
  `(group_id, profile_id)` (`0004:177`), `import.bubble_map` PK `(entity, bubble_id)` (298 e 12 `unique
  id` distintos, 0 vazios). **`team_members` é a única furada — e é a maior tabela do domínio.**
- **Falso positivo por homônimo pessoa↔pessoa:** não encontrei. 298 `colaboradores` normalizados = 298
  distintos; as 8 colunas de relacionamento resolvem 100% e nenhuma casa 2+ pessoas. A regra "na dúvida,
  ABORTAR" de §2.3 é adequada.
- **Rateio/soma:** não há rateio neste domínio (§4 confirma: nenhuma coluna monetária). As somas que
  existem fecham: 271+11+5+4+2+1+1+1 = 296 pessoas com papel + 2 sem = 298; 287+16+6+5+2+1 = 317 linhas.

---

## 7. Verificação executável que o §9 deveria ter (e não tem)

O bloco de verificação de §9 confere **volume**. Nenhuma daquelas contagens pega a duplicação da §1 se
alguém corrigir os totais esperados. O que falta é asserção de **forma**:

```sql
-- 1. nenhuma pessoa com o mesmo vínculo duas vezes (pega o reimport)
select profile_id, team_id, joined_at, count(*)
from public.team_members group by 1,2,3 having count(*) > 1;   -- esperado: 0 linhas

-- 2. ninguém na fila sem o papel que a fila pressupõe (pega o §2 desta refutação)
select p.email from public.distribution_group_members m
join public.profiles p on p.id = m.profile_id
where not exists (select 1 from public.user_roles ur
                  where ur.profile_id = m.profile_id and ur.role = 'broker');  -- esperado: 0 linhas

-- 3. nenhuma saída datada depois da carga (pega o left_at = today())
select count(*) from public.team_members where left_at >= current_date;        -- esperado: 0
```

---

## 8. Suposições e limites desta refutação

1. Nada foi executado contra o banco; os efeitos de trigger/constraint foram deduzidos da leitura das
   migrations, não observados. As três asserções de §7 são justamente o que provaria em execução.
2. Reimplementei `slugify` (`0001:171-181`) e `norm` (§2.2) em Python para conferir slugs e chaves; a
   equivalência com o Postgres não foi testada em execução — para os 12 nomes de equipe o resultado
   coincide com a lista de §3 do próprio mapa.
3. Fuso `America/Sao_Paulo` assumido igual ao mapa; todas as comparações de data são `date`-a-`date`,
   insensíveis ao fuso.
4. Dados pessoais foram lidos apenas para contagem. `senha_temporaria` **não foi lida, exibida nem
   escrita** em nenhum ponto — nenhum script deste relatório referencia essa coluna.
5. Nenhum arquivo do repositório foi alterado além deste.
