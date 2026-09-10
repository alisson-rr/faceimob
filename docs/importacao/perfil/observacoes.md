# Perfil — `observacaoPipelines` + `ligacoes` (export Bubble)

**Data do perfil:** 09/09/2026 · **Fase:** somente leitura de arquivo, nada rodou contra o banco.
**Método:** `python` 3.12 + módulo `csv` em streaming (`csv.DictReader`), `csv.field_size_limit(10**9)`.
Scripts em `…/scratchpad/perfil_obs.py`, `perfil_obs2.py`, `perfil_obs3.py`, `perfil_obs4.py`, `perfil_lig.py`, `perfil_final.py`.
**Todos os números abaixo saíram de um comando executado.** Nenhum foi estimado.

**Mascaramento aplicado:** nomes de pessoa viram `Primeiro I***`; telefones viram `51 *****62`; sequências de 6+ dígitos dentro do texto livre viram `12****89`. Nenhum CPF, PIS, telefone completo ou senha aparece neste arquivo.

---

## 0. Contexto no schema alvo

Lendo `docs/importacao/SCHEMA_ALVO.md`, os destinos plausíveis (mapeamento **não** decidido aqui):

| Origem Bubble | Candidatos no schema alvo |
|---|---|
| `observacaoPipelines` (comentário livre) | `deal_history(deal_id, actor_id, kind, from_value, to_value, detail jsonb, created_at)` · `lead_comments(lead_id, author_id, body)` |
| `observacaoPipelines` com prefixo `STATUS:` (retorno do CCA) | `cca_case_events(case_id, actor_id, kind, from_value, to_value, detail)` — o vocabulário bate com `cca_status` |
| `ligacoes` | `lead_events(lead_id, actor_id, kind='call', detail)` — **não existe tabela de ligações**; o outro destino possível é o contador `daily_entries.calls` |

Observação relevante: `deal_history` **não tem campo de texto livre** — só `kind`, `from_value`, `to_value` e `detail jsonb`. Se a decisão for preservar o texto, ele cabe em `detail` ou é preciso outra tabela. Isso é decisão do agente de mapeamento; o dado abaixo é o que decide.

---

# PARTE 1 — `export_All-observacaoPipelines-modified_2026-09-08_19-43-41.csv`

Tamanho em disco: 6.709.333 bytes.

## 1.1 Contagem real de registros

| Métrica | Valor |
|---|---|
| **Registros (parse CSV)** | **24.766** |
| Colunas | 8 |
| `unique id` distintos | 24.766 (**zero duplicata**) |
| Linhas com quebra de linha dentro do texto | 13.063 (52,7%) — `wc -l` daria número errado |

## 1.2 Perfil coluna a coluna

| Coluna | Tipo observado | Preench. | Cardinalidade | Exemplos (mascarados) | Semântica | Referência? |
|---|---|---|---|---|---|---|
| `data` | data en-US, quase sempre `12:00 am` | 100,00% | 5.869 | `Apr 15, 2025 12:00 am`, `Oct 10, 2025 12:00 am`, `May 9, 2025 12:00 am` | Data "de negócio" da observação. **Redundante** — ver §1.6 | não |
| `observacao` | texto livre, multilinha | 99,31% (24.594) | 19.682 | `CONTRATO CAIXA ASSINADO.`, `Concluido`, `STATUS: VIROU NEGOCIO` | O comentário em si. Núcleo do registro | não |
| `pipeline` | **texto de exibição** (nome do cliente em CAIXA ALTA) | 100,00% | 4.611 | `MILTON C*** D*** A*** R***`, `LAIS C*** M*** M***`, `MAICON D*** A*** L***` | O negócio a que a observação pertence | **SIM → `pipelines`, por `CLIENTE` (nome, NÃO unique id)** |
| `Creation Date` | data en-US com hora | 100,00% | 23.288 | `Nov 21, 2024 2:05 pm`, `Apr 11, 2025 10:39 am` | Instante real da criação. **É o timestamp confiável** | não |
| `Modified Date` | idem | 100,00% | 23.288 | idênticos a `Creation Date` | **Igual a `Creation Date` nas 24.766 linhas** → registro imutável / append-only | não |
| `Slug` | vazio | 0,00% | 0 | — | Não usado no Bubble | não |
| `Creator` | **texto de exibição** (nome + sobrenome) | 100,00% | 118 | `Thayse O***` (5.505), `Maria F*** d*** S*** A***` (3.268), `Douglas G***` (2.898) | Autor da observação | **SIM → `Users`, por nome de exibição (NÃO unique id)** |
| `unique id` | id Bubble `<13d>x<18d>` | 100,00% | 24.766 | `1731499714609x690281958220234800` | PK do Bubble | é a própria PK |

**Confirmação do alerta do briefing:** `pipeline` = 24.766/24.766 no formato de nome de exibição, **zero** no formato `unique id`; **zero** ocorrências do separador de lista `" , "` (é sempre relação 1:1, nunca lista). `Creator` idem: 0 no formato de id.

## 1.3 Distribuição por pipeline (negócio)

| Métrica | Valor |
|---|---|
| Pipelines distintos citados | **4.611** |
| Observações por pipeline — média | **5,37** |
| Mediana | **4** |
| Mínimo | 1 |
| p90 | 12 |
| p99 | 24 |
| **Máximo** | **82** (um único cliente) |

Histograma (nº de observações → quantos pipelines), completo até 20:

```
 1 obs → 1156 pipelines      8 obs → 194      15 obs →  49
 2 obs →  610               10 obs → 155      16 obs →  50
 3 obs →  522                9 obs → 154      17 obs →  36
 4 obs →  389               11 obs → 124      18 obs →  27
 5 obs →  292               12 obs →  88      19 obs →  22
 6 obs →  263               13 obs →  79      20 obs →  17
 7 obs →  223               14 obs →  71      (cauda até 82)
```

Top 15 pipelines por volume de observação (nome mascarado): 82, 41, 41, 39, 38, 36, 36, 35, 35, 33, 32, 31, 30, 30, 29.

### Integridade referencial `pipeline → pipelines.CLIENTE`

Comparação feita contra `export_All-pipelines-modified--_2026-09-08_19-43-56.csv` (**7.568 registros**, 7.426 valores distintos de `CLIENTE`, 7.406 após normalizar acento/caixa/espaço).

| Métrica | Valor |
|---|---|
| Nomes distintos em `observacaoPipelines.pipeline` | 4.611 |
| **Casaram com `pipelines.CLIENTE`** | **4.611 (100%)** |
| Não casaram | **0** |
| Linhas de observação com destino resolvível | **24.766 (100%)** |
| ⚠️ Nomes **ambíguos** (mesmo `CLIENTE` em 2+ pipelines) | **101 nomes** |

`pipelines` tem 143 nomes de `CLIENTE` repetidos no total; 101 deles são usados por observações. **Isso é o único risco real de junção**: para esses 101 nomes o texto não diz a qual negócio pertence. Precisa de desempate por data (`Creation Date` da observação dentro da janela do pipeline) ou de decisão explícita.

## 1.4 Tamanho e forma do texto

| Métrica | Valor |
|---|---|
| Observações vazias | 172 (0,69%) |
| **Tamanho médio** | **109,5 caracteres** |
| Mediana | 70 |
| p90 | 219 |
| Mínimo | 1 |
| Máximo | 1.285 |
| Com quebra de linha | 13.063 (52,7%) |
| Textos > 900 caracteres | 64 |

Os textos longos são laudos/pareceres de crédito colados inteiros (detalhamento de renda autônoma, extrato CADIN, carta ao gerente da Caixa). Exemplo mascarado do maior (1.285 chars): `A cliente exerce atividade autônoma como vendedora de cosméticos, atuando de forma independente na comercialização de produtos de perfumaria, cremes c...`.

## 1.5 (c) O texto tem estrutura? — **SIM, parcialmente**

### 1.5.1 Os 15 padrões mais frequentes (classificação exclusiva, primeira regra que casa vence)

| # | Padrão / prefixo | Linhas | % | Exemplo mascarado |
|---:|---|---:|---:|---|
| 1 | **Saudação** (`Bom dia` / `Boa tarde` / `Boa noite`) | **6.565** | 26,51% | `Boa tarde \n Aprovado TOTAL CCH REF SETEMBRO R$1.666,56 - PARCELA R$499,96` |
| 2 | **Texto livre sem padrão** | **6.013** | 24,28% | `MIGRANDO PARA A LYX.` · `VAMOS TENTAR ATE O DIA 20` |
| 3 | **`STATUS: <código>` + corpo** | **4.561** | 18,42% | `STATUS: REPROVADO \n\n CLIENTE não obteve o rating mínimo exigido.` |
| 4 | `Cliente <fato>` | 1.183 | 4,78% | `Cliente declinou` · `Cliente com restrição` |
| 5 | `Contrato …` (caixa/gerado/apresentado/assinado) | 1.158 | 4,68% | `CONTRATO APRESENTADO E ATO PAGO` |
| 6 | `Aprovado …` (total/condicionado) | 819 | 3,31% | `Aprovado TOTAL CCH REF OUTUBRO R$ 2.0**,22 PARCELA R$ 610,26 PRAZO 420 MESES` |
| 7 | `Pendência(s)` / `Pendente:` / `Segue pendência` | 727 | 2,94% | `SEGUE PENDENCIA PARA ANALISE: \n * CADASTRAR O CASAL NA PROPOSTA` |
| 8 | `Segue <coisa>` (documentação, anexo, carta) | 645 | 2,60% | `Segue CTPS solicitada!` |
| 9 | `PPR gerada/enviada` | 452 | 1,83% | `PPR GERADA` |
| 10 | `Aguardando` / `Esperando <coisa>` | 370 | 1,49% | `Aguardando emissão do Contracheque` |
| 11 | `Favor <pedido>` | 367 | 1,48% | `Favor enviar a CTPS da A*** constando a empresa atual.` |
| 12 | `Cancelamento` / `Distrato` | 278 | 1,12% | `Distrato Informado` |
| 13 | `Anexado / Anexo` | 228 | 0,92% | `ANEXADOS: PRINT FGTS, MO E PROPOSTA PARA GERAR` |
| 14 | `Avançado no fluxo / Avançado para` | 221 | 0,89% | `Avançado sem virar negócio.` |
| 15 | `Concluído` | 216 | 0,87% | `Concluido` |

Cauda (soma 24.766): `<vazio>` 172 · `PCV emitido/assinado` 172 · `Pré-cadastro #<n>` 148 · `Análise <coisa>` 137 · `Carta de <coisa>` 132 · `Rótulo genérico "<Palavra>:"` 126 · `prefixo de data dd-mm / dd/mm` 41 · `Reprovado/Negado` 35.

> **Cuidado ao ler a linha 1.** A regra de saudação é aplicada antes das demais, então ela engole mensagens que **têm** status no corpo (`Boa tarde \n Aprovado TOTAL CCH…`). O bucket "saudação" **não** é sinônimo de "texto sem valor estruturado"; é "texto que começa com cortesia". Reclassificar ignorando a saudação inicial aumentaria os buckets 5, 6, 7 e 12.

### 1.5.2 Frases exatas mais repetidas (esqueleto: minúsculas, dígitos → `#`)

| Linhas | Esqueleto |
|---:|---|
| 375 | `contrato caixa assinado.` |
| 275 | `contrato apresentado` |
| 271 | `ppr gerada` |
| 211 | `concluido` |
| 193 | `status: virou negocio` |
| 135 | `status: bacen cliente possui dívidas baixadas como prejuízo…` |
| 114 | `negociação aprovada` |
| 85 | `pcv emitido` |
| 82 | `contrato gerado` |
| 81 | `cancelamento solicitado` / 81 `contrato caixa assinado` (sem ponto) |
| 73 | `ppr#` |
| 70 | `pré-cadastro # #` |
| 63 | `ato pago` |
| 59 | `virou negócio` |
| 57 | `cliente não obteve o rating mínimo exigido.` |

### 1.5.3 O bloco realmente estruturado: prefixo `STATUS:`

**4.561 linhas (18,42%)** começam com `STATUS:`. O que vem logo depois é um **código de status do funil de crédito**, e ele bate com o vocabulário de `pipelines.STATUS2`.

Casando o início do corpo contra o vocabulário de `pipelines.STATUS2` (29 valores) + variantes:

| Reconhecidos | **4.444 / 4.561 = 97,4%** |
|---|---|
| Não reconhecidos | 117 (2,6%) — quase todos erro de digitação: `AGE RET AGENCIA` 17, `AGG RET AGENCIA` 2, `PEDENTE` 2, `APROB COND` 1, `APOV TOTAL` 1 |

**Distribuição completa dos códigos reconhecidos (23 valores, todos listados):**

| Linhas | Código |
|---:|---|
| 929 | `PENDENTE` |
| 770 | `AG. RET. AGENCIA` |
| 446 | `BACEN` |
| 357 | `APROVADO TOTAL` |
| 341 | `VIROU NEGOCIO` |
| 263 | `PENDENTE C/ RESTRIÇÃO` |
| 248 | `PENDENTE P/ VIRAR NEGOCIO` |
| 207 | `REPROVADO` |
| 166 | `APROV. TOTAL` |
| 157 | `APROVADO CONDICIONADO` |
| 121 | `APROVADA` |
| 80 | `EM PROCESSAMENTO` |
| 73 | `REPROVADA` |
| 60 | `APROVADO TOTAL POTENCIAL` |
| 54 | `APROV. COND.` |
| 50 | `APROVADO POTENCIAL` |
| 36 | `CONDICIONADO` |
| 36 | `PENDENTE COM RESTRIÇÃO` |
| 17 | `PENDENTE PARA VIRAR NEGOCIO` |
| 12 | `RET. ESTEIRA AGIL` |
| 10 | `APROVADO` |
| 6 | `APROV. TOT. RESTRICAO` |
| 5 | `APROV. COND. RESTRICAO` |

Para referência, `pipelines.STATUS2` (o status "atual" do negócio) tem 29 valores distintos, dos quais 8 aparecem literalmente como prefixo `STATUS:` nas observações (`PENDENTE`, `BACEN`, `REPROVADO`, `VIROU NEGOCIO`, `PENDENTE C/ RESTRICAO`, `PENDENTE P/ VIRAR NEGOCIO`, `APROVADO POTENCIAL`, `EM PROCESSAMENTO`). Os demais são variantes de grafia da mesma família.

**Quem escreve `STATUS:`** — três pessoas concentram 99,9%:

| Autor (mascarado) | Linhas `STATUS:` | Total de observações | `Funcao` em `Users` |
|---|---:|---:|---|
| Thayse O*** | 3.399 | 5.505 | **CCA** |
| Rafael R*** | 1.011 | 1.090 | CORRETOR (na prática atua no CCA) |
| Inajara G*** | 146 | 1.317 | **CCA** |
| Maria F*** d*** S*** A*** | 4 | 3.268 | CCA |
| Richard L*** | 1 | — | — |

Ou seja: `STATUS:` **é o retorno formal da esteira de crédito**, escrito pelo analista CCA. Não é comentário de corretor.

### 1.5.4 Autoria por função (`Creator` × `Users.Funcao`)

Regra de junção usada (o `Creator` é nome de exibição, não `unique id`): casa se o nome for igual ao `Nome_completo`, **ou** ao `primeiro + último` nome, **ou** ao `primeiro + segundo` nome. Com essa regra **94 dos 118 autores** batem (22.980 das 24.766 linhas).

| `Funcao` | Linhas | % |
|---|---:|---:|
| **CCA** | **12.464** | 50,3% |
| CORRETOR | 4.793 | 19,4% |
| ADM | 2.898 | 11,7% |
| GERENTE | 2.057 | 8,3% |
| `<sem match em Users>` | 1.786 | 7,2% |
| DIRETOR | 763 | 3,1% |
| SÓCIO | 5 | 0,0% |

**Metade das observações (50,3%) é escrita pelo CCA.**

### 1.5.5 Conclusão de (c): estruturado ou nota livre?

Três camadas, e a resposta não é única:

1. **18,4% (4.561 linhas)** — prefixo `STATUS:` com código enumerável (97,4% dos códigos reconhecidos, 23 valores) + corpo livre. **Vira evento estruturado** (`cca_case_events` com `to_value` = código, `detail` = corpo).
2. **~12% (≈3.000 linhas)** — frases curtas altamente repetidas e sem prefixo (`Contrato Caixa assinado`, `PPR gerada`, `PCV emitido`, `Concluído`, `Ato pago`, `Virou negócio`, `Distrato informado`, `Negociação aprovada`). São eventos de fluxo com vocabulário fechado. **Também dá para estruturar**, mas exige lista de sinônimos escrita à mão — não há prefixo.
3. **~70%** — nota livre de verdade: pedido de documento, esclarecimento de renda, laudo colado, conversa com o corretor. **Só cabe como texto.**

**Recomendação de leitura para o mapeamento:** o texto integral precisa sobreviver em algum campo de texto em 100% dos casos; a estruturação (`kind`/`to_value`) é ganho adicional em ~30% das linhas, não substituto.

## 1.6 (d) `data` × `Creation Date` — concordam?

| Métrica | Valor |
|---|---|
| Registros com `data` legível | 24.766 (100%, zero ilegível) |
| **`data` e `Creation Date` no mesmo DIA** | **24.766 (100%)** |
| `data` **exatamente igual** a `Creation Date` (com hora) | 5.643 (22,8%) |
| `data` com hora ≠ `00:00` | 5.718 (23,1%) |
| `data` com hora ≠ `00:00` **e** diferente de `Creation Date` | 76 |
| Faixa de `data` | **13/11/2024 00:00 → 08/09/2026 16:39** |
| Faixa de `Creation Date` | **13/11/2024 09:08 → 08/09/2026 16:39** |
| `Modified Date` = `Creation Date` | 24.766 (100%) |

**Resposta: concordam sempre, no nível de dia.** `data` é `Creation Date` — ora truncado para meia-noite (77,2% dos casos), ora copiado com hora (22,8%). Nunca é uma data retroativa digitada pelo usuário.

**Consequência prática:** `data` é **descartável**. Use `Creation Date` como `created_at`. Manter `data` só criaria uma segunda fonte de verdade para o mesmo instante.

## 1.7 Volume no tempo

Por ano (`Creation Date`): **2024 → 753 · 2025 → 15.235 · 2026 → 8.778**.
A base começa em 13/11/2024 (não há observação anterior; o Bubble provavelmente ganhou essa feature nessa data).

## 1.8 Qualidade e volume relevante

| Problema | Linhas |
|---|---:|
| `observacao` vazia (registro sem conteúdo) | 172 |
| Duplicata exata `(pipeline, texto, data)` | 43 linhas excedentes |
| Duplicata por `(pipeline, texto)` em datas diferentes | 335 linhas excedentes |
| Nomes de pipeline ambíguos (`CLIENTE` repetido) | 101 nomes |
| `Creator` sem correspondente em `Users` — comparando `Nome_completo` **exato** | 88 de 118 autores → 7.675 linhas |
| `Creator` sem correspondente em `Users` — regra relaxada da §1.5.4 | **24 de 118 autores → 1.786 linhas** |
| `Slug` totalmente vazio | 24.766 |

Distribuição das observações pelo `STATUS` do pipeline dono (rateio proporcional quando o nome é ambíguo):

| `pipelines.STATUS` | Observações |
|---|---:|
| **OFF** (negócio morto/arquivado) | **12.224** |
| **VENDA** | **9.898** |
| PROPOSTA | 1.747 |
| DISTRATO | 898 |

**Quanto vale a pena importar:** as 24.766 linhas são todas resolvíveis e não-duplicadas em 99,5%. O corte defensável é por relevância do negócio, não por qualidade do dado: **12.542 observações** pertencem a negócios `VENDA`/`PROPOSTA`/`DISTRATO` (vivos ou concluídos) e **12.224** pertencem a negócios `OFF`. Se o objetivo é histórico auditável do que virou dinheiro, os 12.542 bastam; se o objetivo é preservar o histórico integral do CCA (metade das linhas é laudo de crédito de analista), importe as 24.766 e filtre na UI.

---

# PARTE 2 — `export_All-ligacoes_2026-09-08_19-41-06.csv`

Tamanho em disco: 762.489 bytes.

## 2.1 Contagem real de registros

| Métrica | Valor |
|---|---|
| **Registros (parse CSV)** | **8.365** |
| Colunas | 6 |
| **`unique id`** | **NÃO EXISTE** — confirmado, a coluna não está no header |

Sem PK própria, a única chave possível é a combinação `(Creation Date, Creator, numerocliente)`.

## 2.2 Perfil coluna a coluna

| Coluna | Tipo observado | Preench. | Cardinalidade | Exemplos (mascarados) | Semântica | Referência? |
|---|---|---|---|---|---|---|
| `nomecliente` | texto curto, sem padrão de caixa | 98,72% (8.258) | 4.639 (3.766 normalizado) | `Maria`, `Paulo`, `Patricia` | Nome de quem foi ligado. **Metade é só o primeiro nome** | fraca → `leadfies.Cliente` por nome |
| `numerocliente` | só dígitos (nenhum caractere não-numérico em 8.300 valores) | 99,22% (8.300) | 7.322 (7.051 por chave de 8 dígitos) | `51 *******98`, `55 ********39` | Telefone discado | **SIM → `leadfies.Telefone` após normalizar** |
| `Creation Date` | data en-US com hora | 100,00% | 5.475 | `Feb 13, 2026 7:15 pm`, `Jan 17, 2026 10:23 pm` | Instante da ligação | não |
| `Modified Date` | idem | 100,00% | 5.475 | idênticos | **Igual a `Creation Date` nas 8.365 linhas** → append-only | não |
| `Slug` | vazio | 0,00% | 0 | — | Não usado | não |
| `Creator` | **texto de exibição** (nome + sobrenome) | 100,00% | **40** | `Marco A***` (1.417), `Anne M*** ` (1.274), `Nathalia S***` (1.038) | **Quem fez a ligação** | **SIM → `Users`, por nome de exibição** |

## 2.3 Telefones: distintos e formato

| Métrica | Valor |
|---|---|
| Registros com número preenchido | 8.300 |
| **Números distintos (dígitos crus)** | **7.322** |
| **Números distintos (chave = últimos 8 dígitos, `55` removido)** | **7.051** |
| Registros com número inaproveitável (< 8 dígitos) | 86 |

Distribuição **completa** por quantidade de dígitos (16 valores, todos listados):

| Dígitos | Linhas | Leitura |
|---:|---:|---|
| 2 | 77 | lixo (ex.: `55` sozinho) |
| 3 | 1 | lixo |
| 4 | 2 | lixo |
| 5 | 1 | lixo |
| 6 | 1 | lixo |
| 7 | 4 | lixo |
| 8 | 32 | número fixo sem DDD |
| **9** | **784** | celular sem DDD |
| **10** | **774** | DDD + 8 dígitos (celular antigo / fixo) |
| **11** | **5.334** | **formato canônico DDD + 9 dígitos** |
| **12** | **1.216** | `55` + DDD + 9 dígitos |
| 13 | 65 | `55` + DDD + 9 + 1 dígito espúrio |
| 14 | 6 | ruído |
| 16 | 1 | ruído |
| 21 | 1 | ruído |
| 104 | 1 | ruído (colagem de vários números numa célula) |

**Conclusão:** não há padrão único. Qualquer junção exige normalizar para os últimos 8 dígitos (foi o que fiz) e aceitar o risco de colisão entre DDDs diferentes.

## 2.4 (e) Cruzamento com telefone de lead

Base comparada: `export_All-leadfies-modified--_2026-09-08_19-40-11.csv` — **102.799 registros** (parse CSV completo, streaming; 56 MB), 102.694 com `Telefone` preenchido, **77.151 telefones distintos** pela mesma chave de 8 dígitos (`whatsapp` acrescenta só 664 e está contido nesse conjunto).
Também comparei com `pipelines.Contato`/`Contato_2`: **7.568 registros**, 6.447 telefones distintos.

| Métrica | Valor |
|---|---|
| Números distintos em `ligacoes` (chave 8 dígitos) | 7.051 |
| **Casam com telefone de lead (`leadfies`)** | **5.385 (76,37%)** |
| Casam com `pipelines.Contato` | 290 |
| **Casam com qualquer um dos dois** | **5.522 (78,32%)** |
| **Linhas de ligação com número que casa em `leadfies`** | **6.421 de 8.214 aproveitáveis (78,17%)** |
| Linhas que casam com qualquer um | 6.570 |

Taxa de match por tamanho do número (mostra que o problema é formato, não ausência de lead):

| Dígitos | Linhas | Com match em leadfies | Taxa |
|---:|---:|---:|---:|
| 8 | 32 | 14 | 43,8% |
| 9 | 784 | 671 | 85,6% |
| 10 | 774 | 512 | 66,1% |
| **11** | **5.334** | **4.196** | **78,7%** |
| 12 | 1.216 | 997 | 82,0% |
| 13 | 65 | 24 | 36,9% |
| ≤7 | 86 | 0 | 0% |

Cruzamento por **nome** (independente do telefone): dos 3.766 nomes normalizados distintos em `nomecliente`, **2.263 batem exatamente** com um `Cliente` de `leadfies` (6.634 linhas). Mas **2.006 dos nomes distintos são só o primeiro nome** (`Maria`, `Paulo`), então o match por nome é fraco e não deve ser usado como chave — serve só como reforço de confiança sobre o match por telefone.

## 2.5 (e) Faixa de datas

| Métrica | Valor |
|---|---|
| **Primeira ligação** | **09/01/2026 16:42** |
| **Última ligação** | **07/09/2026 18:18** |
| `Modified Date` = `Creation Date` | 8.365 (100%) |

Só existe **2026**. A tabela `ligacoes` é bem mais nova que `observacaoPipelines` (que começa em 11/2024).

Por mês (distribuição completa, 9 valores):

| Mês | Ligações |
|---|---:|
| 2026-01 | 1.523 |
| **2026-02** | **2.166** |
| 2026-03 | 1.434 |
| 2026-04 | 1.033 |
| 2026-05 | 1.150 |
| 2026-06 | 541 |
| 2026-07 | 202 |
| 2026-08 | 249 |
| 2026-09 | 67 (parcial, até dia 07) |

O uso despenca a partir de junho/2026 — a feature foi sendo abandonada.

Por hora do dia (distribuição completa):
`00h` 10 · `08h` 47 · `09h` 478 · `10h` 497 · `11h` 502 · `12h` 432 · `13h` 704 · `14h` 1.118 · `15h` 1.254 · **`16h` 1.726** · `17h` 692 · `18h` 492 · `19h` 348 · `20h` 23 · `21h` 33 · `22h` 9.
Pico claro entre 13h e 17h — comportamento de horário comercial, coerente com registro manual de ligação.

Por dia da semana (0=segunda): seg 1.314 · ter 1.436 · qua 1.631 · qui 1.509 · **sex 1.888** · sáb 558 · dom 29.

## 2.6 (e) Quem é o `Creator`?

**Sim, é o corretor que ligou.** Evidências:

1. São **40 pessoas distintas**, todas preenchidas, e a distribuição é de operação (poucos fazem muito): `Marco A***` 1.417, `Anne M***` 1.274, `Nathalia S***` 1.038, `Nathan B***` 609, `Luana B***` 603, `Eduarda N***` 542, `Emilly G***` 495, `Nathalie F***` 400, `Isabele P***` 278, `Debora M***` 274, `Valmir B***` 214, `Kaua M***` 170, `Felipe H***` 150, `Carla R*** C***` 136, `Bruno B***` 100, `Andriel N***` 100, `Kevyn B***` 94, `Janaina d*** C***` 81, `Pedro V***` 55, `Lucas d*** C***` 51, `Alessandro S***` 40, `Tierry G***` 37, `Daiane J*** d*** C***` 34, `Rudinei T*** D*** S***` 33, `Ingrid S***` 31, `Jenifer S***` 22, `Danielle M***` 18, `Pedro L***` 16, `Caroline M***` 15, `Tabhata N***` 12, `Eva L***` 8, `Gustavo T***` 5, `Veronica O***` 4, `Gabriel D***` 2, `Alan d*** O***` 2, `Breno T*** G***` 1, `Keoma P*** D***` 1, `Mateus A*** M***` 1, `Francisco B***` 1, `Fernando S***` 1. **(distribuição completa — são exatamente 40, cauda = 0)**
2. Cruzando com `Users` (`Nome_completo`, 298 registros, 296 nomes distintos) pela regra da §1.5.4: **31 dos 40 autores batem**, cobrindo **6.188 das 8.365 linhas** — e **100% deles têm `Funcao = CORRETOR`**. Nenhum é CCA, ADM, gerente ou diretor. É a checagem mais forte deste relatório: a distribuição de função em `ligacoes` é `CORRETOR` 6.188 / `<sem match>` 2.177, sem nenhuma outra função.
3. Volume máximo por pessoa em um único dia: 144 (`Eduarda N***`, 13/02/2026), 125, 106, 105, 103. Compatível com um dia de prospecção ativa por telefone.
4. **33 dos 40** `Creator` de `ligacoes` também aparecem como `Creator` em `observacaoPipelines` — é a mesma equipe comercial.

**Portanto:** `Creator` = corretor/SDR que registrou a ligação → mapeia para `lead_events.actor_id` (ou `daily_entries.profile_id`). Não é criador técnico do registro nem sistema.

## 2.7 Qualidade e volume relevante

| Problema | Linhas |
|---|---:|
| `nomecliente` vazio | 107 |
| `numerocliente` vazio | 65 |
| **Ambos vazios (registro totalmente inútil)** | **37** |
| Número com < 8 dígitos (impossível discar) | 86 |
| Linhas idênticas `(nome, número, Creation Date)` | 23 excedentes |
| Sem número que case com nenhum lead/pipeline | 1.644 linhas |
| Sem `unique id` | 8.365 (100%) — **não há PK** |
| `Creator` sem correspondente em `Users` | 9 de 40 pessoas → 2.177 linhas |
| `Slug` vazio | 8.365 |

**Quanto vale a pena importar:** de 8.365 registros, **8.214 têm número discável**; desses, **6.421 (78,17%) têm lead correspondente** e podem virar `lead_events` com `lead_id` resolvido. Os **1.793 restantes** (número válido mas sem lead) só teriam onde morar como evento solto sem `lead_id` — e `lead_events.lead_id` é `NOT NULL` no schema alvo, o que os inviabiliza ali.

Como o dado é pobre (nome + telefone + quem + quando, sem duração, sem resultado, sem desfecho) e cobre só 8 meses de 2026 em uma feature que já estava sendo abandonada, a leitura honesta é: **`ligacoes` tem valor de contagem, não de histórico**. Os 6.421 registros com lead resolvido cabem em `lead_events(kind='call')`; o total por corretor/dia (máx. 144/dia) é o que alimentaria `daily_entries.calls`.

---

# PARTE 3 — Respostas diretas às perguntas do briefing

| Pergunta | Resposta |
|---|---|
| **(a)** Contagem real | `observacaoPipelines` = **24.766** · `ligacoes` = **8.365** |
| **(b)** Pipelines distintos | **4.611** · média **5,37** · mediana **4** · máximo **82** · faixa **13/11/2024 → 08/09/2026** · texto médio **109,5 chars** (mediana 70, máx 1.285) |
| **(c)** Estrutura no texto | Sim, em camadas: **18,42%** com prefixo `STATUS:` + código enumerável (23 códigos, 97,4% reconhecidos contra `pipelines.STATUS2`) → **estruturável**; ~12% de frases curtas repetidas sem prefixo → estruturável com lista de sinônimos; ~70% nota livre. **Veredito: híbrido — texto sempre, `kind`/`to_value` quando o prefixo existir.** Top-15 padrões na §1.5.1 |
| **(d)** `data` × `Creation Date` | **Concordam em 100% dos 24.766 registros no nível de dia**; 22,8% são idênticos até a hora. `data` é cópia (às vezes truncada) de `Creation Date` → **descartar `data`** |
| **(e)** `ligacoes` | **7.051** números distintos · **5.385 (76,37%)** casam com telefone de `leadfies` (**6.421 linhas, 78,17%**) · faixa **09/01/2026 → 07/09/2026** (só 2026) · **`Creator` é o corretor que ligou** — 40 pessoas, 31 batem em `Users` e todas as batidas têm `Funcao = CORRETOR` |

## Suposições que mudam o resultado

1. **Fuso horário**: os CSVs não declaram fuso. Tratei todas as datas como `America/Sao_Paulo`. Se o Bubble exportou em UTC, todas as faixas e o histograma por hora deslocam 3h — e o pico de ligações às 16h seria na verdade 13h. **Não é possível decidir isso a partir dos arquivos.**
2. **Chave de telefone = últimos 8 dígitos** (com `55` removido quando havia 12+ dígitos). Escolhi essa chave porque `ligacoes` mistura 6 formatos diferentes. Ela **ignora o DDD**, então pode casar `(51) 9xxxx-1234` com `(11) 9xxxx-1234`. O número real de matches verdadeiros é menor ou igual a 5.385 — considere 76,37% um **teto**.
3. **`pipeline` casa por nome, não por id.** Os 101 nomes ambíguos (mesmo `CLIENTE` em 2+ pipelines) não têm desempate no arquivo. Sem uma regra de desempate, essas observações podem ser anexadas ao negócio errado.
4. **`Creator` casa por nome de exibição.** Usei `primeiro + último nome` de `Users.Nome_completo`; por nome completo exato só 30 de 118 batem. 24 autores de observação e 9 de ligação não existem no export de `Users` (provavelmente desligados e removidos, ou o export de `Users` está incompleto). Esses vão ficar sem `actor_id`.

## O que não consegui responder

- **Duração, resultado ou desfecho da ligação**: não existe no arquivo. `ligacoes` tem só 6 colunas e nenhuma delas registra se atendeu, quanto durou ou o que aconteceu. Qualquer métrica de "taxa de contato" é impossível a partir deste export.
- **`ligacoes` → negócio (`pipeline`)**: não há coluna de relação. A única ponte possível é telefone → lead → pipeline, e ela só cobre 78%.
- **Se o `Creator` da ligação é o mesmo corretor dono do lead**: exigiria juntar `ligacoes` → `leadfies.Corretor`, o que é outro perfil (o de `leadfies`). Não foi feito para não duplicar trabalho do agente daquele grupo.
