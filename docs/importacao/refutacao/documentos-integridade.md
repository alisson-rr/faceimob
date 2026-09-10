# Refutação — `mapa/documentos.md` pela lente **integridade**

Data: 09/09/2026 · Escopo: **só leitura de arquivos**. Nenhum comando contra o banco, nenhum arquivo de
código alterado. Todo número abaixo saiu de script `csv.DictReader` em streaming (`field_size_limit = 50 MB`,
scratchpad fora do repo) ou de `grep`/`sed` em `supabase/migrations/`. Os scripts estão listados na §6.

**Dados pessoais:** nenhum nome, CPF, telefone ou e-mail real aparece aqui; os exemplos de nome de cliente
estão mascarados (`F******* D***** A******`).

> **Veredito: REFUTADO — gravidade alta.**
> A aritmética do mapa é boa: reproduzi 7.568 / 3.979 / 1.454 / 1.256 / 476 / 290 / 94 / 19, os 2.857/2.857
> do ponteiro `doc`, os 19.527, os 2.184+56 e os 29.447 **exatamente**. E a chave de idempotência mais
> importante (`storage_path`) resiste ao teste: os 32.587 `f<epoch>x<rand>` do export são **um por URL, sem
> uma única colisão**.
> O que não resiste é a **resolução de FK por nome**: o mapa *mediu* a ambiguidade com comparação **crua**
> (123 nomes / 249 linhas — reproduzi esse par exato) mas *manda casar* com `norm()` (§4, §4.1.2), que dá
> **143 nomes / 289 linhas**. A normalização que o documento prescreve **não recupera um único registro a
> mais** (o casamento cru já tem **zero órfãos** nas duas tabelas) e **cria 20 ambiguidades novas, atingindo
> 40 negócios** que o casamento cru resolvia com certeza. Todo o orçamento de risco do mapa — "171 negócios",
> "636 linhas duplicadas", §10.5 — está calculado no denominador errado.

---

## 0. O que foi confirmado (para não jogar fora o que está certo)

| afirmação do mapa | medido | resultado |
|---|---|---|
| `pipelines` 7.568 linhas, `unique id` sem duplicata | 7.568 / 7.568 distintos / 0 dup | ✔ |
| `doc-clientes` 25.890 linhas, `unique id` sem duplicata | idem | ✔ |
| §3.1 cobre 100% dos rótulos de `STATUS2` | 30 rótulos, **0 fora do de-para** | ✔ |
| totais `approved` 3.979 · `pending_documents` 1.454 · `rejected` 1.256 · `under_review` 476 · `cancelled` 290 · `sent_to_agency` 94 · sem caso 19 | idem, soma 7.568 | ✔ |
| 5.235 casos decididos | 5.235 | ✔ |
| `ENVIO` preenchida em 7.567/7.568 | 1 vazia; `mudou_status` 1 vazia | ✔ |
| `decided_at` nunca nulo em `approved`/`rejected` (constraint `cca_cases_decision_consistency`, `0007:29-30`) | **0 casos decididos sem `mudou_status` E sem `ENVIO`** — o *fallback* da §2.7 cobre 5.235/5.235 | ✔ |
| `cca_status` tem `'cancelled'` (para `DISTRATO`/`QUEDA`) | `0001:74-82` | ✔ |
| `cca_cases.deal_id` é `unique` | `0007:18` | ✔ |
| `deal_documents.storage_path` é `unique` | `0006:260` | ✔ |
| `pipelines.doc` → `doc-clientes.unique id`: 2.857/2.857 | 2.857 ponteiros, 2.857 distintos, 2.857 casam | ✔ |
| nenhum `doc-cliente` é apontado por 2 negócios | 0 | ✔ |
| 19.527 linhas com `url_N` e `arquivos` vazio | 19.527 | ✔ |
| `arquivos` idêntica a `url_1..16` em 2.184 de 2.240 | 2.240 preenchidas, **56** divergem | ✔ |
| `pipelines.documentos` = 29.447 URLs | 29.447 distintas, em 4.330 negócios | ✔ |
| `deal_documents_supersede` é `after insert` → `UPDATE` pós-carga não redispara (§9, depois-da-carga 2) | `0006:343-345` | ✔ |
| `import_bubble_map` não existe no repo | `grep` só devolve os próprios documentos de importação | ✔ |
| §4.1.4: 12 linhas de `doc-clientes` com `pipeline` vazio | 12 — e as 7 alcançáveis pelo ponteiro `doc` **não carregam nenhum arquivo**, então a ordem "regra 1 antes da regra 4" não perde nada | ✔ |

**A chave de idempotência mais crítica está certa.** Testei o pior cenário do `storage_path`: dois arquivos
diferentes com o mesmo `bubble_file_id`, ou dois nomes que `sanitize()` colapsa dentro do mesmo id — qualquer
um dos dois faria `on conflict (storage_path) do nothing` **engolir um arquivo em silêncio**.

```
f-ids distintos: 32587 | f-id com MAIS DE UM nome de arquivo: 0
f-id com mais de uma URL normalizada: 0
f-ids onde sanitize() COLAPSA nomes distintos: 0
```

Ou seja: o achado da §5.1 ("o id do arquivo já está dentro da URL e é estável") **se sustenta**, e o mapa
irmão `negocios.md` fecha o resto — `deals.id` é **UUIDv5 derivado do `unique id`** (`negocios.md:236`), então
o prefixo do caminho também é estável entre execuções. **Reimportar não duplica `deal_documents`.**

O problema não é contagem nem idempotência. É **para qual negócio cada arquivo vai**.

---

## 1. ACHADO PRINCIPAL — a `norm()` que o mapa manda usar destrói a resolução de 40 negócios e não recupera nenhum

### 1.1 O documento mede com uma regra e manda executar outra

§4 abre assim: *"Normalização única para todo casamento por nome (função `norm` da §2.1)"*. §4.1.2 aplica:
`norm(doc-clientes.pipeline) = norm(pipelines.CLIENTE)`. §4.1.3 então declara o custo:

> **Por nome, ambíguo.** 123 nomes de `CLIENTE` pertencem a 2 ou 3 negócios (249 linhas de `pipelines`)

Reimplementei `norm()` verbatim da §2.1 e contei os dois jeitos sobre as mesmas 7.568 linhas:

```
CLIENTE ambiguo por comparacao CRUA:            123 nomes / 249 linhas
CLIENTE ambiguo por norm() (a funcao do mapa):  143 nomes / 289 linhas
```

O par **123 / 249 é exatamente a contagem crua**. O mapa perfilou a ambiguidade com igualdade de string
sensível a acento e caixa, e prescreveu o casamento com uma função que **apaga acento e caixa**. São 20 nomes
e 40 linhas de `pipelines` de ambiguidade que existem no algoritmo e não existem no orçamento de risco.

### 1.2 A normalização não compra recall nenhum — mediu-se zero órfão dos dois lados

Esta é a parte que fecha o argumento. Se `norm()` fosse necessária para casar, o custo seria justificável.
Não é:

```
--- doc-clientes (25.890 linhas) ---
  orfaos por CASAMENTO CRU: 0 nomes / 0 linhas
  orfaos por norm():        0 nomes / 0 linhas
--- historicoPipes (10.343 linhas) ---
  orfaos por CASAMENTO CRU: 0 nomes / 0 linhas
  orfaos por norm():        0 nomes / 0 linhas
```

A coluna `pipeline` do export `-modified` é a **renderização literal** de `pipelines.CLIENTE`: 36.233 linhas
de origem, **zero** que precise de normalização para achar o negócio. `norm()` tem recall idêntico e
**resolução estritamente pior**.

### 1.3 O preço, medido, é o ramo ambíguo crescer dos dois lados

```
doc-clientes   — ramo ambiguo cru:   98 nomes /  715 linhas / 198 negocios
doc-clientes   — ramo ambiguo norm: 110 nomes /  779 linhas / 222 negocios
historicoPipes — ramo ambiguo cru:   41 nomes /  211 linhas /  84 negocios
historicoPipes — ramo ambiguo norm:  43 nomes /  220 linhas /  88 negocios

nomes que o norm() TORNA ambiguos (cada grafia isolada e unica): 20 | negocios envolvidos: 40
   colisao criada por norm(): ['F******* D***** A******', 'F******* D***** A******']
   colisao criada por norm(): ['F********* S***** D* S****', 'F********* S***** D* S****']
   colisao criada por norm(): ['S***** C******* D* S****', 'S***** C******* D* S****']
```

Leia a lista mascarada: as duas grafias de cada par são **idênticas depois de tirar acento e caixa** e
**distintas antes**. Para esses 40 negócios, o registro de `doc-clientes` diz exatamente qual dos dois é o
dono — a string bate com um e só um. O `norm()` apaga essa informação e joga 64 registros de `doc-clientes`
e 9 de `historicoPipes` no ramo §4.1.3, cujo último degrau é literal:

> c. ainda empatado: **anexar o pacote aos dois negócios**

### 1.4 Por que isso é grave e não cosmético

O que o pacote contém é o ponto. O próprio mapa mede (§2.6): **1.127 arquivos têm CPF formatado no nome** e
590 têm 11 dígitos isolados; a §3.2 classifica holerite, extrato bancário, CTPS, certidão de casamento. Anexar
"aos dois negócios" quando o dado da origem **sabia** qual era o certo é publicar documento pessoal de A dentro
do negócio de B — e a tela do negócio é visível para todo participante e para o CCA
(`cca_cases_select = has_any_role('admin','cca') or can_see_deal`, citado na própria §4.3).

E é um erro que o desempate não pega: os degraus 3a (janela de data) e 3b (interseção com
`pipelines.documentos`) foram desenhados para **homônimos de pessoas diferentes**. Duas grafias do **mesmo
nome** costumam ser a mesma pessoa recadastrada, com janelas de data sobrepostas e listas de documento
parecidas — exatamente o caso em que 3a e 3b empatam e cai-se no 3c.

### 1.5 Correção (menor diff, sem perda)

Trocar o degrau 2 do §4.1 por dois degraus, mantendo `norm()` só como rede:

```
2a. igualdade CRUA (só .replace("\xa0"," ").strip()) contra pipelines.CLIENTE,
    quando a string pertence a um só negócio  -> aceita  (zero órfãos, 0 falsos positivos novos)
2b. só se 2a não achar nada: norm() como hoje
3.  ramo ambíguo: só o que sobrar de 2a e 2b
```

Consequência de **não** corrigir: 40 negócios entram no ramo de desempate sem necessidade, e a linha "171
negócios" da §4.1 e as "636 linhas duplicadas" da §8/§10.5 continuam sendo números de um algoritmo que o
documento não manda executar. Consequência de corrigir: uma condição a mais no script, ambiguidade cai para o
patamar que o próprio mapa já publicou (123/249), e o resto do documento passa a bater com a implementação.

---

## 2. Demais achados, por gravidade

### 2.1 O conjunto de upload não cobre as linhas que o próprio mapa manda criar — **alta**

Três afirmações do documento não podem ser verdadeiras ao mesmo tempo:

| onde | afirmação |
|---|---|
| §2.6 / §5.1 | `storage_path = f"{deal_id}/{bubble_file_id}-{sanitize(...)}"` — **prefixo de negócio**, `unique` no banco |
| §0 e §8 | subir **30.279 objetos distintos** (união de URLs normalizadas) |
| §8 | criar **30.915** linhas de `deal_documents` — "636 a mais que os arquivos distintos" |

Se o caminho carrega o `deal_id`, o mesmo arquivo anexado a dois negócios pelo degrau 3c gera **dois caminhos
distintos** e portanto **dois objetos**. 30.915 caminhos exigem 30.915 objetos, não 30.279. Do jeito escrito,
**636 linhas nascem apontando para objeto que ninguém subiu** — e o §1 passo 6 avisa o que acontece: *"linha
sem objeto produz 'Baixar' com 400"*. Pior: o §9 (depois da carga, item 3) manda reconciliar com
`missingStoragePaths` e *"ou sobe o arquivo ou apaga a linha"* — a limpeza apagaria em silêncio justamente as
636 linhas dos negócios ambíguos, que é o dado que o degrau 3c existiu para preservar.

Correção: o conjunto de upload é o conjunto de **pares (negócio, arquivo)**, não o de arquivos distintos.
Baixar 1×, subir N×. Também sobem os bytes: ≈ 4,5 GB × 30.915/30.279.

### 2.2 O "recorte corrente" zera 82 negócios — 673 arquivos que não são "versão anterior" de nada — **alta**

§6.1 descreve o descarte como *"Versões anteriores dos anexos (`doc-clientes` não-corrente) — ~21,5 mil
registros / 2.308 arquivos além do recorte corrente — **não importar**"*, enquadrando a perda como
supersessão benigna. Medido, o descarte é maior e nem sempre benigno:

```
arquivos distintos em doc-clientes (todas as versoes): 32581
uniao do mapa (recorte corrente U pipelines.documentos): 29721
descartados: 3123

nomes cujo registro CORRENTE esta VAZIO mas cujo historico tem arquivo: 87
   totalmente recuperados por pipelines.documentos:  5
   com arquivo que nao aparece em lugar nenhum do recorte: 82  | arquivos perdidos: 673
```

Em 87 clientes o registro mais recente de `doc-clientes` é um registro **sem nenhuma URL** — no Bubble, o
esvaziamento da caixa de anexos. A regra "pegue o snapshot corrente" pega o vazio: **82 negócios terminam com
zero documento** e vão para o balde "3.048 negócios ficam sem nenhum documento" da §4.1, indistinguíveis de
quem nunca teve documento. Não são versões antigas de arquivo vigente — são os **únicos** arquivos daqueles
negócios.

Correção mínima: quando o registro corrente do negócio for vazio, usar o registro **não-vazio** mais recente.
Custo: 673 arquivos, ~2,2% a mais de upload; ganho: 82 negócios deixam de nascer sem dossiê.

Efeito colateral confirmado no mesmo teste: **10 registros de `doc-clientes` são o "corrente" de 2 negócios ao
mesmo tempo** — e todos os 10 têm 0 arquivo. É por isso (e só por isso) que a duplicação do 3c não aparece na
minha execução; ver 2.3.

### 2.3 Os três volumes-âncora não reproduzem — **média**

Implementei a §4.1 inteira (ponteiro `doc` → nome único → 3a janela de data → 3b interseção → 3c ambos) e
comparei:

| número do mapa | valor publicado | meu valor | como cheguei |
|---|---:|---:|---|
| arquivos a subir (§0/§8) | 30.279 | **29.721** | união (corrente por nome) ∪ `pipelines.documentos`, casamento cru |
| idem, com o algoritmo §4.1 completo e `norm()` | 30.279 | **29.741** | simulação dos 4 degraus |
| recorte corrente puro, sem `pipelines.documentos` | — | **29.263** | é exatamente o número que a §10.4 atribui ao perfil |
| linhas `deal_documents` (§8) | 30.915 | **29.741** | pares (negócio, arquivo) |
| "636 a mais que os arquivos distintos" | 636 | **0** | nenhum arquivo ficou ligado a 2 negócios |

Os 636 não reproduzem porque, na minha implementação, os 10 registros compartilhados por dois negócios estão
todos vazios (2.2). Não afirmo que o mapa errou — afirmo que **o número não é reproduzível a partir das regras
escritas**, e ele é o insumo de duas decisões (D8 e o dimensionamento do §8). Enquanto o script que produziu
30.279 / 30.915 / 636 não estiver publicado junto, esses três são fé, não medição.

### 2.4 Aritmética interna do `uploaded_by` não fecha — **baixa**

§4.2, último parágrafo: *"25.153 de 29.871 arquivos (84,2%) ganham `uploaded_by`; 4.613 ficam com `NULL`"*.
29.871 − 25.153 = **4.718**, não 4.613 (diferença de 105). O percentual da §6.2 (*"NULL em 15,8%"*) confirma:
4.718/29.871 = 15,79%; 4.613/29.871 = 15,44%. Além disso o documento usa **três denominadores diferentes** para
"arquivos" — 29.871 (§4.2), 30.279 (§0/§8) e 30.915 (§8) — e `uploaded_by` é por **linha**, logo o
denominador certo seria o de linhas.

### 2.5 O teto de 16 slots: o número está errado, a conclusão sobrevive — **baixa**

§2.2 diz *"707 linhas têm exatamente 16 arquivos"*. Medido, com e sem dedup dentro da linha:

```
linhas com 16 url_N preenchidas (sem dedup): 763
linhas com 16 url_N DISTINTAS (com dedup):   763
```

São **763**, não 707. E das 763, **690 não têm a coluna `arquivos` preenchida**, ou seja, o excedente delas é
invisível neste export — a §2.2 dá a impressão de que o problema está cercado nos "56 registros" que
`arquivos` recupera. Checando só o que entra na carga, porém, o estrago é pequeno: no recorte corrente há 142
registros saturados, `pipelines.documentos` traz o excedente de 61 deles, e sobram **10** com excedente
potencialmente invisível. Vale corrigir o número e a frase; não vale mudar a estratégia.

### 2.6 Já coberto pela lente "schema" (não repito aqui)

`refutacao/documentos-schema.md` já trata: o segundo ramo de `cca_cases_sync_esteira_label` (§1 lá), o
`deal_documents_award_points` fora da lista de travas (2.1), o `alter table … disable trigger` que não roda
por `service_role`/PostgREST (2.2), as duas DDLs incompatíveis de `import_bubble_map` (2.3) e o `updated_at`
de `cca_cases` (2.4). Confirmei por `grep` os gatilhos citados lá e concordo com o recorte.

Acrescento só um ponto de integridade que aquele relatório não cobre: a PK de `import_bubble_map` guarda **um
`registro_id` por (entidade, bubble_id, tabela)**, mas um registro de `doc-clientes` gera **até 49 linhas** de
`deal_documents` (maior lista medida na coluna `arquivos`). O de-para nunca vai conseguir rastrear
`doc_cliente → deal_documents`; para essa tabela a rastreabilidade real é o `storage_path`, e só ela.

---

## 3. Respostas diretas às perguntas da lente

| pergunta | resposta | evidência |
|---|---|---|
| A ordem de carga respeita as FKs? | **Sim.** `document_types` e `cca_stages` antes das linhas que os referenciam; `deals` é pré-requisito declarado; `cca_stages.status` existe e o enum aceita `cancelled` | `0012:266-286`, `0001:74-82` |
| A chave de idempotência é única na origem? | **Sim, e é o ponto forte do mapa.** 32.587 f-ids para 32.587 URLs, 0 colisão, 0 colapso por `sanitize()`; `storage_path` é `unique` no banco e o `deal_id` é UUIDv5 determinístico | `a2_docs.py`; `0006:260`; `negocios.md:236` |
| O casamento por nome produz falso positivo? | **Sim, e mais do que o mapa declara**: 143 nomes / 289 linhas sob a `norm()` prescrita contra 123 / 249 publicados; 20 dessas ambiguidades são **criadas** pela `norm()`, atingindo 40 negócios | §1 |
| Produz perda silenciosa? | **Sim, em outro ponto**: 82 negócios ficam com 0 documento porque o "snapshot corrente" é um registro vazio — 673 arquivos | §2.2 |
| A soma bate? | **A do CCA bate exatamente** (7.568 = 3.979+1.454+1.256+476+290+94+19). A de documentos **não**: 30.279 objetos não comportam 30.915 caminhos, e 25.153+4.613 ≠ 29.871 | §2.1, §2.4 |
| Um reimport duplica algo? | **Em `deal_documents`, não** — `storage_path` é determinístico e `deal_id` é UUIDv5. Em `cca_cases`, o `on conflict do update` com status igual sai pelo *early return* de `cca_cases_sync_esteira_label` e não escreve nada | `0059:183-185`, `0007:219-221` |

---

## 4. O que falta provar antes de rodar

1. O script que produziu **30.279 / 30.915 / 636 / 4.520 / 171**. Nenhum desses cinco reproduziu a partir das
   regras escritas (§2.3). São os números que dimensionam upload, banda e a decisão D8.
2. Se o "snapshot corrente" é por **negócio** ou por **nome**. As duas leituras dão resultados diferentes nos
   143 nomes ambíguos e nos 87 registros correntes vazios.
3. Tamanho e `Content-Type` reais: continuam **não medidos** (o próprio mapa admite, §10.6 — 39 HEADs). O teto
   de 25 MB e a estimativa de 4,5 GB são extrapolação de amostra n=39.

---

## 5. Suposições declaradas

- Fuso `America/Sao_Paulo` nas datas (mesma suposição do mapa, §10.1). Nenhum achado meu depende dela: o
  desempate por janela de data (§4.1.3a) é interno ao mesmo fuso e desloca junto.
- "Recorte corrente" = registro de maior `Creation Date` por nome de pipeline. É a leitura literal de
  §2.2 ("também é o critério de snapshot corrente") + §8 ("snapshot corrente de `doc-clientes` por negócio").
  Ver pendência 2 da §4.
- Contei arquivo como a URL depois de `url_norm`, incluindo o que só existe na coluna `arquivos`.

---

## 6. Como reproduzir

Scripts no scratchpad da sessão (`…/2d71f16a-19ed-42bc-a96d-efa2d4b2d87c/scratchpad/`), todos com
`csv.DictReader` + `field_size_limit(50 MB)`:

| script | o que mede |
|---|---|
| `a1_cca.py` | 7.568 linhas, de-para de `STATUS2`, `decided_at` nunca nulo, ambiguidade de `CLIENTE` |
| `a2_docs.py` | ponteiro `doc` 2.857/2.857, órfãos por nome, **colisão de `f-id` e de `storage_path`** |
| `a3_overflow.py` | teto de 16 slots, ponteiro `doc` × registro mais recente |
| `a4_sim.py` | simulação completa dos 4 degraus do §4.1 |
| `a5.py` | `pipelines.documentos`, ambiguidade **cru × `norm()`**, saturação no recorte corrente |
| `a6.py` | órfãos e ambiguidade cru × `norm()` nas duas tabelas; colisões criadas pela `norm()` |
| `a7.py`, `a8.py` | volume da união e a perda dos 82 negócios / 673 arquivos |

Migrations conferidas por `grep`/`sed`: `0001:74-82` (enum `cca_status`), `0006:256-345` (DDL e gatilhos de
`deal_documents`), `0007:16-31` (`cca_cases` + constraint de decisão), `0012:266-290` (`cca_stages`),
`0037:39-67` (`deals_guard_esteira_label`), `0059:150-247` (`cca_cases_sync_esteira_label`),
`0010:29-53` (`deals_guard_closed_month`), `0028:54-79` (`deals_guard_document_review`),
`0060:290-345` (`deals_award_points`).
