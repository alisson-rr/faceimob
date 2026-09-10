# Refutação — `mapa/negocios.md` pela lente **dados**

Data: 09/09/2026 · Escopo: conferir contra os CSVs reais do Bubble as afirmações factuais do
mapeamento (valores de enum, formato de data e dinheiro, existência e preenchimento das colunas
citadas, taxa de casamento das FKs). Nada foi executado contra o banco; nenhum arquivo de código
foi alterado. Todos os números abaixo saíram de scripts `csv.DictReader` (Python 3.12) em
streaming, guardados em `<scratchpad>/p1.py`…`p12.py`.

**Veredito: REFUTADO em pontos localizados.** O esqueleto do mapeamento reproduz com precisão
incomum — os cinco eixos que a carga usa (enum de `STATUS`, catálogo de `STATUS2`, formato de
data e de dinheiro, existência/preenchimento das 110 colunas, taxa de FK por nome) saíram
idênticos ao documento, incluindo somas de dinheiro até o centavo. O que não sobrevive é
**um número de risco usado para decidir (D8) e três medidas apresentadas como fato**.

O achado grave é o **§5.3 / S5 / D8**: a exposição do desempate por nome está declarada como
"até 305 linhas" quando o que medi é **724 linhas de observação** — e **1.723 linhas** somando
os três arquivos que o próprio documento manda reexportar.

---

## 1. O que foi confirmado (não mexer)

| Afirmação do mapa | Medido | |
|---|---|:--:|
| §2 `pipelines` = 7.568 registros × 110 colunas | idem (parser CSV, não `wc -l`) | OK |
| §4.1 `STATUS` tem **5 valores fechados**: `OFF` 5.077 · `VENDA` 1.829 · `PROPOSTA` 494 · `DISTRATO` 158 · `PARCEIRO` 8 · vazio 2 | idem, valor a valor, nenhum sexto valor | OK |
| §4.3 `STATUS2` = 29 rótulos + 19 vazios, com as contagens da tabela (1.172 / 718 / 699 / 668 / 663 / 590 / 551 / 465 / 423 / 361 / 201 / 186 / 170 / 120 / 96 / 86 / 81 / 69 / 68 / 44 / 36 / 36 / 20 / 13 / 8 / 2 / 1 / 1 / 1) | idem, um a um | OK |
| §2 T-NBSP: `PENDENTE\xa0C/\xa0RESTRIÇÃO` (186), `ANÁLISE P/ VIRAR\xa0NEGÓCIO` (68), `AG. RET.\xa0AGENCIA` (8) = 262 linhas; `Lead\xa0Indicação` 359 | idem — os 3 rótulos de `STATUS2` somam exatamente 262 | OK |
| §4.3 a regra do OFF: **677** negócios `OFF` com `QUEDA`/`DISTRATO`/`REPROVADO`, **4.400** com outro rótulo | idem (677 + 4.400 = 5.077) | OK |
| §4.2 a cascata cobre 100% do `PROPOSTA` | 19 valores de `STATUS2` dentro de `PROPOSTA`, **0 fora das famílias listadas** | OK |
| §2 formato de data `%b %d, %Y %I:%M %p` | `ENVIO` 7.567/7.567 · `mudou_status` 7.567/7.567 · `mes` 7.564/7.564 · `observacaoPipelines."Creation Date"` 24.766/24.766 — **zero falha de parse** | OK |
| §4.1 `mudou_status` cobre **7.072/7.072** dos negócios que precisam de `closed_at` | idem, exato | OK |
| §2.3 T-MOEDA: `VGV BRUTO` tem 2.780 preenchidas, **632** são o literal `R$ -`, **2.148** numéricas, **2.146 > 0** | idem; `money()` não levantou exceção em nenhuma linha | OK |
| §9 conferência 6: `sum(vgv_gross)` = **465.211.260,70** e `won` = **398.105.909,06** | idem, ao centavo | OK |
| §2.3 `PARC_DESCONTO`: 661 preenchidas, **624 ≠ 0**, **1 negativa** | idem; e o maior `desconto/bruto` é **28,38%** → o `check (discount_pct between 0 and 100)` não é violado por nenhuma linha | OK |
| §2.2/§0-5 rateio: `vgv_corretor_1`, `vgv_corretor_2`, `vgv_gerente_1`, `vgv_gerente_2` **0 de 7.568** | idem — e mais 13 colunas com 0 (`Campanha`, `Canal`, `Fonte`, `Criativo Meta`, `Formulário Meta`, `obs`, `enviar`, `Slug`, `dias`, `vgv_bruto`, `vgv_prentedido`, `diretor3`, `PARC. DESCONTO`) | OK |
| §2.2 ⚠ **`GERENTE 2` com espaço não existe**; existe `GERENTE2` (155) e `GERENTE 3` (7) | idem, no cabeçalho literal | OK |
| §2.1 ⚠ `dataInicioAtividade ` com espaço no fim do nome (306) | idem | OK |
| §5.2 tabela de cobertura de FK, **linha a linha** | `CORRETOR 1` 7.349→**7.271 (98,94%)**, 78 linhas / 20 nomes · `CORRETOR 2` 849→841 (99,06%), 8/5 · `CORRETOR 3` 5→5 · `GERENTE 1` 7.521→**7.375 (98,06%)**, 146/**1** · `GERENTE2` 155→151, 4/1 · `GERENTE 3` 7→7 · `Diretor1` 5.086→**5.086 (100%)** · `diretor2` 73→73 · `Creator` 7.568→**6.336 (83,72%)**, 1.232/2 | OK |
| §5.2 `Users.colaboradores` = **298 valores em 298 linhas, zero duplicata** (raw e normalizado) | idem | OK |
| §2.5 `CONSTRUTORA2` **7.546/7.546** casa com o catálogo `Construtoras` (41 nomes, coluna `nome`) | idem, 100%, sem precisar da regra `MAISLAR` | OK |
| §2.5 `coalesce(CONSTRUTORA2, construtora)` com a regra `MAISLAR → MAIS LAR` | **7.551/7.551** | OK |
| §2.5 `EMPREENDIMENTO`: **688** valores crus → **576** normalizados | idem | OK |
| §2.6 `OrigemLead`: `Lead Próprio` 2.832 · `Leadfy` 576 · `Lead Indicação` 359 · `Lead Loja` 166 · `Lead Feirão` 34 (total 3.967) | idem, 5 valores e nenhum outro | OK |
| §9-T2 `mes` = 2026-09 em **411** negócios; futuros **186** (2026-10: 150 · 2026-11: 28 · 2026-12: 7 · 2027-02: 1) | idem, mês a mês | OK |
| §9-T5 `13. ESTEIRA AGIL` + `RET. ESTEIRA AGIL` = **374** negócios | 361 + 13 = 374 | OK |
| §2 T-FONE: 11 díg. 4.860 · 10 díg. 1.382 · 12 díg. 81 · 13 díg. 17 · 9 díg. 43 · ≤8 díg. 19 (6.402) | idem, bucket a bucket | OK |
| §2.1 `pis`: **3.621** com 11 dígitos de 4.579 preenchidas, 958 lixo | idem | OK |
| §6 `unique id`: **0 duplicatas** e 0 vazios em 7.568 | idem — a chave de idempotência do §6.1 é sólida | OK |
| §3 `observacaoPipelines` = 24.766 linhas, **172** com `observacao` vazia; `data` no mesmo dia de `Creation Date` em **24.766/24.766**; `Modified Date` == `Creation Date` em **24.766/24.766** | idem | OK |
| §3 os nomes de `observacaoPipelines.pipeline` casam **100%** com `pipelines.CLIENTE` | **0 linhas sem candidato** em 24.766 | OK |
| §4.3 catálogo do front: 32 rótulos em `src/components/pipeline/statuses.ts:19-53`; **28 dos 29** valores do Bubble casam; só `RC EMITIDA` fica de fora | idem, rótulo a rótulo | OK |
| §7.2 as colunas de destino citadas existem | `deals.status_detail` (`0020:140`), `deals.document_review_status` (`0028:11`), `deal_participants.ordinal` (`0025:32`), `deal_clients.activity_duration`/`cch_reference`/`dependents text` (`0006:81-108`), `vgv_net generated always … stored` (`0006:44-46`), `discount_pct numeric(5,2)` (`0006:41`), sem `external_id` em `deals` | OK |

---

## 2. O que foi refutado

### R1 — GRAVE · §5.3, S5 e D8: a exposição do desempate por nome é **724 linhas**, não 305

O mapa mede a ambiguidade **do lado errado da junção**. Ele conta linhas de `pipelines` com
`CLIENTE` repetido e apresenta esse número como se fosse o número de observações em risco:

> §5.3: "`pipelines` tem **144 valores de `CLIENTE` repetidos, cobrindo 305 linhas**. Desses, **101 nomes** são citados por observações."
> S5: "**Até 305 linhas de observação podem ir para o negócio errado**"
> D8: "importar por nome com desempate temporal: heurística não validável; **até 305 linhas** podem ir para o negócio errado"

Medido com a **mesma** `T_NOME` do §5.1:

| Grandeza | Mapa | Medido |
|---|---:|---:|
| `CLIENTE` (T_NOME) repetidos em `pipelines` | 144 | **143** |
| Linhas de `pipelines` cobertas por esses nomes | 305 | **289** |
| Nomes ambíguos citados por `observacaoPipelines` | 101 | **98** |
| **Linhas de `observacaoPipelines` que caem em 2+ negócios** | **305** | **724** |

E o mesmo join é usado em mais dois arquivos que o D8 manda reexportar, sem nenhum número no
documento:

| Arquivo | Linhas | Linhas ambíguas | Nomes ambíguos |
|---|---:|---:|---:|
| `observacaoPipelines-modified` | 24.766 | **724** | 98 |
| `doc-clientes-modified` | 25.890 | **779** | 110 |
| `historicoPipes-modified` | 10.343 | **220** | 43 |
| **Total** | | **1.723** | |

Por que importa: D8 é uma decisão do dono ("reexportar ou importar por nome"), e o custo da
opção (b) está declarado 2,4× menor do que é — 5,6× se a decisão for tomada para os três
arquivos de uma vez, que é como o próprio D8 a formula. O desempate por janela temporal
continua sendo heurística não validável; o que muda é quanta coisa depende dela.

Evidência: `<scratchpad>/p8.py`, `p9.py`, `p11.py`.

> Nota de contexto: **não existe atalho**. Conferi o `export_All-doc-clientes_2026-09-08_19-37-42.csv`
> (o único arquivo da pasta **sem** o sufixo `-modified`): a coluna `pipeline` também traz nome de
> exibição (`'MARCELO PEREIRA PIRES'`), não `unique id`. O reexport do D8 continua sendo
> obrigatório para eliminar a ambiguidade.

### R2 — §0 decisão 1 e §5.2: "`Nome_completo` resolve 0%" é falso — resolve **29,45%**

> §0-1: "`CORRETOR 1` resolve 7.271/7.349 (98,94%) por `colaboradores` e **0** por `Nome_completo`"
> §5.2: "`Users.Nome_completo`, **que resolve 0% de `CORRETOR 1`**"

Medido com a `T_NOME` do §5.1: `CORRETOR 1` resolve **2.164 de 7.349 (29,45%)** contra
`Users.Nome_completo`. E o próprio mapa, duas linhas antes, explica que "o perfil `pipelines.md`
§8 mediu 29% porque comparou contra a coluna errada" — 29% é exatamente o que `Nome_completo`
dá. O documento se contradiz: ou o 0 está errado, ou a explicação do 29% está.

Onde o 0 é verdade: `Diretor1` e `diretor2`, que resolvem **0/5.086** e **0/73** por
`Nome_completo`. A confusão é essa.

Impacto na carga: **nenhum**. A decisão 1 sobrevive intacta (98,94% ≫ 29,45%, e `colaboradores`
tem zero duplicata). O que morre é a força do argumento — quem for auditar a escolha da chave
vai reproduzir 29% e desconfiar do resto do documento.

Evidência: `<scratchpad>/p3.py`.

### R3 — §2.3, L7 e D3: o erro máximo do desconto é **R$ 2.000,00**, não R$ 20,20

> §2.3: "medi nos 624 negócios com desconto: **erro máximo R$ 20,20** · mediana R$ 6,00 · 604 de 624 passam de R$ 0,01 · 564 passam de R$ 1,00. **O erro total é ~R$ 4 mil**"

Reconstituí `VGV LIQUIDO` pela fórmula do banco
(`round(vgv_gross * (1 - round(desconto/bruto*100, 2)/100), 2)`), aplicando a própria regra do
mapa de forçar 0 no desconto negativo:

| | Mapa | Medido |
|---|---:|---:|
| n | 624 | **624** OK |
| mediana | R$ 6,00 | **R$ 6,00** OK |
| erros > R$ 0,01 | 604 | **604** OK |
| erros > R$ 1,00 | 564 | **564** OK |
| **erro máximo** | **R$ 20,20** | **R$ 2.000,00** |
| **erro total** | **~R$ 4.000** | **R$ 5.804,33** |

A diferença é uma linha só: o negócio com `PARC_DESCONTO = -2.000`. A regra "forçar 0" do
próprio §2.3 transforma um desconto de R$ 2.000 em desconto zero, e o líquido importado fica
R$ 2.000 acima do líquido do Bubble. O mapa mediu o erro **excluindo** a linha que sua própria
regra quebra (R$ 5.804,33 − R$ 2.000,00 = R$ 3.804,33 ≈ "~R$ 4 mil"), e depois apresentou o
número como se cobrisse os 624.

A recomendação D3(a) continua certa (0,0012% sobre R$ 465,2 mi). Só que o "erro máximo
R$ 20,20" não pode ir para a conferência pós-carga como limite: um
`abs(vgv_net - VGV LIQUIDO) > 21` acusaria a linha do desconto negativo como falha da carga
quando é comportamento planejado. O correto é excetuar esse `unique id` explicitamente.

Evidência: `<scratchpad>/p5.py`, `p6.py`.

### R4 — §2.3: a regra de fallback do `VGV BRUTO` é **código morto** (0 linhas), e 71,6% dos negócios chegam sem VGV

> §2.3: "**Fallback:** quando vazio e `VGV LIQUIDO > 0`, usar `VGV LIQUIDO`"

Medido: **0 linhas** se qualificam. As 5.420 linhas sem `VGV BRUTO` numérico têm `VGV LIQUIDO`
preenchido com **zero** (soma de `VGV LIQUIDO` = R$ 452.572.679,13, exatamente
R$ 465,2 mi − R$ 12,6 mi de desconto). A regra nunca dispara.

Não é erro de carga — é ruído. Mas ela esconde um número que o mapa nunca escreve e que muda a
leitura de qualquer painel: **`deals.vgv_gross` nasce NULL em 5.420 dos 7.568 negócios (71,6%)**.
O §10 lista volume de linhas, não cobertura de coluna, e nenhuma tabela do documento diz isso.
Merece uma linha no §7.1 ou no §10: importar 7.568 negócios não é importar 7.568 VGVs.

Evidência: `<scratchpad>/p5.py`.

### R5 — Contagens menores que não reproduzem (nenhuma muda decisão, todas alimentam conferência)

| Onde | Mapa | Medido | Efeito |
|---|---:|---:|---|
| §3 e §10: "**43** duplicatas exatas `(pipeline, texto, data)`" | 43 | **42** por `data`; **8** por `Creation Date`; 36 sem normalizar o nome | O volume final de `deal_history` vira **24.552**, não 24.551. A definição de "duplicata" precisa dizer qual coluna de data usa |
| §3: "os **4.611** nomes distintos de `observacaoPipelines`" | 4.611 | **4.608** (T_NOME) | cosmético |
| §2 T-MES: "12 outros dias em **36 linhas**" | 36 | **32** | 6.650 + 882 + 36 = 7.568 ≠ 7.564 preenchidas; com 32 fecha |
| §2 T-CPF: "5.388 de **5.428** preenchidos; **40** linhas viram NULL" | 5.428 / 40 | **5.426** / **38** | cosmético |
| §1 e §10: "**635** pares `(construtora, empreendimento)`" | 635 | **633** | dimensiona `developer_projects` |
| §2.1 e §4.4: "**40 variantes**" de `estado_civil` | 40 | **39** (caixa alta) | cosmético |
| §5.3: "**144** valores repetidos cobrindo **305** linhas" | 144 / 305 | **143 / 289** (T_NOME) ou **123 / 249** (cru) | ver R1; §12 do próprio mapa já diz "143", contradizendo o §5.3 |

---

## 3. Conclusão

O mapeamento é utilizável e a onda 1 (`deals` + `deal_clients` + `deal_participants`) pode ir
como está: enum, formato de data, formato de dinheiro, existência das colunas e taxa de FK — os
cinco eixos que a lente "dados" cobre — reproduzem. Antes de publicar, corrigir:

1. **R1 (alta):** trocar "até 305 linhas" por **724 linhas de observação** em S5 e D8, e
   acrescentar `doc-clientes` (779) e `historicoPipes` (220) — total **1.723**. É o número que
   o dono usa para decidir se reexporta.
2. **R3 (média):** erro máximo **R$ 2.000,00** e total **R$ 5.804,33**; nomear o `unique id` do
   desconto negativo como exceção conhecida da conferência pós-carga.
3. **R2 (média):** trocar "0 por `Nome_completo`" por **29,45%** (o 0 é de `Diretor1`).
4. **R4 (baixa):** remover o fallback morto e registrar que **71,6% dos negócios chegam com
   `vgv_gross` NULL**.
5. **R5 (baixa):** ajustar as sete contagens e fixar por qual coluna de data a duplicata de
   `deal_history` é definida.

Fora do alcance desta lente (não verifiquei, e nenhum script resolve): a suposição S1 de fuso —
os arquivos não declaram fuso. O próprio §11 admite. Segue sendo a maior incerteza do documento
e a única que desloca **todas** as datas, inclusive `closed_at`.
