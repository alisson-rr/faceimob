# Perfil — Documentos (doc-clientes + historicoPipes)

Export Bubble em `DOCUMENTOS/DADOS_BUBBLE`. Perfilado em 09/09/2026 com Python 3.12 (módulo `csv`, `field_size_limit` = 50 MB).
Todos os números deste relatório saem de contagens executadas sobre os arquivos; nenhum foi estimado, exceto os itens explicitamente marcados como **estimativa** (tamanho de download).

Scripts usados (temporários, fora do repo):
`…/scratchpad/perfil_docs.py`, `…/scratchpad/perfil_docs2.py` e blocos `python - <<PY` avulsos.

**Dados pessoais:** todos os exemplos abaixo estão mascarados. Nomes de clientes, nomes de arquivo com nome/CPF e trechos de URL que revelam identidade aparecem parcialmente ocultos. O caminho do CDN (`f<ts>x<rand>`) é mantido porque é opaco.

---

## 1. Arquivos do grupo

| Arquivo | Bytes | Linhas físicas (`wc -l`) | **Registros (parse CSV)** | Colunas |
|---|---:|---:|---:|---:|
| `export_All-doc-clientes-modified_2026-09-08_19-37-56.csv` | 26.281.714 | 25.891 | **25.890** | 23 |
| `export_All-doc-clientes_2026-09-08_19-37-42.csv` | 5.362.276 | 25.891 | **25.890** | 7 |
| `export_All-historicoPipes-modified_2026-09-08_19-39-27.csv` | 12.558.199 | 10.344 | **10.343** | 9 |

Nestes três arquivos `linhas físicas − 1 = registros`, ou seja **não há quebra de linha dentro de campo**. Isso é coincidência destes arquivos, não regra do export: continue usando parser CSV.

Headers exatos:

```
doc-clientes-modified: arquivos, pipeline, url_1, url_10, url_11, url_12, url_13, url_14,
                       url_15, url_16, url_2, url_3, url_4, url_5, url_6, url_7, url_8, url_9,
                       Creation Date, Modified Date, Slug, Creator, unique id
doc-clientes:          arquivos, pipeline, url_10, url_11, url_12, url_13, url_14
historicoPipes:        arquivos, ativo, nomesArquivos, pipeline,
                       Creation Date, Modified Date, Slug, Creator, unique id
```

> O header de `doc-clientes` **não está truncado no arquivo** — o CSV realmente só tem 7 colunas.
> O que houve foi um export parcial de colunas (o `url_1` … `url_9`, `url_15`, `url_16` e os campos de sistema simplesmente não foram selecionados). Verificado lendo o header completo e confirmando que toda linha tem exatamente 7 campos.

---

## 2. (a) Os dois `doc-clientes` são o mesmo dataset?

**Sim.** Mesmo dataset, mesma ordem de linhas, conjuntos de colunas diferentes.

Verificação executada (leitura pareada linha a linha, sem reordenar):

| Checagem | Resultado |
|---|---|
| Registros em cada arquivo | 25.890 e 25.890 |
| Colunas de `doc-clientes` que existem em `doc-clientes-modified` | 7 de 7 (subconjunto perfeito) |
| Linhas com `pipeline` idêntico na mesma posição | **25.890 / 25.890 (100%)** |
| Linhas com **todas** as 7 colunas comuns idênticas | **25.889 / 25.890 (99,996%)** |
| Colunas com divergência | apenas `arquivos`, em 1 linha |

A única divergência é a linha 25.863: em `doc-clientes` a coluna `arquivos` tem 4 URLs (489 caracteres) e em `doc-clientes-modified` está vazia. Os 4 arquivos são de um mesmo cliente (RG, CTPS, MO assinado, renda). Explicação mais provável: os dois exports foram gerados com 14 s de diferença (19:37:42 → 19:37:56) e o registro foi alterado no Bubble nesse intervalo. Consequência prática: nenhuma — é 1 registro em 25.890, e o mesmo conjunto de arquivos aparece nas colunas `url_N` de `doc-clientes-modified`.

Não é possível comparar por `unique id` porque `doc-clientes` **não exportou** essa coluna. A comparação foi feita por posição + igualdade de `pipeline` em 100% das linhas, o que é evidência suficiente de que a ordem é a mesma.

**Arquivo completo: `export_All-doc-clientes-modified_2026-09-08_19-37-56.csv`.** Ele contém tudo que o outro tem (exceto aquela linha), mais `url_1`…`url_9`, `url_15`, `url_16`, `Creation Date`, `Modified Date`, `Slug`, `Creator` e `unique id`.
**`export_All-doc-clientes_2026-09-08_19-37-42.csv` pode ser descartado da importação.**

---

## 3. (b) Contagem real de registros

* `doc-clientes-modified`: **25.890**
* `doc-clientes`: **25.890**
* `historicoPipes-modified`: **10.343**

---

## 4. Perfil coluna a coluna

### 4.1 `doc-clientes-modified` (25.890 registros)

| Coluna | Tipo observado | Preench. | Cardinalidade | Exemplo mascarado | Semântica | Referência |
|---|---|---:|---:|---|---|---|
| `arquivos` | lista de URLs separada por `" , "` (sem esquema, começa em `//`) | 8,65% (2.240) | 2.229 | `//0b42…cdn.bubble.io/f1726866705049x328…/1 - CNH .pdf , //0b42…/_Pro*****_Fac*****.pdf` | lista bruta dos anexos daquele registro | não é FK; cada item é URL de arquivo no CDN |
| `pipeline` | texto (nome do cliente) | 99,95% (25.878) | 5.639 | `M****** P****** P****` | negócio/pipeline ao qual o pacote de documentos pertence | **nome_exibicao → pipelines** (`pipelines.CLIENTE`), não é unique id |
| `url_1` | texto (URL ou sentinela `https:`) | 99,14% (25.668) — **URL real em 21.767 (84,1%)** | 4.888 | `https://0b42…/f1726755878368x586…/Ane** sem tít*** 00032.htm` | slot 1 de anexo | arquivo no CDN |
| `url_2` | idem | 99,14% — real 21.384 | 4.867 | `https://0b42…/f1726866705047x955…/_Pro*****_Fac*****.pdf` | slot 2 | arquivo |
| `url_3` | idem | 99,14% — real 20.301 | 4.695 | `https://0b42…/f1726755889361x848…/1 - CPF E R*.pdf` | slot 3 | arquivo |
| `url_4` | idem | 99,13% — real 18.274 | 4.236 | `https://0b42…/f1727467342919x760…/CIN*** XAV***.pdf` | slot 4 | arquivo |
| `url_5` | idem | 99,13% — real 15.808 | 3.676 | `https://0b42…/f1726755890511x394…/2 - CER**** .pdf` | slot 5 | arquivo |
| `url_6` | idem | 99,13% — real 12.918 | 3.020 | `https://0b42…/f1726755891484x979…/3 - COM**** DE RES*******.pdf` | slot 6 | arquivo |
| `url_7` | idem | 99,13% — real 10.129 | 2.369 | `//0b42…/f1728326116895x676…/PET***** DA SIL**.pdf` | slot 7 | arquivo |
| `url_8` | idem | 99,13% — real 7.822 | 1.817 | `https://0b42…/f1726755892747x492…/4 - CON**** .pdf` | slot 8 | arquivo |
| `url_9` | idem | 99,13% — real 5.999 | 1.385 | `https://0b42…/f1726755893035x425…/Ane** sem tít*** 00044.htm` | slot 9 | arquivo |
| `url_10` | idem | 99,12% — real 4.493 | 1.037 | `//0b42…/f1729212526711x148…/CAR** DE CAN*******.pdf` | slot 10 | arquivo |
| `url_11` | idem | 99,12% — real 3.364 | 752 | `https://0b42…/f1726755893916x809…/5 - CTP* DIG****.pdf` | slot 11 | arquivo |
| `url_12` | idem | 99,12% — real 2.446 | 565 | `https://0b42…/f1730396374106x971…/EXT**** SIM****.pdf` | slot 12 | arquivo |
| `url_13` | idem | 99,12% — real 1.784 | 406 | `https://0b42…/f1726755894967x581…/6 - EXT**** DE FGT*.pdf` | slot 13 | arquivo |
| `url_14` | idem | 99,12% — real 1.338 | 297 | `https://0b42…/f1730396375672x535…/sim****** s******.pdf` | slot 14 | arquivo |
| `url_15` | idem | 99,12% — real 1.011 | 236 | `https://0b42…/f1726755896450x358…/MO.pdf` | slot 15 | arquivo |
| `url_16` | idem | 99,12% — real 763 | 175 | `https://0b42…/f1733594643201x600…/iRN* Nil****.pdf` | slot 16 (**teto duro**) | arquivo |
| `Creation Date` | data en-US `%b %d, %Y %I:%M %p` | 100% | 23.726 | `Sep 18, 2024 6:24 pm` | criação do registro | — |
| `Modified Date` | idem | 100% | 23.060 | `Sep 24, 2024 11:18 am` | última alteração | — |
| `Slug` | texto | **0%** | 0 | (sempre vazio) | slug do Bubble, nunca usado | — |
| `Creator` | texto (nome de exibição) | 99,54% (25.770) | 148 | `D****** G****` | usuário que criou o registro | **nome_exibicao → Users** |
| `unique id` | id Bubble `<ms>x<rand>` (32 chars) | 100% | **25.890 (sem duplicata)** | `1726694698451x**********` | PK | **PK**; referenciada por `pipelines.doc` |

Notas de leitura:

* **O valor `https:` é sentinela de "sem arquivo".** As colunas `url_N` são o resultado de uma concatenação `"https:" & <arquivo>` no Bubble; quando o slot está vazio sobra literalmente a string `https:`. Contagem de sentinelas por coluna: `url_1` 3.901, `url_2` 4.283, `url_3` 5.366, `url_4` 7.392, `url_5` 9.858, `url_6` 12.748, `url_7` 15.536, `url_8` 17.843, `url_9` 19.666, `url_10` 21.170, `url_11` 22.297, `url_12` 23.215, `url_13` 23.877, `url_14` 24.323, `url_15` 24.650, `url_16` 24.898. **Qualquer importador precisa tratar `https:` como NULL.**
* `arquivos` só está preenchido em 8,65% das linhas. Quando está, é praticamente redundante com as `url_N`: em 2.184 das 2.240 linhas o conjunto de arquivos de `arquivos` é **igual** ao das `url_N`; em 56 linhas `arquivos` traz itens que não cabem nos 16 slots.
* 19.527 linhas têm `url_N` preenchida mas `arquivos` vazio. Ou seja: **a fonte primária de anexos em `doc-clientes` são as colunas `url_1..url_16`, não `arquivos`.**

### 4.2 `doc-clientes` (25.890 registros)

Colunas idênticas às homônimas de 4.1, com os mesmos números:

| Coluna | Preench. | Cardinalidade | Sentinela `https:` |
|---|---:|---:|---:|
| `arquivos` | 8,66% (2.241) | 2.230 | — |
| `pipeline` | 99,95% (25.878) | 5.639 | — |
| `url_10` | 99,12% (25.663) | 1.037 | 21.170 |
| `url_11` | 99,12% (25.661) | 752 | 22.297 |
| `url_12` | 99,12% (25.661) | 565 | 23.215 |
| `url_13` | 99,12% (25.661) | 406 | 23.877 |
| `url_14` | 99,12% (25.661) | 297 | 24.323 |

### 4.3 `historicoPipes-modified` (10.343 registros)

| Coluna | Tipo observado | Preench. | Cardinalidade | Exemplo mascarado | Semântica | Referência |
|---|---|---:|---:|---|---|---|
| `arquivos` | lista de URLs `" , "` (sempre `//`, sem esquema) | 97,75% (10.110) | 9.778 | `//0b42…/f1742409827021x132…/cnh gab****.pdf , //0b42…/com******** de res gab****.pdf` | snapshot completo da lista de anexos do pipeline naquele instante | itens = arquivos no CDN |
| `ativo` | texto sim/não do Bubble | 100% | **1** | `não` (10.343 de 10.343) | flag booleana; **sem variação no export** | — |
| `nomesArquivos` | lista de nomes `" , "` | 97,75% (10.110) | 9.364 | `cnh gab****.pdf , com******** de res gab****.pdf` | nomes originais, na mesma ordem de `arquivos` | — |
| `pipeline` | texto (nome do cliente) | 100% | 2.386 | `G****** DE L**** DE L***` | pipeline dono do snapshot | **nome_exibicao → pipelines** (`pipelines.CLIENTE`) |
| `Creation Date` | data en-US | 100% | 6.945 | `Apr 29, 2025 10:35 am` | quando o snapshot foi gravado | — |
| `Modified Date` | data en-US | 100% | 6.946 | `Apr 29, 2025 10:35 am` | igual a Creation em quase todos | — |
| `Slug` | texto | **0%** | 0 | (vazio) | não usado | — |
| `Creator` | texto (nome de exibição) | 100% | 111 | `M******* V*****` | quem salvou o pipeline | **nome_exibicao → Users** |
| `unique id` | id Bubble | 100% | **10.343 (sem duplicata)** | `1745933754716x**********` | PK | **PK**; não é referenciada por nenhuma coluna de `pipelines` |

Distribuição de `ativo` (completa, 1 valor distinto):

| valor | linhas | % |
|---|---:|---:|
| `não` | 10.343 | 100,0% |

### 4.4 Janelas de data (fuso não declarado — tratado como America/Sao_Paulo, **suposição**)

| Arquivo | Campo | Mínimo | Máximo | Falhas de parse |
|---|---|---|---|---:|
| doc-clientes-modified | Creation Date | 2024-09-18 18:24 | 2026-09-08 16:31 | 0 |
| doc-clientes-modified | Modified Date | 2024-09-18 20:12 | 2026-09-08 16:39 | 0 |
| historicoPipes | Creation Date | 2025-04-29 10:35 | 2026-09-08 16:08 | 0 |
| historicoPipes | Modified Date | 2025-04-29 10:35 | 2026-09-08 16:08 | 0 |

`historicoPipes` começa 7 meses depois de `doc-clientes` — o mecanismo de snapshot foi ligado em 29/04/2025.

---

## 5. (c) URLs, CDN e formato

**Formato observado (100% das ocorrências):**

```
[https:]//0b42dac624c17cda9446e55d45fcfe83.cdn.bubble.io/f<epoch_ms>x<rand19>/<nome-do-arquivo-percent-encoded>
```

Exemplo mascarado: `//0b42dac624c17cda9446e55d45fcfe83.cdn.bubble.io/f1745505753590x930992480000151700/EXT**** FGT* - NIC**** AMA***.pdf`

| Métrica | Valor |
|---|---:|
| Host distinto | **1** — `0b42dac624c17cda9446e55d45fcfe83.cdn.bubble.io` (60.021 de 60.021 ocorrências) |
| Strings de URL distintas, doc-clientes-modified | 47.329 |
| Strings de URL distintas, historicoPipes | 21.667 |
| União das strings distintas | 60.021 |
| Com esquema `https:` | 32.362 |
| Sem esquema (começa em `//`) | 27.659 |
| **Arquivos distintos após normalizar o esquema** (`https://X` ≡ `//X`) | **34.457** |
| — só em doc-clientes | 32.587 |
| — só em historicoPipes | 21.667 |
| — em ambos | 19.797 |
| — em historicoPipes e **não** em doc-clientes | 1.870 |

**A normalização do esquema é obrigatória**: sem ela você conta 60.021 "URLs" e importa quase o dobro de arquivos. O identificador estável do arquivo é o caminho `f<epoch_ms>x<rand>/<nome>`.

Para referência de escopo (fora deste grupo, mas relevante): `pipelines.documentos` traz 29.447 arquivos distintos, dos quais apenas **70** não aparecem em doc-clientes nem em historicoPipes. A união dos três é **34.527**.

---

## 6. (d) As URLs são públicas?

**Sim, são públicas e sem autenticação.** Teste executado com `curl -I` (somente cabeçalhos, corpo não baixado):

```
URL: https://0b42dac624c17cda9446e55d45fcfe83.cdn.bubble.io/f1726755891484x979659039014787500/3%20-%20COMPROVANTE%20DE%20RESIDENCIA.pdf

HTTP/1.1 200 OK
Content-Type: application/pdf
Content-Length: 14818
Last-Modified: Thu, 19 Sep 2024 14:24:52 GMT
Cache-Control: public,max-age=86400
Server: cloudflare
x-amz-server-side-encryption: AES256
x-amz-meta-appname: faceimobapp
x-amz-meta-app-version: live
Accept-Ranges: bytes
Content-Security-Policy: script-src 'none'
```

* **HTTP status: 200.** **Content-Type: `application/pdf`.**
* Sem `WWW-Authenticate`, sem cookie, sem token na querystring — a URL sozinha entrega o arquivo.
* Infra: S3 (cabeçalhos `x-amz-*`) atrás de Cloudflare. `Accept-Ranges: bytes` permite download paralelo/retomada.

Amostra ampliada, ainda **só HEAD**, 39 URLs sorteadas aleatoriamente (seed 42) do universo de 34.457: **39/39 responderam 200**. Content-Types observados: `application/pdf` (32), `image/jpeg` (5), `image/png` (1), `text/plain` (1).

**Risco de segurança a registrar:** qualquer pessoa com a URL lê o documento — inclusive CPF, RG, holerite e extrato bancário de clientes. As URLs estão em texto claro dentro dos CSVs do export. Consequência de migrar mantendo os links: o vazamento continua ativo e fora do controle do RLS do Supabase. Consequência de baixar e reenviar para o Storage do Supabase com bucket privado: o acesso passa a ser governado por RLS/URL assinada, ao custo do download (item 7).

---

## 7. (e) Volume estimado de download

### 7.1 Quantidade

| Universo | Arquivos distintos |
|---|---:|
| doc-clientes + historicoPipes (o grupo deste relatório) | **34.457** |
| Só o snapshot mais recente por pipeline em doc-clientes | 29.263 |
| Só o snapshot mais recente por pipeline + `pipelines.documentos` | 29.721 |
| Todos os três (incluindo `pipelines.documentos`) | 34.527 |

Ocorrências (vínculo arquivo × registro, deduplicadas dentro da linha): **149.863** em doc-clientes e **73.197** em historicoPipes, total **223.060** — a maior parte é repetição do mesmo arquivo em snapshots sucessivos. Só as colunas `url_1..url_16` somam 149.601 valores reais.

### 7.2 Extensões — distribuição completa (24 valores distintos, sobre os 34.457 arquivos)

| Extensão | Arquivos | % |
|---|---:|---:|
| pdf | 28.237 | 81,95% |
| jpeg | 4.016 | 11,66% |
| jpg | 1.503 | 4,36% |
| xlsx | 247 | 0,72% |
| png | 169 | 0,49% |
| xls | 128 | 0,37% |
| jfif | 54 | 0,16% |
| docx | 17 | 0,05% |
| html | 16 | 0,05% |
| zip | 12 | 0,03% |
| mht | 11 | 0,03% |
| txt | 9 | 0,03% |
| htm | 8 | 0,02% |
| (sem extensão) | 8 | 0,02% |
| rar | 6 | 0,02% |
| doc | 4 | 0,01% |
| **exe** | **3** | 0,01% |
| ods | 2 | 0,01% |
| csv | 2 | 0,01% |
| heic | 1 | <0,01% |
| ctfb | 1 | <0,01% |
| json | 1 | <0,01% |
| sig | 1 | <0,01% |
| enc | 1 | <0,01% |

98,0% é PDF ou imagem. Os 3 `.exe`, 18 compactados (`zip`/`rar`) e os `.enc`/`.ctfb`/`.sig` precisam de tratamento à parte (ver problemas de qualidade).

### 7.3 Tamanho — **estimativa** a partir de amostra HEAD (n=39)

| Estatística | Bytes | Legível |
|---|---:|---|
| mínimo | 2.717 | 2,7 KB |
| p25 | 97.648 | 95 KB |
| **mediana** | **149.559** | **146 KB** |
| p75 | 310.409 | 303 KB |
| média | 616.215 | 602 KB |
| máximo | 13.305.984 | 12,7 MB |
| soma da amostra | 24.032.388 | 22,9 MB |

Projeção para 34.457 arquivos:

| Base | Estimativa |
|---|---|
| mediana × 34.457 | **≈ 4,8 GB** |
| média sem o outlier de 12,7 MB × 34.457 | **≈ 9,1 GB** |
| média cheia × 34.457 | **≈ 19,8 GB** |

**Faixa a planejar: 5 GB a 20 GB, com melhor palpite ~9–10 GB.** A amostra de 39 é pequena e a cauda é longa (um único arquivo respondeu por 55% da soma da amostra), então a média cheia é instável. Se o número exato importar, rode HEAD em todas as 34.457 URLs (é barato: só cabeçalho, e o CDN aceita paralelismo) e some `Content-Length` — foi o método usado aqui, apenas com amostra menor.

---

## 8. (f) `arquivos` vs `nomesArquivos` — o nome original sobrevive?

**Sim, o nome original está preservado nos dois lugares, e são redundantes entre si.**

O último segmento da URL é o nome original do arquivo, percent-encoded. `nomesArquivos` (que só existe em `historicoPipes`) é exatamente esse nome, decodificado.

| Checagem | Resultado |
|---|---:|
| Pares (URL, nome) comparáveis em historicoPipes | 65.323 |
| `basename(url) == nomesArquivos[i]` | **65.294 (99,96%)** |
| Diferentes | 29 |

As 29 diferenças são cosméticas: espaço à esquerda no basename, ou caracteres de isolamento bidirecional Unicode (U+2068/U+2069) que o iOS insere. Exemplos mascarados: `" Cni* Dud* .pdf"` vs `"Cni* Dud* .pdf"`; `" ⁨28-08-2025 10.50⁩.pdf"` vs `"⁨28-08-2025 10.50⁩.pdf"`.

**Consequência:** `doc-clientes` não tem `nomesArquivos`, mas não precisa — o nome original se extrai do basename da URL com `urllib.parse.unquote`. O mesmo vale para `pipelines.documentos`.

**Armadilha do separador:** em 653 das 10.343 linhas de `historicoPipes`, `len(arquivos) != len(nomesArquivos)`. A causa é o separador `" , "`: alguns nomes originais contêm vírgula (ex.: `Carteira de identidade Kal***,.pdf`), e ao juntar em `nomesArquivos` a lista fica ambígua. `arquivos` sofre menos porque a URL vem percent-encoded (a vírgula do nome vira `%2C` em parte dos casos, mas não em todos). **Regra prática: use `arquivos` como fonte da lista e derive o nome do basename; não confie no split de `nomesArquivos`.**

### 8.1 Tipo de documento inferido pelo nome

Sim, dá para inferir. Classificador de 31 regras por regex sobre o basename decodificado (case-insensitive, `_` e `-` normalizados para espaço), avaliado na ordem da tabela — a primeira regra que casa vence.

**Distribuição sobre os 34.457 arquivos distintos (união doc-clientes + historicoPipes) — completa, 31 categorias:**

| Tipo inferido | Arquivos | % |
|---|---:|---:|
| Print/foto/scan sem nome útil | 3.670 | 10,7% |
| **Não identificado** | 3.522 | 10,2% |
| Comprovante de residência | 3.205 | 9,3% |
| CTPS / carteira de trabalho | 3.105 | 9,0% |
| RG / identidade | 3.015 | 8,8% |
| Extrato bancário | 2.515 | 7,3% |
| Certidão (nascimento/casamento/estado civil) | 2.015 | 5,8% |
| CCH | 2.002 | 5,8% |
| Holerite / contracheque (inclui eSocial) | 1.958 | 5,7% |
| CNH | 1.511 | 4,4% |
| Comprovação de renda | 1.293 | 3,8% |
| Extrato FGTS | 1.101 | 3,2% |
| Carta de cancelamento | 886 | 2,6% |
| IRPF / imposto de renda | 742 | 2,2% |
| Caixa — avaliação de risco / Caixa Aqui | 690 | 2,0% |
| Fatura / conta de consumo | 588 | 1,7% |
| Comprovante de pagamento / PIX | 496 | 1,4% |
| Proposta / simulação | 351 | 1,0% |
| MO (documento Caixa) | 313 | 0,9% |
| Porta de Entrada (programa habitacional) | 309 | 0,9% |
| Documento de dependente | 290 | 0,8% |
| Declaração (genérica) | 147 | 0,4% |
| CPF | 144 | 0,4% |
| SCR / Bacen | 137 | 0,4% |
| PIS | 113 | 0,3% |
| Ficha / cadastro / formulário | 107 | 0,3% |
| INSS / CNIS / benefício | 71 | 0,2% |
| Caixa — Portal de Negócios Habitação | 65 | 0,2% |
| Contrato / escritura | 57 | 0,2% |
| Matrícula do imóvel | 20 | 0,1% |
| CNPJ | 19 | 0,1% |

**Cobertura: 89,8% classificado, 10,2% não identificado** (mais 10,7% que são identificáveis apenas como "print/scan sem nome útil", que na prática também não dizem o tipo).

**Distribuição sobre as 72.229 ocorrências de `historicoPipes.nomesArquivos`** (mesmo classificador, contando repetições — útil para dimensionar a frequência real de cada tipo no dia a dia):

| Tipo inferido | Ocorrências | % |
|---|---:|---:|
| Print/foto/scan sem nome útil | 7.193 | 10,0% |
| Não identificado | 6.942 | 9,6% |
| CTPS / carteira de trabalho | 6.818 | 9,4% |
| RG / identidade | 6.245 | 8,6% |
| Comprovante de residência | 6.149 | 8,5% |
| Extrato bancário | 6.087 | 8,4% |
| Certidão | 4.609 | 6,4% |
| Holerite / contracheque | 4.139 | 5,7% |
| CCH | 3.577 | 5,0% |
| CNH | 3.075 | 4,3% |
| Comprovação de renda | 2.708 | 3,7% |
| Extrato FGTS | 2.321 | 3,2% |
| IRPF | 1.930 | 2,7% |
| Caixa — avaliação de risco | 1.914 | 2,6% |
| Carta de cancelamento | 1.849 | 2,6% |
| Fatura / conta de consumo | 1.140 | 1,6% |
| Comprovante de pagamento / PIX | 1.110 | 1,5% |
| Documento de dependente | 628 | 0,9% |
| Proposta / simulação | 603 | 0,8% |
| Porta de Entrada | 587 | 0,8% |
| MO (documento Caixa) | 556 | 0,8% |
| SCR / Bacen | 468 | 0,6% |
| Declaração | 359 | 0,5% |
| CPF | 287 | 0,4% |
| PIS | 262 | 0,4% |
| Ficha / cadastro | 247 | 0,3% |
| Caixa — Portal de Negócios Habitação | 123 | 0,2% |
| INSS / CNIS | 116 | 0,2% |
| Contrato / escritura | 95 | 0,1% |
| CNPJ | 60 | 0,1% |
| Matrícula do imóvel | 32 | <0,1% |

Exemplos mascarados por categoria (para calibrar as regras):

* Extrato FGTS: `EXT**** FGT*.pdf`, `Rel***ório Ext**** FGT*_8-7-2026pdf (5).pdf`, `historico-creditos.pdf`
* CTPS: `5 - CTP* DIG****.pdf`, `AND**** CAS*** - CTP* DIG****.pdf`
* CCH: `cch.pdf` (86×), `cchs.pdf` (45×), `cch abril.pdf` (35×), `cch jan.pdf` (27×) — documento **mensal**; é o mesmo termo que já existe no schema alvo como `deal_clients.cch_reference`
* Holerite: `Rec*** de Pag****** 05 2026.pdf`, `esocial_demonstrativo_recibo_agosto_2025.pdf`
* Caixa: `caixa aqui - avaliação de risco.pdf` (332×), `portal de negócios da habitação.pdf` (32×), `porta de entrada.pdf` (60×), `mo.pdf` (90×), `tela bacen.png`
* Não identificado (top do resíduo): nomes só com o mês (`abril.pdf` 13×, `março.pdf` 13×), `aprovado condicionado.png` (11×), `analise ativa.png` (9×), `fator social.pdf`, `moradia compartilhada.pdf`, `cr.pdf`

**Ressalvas do classificador** (registre antes de usar isso para preencher `document_types`):
1. É heurística de nome de arquivo. Não foi validada contra o conteúdo dos PDFs. Estimo acerto alto para RG/CNH/CTPS/FGTS/CCH (nomes muito padronizados) e baixo para "extrato bancário" vs "comprovante de renda" (nomes se sobrepõem).
2. A ordem das regras importa. Ex.: `CTPS_CONTRATO_DE_TRABALHO_601.***.***-08.pdf` cai em CTPS, não em Contrato — o que é o desejado, mas só porque CTPS vem antes.
3. `MO` é sigla de documento da Caixa que não consegui resolver a partir dos dados (aparece como `mo.pdf`, `mo assinado.pdf`, `mo43112-1_2_assinado.pdf`). Precisa de confirmação com a operação.
4. "Print/foto/scan sem nome útil" não é um tipo de documento — é a ausência de informação no nome (`Imagem do WhatsApp de 2025-10-23…jpg`, `CamScanner…`, `ilovepdf_merged.pdf`, `Impressao_20260722140305.pdf`).

---

## 9. (g) `historicoPipes` é versão anterior de documento? O que é `ativo`?

### 9.1 Não é versionamento de documento — é snapshot da lista de anexos

Cada linha de `historicoPipes` guarda **a lista inteira de anexos do pipeline naquele instante**, não um arquivo substituído.

Evidência:

| Métrica | Valor |
|---|---:|
| Registros | 10.343 |
| Pipelines distintos | 2.386 |
| Registros por pipeline | 1 a **42** |
| Pares consecutivos (mesmo pipeline, ordenados por Creation Date) | 7.957 |
| Pares em que o conjunto **cresceu ou ficou igual** | 5.087 (63,9%) |
| Pares em que o snapshot novo é **superconjunto** do anterior | 4.610 (57,9%) |
| Linhas sem nenhum arquivo | 233 |
| Arquivos por linha | 0 a 49 (mediana entre 5 e 6) |

Distribuição de snapshots por pipeline (top 15 de 2.386):

| snapshots | pipelines |
|---:|---:|
| 1 | 787 |
| 2 | 407 |
| 3 | 250 |
| 4 | 174 |
| 5 | 144 |
| 6 | 123 |
| 7 | 101 |
| 8 | 75 |
| 9 | 63 |
| 10 | 44 |
| 11 | 40 |
| 12 | 35 |
| 14 | 22 |
| 13 | 18 |
| 15 | 18 |

O padrão dos exemplos confirma: a linha 1 de um pipeline tem `cnh.pdf, comprovante de residência.pdf`; a linha 2, minutos depois, tem os mesmos dois **mais** `extrato…pdf, contracheques.pdf, fatura…pdf`. É append de anexos, gravando a lista completa a cada salvamento.

Os 36% de pares que **não** crescem correspondem a remoções de anexo (o corretor tirou um arquivo errado) e a reordenações — ou seja, o histórico permite reconstruir remoções, mas não é isso que ele foi feito para guardar.

### 9.2 `doc-clientes` tem o mesmo comportamento

Isso é importante e não estava no enunciado: **`doc-clientes` também é um log append-only**, não uma tabela de 1 linha por pipeline.

| Métrica | Valor |
|---|---:|
| Registros | 25.890 |
| Pipelines distintos | 5.639 (mais 12 linhas com pipeline vazio) |
| Registros por pipeline | 1 a **46** |
| Pipelines com mais de 1 registro | 5.038 |
| Pares consecutivos por pipeline | 20.239 |
| Pares que cresceram ou ficaram iguais | 19.831 (**98,0%**) |
| Pares em que o novo é superconjunto do anterior | 16.296 (80,5%) |

E há um ponteiro para o registro "corrente": a coluna `doc` de `pipelines` é um **unique id**, preenchida em 2.857 das 7.568 linhas, e **2.857 de 2.857 (100%) resolvem para `doc-clientes.unique id`** — nenhuma para `historicoPipes`. Em **2.819 de 2.857 (98,7%)** o registro apontado é o de `Creation Date` mais recente daquele pipeline.

Leitura de negócio: `doc-clientes` é a caixa de anexos do pipeline (gravada a cada save, acumulando), `pipelines.doc` aponta para a versão corrente, `pipelines.documentos` guarda a lista atual denormalizada, e `historicoPipes` é uma segunda trilha de auditoria ligada em 29/04/2025.

### 9.3 `ativo`

**Cardinalidade 1: `não` em 10.343 de 10.343 linhas (100%).**

Não há como inferir a semântica pelos dados — o campo não varia. Duas hipóteses, nenhuma confirmável com este export:
* é a flag "este snapshot é o corrente?" e nenhum snapshot foi marcado como corrente (o corrente vive em `pipelines.documentos`);
* é um yes/no do Bubble com default `no` que a aplicação nunca escreveu.

**Recomendação: não importar `ativo`.** Ele não carrega informação. Se a operação disser que a flag importava, o dado dela se perdeu no export e teria de vir de outra fonte.

---

## 10. (h) Quantos pipelines distintos têm documento

| Fonte | Pipelines (nome) com ≥1 arquivo |
|---|---:|
| `doc-clientes-modified` | **4.398** |
| `historicoPipes` | **2.386** (todos os que aparecem no arquivo) |
| União dos dois | **4.425** |
| — só em historicoPipes, sem arquivo em doc-clientes | 27 |
| `pipelines.documentos` (referência externa) | 4.314 |
| — fora da união acima | 22 |

Denominador: `pipelines` tem 7.568 registros e 7.426 valores distintos de `CLIENTE` (16 vazios). Logo **≈ 59,6% dos pipelines têm ao menos um documento anexado** (4.425 / 7.426).

Do outro lado: em `doc-clientes-modified`, 5.639 nomes de pipeline aparecem mas só 4.398 têm arquivo — **1.241 pipelines geraram registro de documento vazio**. No nível de linha, **4.123 das 25.890 linhas (15,9%) não têm nenhum arquivo**.

Todos os 4.425 nomes de pipeline vindos de doc-clientes/historicoPipes existem em `pipelines.CLIENTE` (0 órfãos por nome).

---

## 11. Relacionamentos

```
pipelines.doc  ──(unique id, 2.857/2.857 resolvem)──▶  doc-clientes.unique id
pipelines.CLIENTE  ◀──(nome de exibição)──  doc-clientes.pipeline      (25.878 linhas)
pipelines.CLIENTE  ◀──(nome de exibição)──  historicoPipes.pipeline    (10.343 linhas)
Users (nome de exibição)  ◀──  doc-clientes.Creator   (148 distintos, 120 linhas vazias)
Users (nome de exibição)  ◀──  historicoPipes.Creator (111 distintos, 0 vazias)
historicoPipes.unique id  ──▶  (não referenciado por nenhuma coluna de pipelines)
doc-clientes.arquivos / url_1..16  ──▶  arquivos no CDN Bubble (URL pública)
historicoPipes.arquivos           ──▶  arquivos no CDN Bubble (URL pública)
pipelines.documentos              ──▶  arquivos no CDN Bubble (lista corrente, denormalizada)
```

**Formato das referências, coluna a coluna:**

| Coluna | Formato | Resolve para |
|---|---|---|
| `doc-clientes.pipeline` | **nome de exibição** (texto) | `pipelines.CLIENTE` |
| `doc-clientes.Creator` | **nome de exibição** (texto) | Users |
| `doc-clientes.unique id` | **unique id** | PK, alvo de `pipelines.doc` |
| `historicoPipes.pipeline` | **nome de exibição** (texto) | `pipelines.CLIENTE` |
| `historicoPipes.Creator` | **nome de exibição** (texto) | Users |
| `historicoPipes.unique id` | **unique id** | PK, sem referência entrante |

**Ambiguidade do join por nome:** 123 valores de `CLIENTE` aparecem em mais de um pipeline (249 linhas de `pipelines`, máximo 3 pipelines com o mesmo nome). Para esses, `pipeline` como texto não identifica o negócio.

Estratégia de resolução, em ordem de confiança:
1. `pipelines.doc` → `doc-clientes.unique id` (exato, cobre 2.857 pipelines).
2. Nome + janela de data (`doc-clientes.Creation Date` dentro do intervalo de vida do pipeline).
3. Nome + interseção de arquivos com `pipelines.documentos`.
4. Sobra: 123 nomes ambíguos a resolver manualmente ou a descartar.

---

## 12. Problemas de qualidade

1. **Sentinela `https:` em `url_1..url_16`** — 3.901 a 24.898 ocorrências por coluna, 261.023 no total. Precisa virar NULL. Um importador ingênuo criaria 261 mil "documentos" com URL inválida.
2. **Mesmo arquivo com dois esquemas** (`https://X` e `//X`). Sem normalizar, 60.021 strings distintas viram 34.457 arquivos reais — inflação de 74%.
3. **Separador `" , "` ambíguo** — 653 linhas de `historicoPipes` com contagem divergente entre `arquivos` e `nomesArquivos`, causada por vírgula dentro do nome do arquivo.
4. **`pipeline` é texto, não id** — 123 nomes de cliente pertencem a mais de um pipeline; join por nome é ambíguo nesses casos.
5. **Teto duro de 16 slots** em `url_N`. 707 linhas de `doc-clientes` têm exatamente 16 arquivos — candidatas a truncamento silencioso. A recuperação depende de `arquivos` (só 8,65% preenchido) ou de `pipelines.documentos`. Distribuição de arquivos por linha: 0→4.123, 1→383, 2→1.083, 3→2.027, 4→2.466, 5→2.890, 6→2.789, 7→2.307, 8→1.823, 9→1.506, 10→1.129, 11→918, 12→662, 13→446, 14→327, 15→248, **16→707**, 17+→53 (máximo 49).
6. **`ativo` sem variação** (100% `não`) — inútil.
7. **`Slug` 100% vazio** nos dois arquivos.
8. **`Creator` vazio em 120 linhas** de `doc-clientes` (0,46%).
9. **`pipeline` vazio em 12 linhas** de `doc-clientes` — documentos órfãos, sem como ligar a um negócio.
10. **4.123 linhas de `doc-clientes` e 233 de `historicoPipes` sem nenhum arquivo** — 4.356 de 36.233 registros (12,0%) são vazios.
11. **Duplicação massiva por snapshot**: 149.863 + 73.197 = 223.060 vínculos arquivo×registro para 34.457 arquivos reais (fator **6,5×**).
12. **Dados pessoais no nome do arquivo** — nome completo do cliente é a norma, e **1.251 arquivos (3,6%) têm CPF formatado no nome** (`\d{3}\.\d{3}\.\d{3}-\d{2}`), mais **672 (2,0%) com 11 dígitos isolados** (CPF provável) — 1.923 no total, 5,6% do acervo. Exemplos mascarados: `CTPS_…_601.***.***-08_30-07-2025.pdf`, `039***56045-IRPF-A-2025-2024-REC.pdf`. Se o `original_name` for exposto em UI ou log, isso vaza CPF.
13. **URLs públicas sem autenticação** (seção 6). Migrar mantendo os links preserva o vazamento.
14. **Extensões de risco**: 3 `.exe`, 12 `.zip`, 6 `.rar`, 1 `.enc`, 1 `.ctfb`, 1 `.sig`. Executável anexado a documento de cliente é anomalia — inspecionar antes de qualquer upload para o Storage, e provavelmente descartar.
15. **35 arquivos `.htm`/`.html`/`.mht`** — anexos de e-mail salvos pelo Outlook (`Anexo sem título 00032.htm`). Sem valor documental.
16. **Fuso horário não declarado** nos campos de data. Assumido America/Sao_Paulo. Se estiver errado, todas as datas deslocam em 3 h — o que importa para ordenar snapshots do mesmo dia.
17. **1 divergência entre os dois exports de `doc-clientes`** (linha 25.863), causada por edição concorrente durante o export.
18. **8 arquivos sem extensão** no nome — o `mime_type` terá de vir do `Content-Type` da resposta HTTP, não do nome.

---

## 13. Volume relevante para importar

**Registros:** dos 25.890 de `doc-clientes`, o que tem valor de negócio são os **4.398 registros "mais recentes por pipeline com arquivo"**. Os outros ~21,5 mil são estados intermediários do mesmo pacote de anexos (98% dos pares consecutivos apenas acrescentam arquivos). Os 10.343 de `historicoPipes` são a mesma coisa, em outra trilha e cobrindo apenas 2.386 pipelines a partir de abr/2025.

**Arquivos:** o universo real é **34.457 arquivos distintos**, mas:

| Estratégia | Arquivos | Download estimado (mediana) |
|---|---:|---:|
| Tudo (doc-clientes + historicoPipes) | 34.457 | ~4,8 GB (faixa 5–20 GB) |
| Só o snapshot mais recente por pipeline | 29.263 | ~4,1 GB |
| Snapshot mais recente + `pipelines.documentos` | 29.721 | ~4,2 GB |

A economia de descartar o histórico é de apenas **15%** dos arquivos (5.194 arquivos), porque os snapshots repetem os mesmos arquivos em vez de gerar novos. **O histórico é barato de trazer em bytes e caro de trazer em linhas.**

**Recomendação (consequências de cada caminho):**

* **Importar só o pacote corrente** — 4.398 pipelines, ~29,3 mil arquivos, ~4 GB. Consequência: perde-se a linha do tempo de quem anexou o quê e quando; ganha-se um modelo limpo, 1 documento = 1 linha em `deal_documents`, e `version`/`superseded_at` do schema alvo ficam livres para o uso futuro.
* **Importar corrente + histórico como eventos** — mesmos ~29,3 mil arquivos no Storage, mais 10.343 linhas em `deal_history` (kind = `documents_snapshot`, detail com a lista). Consequência: preserva auditoria a custo de armazenamento quase zero (nenhum arquivo extra), sem poluir `deal_documents`.
* **Importar tudo como documentos versionados** — 34.457 arquivos e 223.060 vínculos. Consequência: `deal_documents` fica com fator 6,5× de duplicação e a UI de documentos do negócio vira inutilizável. Não recomendo.

**Lixo a descartar antes de qualquer download:** 4.123 + 233 registros sem arquivo, 12 registros com pipeline vazio, 35 arquivos `.htm/.html/.mht`, 3 `.exe`, 18 compactados a inspecionar, e o arquivo `export_All-doc-clientes_2026-09-08_19-37-42.csv` inteiro (redundante).

---

## 14. Contexto do schema alvo

Só para situar o próximo agente — **este relatório não faz o mapeamento**.

O destino natural do grupo, em `docs/importacao/SCHEMA_ALVO.md`:

* `deal_documents(id, deal_id, document_type_id, storage_path, original_name, stored_name, mime_type, size_bytes, version, superseded_at, superseded_by, uploaded_by, created_at)` — recebe os arquivos. `original_name` sai do basename decodificado; `mime_type` e `size_bytes` saem dos cabeçalhos HTTP do download; `uploaded_by` sai de `Creator` (nome de exibição → profile); `created_at` sai de `Creation Date`.
* `document_types(code, label, category, required_for_conversion, allows_multiple, naming_pattern, sort_order, active)` — hoje o banco remoto tem **9** tipos de documento. A inferência da seção 8.1 aponta ~20 tipos com volume relevante (CCH, Carta de cancelamento, Caixa/avaliação de risco, Porta de Entrada, MO, SCR/Bacen, PIS não estão entre os 9 atuais). Decidir se o catálogo cresce ou se o excedente vira um tipo genérico é decisão de produto, não de importação.
* `deal_history(deal_id, actor_id, kind, from_value, to_value, detail jsonb, created_at)` — destino natural dos 10.343 snapshots de `historicoPipes` se a opção for preservar auditoria.
* `deals` — o `pipeline` (texto) precisa resolver para `deals.id`; o caminho confiável é `pipelines.doc` → `doc-clientes.unique id`, conforme seção 11.

O Storage do Supabase deve receber os arquivos em **bucket privado com RLS**, encerrando a exposição pública descrita na seção 6.

---

## 15. O que não foi respondido

Nada do enunciado ficou sem resposta. Ressalvas de precisão, explicitadas onde ocorrem:

* **Tamanho total de download** é estimativa por amostra de 39 HEADs (seção 7.3), não medição completa. Método para fechar o número exato está descrito lá.
* **Tipo de documento** é inferência por nome de arquivo, não por conteúdo (seção 8.1, ressalvas 1–4).
* **Semântica de `ativo`** não é derivável dos dados (cardinalidade 1); as duas hipóteses estão na seção 9.3 e precisam de confirmação com a operação.
* **Sigla `MO`** (313 arquivos) não foi resolvida.
* **Fuso horário** das datas é suposição declarada.
