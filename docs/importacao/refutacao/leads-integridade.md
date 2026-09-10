# Refutação — mapa de importação **Leads**, lente **integridade**

**Alvo:** `docs/importacao/mapa/leads.md`
**Data:** 09/09/2026 · **Escopo:** somente leitura (CSVs + migrations). Nenhuma consulta ao banco, nenhum arquivo do repo alterado fora deste.
**Método:** todo número abaixo saiu de um comando executado — `python` (módulo `csv`, streaming) sobre os CSVs de `DOCUMENTOS/DADOS_BUBBLE/` ou `grep`/`sed` nas migrations de `supabase/migrations/`.

**Veredito: REFUTADO.** O mapa reproduz corretamente quase todos os números do perfil (conferi e bateram: 102.799 linhas, `unique id` 100% distinto, `Status` canônico 36.265/64.885/871/59/719, `Observações` 7.432, escada 95.287+279+3.728+0, telefone). Mas **três** afirmações centrais de integridade são falsas, e duas delas produzem dado errado em silêncio.

---

## F1 — BLOQUEANTE · a escada de nomes tem falso positivo e perda silenciosa; o mapa afirma o contrário

### O que o mapa afirma

> §5.2: "Medido: **zero** ambiguidades reais neste arquivo — todas as falhas são 'não encontrado'."
> §5.2, tabela de não encontrados: `sonia mara castro viana` (484) · `kelvin albuquerque castro viana` (37) · `maria luiza castro viana` (26) · `kelvin viana` (144) → **"ausente de `Users`"**.
> §5.2, ALIAS: `"maria luiza castro viana": "Maria Luiza Viana"  # +26, média confiança`.
> §8, D3: "**Criar perfil `terminated`** para elas preserva o dono do lead histórico."

### O que os dados mostram

Reimplementei a escada exatamente como está escrita (nkey NFD + regex de mojibake + primeiro/último token + subset) e rodei sobre as 102.799 linhas contra `export_All-Users-modified--_2026-09-08_19-44-45.csv` (298 linhas, 298 `colaboradores` distintos, zero duplicata de nkey).

Bateu nas quatro regras — e divergiu no resto:

| | mapa | medido |
|---|---:|---:|
| 1 exato | 95.287 | **95.287** ok |
| 2 mojibake | 279 | **279** ok |
| 3 primeiro+último | 3.728 | **3.728** ok |
| 4 subset | 0 | **0** ok |
| **ambíguo** | **0** | **26** ✘ |
| não encontrado | 3.504 | **3.478** |

**(a) Falso positivo real, 85 leads.** Auditei todos os 13 pares que a regra 3 casou:

```
  1642  'everton goncalves da silva'   ->  'Everton Silva'            (ok: Nome_completo = Everton Goncalves da Silva)
   918  'fabiano rodrigues vieira'     ->  'Fabiano Vieira'
   403  'isaias ribeiro luca'          ->  'Isaias Luca'
   322  'roberto santos mendes'        ->  'Roberto Mendes'
   188  'caroline elias de menezes'    ->  'Caroline Menezes'
    85  'fernanda lucas teixeira'      ->  'Fernanda Cardoso Teixeira'   <-- PESSOA DIFERENTE
    71  'thaila tayana rosa de araujo' ->  'Thaila Araujo'
    ... (demais consistentes)
```

Em `Users` existem exatamente **duas** Fernandas: `Fernanda Cardoso Teixeira` (`colaboradores` = `Nome_completo` = *Cardoso*, sem nenhum "Lucas") e `Maria Fernanda da Silva Azeredo`. **`Fernanda Lucas Teixeira` não está em `Users`** — a regra 3 casa só porque ela é a única com (fernanda, teixeira). Resultado: 85 leads (nome, telefone, e-mail de pessoas reais) ganham `assigned_to` de outra corretora, e `raw_payload.corretor_resolvido = "3_prim_ult"` fica **indistinguível de um acerto**. É exatamente o cenário que o próprio mapa proíbe ("não encontrado → NULL, nunca melhor palpite") e cuja consequência ele mesmo descreve: `leads_select` (`0005:623-624`) passa a exibir o lead para quem não é dono.

A pré-condição desse erro está provada pelo próprio mapa: 17 nomes de corretor não estão em `Users`. Sempre que um deles compartilhar (primeiro, último) token com alguém que está, a regra 3 casa errado. A cláusula "único candidato" só protege contra dois candidatos **dentro de `Users`** — não contra a pessoa certa estar **fora** dele.

**(b) Perda silenciosa: 1.090 leads (+146) cujo dono existe em `Users` e o mapa declarou ausente.** A escada indexa só `Users.colaboradores`. Buscando os mesmos nomes em `Users.Nome_completo`, **por igualdade exata**:

| `Corretor` no CSV | leads | linha em `Users` (`colaboradores` → `Nome_completo`) | `Ativo` |
|---|---:|---|---|
| `janaina silva de fraga maciel` | **543** | `Janaina Fraga` → `Janaina Silva de Fraga Maciel` | **sim** |
| `sonia mara castro viana` | **484** | `Sonia Castro` → `Sônia Mara Castro Viana` | não |
| `kelvin albuquerque castro viana` | **37** | `Kelvin Castro` → `Kelvin Albuquerque Castro Viana` | **sim** |
| `maria luiza castro viana` | **26** | `Maria Viana` → `Maria Luiza Castro Viana` | não |
| | **1.090** | | |

Mais 146 leads por primeiro+último token sobre `Nome_completo`: `kelvin viana` (144) → `Kelvin Albuquerque Castro Viana`; `fatima gomes` (2) → `Fátima Cristina Mendes Ferreira Gomes` (`colaboradores` = `Cristina Mendes`).

**Consequência do D3 como está escrito:** o dono aprovaria "criar perfil `terminated`" para `Janaina Fraga` e `Kelvin Castro`, que estão **ativos** no export. Isso cria **perfil duplicado para funcionário em atividade** — dois `profiles.id` para a mesma pessoa quebram `team_members` → `teams.manager_id`, `auth_visible_profiles()`, contagem de leads por corretor, gamificação e o rateio de VGV. É um erro de identidade que se espalha por todos os domínios e não tem correção barata depois da carga.

**(c) A ALIAS sugerida aponta para a pessoa errada.** `maria luiza castro viana` tem **dois** candidatos em `Users` cujo (primeiro, último) é (maria, viana) — por isso medi 26 ambíguos onde o mapa mediu zero:

```
   colaboradores='Maria Luiza Viana'  Nome_completo='Maria Luiza Viana'         Ativo=nao
   colaboradores='Maria Viana'        Nome_completo='Maria Luiza Castro Viana'  Ativo=nao
```

O mapa recomenda `"maria luiza castro viana": "Maria Luiza Viana"`. A pessoa certa é a segunda linha — `Maria Viana`, cujo `Nome_completo` **é literalmente** `Maria Luiza Castro Viana`. Aplicar o alias do mapa manda 26 leads para outra pessoa.

### Correção

1. Indexar **`colaboradores` e `Nome_completo`** na escada (regra 1 em ambos, antes de qualquer heurística). Recupera 1.090 leads por igualdade exata, elimina 3 das 4 "pessoas ausentes" e derruba a ALIAS errada.
2. **Tirar a regra 3 do caminho automático.** É a única fonte de falso positivo e responde por 3.728 leads. Converta-a em *lista de revisão para o dono*: são 13 pares, uma linha cada — 5 minutos de leitura, e é a diferença entre 3.728 atribuições auditadas e 85 erradas invisíveis.
3. Se a regra 3 ficar, grave `corretor_resolvido = "3_prim_ult_nao_auditado"` e faça a verificação da §10 listar esses leads. Hoje o `raw_payload` não permite separar acerto de chute.
4. Reabrir D3 com a lista corrigida: sobram como realmente ausentes de `Users` `caroline farias` (618), `thabata nobre` (155, alias de digitação para `Tabhata Nobre`), `jose neres da silva junior` (93), `alessandro bueno` (82), `andre da silva` (79 — **2 candidatos** por `Nome_completo`, mantenha NULL), `henrique de vargas pacheco` (76) e a cauda de 22 leads.

---

## F2 — ALTA · `on conflict (external_id) do nothing` não executa: o índice é PARCIAL

`supabase/migrations/20260725120400_0005_leads.sql:83-84`:

```sql
create unique index leads_external_id_idx on public.leads (external_id)
  where external_id is not null;
```

É o **único** índice único sobre `external_id` em todo o repositório (`grep -rn "leads_external_id\|unique (external_id)" supabase/migrations/*.sql` retorna só essa linha). O mapa §6 prescreve:

> `insert … on conflict (external_id) do nothing`

O PostgreSQL não infere índice parcial como *arbiter* quando a cláusula `ON CONFLICT` não repete o predicado: `infer_arbiter_indexes()` descarta todo índice com `indpred` cujo predicado não seja implicado pelo `arbiterWhere` — e sem `WHERE` na cláusula não há o que implicar. O comando morre com:

```
ERROR:  there is no unique or exclusion constraint matching the ON CONFLICT specification
```

Evidência corroborante no próprio repo: `supabase/functions/voice-ai-webhook/index.ts:27-28` documenta que depende desse índice parcial para idempotência e, em vez de `upsert`, faz **`select … .eq("external_id", …)` seguido de insert** (linhas 97 e 128). O único `upsert` real do projeto é sobre `ad_campaigns`, cujo índice `ad_campaigns_external_id_key` (`0067:27-28`) é **total** — e o comentário de 0067 registra a preocupação explícita de "manter válido qualquer `on conflict` já escrito contra ele".

**Gravidade:** falha alto e cedo (a primeira instrução do lote aborta), não corrompe. Mas é a única alavanca de idempotência do domínio, e a verificação §10 item 4 não a detecta — ela conta linhas depois de um INSERT que nunca rodou.

**Correção — uma cláusula:**

```sql
insert into public.leads (…) values (…)
on conflict (external_id) where external_id is not null do nothing;
```

E **não** troque para `do update` sem pensar: `leads_log_changes` é `after update` (`0005:606-609`) e gravaria um `lead_events('status_changed')` + `('stage_changed')` por lead alterado; `leads_set_updated_at` (`0005:92-94`) sobrescreveria o `Modified Date` que a linha 39 do §3 diz preservar. Confirmei que na **inserção** nada disso dispara — `leads_log_changes` é só `after update`, `leads_keep_next_action` é `before update` (`0074:456-458`) e `leads_normalize` é o único `before insert`. A §0 acerta aqui.

---

## F3 — MÉDIA · §4.5 conta 46 grupos onde há 47, e a soma da coluna não fecha

`Grupo` tem **50 valores distintos incluindo vazio** → **49 rótulos não vazios**. O mapa diz "49 valores, incluindo vazio" e monta a tabela como `Roleta Geral` + *(vazio)* + `ChatBot` + "os **46** restantes". A lista enumerada em §4.5 contém, contando item a item, **47** rótulos — o texto que os rotula é que está errado, não a lista.

Efeito prático: **§9 subestima em 1 linha** — `distribution_groups` recebe **+48** (47 legados + `chatbot`), não +47.

Segundo erro na mesma linha: a coluna *Registros* dos "46 restantes" diz **20.406**. A soma dos valores individuais que o próprio mapa lista dá **15.508**, e é esse o número certo: `102.799 − 69.919 (Roleta Geral) − 12.687 (vazio) − 4.685 (ChatBot) = 15.508`. Com 20.406 a coluna soma 107.697 ≠ 102.799.

O resto da §4.5 sobrevive à checagem: gerei o slug dos 49 rótulos pela regra descrita — **49 slugs distintos, zero colisão entre si** e nenhuma contra `fila-geral`, `triagem-sdr-ia` (`supabase/seed.sql:111-115`) nem contra `leads-parque-das-flores` / `leads-regiao-sul` (`supabase/seeds/020_catalog_distribution_sdr.sql:33`).

**Armadilha adjacente que o mapa não menciona:** `on conflict (slug) do nothing` **não retorna linha** quando o slug já existe. Se o script usar `insert … on conflict (slug) do nothing returning id` para obter o `distribution_group_id`, numa reexecução ele recebe zero linhas e grava `distribution_group_id = NULL` em silêncio — inclusive nos 69.919 leads de `Roleta Geral`, que reusam um grupo pré-existente e portanto caem nesse caso **já na primeira carga**. Resolva o id com `select id from distribution_groups where slug = :slug` depois do insert, nunca pelo `returning`.

---

## F4 — MÉDIA · a chave de dedupe de `lead_events(kind='call')` colide: 13 ligações somem no reimport

§6 propõe `bubble_ref = "call:<epoch>:<chave_telefone>:<creator>"`. `export_All-ligacoes` não tem `unique id` e o `Creation Date` tem resolução de **minuto** (`%b %d, %Y %I:%M %p`). Medi a chave composta nas 8.365 linhas:

```
refs distintos: 8201 | linhas com chave util: 8214 | inaproveitaveis: 151
refs colidentes: 12 | linhas perdidas no dedupe: 13
  colisao x3: data=Apr 22, 2026 1:43 pm  tel=***1010  creator=Nathan Bittencourt
  colisao x2: data=Feb 6, 2026 11:20 am  tel=***4148  creator=Kevyn Bueno
  colisao x2: data=Feb 7, 2026 11:34 am  tel=***5831  creator=Nathalia Sito
```

São ligações reais, repetidas no mesmo minuto para o mesmo número pelo mesmo corretor (rediscagem). O `where not exists` da §6 insere a primeira e descarta as outras 13 — **perda silenciosa de 0,16%**, e o número cresce se a carga for reexecutada por partes. Correção trivial: acrescentar o ordinal da linha dentro do grupo ao `bubble_ref` (`call:<epoch>:<tel>:<creator>:<n>`), tornando a chave posicional e estável.

Na mesma seção, §5.5 diz "86 com número inaproveitável (<8 dígitos)". Medido: **86 com menos de 8 dígitos e mais 65 com `numerocliente` vazio** = 151 linhas sem chave possível. O total de 1.944 não muda; só a decomposição está incompleta.

---

## F5 — BAIXA · o plano B de idempotência de `lead_comments` apaga comentário de usuário

§6 oferece como "alternativa mais simples":

```sql
delete from lead_comments where lead_id = any(:lote) and author_id is not distinct from :corretor
```

`lead_comments` não tem coluna que distinga comentário importado de comentário digitado no app (`0005:172-179`: `id, lead_id, author_id, body, created_at, updated_at` — nada de `source`/`external_id`). O corretor dono do lead é o mesmo `author_id` que a carga usa. Logo, um reimport rodado depois que a operação começou **apaga os comentários que os corretores escreveram** nesses leads. Use só a variante `where not exists (lead_id, created_at, md5(body))`, que a própria §6 lista primeiro — ou a tabela `import_bubble_map`, que resolve isso e ainda serve os outros domínios.

---

## O que checei e **não** refutou o mapa

Registro para não custar o trabalho a quem vier depois:

- **Cabeçalho do CSV.** A §0 diz que o header está limpo e o corpo não. **Confere byte a byte:** a primeira linha decodifica em UTF-8 estrito, contém `C3 B3`/`C3 A7`/`C3 A3` (acentos reais) e **zero** ocorrência de `EF BF BD`. `DictReader` com `'Código'`, `'Observações'`, `'Mês'`, `'Imóvel'`, `'Preço'` funciona. (O `?` que aparece no terminal Windows é da saída do console, não do arquivo.)
- **Chave de idempotência única na origem.** 102.799 linhas, 102.799 `unique id` distintos, **zero** vazio, **zero** repetido.
- **Ordem de carga (§1) respeita as FKs.** `leads.source_id` → `lead_sources`, `distribution_group_id` → `distribution_groups`, `assigned_to` → `profiles` (todas `on delete set null`, `0005:31-32,52`); `lead_comments.lead_id` e `lead_events.lead_id` são `not null references leads on delete cascade` (`0005:153,174`) e vêm depois. `converted_deal_id` adiado para o passo 7 é correto. Nenhuma inversão.
- **Nenhum gatilho de INSERT em `leads` gera evento ou notificação.** Só `leads_normalize` (`before insert or update`). `leads_log_changes` e `leads_keep_next_action` são `after`/`before update`.
- **`Status` canônico.** Reproduzi com a `canon()` da §5.1: `arquivado` 36.265 · `em negociao` 64.885 · `novo` 871 · `negcio fechado` 59 · vazio 719 = 102.799. As somas do §4.1 e do §9 (opção A) fecham exatamente.
- **`Observações`:** 7.432 preenchidas.
- **Constraint `leads_lost_consistency`** é `(status='lost') = (lost_at is not null)` (`0005:78-79`) — logo `discarded` com `lost_at` NULL é aceito e a regra do §4.1 está certa.
- **Telefone.** Com a regra da §5.4 e os 67 DDDs: **100.342 válidos · 2.352 inválidos · 105 vazios** = 102.799. Casa com a "checagem independente" que o mapa já declara (100.342) e explica o delta de 5 para os 100.337 do perfil. O mapa expõe a divergência em vez de escondê-la — correto.
- **Nomes duplicados em `Users`:** zero. Os 298 `colaboradores` têm 298 nkeys distintos, então a regra 1 nunca é ambígua.
- **Seeds não apagam a carga.** `059`/`069` deletam por prefixo de id (`75000000-%`, `83000000-%`), não por faixa de data nem por grupo.

**Divergência menor sem veredito:** o corte de 12 meses do D1-C. Com `Data atividade`, caindo para `Criado em` quando vazia, e `>= 09/09/2025`, medi **40.852** leads (`in_progress` 27.239 · `lost` 13.362 · `discarded` 241 · `converted` 10) contra os **41.367** do §9 — 1,2% de diferença, provavelmente outra definição de "atividade nos últimos 12 meses" (`max(Criado em, Data atividade)`, por exemplo). O mapa não diz qual data define o corte; **defina-a explicitamente** antes de rodar, senão dois scripts produzem dois recortes.

---

## Ordem de correção sugerida

| | O quê | Custo |
|---|---|---|
| 1 | Indexar `Nome_completo` na escada; tirar a regra 3 do automático; refazer a lista do D3 | 1 h de script + 5 min do dono |
| 2 | `on conflict (external_id) where external_id is not null do nothing` | 1 linha |
| 3 | Resolver `distribution_group_id` por `select`, nunca por `returning` de um `do nothing` | 3 linhas |
| 4 | `bubble_ref` de `call` com ordinal | 3 linhas |
| 5 | Corrigir §4.5 (47 rótulos, 15.508 registros) e §9 (`distribution_groups` +48) | texto |
| 6 | Riscar o `delete from lead_comments` do §6 | texto |

---

*Nenhum arquivo do repositório fora deste foi criado ou alterado. Nenhuma consulta foi feita ao banco. Telefones aparecem só com os 4 últimos dígitos; nenhuma senha, CPF ou e-mail foi lido, exibido ou copiado.*
