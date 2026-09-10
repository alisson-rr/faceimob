# Refutação — `mapa/negocios.md` pela lente **integridade**

**Alvo:** `docs/importacao/mapa/negocios.md` (816 linhas, lido inteiro)
**Data:** 09/09/2026 · **Fase:** somente leitura de arquivo. Nada rodou contra banco.
**Scripts:** `<scratchpad>/v1.py`…`v6.py` (`csv.DictReader`, Python 3.12, streaming).
Todo número abaixo saiu de um comando executado; onde reproduzi o número do mapa, digo que
reproduziu.

**Veredito: REFUTADO — gravidade alta.** O mapa está muito acima da média em aritmética
(reproduzi 9 dos seus números principais na casa do centavo), mas **o único join heurístico do
domínio tem a exposição subdeclarada em 2,4×**, e é justamente com esse número que o dono
decide se espera o reexport ou não.

---

## 1. O achado principal — a ambiguidade de `observacaoPipelines → deals` é 724 linhas, não 305

### O que o mapa afirma

§5.3: *"`pipelines` tem **144 valores de `CLIENTE` repetidos, cobrindo 305 linhas**. Desses,
**101 nomes** são citados por observações."*
§11-S5: *"Até **305 linhas de observação** podem ir para o negócio errado."*
§8-D8: *"até 305 linhas podem ir para o negócio errado."*

### O que os arquivos dizem

Reproduzi o 144/305 **exatamente** — e foi assim que descobri o erro:

```
nomes repetidos INCLUINDO bucket vazio: 144   linhas: 305     # v6.py
nomes ambiguos (>=2 negocios), sem o bucket vazio: 143   cobrindo 289 linhas
CLIENTE vazio: 16                                             # 143+1 = 144 · 289+16 = 305
```

Ou seja: **305 é a contagem de linhas de `pipelines`** (289 negócios com nome repetido + as 16
linhas de `CLIENTE` vazio, contadas como um 144º "valor repetido"). Não é, e nunca foi, uma
contagem de observações.

A contagem correta, do lado de `observacaoPipelines`:

```
observacoes total: 24766
linhas em nome UNICO   : 24042   (97,08%)
linhas em nome AMBIGUO :   724   (2,92%)   <-- exposição real
  destas, com texto (que de fato viram deal_history): 718
nomes ambiguos citados por obs: 98   (o mapa diz 101)
linhas sem candidato: 0            (aqui o mapa acerta)
```

**724 observações**, não 305. Fator 2,4×.

### E o desempate não fecha a conta

Apliquei literalmente a regra do §5.3 passo 3 ("escolher o negócio cujo intervalo
`[ENVIO, coalesce(mudou_status, hoje)]` contém o `Creation Date` da observação"):

```
janela temporal -> nº de candidatos que ela seleciona:
  0 candidatos : 255      <- a janela não elege ninguém
  1 candidato  : 435      <- resolvido de verdade (60,1%)
  2 candidatos :  34      <- empate: a janela não decide
obs que a janela NAO resolve: 289 de 724 (39,9%)
```

Essas **289 linhas** caem no fallback *"o negócio com `ENVIO` mais próximo e anterior à
observação"* — que não é desempate, é escolha arbitrária entre dois negócios do mesmo cliente.
O mapa chama a regra de "heurística, não fato" e está certo; o problema é apresentar o custo
como 305 linhas quando são 724 expostas e 289 decididas no chute.

### Por que isso é integridade e não estética

`deal_history` não tem chave natural de negócio — a própria §6.1 diz que por isso o `id`
determinístico é obrigatório e a idempotência é `on conflict (id) do nothing`. **Uma observação
atribuída ao negócio errado na onda 1 nunca é corrigida por reimportação:** o `id` é derivado do
`unique id` da observação, o conflito bate, e o `deal_id` errado fica. Só um `UPDATE` manual
desfaz — e ninguém sabe quais 289 linhas revisar, porque o log da carga vai listar as 724 como
"resolvidas por janela temporal".

### Consequência para a decisão D8

O mapa recomenda D8-(a) (reexportar sem `-modified`) e diz que a onda 1 não depende disso.
Continua verdade. O que muda é o custo de **não** esperar: não é 0,3% do histórico de
comentários, é **2,9% exposto** e **1,2% (289/24.766) atribuído por sorteio**.

**Correção mínima:** trocar 305 por 724 em §5.3, §8-D8 e §11-S5; registrar que o desempate
resolve 435 e deixa 289 no fallback; e gravar em `deal_history.detail` um
`jsonb_build_object('match','ambiguo')` nas 724, para existir a lista de revisão.

---

## 2. Demais achados (menores, mas todos com número)

### 2.1 Volume de `deal_history` não reproduz — 24.593, não 24.551 · **gravidade média**

§3: *"43 duplicatas exatas `(pipeline, texto, data)`. **Volume final: 24.766 − 172 − 43 =
24.551**."* As 172 vazias reproduzem exatamente. As 43 não reproduzem sob nenhuma leitura:

| Tupla testada (já sem as 172 vazias) | Duplicatas excedentes |
|---|---:|
| `(pipeline, observacao, data)` cru | 22 |
| `(pipeline, observacao, Creation Date)` cru | 1 |
| `(T_NOME(pipeline), observacao, data)` | 22 |
| `(T_NOME(pipeline), observacao, Creation Date)` | 1 |

(medido em `v3.py`, `v5.py` e `v6.py`)

Volume real: **24.766 − 172 − 22 = 24.572** (leitura `data`) ou **24.593** (leitura
`Creation Date`). O mapa é o único documento do lote que promete "todo número saiu de um
script"; este não sai. Impacto de dado: baixo (dezenas de linhas). Impacto operacional: a
conferência pós-carga vai bater 24.572/24.593 contra um esperado de 24.551 e alguém vai parar a
carga achando que perdeu linha.

### 2.2 18 negócios ficam com rateio inflado e o mapa não os conta · **gravidade média**

§5.2 conta apenas *"negócios sem nenhum corretor resolvível: 279"* (reproduzi: 279, dos quais 75
têm nome que não resolve — bate). Mas há um caso que ninguém contou: o negócio em que **um slot
de corretor não resolve e outro resolve**. O corretor sobrevivente recebe `share_pct = 100` onde
o legado tinha dois nomes.

```
brokers resolvidos por negocio: {0: 279, 1: 6472, 2: 813, 3: 4}
negocios com rateio INFLADO (algum corretor sumiu, outro ficou): 18
ordinal 2 sem ordinal 1 (broker):                                18
```

18 negócios (0,24%) nascem com 100% para quem tinha 50%, e **18 nascem com `ordinal = 2` sem
`ordinal = 1`** — legal no schema (confirmei: não existe unique em `(deal_id, role, ordinal)`,
só `deal_participants_ordinal_check between 1 and 3`, `0025:32`), mas quebra a leitura
"slot 1 = titular" do front. Nenhuma das 6 conferências do §9 pega isso: a #1 checa
`sum(share_pct) = 100`, que **passa** justamente porque o rateio foi inflado.

**Correção:** 7ª conferência —
`select deal_id from deal_participants where role='broker' group by 1 having min(ordinal) > 1;`
esperado 18, e a lista sai junto com a curadoria de `import_bubble_map`.

### 2.3 44 negócios nascem com `stage='lost'` e `outcome='open'` · **gravidade média**

§4.2 admite a inconsistência ("a única tolerada") mas não a dimensiona. Medi:
`STATUS='PROPOSTA'` com `STATUS2 ∈ {REPROVADO, QUEDA, DISTRATO}` = **44 negócios**. Confirmei
que nada os barra no INSERT: `deals_guard_stage` é `before update` (`0006:435-437`) e
`deals_closed_consistency` só exige `closed_at` quando `outcome <> 'open'` (`0006:59-60`).

Efeito prático: 44 negócios aparecem na coluna "Perdido" do kanban e contam como **abertos** em
todo indicador (`dealCategory` decide por `outcome`). E no primeiro `UPDATE` de etapa,
`deals_guard_stage` copia o `outcome` da etapa e carimba `closed_at := now()` — a data de perda
vira o dia em que alguém abriu o negócio. Merece uma linha em §11 e uma conferência.

### 2.4 O caminho por API deixa T2, T4 e T6 sem mitigação · **gravidade alta se escolhido**

§9 fecha com: *"`disable trigger` exige ser dono da tabela… Se a carga for por API, a saída é
limpar `game_events` depois."* Isso resolve **só T1**. Pelos números do próprio mapa, no caminho
API sobram:

- **T2** — `deals_default_month_base` (`0032:82`, `before insert`) reescreve `month_base` de
  **411 negócios** cujo `mes` é o mês corrente. Irreversível sem o CSV na mão.
- **T4** — `deals_add_creator_participant` (`0012:170`) insere **522 corretores espúrios**
  (`Creator` com `Funcao=CORRETOR` diferente do `CORRETOR 1`), e cada um muda o 100/n do negócio.
- **T6** — `deal_participants_autofill` (`0006:225`, `after insert`) puxa gerente e diretor da
  equipe **atual** do corretor; confirmei no corpo da função (`0006:190-225`) que ele insere
  **sem** passar `ordinal`, ou seja, com o default **1**, colidindo com o gerente histórico que a
  carga põe em `ordinal = 1`. Não há unique que barre — entram dois managers no ordinal 1,
  exatamente o bug que a 0025 consertou.

**Correção:** dizer explicitamente que a carga por API está **proibida** para este domínio, ou
listar o pós-processamento de T2/T4/T6 (que, para T2, não existe).

### 2.5 §5.2 mede contra `Users`, mas promete `profiles.id` · **gravidade baixa**

O passo 1 do §5.2 é escrito como um salto só:
`T_NOME(valor) == T_NOME(Users.colaboradores) -> profiles.id`. São dois. `profiles.id` vem do
gatilho `on_auth_user_created` (`mapa/pessoas.md:31-32`) e é aleatório — não é computável no ETL.
A chave do segundo salto (`Users.email` → `profiles.email`, que é `citext unique`) nunca é
declarada. Confirmei que ela funciona: **298 Users, 298 e-mails preenchidos, 0 duplicados**
(`v5.py`), então o salto é seguro — mas está implícito.

Corolário medido: **4.096 linhas de participante** (2.915 broker, 818 manager, 363 director)
apontam para Users com `Ativo='não'`, que `pessoas.md:176` converte em
`profiles.status = 'terminated'` + `banned_until`. Nenhuma FK quebra (o `references profiles(id)`
não olha status), mas o mapa deveria dizer que **o pré-requisito são as 298 pessoas, inclusive as
204 desligadas** — uma carga de identidade "só dos ativos" derrubaria 4.096 linhas por FK
`restrict`.

---

## 3. O que ATAQUEI e NÃO caiu (o mapa está certo aqui)

Registro para o revisor não refazer o trabalho:

| Afirmação do mapa | Verificação executada | Resultado |
|---|---|---|
| `pipelines`: 7.568 registros, 110 colunas, `unique id` 1:1 | `csv.DictReader` completo (`v1.py`) | **7.568 linhas, 110 colunas, 7.568 uids distintos, 0 duplicado, 0 vazio** ✔ |
| `observacaoPipelines`: `unique id` serve de chave de idempotência | idem (`v3.py`) | **24.766 linhas, 24.766 uids distintos, 0 duplicado** ✔ |
| Conferência #6: `sum(vgv_gross) = 465.211.260,70` | soma com a `money()` do §2 | **465211260.70** ✔ (ao centavo) |
| Conferência #6: `won` = `398.105.909,06` | idem, `STATUS ∈ {VENDA, PARCEIRO}` | **398105909.06** ✔ |
| `VGV BRUTO`: 2.148 numéricos, 2.146 > 0, 632 são `R$ -` | contagem | **2.148 / 2.146** ✔ |
| Distribuição de `STATUS` (1.829 / 8 / 494 / 5.077 / 158 / 2) | contagem | **idêntica** ✔ |
| Volume `deal_participants` = **20.722** (8.110 + 7.490 + 5.122) | dedupe por `(deal, profile, role)` contra `Users.colaboradores` (`v4.py`) | **20.722, com o mesmo split** ✔ — inclusive as colisões intra-papel que o mapa não mostra (43 manager, 7 broker, 37 director) |
| `Users.colaboradores`: 298 distintos em 298 linhas, homônimo impossível | `T_NOME` sobre as 298 | **298 distintos, 0 colisão** ✔ |
| 279 negócios sem corretor resolvível (204 sem nome + 75 sem match) | contagem | **279 / 75** ✔ |
| Fallback "`VGV BRUTO` vazio e `VGV LIQUIDO` > 0" | contagem | **0 linhas** — regra inócua, mas inofensiva ✔ |
| `PARC_DESCONTO ≠ 0` sempre tem `VGV BRUTO` (senão dividiria por nulo) | contagem | **624 com desconto, 0 sem bruto** ✔ |
| Conferência #1 fecha com 3 corretores | leitura de `recalc_deal_shares` (`0058:31-79`) | **fecha** — há ajuste explícito do resto no `v_first` ✔ |
| `pipeline_stages` já tem os 6 codes que §4.2 emite | `seed.sql:11-22` | `incomplete, under_analysis, approved, contract, closed, lost` **todos existem** ✔ |
| Os nomes de T1–T6 são nomes de **trigger**, não de função | `grep "create trigger"` nas 86 migrations | **todos batem** — o `alter table … disable trigger` do §9 roda ✔ |
| `deals_guard_esteira_label` escapa `postgres`/`service_role` | `0037:40-70` | **confirmado**: `current_user not in ('postgres','service_role')` ✔ |
| `deals_guard_document_review` é só `before update` | `0028:75` | **confirmado** ✔ |
| `deals_log_changes` e `deals_guard_value` não disparam em INSERT | `0006:461`, `0061:246` | **ambos `after`/`before update`** ✔ — o mapa nem precisava citá-los |
| Reimportação duplica algo? | conferi cada `on conflict` contra o unique real (`0006:114,136`; `0003:92`) | **não duplica** ✔ |
| Ordem de carga respeita as FKs? | `developers → developer_projects → deals → clients/participants/history`; FKs em `0006:28-56` | **respeita** ✔ |

Sobre reimportação, uma ressalva que não é erro: **todos os `on conflict` são `do nothing`**, então
reimportar nunca corrige linha existente — só acrescenta o que faltava. Isso é ótimo para a
curadoria de `import_bubble_map` (participante novo entra e o `resplit` reajusta sozinho) e
inútil para consertar um `deal_history.deal_id` errado (§1) ou um `status_detail` mal mapeado.
Vale uma linha em §6 dizendo isso, para ninguém contar com reimportação como conserto.

---

## 4. Resumo executável das correções

1. **§5.3 / §8-D8 / §11-S5:** trocar 305 → **724** observações expostas; acrescentar que a janela
   temporal resolve **435** e deixa **289** no fallback arbitrário. *(bloqueia a decisão D8, não a
   carga da onda 1)*
2. **§3:** recontar as duplicatas (22 por `data`, 1 por `Creation Date`) e corrigir o volume para
   **24.572** ou **24.593**.
3. **§9:** acrescentar a conferência de `min(ordinal) > 1` (esperado 18) e listar os 18 negócios de
   rateio inflado junto da curadoria.
4. **§4.2 / §11:** dimensionar os **44** `PROPOSTA` com `STATUS2` de perda e avisar do carimbo
   `closed_at := now()` no primeiro UPDATE de etapa.
5. **§9 (fecho):** proibir explicitamente a carga por API, ou documentar o pós-processamento de
   T2/T4/T6.
6. **§5.2:** declarar o segundo salto (`Users.email` → `profiles.email`) e o pré-requisito de
   **298** perfis, inclusive as **204** pessoas desligadas.
