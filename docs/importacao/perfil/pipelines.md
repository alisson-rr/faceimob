# Perfil — `pipelines` (NEGÓCIOS) — export Bubble

**Arquivo:** `DOCUMENTOS/DADOS_BUBBLE/export_All-pipelines-modified--_2026-09-08_19-43-56.csv` (9,5 MB)
**Registros:** **7.568** (parse com `csv` do Python 3; nenhuma linha com contagem de colunas divergente)
**Colunas:** **110** = 105 de domínio + 5 metadados Bubble (`Creation Date`, `Modified Date`, `Slug`, `Creator`, `unique id`)
**Encoding:** UTF‑8 (decodifica limpo; `cp1252` falha — quem ler precisa forçar UTF‑8)
**Data do perfil:** 09/09/2026

---

## 0. Resumo executivo

`pipelines` é a tabela de **negócios/vendas** do CRM legado em Bubble. Cada linha é um negócio de um cliente comprador com uma construtora, num empreendimento e unidade, conduzido por um corretor sob um gerente e um diretor, passando por uma esteira de crédito (status de análise bancária) até virar venda, distrato ou cair. A linha carrega, achatados na mesma tabela: os dados cadastrais do comprador (e de um segundo comprador, quando compra em conjunto), o rateio de participantes, os valores da operação, o estado no funil em três codificações redundantes, os documentos anexados e um vínculo com o registro de gamificação do corretor.

No schema alvo, uma linha se decompõe em: `deals` (1 linha) + `deal_clients` (1 ou 2 linhas, `ordinal` 1 e 2) + `deal_participants` (1 a 3 corretores + 1 a 2 gerentes + 1 a 2 diretores) + `deal_documents` (via `doc` → `doc-clientes`) + `cca_cases` (a esteira que hoje vive em `STATUS2`) + `game_events` (via `GameCorretor1/2`).

**Três achados que mudam o plano de importação:**

1. **17 das 105 colunas de domínio estão 100% vazias**, inclusive metade dos pares "duplicados" do briefing: `vgv_bruto`, `PARC. DESCONTO`, `vgv_corretor_1/2`, `vgv_gerente_1/2`, `vgv_prentedido`, `obs`, `dias`, `diretor3`, `Campanha`, `Canal`, `Fonte`, `Criativo Meta`, `Formulário Meta`, `enviar`, `Slug`. **Não existe rateio de VGV por participante no export** — o `share_pct` de `deal_participants` terá de ser derivado por regra, não importado.
2. **Nenhuma coluna de participante traz `unique id`** — todas são nome de exibição. As FKs de volta (`historicoPipes.pipeline`, `observacaoPipelines.pipeline`, `doc-clientes.pipeline`, `financeiros.pipeline`, `vendas.pipeline`) também vêm como **nome do cliente**, não como id. A única ponte por id que sobrevive é `pipelines.doc` → `doc-clientes.unique id` (2.857/2.857 casam).
3. **`VGV LIQUIDO = VGV BRUTO − PARC_DESCONTO`** confirmado em 661/661 linhas testadas. `VGV BRUTO > 0` ⟺ `VGV LIQUIDO > 0` (2.146 linhas em ambos). Só **2.146 dos 7.568 negócios (28,4%) têm valor**; os outros 5.422 são `0` / `R$ -`.

---

## 1. Metodologia e avisos

- Parse com o módulo `csv` da stdlib (há 966 valores de `OBSERVAÇÃO` com quebra de linha dentro de aspas; `wc -l` daria número errado).
- **Fuso horário:** o arquivo não declara fuso. Assumi `America/Sao_Paulo` na leitura de `Creation Date`/`Modified Date`. Se o Bubble exportou em UTC, todos os horários estão 3h adiantados — isso desloca ~4% dos registros para o dia anterior. **Verificar antes de importar** comparando um negócio conhecido.
- **Mascaramento:** CPF, PIS, telefone, e‑mail, endereço e nome de cliente aparecem mascarados neste relatório. Nomes de colaboradores (corretor/gerente/diretor) aparecem completos porque são a chave de junção com `Users`/`corretors`/`gerentes` e o mapeamento depende deles.
- Nenhum comando foi executado contra banco. Só leitura de arquivo.
- Percentuais de preenchimento usam denominador 7.568.

---

## 2. (a) Volume e faixa de datas

### Contagem

| Métrica | Valor |
|---|---|
| Registros (parse CSV) | **7.568** |
| `unique id` distintos | 7.568 (0 vazios, 0 duplicados) |
| Linhas com todas as colunas de domínio vazias | 0 |

### `Creation Date` — criação do registro no Bubble

Faixa: **13/05/2024 23:13 → 08/09/2026 16:14**

| Ano | Registros |
|---|---|
| 2024 | 2.872 |
| 2025 | 2.666 |
| 2026 | 2.030 (até 08/09) |

Por mês: `2024-05` 1.239 (carga inicial de migração — 16% da base num mês), `2024-06` 317, `2024-07` 296, `2024-08` 256, `2024-09` 216, `2024-10` 267, `2024-11` 186, `2024-12` 95, `2025-01` 179, `2025-02` 216, `2025-03` 226, `2025-04` 239, `2025-05` 219, `2025-06` 158, `2025-07` 262, `2025-08` 239, `2025-09` 230, `2025-10` 315, `2025-11` 252, `2025-12` 131, `2026-01` 305, `2026-02` 277, `2026-03` 250, `2026-04` 281, `2026-05` 251, `2026-06` 202, `2026-07` 200, `2026-08` 226, `2026-09` 38.

### `Modified Date`

Faixa: **19/09/2024 12:37 → 08/09/2026 16:44**. 2024: 1.744 · 2025: 3.255 · 2026: 2.569.
Nenhum registro tem `Modified Date` anterior a set/2024 — indicativo de que o Bubble reescreveu a coluna numa migração em 18-19/09/2024 (o mesmo dia domina `mudou_status`, com 2.039 ocorrências de `Sep 18, 2024`).

### `ENVIO` — data real do negócio (a data de negócio, não a de criação do registro)

Faixa: **21/08/2023 → 08/09/2026**. Preenchida em 7.567/7.568 (99,99%).

| Ano de `ENVIO` | Registros |
|---|---|
| 2023 | 75 |
| 2024 | 2.770 |
| 2025 | 2.639 |
| 2026 | 2.083 |

`ENVIO` é anterior a `Creation Date` em 1.067 linhas e posterior em 188 — confirma que é a data do fato (envio para análise), digitada pelo usuário, e não um carimbo do sistema. **Esta é a coluna a usar para `deals.month_base` / datas do negócio**, não `Creation Date`.

### `mes` — mês de referência (competência)

7.564 preenchidas. É sempre dia 5 (6.650×) ou dia 1 (882×) do mês — ou seja, um marcador de competência, não uma data real. Bate com o mês de `ENVIO` em 3.529/7.564 (46,7%) e com o mês de `Creation Date` em 2.569 — portanto **é editado à mão e diverge das duas**; tratar como campo de fechamento contábil, não derivar.
Anos: 2023: 72 · 2024: 2.602 · 2025: 2.419 · 2026: 2.470 · 2027: 1 (erro de digitação).

---

## 3. Perfil coluna a coluna (110 colunas, por grupo de assunto)

Legenda de `referência`: `não` · `unique_id->tabela` · `nome_exibicao->tabela` · `lista_nomes->tabela`.

### Grupo 1 — Cliente 1 e Cliente 2 (25 colunas)

Padrão: cada campo do comprador principal tem um gêmeo com sufixo `_2` para o segundo comprador (compra em conjunto). O preenchimento do bloco `_2` gira em torno de 3,7–4,7%, coerente com `compra_conjunto = sim` em 347 linhas.

| Coluna | Preench. | % | Card. | Tipo | Exemplos (mascarados) | Significado | Referência |
|---|---|---|---|---|---|---|---|
| `CLIENTE` | 7.552 | 99,79 | 7.426 | texto | `IGOR F*** P***`, `CARLOS A*** E*** B***`, `ADRIAN M*** D***` | Nome do comprador principal. **É também a chave de exibição usada pelas tabelas-filhas** | não (mas é o join de fato — ver §11) |
| `CLIENTE_2` | 352 | 4,65 | 347 | texto | `PAULO R*** G***`, `LUCAS C*** D***` | Nome do 2º comprador | não |
| `cpf_numero` | 5.426 | 71,70 | 5.383 | num | `000.***.***-24`, `026.***.***-96` | CPF do comprador. **Sempre só dígitos**, sem pontuação | não |
| `cpf_numero_2` | 351 | 4,64 | 347 | num | `034.***.***-00` | CPF do 2º comprador | não |
| `Contato` | 6.402 | 84,59 | 6.217 | num/texto | `(51) *****-2047` | Telefone. 4.733 com 11 dígitos crus, 1.330 com 10, 127 já formatados | não |
| `Contato_2` | 333 | 4,40 | 326 | num | `(51) *****-8488` | Telefone do 2º comprador | não |
| `email` | 4.655 | 61,51 | 4.594 | texto | `S***@HOTMAIL.COM`, `L***@GMAIL.COM` | E‑mail. 0 valores sem `@`. Predominantemente CAIXA ALTA | não |
| `email_2` | 291 | 3,85 | 289 | texto | `L***@GMAIL.COM` | E‑mail do 2º comprador | não |
| `estado_civil` | 4.623 | 61,09 | 39 | texto | `SOLTEIRO` 2.116, `SOLTEIRA` 2.004, `SOLTEIRO(A)` 117 | Estado civil. **Gênero embutido no valor** — 39 variantes para ~6 conceitos | não (enum sujo) |
| `estado_civil_2` | 289 | 3,82 | 12 | texto | `CASADA` 84, `SOLTEIRA` 65 | idem, 2º comprador | não |
| `naturalidade` | 4.615 | 60,98 | 596 | num/texto | `PORTO ALEGRE` 1.295, `PORTO ALEGRE ` 355 (com espaço), `POA` 148, `BRASILEIRO` 174 | Cidade natal. Texto livre sujo — inclui nacionalidade em 174 casos | não |
| `naturalidade_2` | 290 | 3,83 | 91 | texto | `PORTO ALEGRE`, `CANOAS` | idem, 2º comprador | não |
| `dependente` | 4.566 | 60,33 | 2 | texto | `SIM` 2.617, `NÃO` 1.949 | Tem dependentes? Booleano em PT maiúsculo | não |
| `dependente_2` | 283 | 3,74 | 2 | texto | `NÃO` 154, `SIM` 129 | idem | não |
| `data_Admissao` | 4.243 | 56,07 | 1.542 | data | `Jan 1, 2025 12:00 am`, `Feb 1, 2010 12:00 am` | Admissão no emprego (usado na análise de crédito). 100% parseável no formato en‑US | não |
| `data_Admissao_2` | 223 | 2,95 | 189 | data | `Jul 1, 2022 12:00 am` | idem | não |
| `pis` | 4.579 | 60,50 | 3.776 | num | `***`, `000.***.***-00` | PIS/PASEP. **Sujo**: 3.621 com 11 dígitos, 196 com 1 dígito, 133 com 12, 84 com 13, 56 com 14 | não |
| `pis_2` | 273 | 3,61 | 215 | num | `***` | idem | não |
| `ref_cch` | 4.227 | 55,85 | 12 | texto | `JANEIRO` 468, `MARÇO` 444, `JUNHO` 423 | Mês de referência da CCH (carta de crédito habitacional). Só o nome do mês, **sem ano** | não |
| `ref_cch_2` | 217 | 2,87 | 12 | texto | `ABRIL` 29, `JUNHO` 29 | idem, 2º comprador | não |
| `cep_endereco` | 4.533 | 59,90 | 2.854 | num/texto | `91170-200`, `92990-000` | CEP do comprador. 4.495 no formato `#####-###`, 17 com 7 dígitos, 10 com 1 dígito | não |
| `cep_endereco_2` | 278 | 3,67 | 260 | num/texto | `92990-000`, `92480000` | idem | não |
| `cotista` | 4.607 | 60,87 | 2 | texto | `SIM` 2.682, `NÃO` 1.925 | Cotista do FGTS (mais de 3 anos de contribuição) | não |
| `cotista_2` | 286 | 3,78 | 2 | texto | `NÃO` 166, `SIM` 120 | idem | não |
| `compra_conjunto` | 1.204 | 15,91 | 2 | texto | `não` 857, `sim` 347 | Compra em conjunto (dois compradores). Minúsculas, ao contrário de `cotista`/`dependente` | não |

**Destino:** `deal_clients` com `ordinal=1` (bloco sem sufixo) e `ordinal=2` (bloco `_2`). Mapeia direto em `full_name`, `cpf`, `phone`, `email`, `pis`, `marital_status`, `birthplace`, `dependents`, `admission_date`, `cch_reference`, `postal_code`, `is_shareholder`.

### Grupo 2 — Participantes e rateio (22 colunas)

| Coluna | Preench. | % | Card. | Tipo | Exemplos | Significado | Referência |
|---|---|---|---|---|---|---|---|
| `corretor` | 7.347 | 97,08 | 287 | texto | `LEONARDO VALLIER`, `TABHATA NOBRE`, `Isaias Ribeiro Luca` | Corretor 1 — **versão legada/suja** (mistura CAIXA ALTA e Title Case: 287 grafias para ~210 pessoas) | nome_exibicao->corretors (108 linhas fora do catálogo) |
| `CORRETOR 1` | 7.349 | 97,11 | 215 | texto | `Felipe di Pompo` 347, `Leonardo Vallier` 307, `Tabhata Nobre` 282 | Corretor 1 — **versão canônica**. 7.349/7.349 casam com o catálogo `corretors` | nome_exibicao->corretors (100%) |
| `CORRETOR 2` | 849 | 11,22 | 120 | texto | `Lucas Telles`, `Leonardo Vallier` | Corretor 2 (venda a dois) | nome_exibicao->corretors (100%) |
| `CORRETOR 3` | 5 | 0,07 | 3 | texto | `Susana Cristina Prates` 3, `Rudinei Teixeira De Souza` 1, `Parceiro Externo` 1 | Corretor 3. Praticamente inexistente | nome_exibicao->corretors (100%) |
| `corretor2` | 845 | 11,17 | 158 | texto | `Lucas Telles`, `LEONARDO VALLIER` | Corretor 2 — versão legada/suja. 6 linhas fora do catálogo | nome_exibicao->corretors |
| `gerente` | 7.511 | 99,25 | 26 | texto | `ARCHIMEDES BOFF` 1.050 + `Archimedes Boff` 544 | Gerente 1 — versão legada/suja. 26 grafias para 17 pessoas; 127 linhas fora dos catálogos (`ROBERTO SANTOS MENDES` 69, `FACEIMOB` 58) | nome_exibicao->gerentes |
| `GERENTE 1` | 7.521 | 99,38 | 17 | texto | `Archimedes Boff` 1.597, `Fabio Batista` 1.129, `Mauricio Vieira` 1.110 | Gerente 1 — **canônica**. 7.521/7.521 casam com `gerentes` | nome_exibicao->gerentes (100%) |
| `GERENTE 3` | 7 | 0,09 | 6 | texto | `Gerente Interino` 2, `Junior Rezende` 1 | Gerente 3. **Não existe coluna `GERENTE 2` com espaço** — a numeração pula | nome_exibicao->gerentes (100%) |
| `gerente2` | 154 | 2,03 | 18 | texto | `ARCHIMEDES BOFF`, `Zona Sul` | Gerente 2 — versão legada | nome_exibicao->gerentes |
| `GERENTE2` | 155 | 2,05 | 14 | texto | `Archimedes Boff` 47, `Mauricio Vieira` 40 | Gerente 2 — **canônica** (o "GERENTE 2" do briefing). 155/155 no catálogo | nome_exibicao->gerentes (100%) |
| `Diretor1` | 5.086 | 67,20 | 5 | texto | `Mauricio Vieira` 1.808, `Archimedes Boff` 1.463, `Fabio Batista` 1.454, `Junior Rezende` 356, `Luis Hahn` 5 | Diretor da operação. **Só 5 pessoas** | nome_exibicao->gerentes/corretors (100%) |
| `diretor2` | 73 | 0,96 | 4 | texto | `Mauricio Vieira` 39, `Archimedes Boff` 24 | 2º diretor | nome_exibicao->gerentes (100%) |
| `diretor3` | 0 | 0,00 | 0 | vazio | — | 3º diretor. **Nunca usada** | não |
| `cotistaCCA` | 447 | 5,91 | 2 | texto | `SIM`, `NÃO` | ⚠️ **Não é participante** apesar do nome: é um booleano de cotista registrado pela CCA. Concorda com `cotista` em 386/443 (87%) | não |
| `cca_externo1` | 646 | 8,54 | 107 | texto (e‑mail) | `c***@faceimob.com.br`, `a***@a.com` | E‑mail do analista/agente externo da CCA. 107 grafias = **93 e‑mails distintos** depois de normalizar caixa; 376/646 casam com `Users.email`; 270 não casam (inclui lixo: `a@a.com`, `a@arrombado.com`) | nome_exibicao->Users por e‑mail (58%) |
| `cca_externo2` | 296 | 3,91 | 18 | texto | `c***@faceimob.com.br` | 2º e‑mail CCA. 268/296 casam com `Users.email`. Contém erros de digitação de domínio (`facimob`, `fcaeimob`, `facebook.com.br`) | nome_exibicao->Users por e‑mail (91%) |
| `cca_externo3` | 8 | 0,11 | 6 | texto | `l***@gmail.com`, `j***@mrv.com.br` | 3º e‑mail CCA. 0/8 casam com `Users` | não resolvível |
| `cca_externo4` | 8 | 0,11 | 6 | texto | idem `cca_externo3` (valores idênticos) | 4º e‑mail CCA — **duplicata literal de `cca_externo3`** | não resolvível |
| `vgv_corretor_1` | 0 | 0,00 | 0 | vazio | — | Rateio de VGV do corretor 1. **Nunca preenchida** | não |
| `vgv_corretor_2` | 0 | 0,00 | 0 | vazio | — | idem corretor 2 | não |
| `vgv_gerente_1` | 0 | 0,00 | 0 | vazio | — | Rateio do gerente 1. **Nunca preenchida** | não |
| `vgv_gerente_2` | 0 | 0,00 | 0 | vazio | — | idem gerente 2 | não |

### Grupo 3 — Valores (21 colunas)

| Coluna | Preench. | % | Card. | Tipo | Exemplos brutos | Significado | Referência |
|---|---|---|---|---|---|---|---|
| `VGV BRUTO` | 2.780 | 36,73 | 1.237 | num/texto | `R$ 214.752,17`, `R$ -`, `150000`, `159471` | Valor bruto do negócio. **632 valores são o literal `R$ -`** (= nulo). Numéricos: 2.148, dos quais 2.146 > 0. min 0 · mediana 211.000 · máx 458.000 · soma 465.211.260,70 | não |
| `VGV LIQUIDO` | 7.567 | 99,99 | 1.372 | num/texto | `R$214.752,17`, `R$0,00`, `0`, `150000` | VGV líquido = bruto − desconto. **Sempre preenchida**; 2.146 > 0 e 5.421 = 0. soma 452.572.679,13 | não |
| `vgv_bruto` | 0 | 0,00 | 0 | vazio | — | Duplicata minúscula de `VGV BRUTO`. **Nunca preenchida** | não |
| `vgv_prentedido` | 0 | 0,00 | 0 | vazio | — | "VGV pretendido" (com typo). **Nunca preenchida** | não |
| `ValorAvaliacao` | 43 | 0,57 | 29 | num | `225000`, `255000` | Valor de avaliação do imóvel pelo banco. **Contém outlier `277000194`** (dígito colado) que sozinho responde por 97% da soma | não |
| `ValorCompraVenda` | 58 | 0,77 | 30 | num | `255000`, `275000` | Valor do contrato de compra e venda. min 157.500 · mediana 239.000 · máx 275.000. Bate com `VGV BRUTO` em só 20/54 | não |
| `ValorFGTS` | 50 | 0,66 | 42 | num | `0`, `11276,56`, `2626,14` | Valor de FGTS usado. 38/50 com vírgula decimal | não |
| `ValorFGTSFuturo` | 6 | 0,08 | 1 | num | `0` (todos) | Valor de FGTS futuro. **Todos zero — inútil** | não |
| `FGTS` | 405 | 5,35 | 2 | texto | `NÃO` 347, `SIM` 58 | ⚠️ **Booleano, não valor**: usa FGTS? | não |
| `FGTSFuturo` | 413 | 5,46 | 2 | texto | `NÃO` 403, `SIM` 10 | ⚠️ Booleano: usará FGTS futuro? | não |
| `SubsidioEstadual` | 16 | 0,21 | 3 | num | `20000`, `2070`, `7958` | Subsídio estadual. soma 290.028 | não |
| `SubsidioFederal` | 31 | 0,41 | 28 | num | `20000`, `6093`, `617` | Subsídio federal. soma 321.906 | não |
| `PARC. DESCONTO` | 0 | 0,00 | 0 | vazio | — | Duplicata com ponto. **Nunca preenchida** | não |
| `PARC_DESCONTO` | 661 | 8,73 | 351 | num | `64965`, `2950,74`, `5027,04` | **Desconto concedido em R$** (não é "parcela"). min −2.000 (!) · mediana 12.870 · máx 114.100 · soma 12.638.581,57 | não |
| `ParcelaAprovada` | 455 | 6,01 | 419 | num | `577,85`, `1414,11` | Valor da parcela aprovada pelo banco. min 148,41 · mediana 900,22 · máx 13.615 | não |
| `RendaAprovada` | 457 | 6,04 | 424 | num | `1926,17`, `4713,7` | Renda considerada na aprovação. min 0 · mediana 3.045,21 · máx 19.702,66 | não |
| `rendimentoMensal` | 314 | 4,15 | 192 | num | `4000`, `2850,24` | Renda informada pelo cliente. mediana 2.550 · máx 11.810,02 | não |
| `Fator` | 447 | 5,91 | 2 | texto | `NÃO` 247, `SIM` 200 | ⚠️ Booleano (uso do "fator" na simulação), não número | não |
| `Tabela` | 477 | 6,30 | 2 | texto | `PRICE` 473, `SAC` 4 | Sistema de amortização | não (enum) |
| `Prazo` | 445 | 5,88 | 49 | num/texto | `420`, `360`, `381` | Prazo em meses. mediana 420. **1 outlier `4201`** e 1 valor não numérico | não |
| `dias` | 0 | 0,00 | 0 | vazio | — | **Nunca preenchida** | não |

### Grupo 4 — Status e etapa (9 colunas)

| Coluna | Preench. | % | Card. | Tipo | Significado | Referência |
|---|---|---|---|---|---|---|
| `STATUS` | 7.566 | 99,97 | 5 | texto | **Desfecho do negócio** (`OFF`/`VENDA`/`PROPOSTA`/`DISTRATO`/`PARCEIRO`) → `deals.outcome` | não (enum) |
| `STATUS2` | 7.549 | 99,75 | 29 | texto | **Etapa da esteira de crédito** (`APROV. TOTAL`, `ASS. BANCO`, `BACEN`…) → `pipeline_stages` / `cca_stages` | não (enum) |
| `status_filtro` | 7.566 | 99,97 | 7 | texto | Campo de filtro da UI, **semanticamente quebrado** (mistura cópia de `STATUS` com um sim/não) — ver §4.3 | não |
| `statusNumero` | 6.520 | 86,15 | 21 | num | **Código numérico de `STATUS2`** (ordem/posição na esteira). 1.048 vazios | não (mapeia 1:1 com STATUS2) |
| `mudou_status` | 7.567 | 99,99 | 603 | data | Data da última mudança de status → `deals.stage_entered_at`. 2.039 linhas com `Sep 18, 2024` (carimbo de migração) | não |
| `Off` | 6.942 | 91,73 | 2 | texto | `sim` 4.879 / `não` 2.063. **Booleano redundante**: todas as 4.879 `sim` têm `STATUS='OFF'` | não |
| `enviar` | 0 | 0,00 | 0 | vazio | **Nunca preenchida** | não |
| `ENVIO` | 7.567 | 99,99 | 877 | data | **Data do negócio** (envio para análise) → base para `month_base`/`closed_at` | não |
| `FinanciamentoAprovado` | 73 | 0,96 | 66 | num | Valor do financiamento aprovado (apesar do nome sugerir booleano). Ex.: `180000`, `141457,18` | não |
| `mes` | 7.564 | 99,95 | 67 | data | Competência (sempre dia 1 ou 5). → `deals.month_base` | não |

### Grupo 5 — Empreendimento (4 colunas)

| Coluna | Preench. | % | Card. | Tipo | Exemplos | Significado | Referência |
|---|---|---|---|---|---|---|---|
| `construtora` | 7.551 | 99,78 | 33 | texto | `TENDA` 3.437, `VASCO` 2.108, `MRV` 433 | Construtora — versão legada. 6 linhas com `MAISLAR` (fora do catálogo) | nome_exibicao->Construtoras (99,92%) |
| `CONSTRUTORA2` | 7.546 | 99,71 | 32 | texto | `TENDA` 3.434, `VASCO` 2.107, `MRV` 435 | Construtora — **canônica**, 7.546/7.546 no catálogo | nome_exibicao->Construtoras (100%) |
| `EMPREENDIMENTO` | 7.529 | 99,48 | 688 | num/texto | `SOLAR DO BOSQUE` 542, `RESERVA DO PARQUE` 334, `SOLAR DOS PASSAROS` 288 | Nome do empreendimento. **688 variantes** com duplicatas de caixa (`Garda` 60 vs `GARDA` 171; `Morada do Campo` 40 vs `MORADA DO CAMPO` 142) — não há catálogo de empreendimentos no export | não (vira `developer_projects` por dedup) |
| `BL - UN` | 2.377 | 31,41 | 1.665 | num/texto | `08 \| 102`, `16 -102`, `E - 702`, `ESCOLHER`, `00` | Bloco e unidade. 1.479 no formato `bl \| un`, 400 no formato `a-b`, 242 só dígitos, 256 outros (inclui placeholders `ESCOLHER` 27, `EXTERNO` 6, `00` 27) | não → `deals.unit` |

### Grupo 6 — Origem (6 colunas)

| Coluna | Preench. | % | Card. | Significado |
|---|---|---|---|---|
| `Campanha` | 0 | 0,00 | 0 | **Nunca preenchida** |
| `Canal` | 0 | 0,00 | 0 | **Nunca preenchida** |
| `Criativo Meta` | 0 | 0,00 | 0 | **Nunca preenchida** |
| `Formulário Meta` | 0 | 0,00 | 0 | **Nunca preenchida** |
| `Fonte` | 0 | 0,00 | 0 | **Nunca preenchida** |
| `OrigemLead` | 3.967 | 52,42 | 5 | Origem do lead. Distribuição completa: `Lead Próprio` 2.832 · `Leadfy` 576 · `Lead Indicação` 359 (com NBSP: `Lead\xa0Indicação`) · `Lead Loja` 166 · `Lead Feirão` 34. → `deals.lead_origin` / `lead_sources` |

**Consequência:** toda a atribuição de mídia paga (campanha, criativo, formulário Meta) **não existe** neste export. O vínculo negócio→campanha só poderá ser reconstruído indiretamente, via `leadfies` (a tabela de leads), se lá houver `Identificador`/campanha e casamento por telefone.

### Grupo 7 — Documentos e CCA (12 colunas)

| Coluna | Preench. | % | Card. | Tipo | Significado | Referência |
|---|---|---|---|---|---|---|
| `doc` | 2.857 | 37,75 | 2.857 | **uid** | Ponteiro para o registro de documentos. **2.857/2.857 casam com `doc-clientes.unique id`** — única FK por id que sobreviveu | **unique_id->doc-clientes (100%)** |
| `documentos` | 4.330 | 57,21 | 4.330 | texto | Lista de URLs do CDN Bubble, **separadas por `" , "`**. 29.447 URLs no total (1 a 49 por linha; mediana 6). Ex.: `//0b42…cdn.bubble.io/f1743775921498x…/cnh.pdf` | lista de URLs externas |
| `financeiro` | 7 | 0,09 | 7 | uid (lista) | Lista de ids de `financeiros` separada por `" , "`. Só 7 linhas — a tabela `financeiros` tem 26 registros | unique_id->financeiros (lista) |
| `RefCCHcca` | 249 | 3,29 | 12 | texto | Mês de referência da CCH registrado pela CCA. Concorda com `ref_cch` em 213/241 (88%) | não |
| `declaraImpostoRenda` | 4.175 | 55,17 | 2 | texto | `não` 4.174, `sim` 1. **Praticamente constante — sem valor informativo** | não |
| `emiteNota` | 4.175 | 55,17 | **1** | texto | `não` 4.175. **Constante — descartar** | não |
| `rendaInformal` | 483 | 6,38 | 2 | texto | `sim` 340, `não` 143 | não |
| `ObsRenda` | 162 | 2,14 | 162 | texto | Texto livre sobre a origem da renda informal. Ex.: "CLIENTE POSSUI SALAO DE BELEZA" | não |
| `formaAtuacao` | 311 | 4,11 | 169 | texto | Forma de atuação profissional. **Sujo**: `AUTONOMA` 31, `AUTONOMO` 27, `PRESENCIAL ` 23 (com espaço), `PRESENCIAL` 13, `presencial ` 7 | não |
| `formaDivulgacao` | 283 | 3,74 | 3 | texto | `Indicação` 214 · `Mídias Sociais` 66 · `Panfletagem` 3 | não (enum limpo) |
| `segmentoAtividade` | 312 | 4,12 | 242 | texto | Ramo do trabalho informal: `MOTOBOY` 9, `VENDEDORA` 6, `DIARISTA` 5. Texto livre | não |
| `dataInicioAtividade ` (⚠️ nome com **espaço no final**) | 306 | 4,04 | 120 | num/texto | **Não é data**: 0/306 parseiam como data. Mistura duração (`2 ANOS` 30, `1 ANO` 26) com data (`01/02/2025`) e lixo (`INTEGRAL`) | não |

### Grupo 8 — Gamificação (3 colunas)

| Coluna | Preench. | % | Card. | Tipo | Significado | Referência |
|---|---|---|---|---|---|---|
| `GameCorretor1` | 1.367 | 18,06 | 338 | **uid** | Registro de gamificação do corretor 1. **1.367/1.367 casam com `gameficacaos.unique id`** | **unique_id->gameficacaos (100%)** |
| `GameCorretor2` | 69 | 0,91 | 44 | **uid** | idem corretor 2. **69/69 casam** | **unique_id->gameficacaos (100%)** |
| `gameEsteiraAgilPontuada` | 1.266 | 16,73 | 2 | texto | `sim` 1.028, `não` 238. Marca se o bônus de "esteira ágil" já foi pontuado (idempotência) | não |

### Grupo 9 — Observações (2 colunas)

| Coluna | Preench. | % | Card. | Significado |
|---|---|---|---|---|
| `obs` | 0 | 0,00 | 0 | **Nunca preenchida** |
| `OBSERVAÇÃO` | 4.238 | 56,00 | 3.279 | Observação do negócio. Tamanho: mín 2 · mediana 45 · p95 253 · máx 1.254 caracteres. **966 contêm quebra de linha** → obriga parser CSV real. Ex. mascarados: `EM ANÁLISE`, `SEGUE DOCUMENTACAO PARA ANALISE` |

⚠️ O histórico completo de observações está em `observacaoPipelines` (24.766 registros); `OBSERVAÇÃO` é só a última.

### Metadados Bubble (5 colunas)

| Coluna | Preench. | % | Card. | Significado |
|---|---|---|---|---|
| `Creation Date` | 7.568 | 100 | 6.402 | Criação do registro. 100% parseável |
| `Modified Date` | 7.568 | 100 | 4.083 | Última alteração |
| `Slug` | 0 | 0,00 | 0 | **Nunca preenchida** |
| `Creator` | 7.568 | 100 | 139 | Quem criou o registro (nome de exibição). `Douglas Gomes` 1.973, `(App admin)` 1.081, `Felipe di Pompo` 313, `(deleted thing)` 151 → `deals.created_by` |
| `unique id` | 7.568 | 100 | 7.568 | **PK do Bubble**. Único, sem nulos |

---

## 4. (b) Status: distribuições completas e como se relacionam

### 4.1 `STATUS` — distribuição completa (5 valores + vazio)

| Valor | Contagem | % | Leitura |
|---|---|---|---|
| `OFF` | 5.077 | 67,08% | Negócio morto/encerrado sem venda |
| `VENDA` | 1.829 | 24,17% | Venda concluída |
| `PROPOSTA` | 494 | 6,53% | Em andamento |
| `DISTRATO` | 158 | 2,09% | Venda desfeita |
| `PARCEIRO` | 8 | 0,11% | Venda de parceiro externo |
| *(vazio)* | 2 | 0,03% | |

→ **`deals.outcome`**: `VENDA`/`PARCEIRO` → `won`; `OFF` → `lost`; `DISTRATO` → `cancelled`; `PROPOSTA` → `open`.

### 4.2 `STATUS2` — distribuição completa (29 valores + vazio)

| Valor | Contagem | `statusNumero` correspondente |
|---|---|---|
| `APROV. TOTAL` | 1.172 | 9 |
| `ASSINADO` | 718 | 3 (670) / 4 (42) |
| `ASS. BANCO` | 699 | 2 |
| `PENDENTE` | 668 | 16 |
| `APROV. COND.` | 663 | 10 |
| `REPROVADO` | 590 | 19 |
| `INCOMPLETO` | 551 | *(vazio, 548)* |
| `BACEN` | 465 | 20 |
| `EM CONTRATO` | 423 | 4 |
| `ESTEIRA AGIL` | 361 | 13 |
| `RESTRIÇÃO` | 201 | 21 |
| `PENDENTE C/ RESTRIÇÃO` | 186 | *(vazio)* |
| `DISTRATO` | 170 | 17 |
| `QUEDA` | 120 | 18 |
| `APROVADO POTENCIAL` | 96 | *(vazio)* |
| `ANÁLISE EXTERNA` | 86 | *(vazio, 85)* |
| `VIROU NEGÓCIO` | 81 | 8 |
| `APROV. TOT. RESTRIÇÃO` | 69 | *(vazio)* |
| `ANÁLISE P/ VIRAR NEGÓCIO` | 68 | 14 (65) / 15 (3) |
| `INTERNALIZADO` | 44 | 15 |
| `PENDENTE P/ VIRAR NEGÓCIO` | 36 | 14 |
| `APROV. COND. RESTRIÇÃO` | 36 | *(vazio)* |
| `APROV. AG. CONT.` | 20 | 7 |
| *(vazio)* | 19 | *(vazio)* |
| `RET. ESTEIRA AGIL` | 13 | *(vazio, 9)* |
| `AG. RET. AGENCIA` | 8 | 11 |
| `EM PROCESSAMENTO` | 2 | 12 |
| `RP APROVADO` | 1 | 5 |
| `ENVIO DE RP` | 1 | 6 |
| `RC EMITIDA` | 1 | 1 |

⚠️ **Três rótulos contêm NBSP (`\xa0`) no lugar do espaço**: `PENDENTE\xa0C/\xa0RESTRIÇÃO`, `ANÁLISE P/ VIRAR\xa0NEGÓCIO`, `AG. RET.\xa0AGENCIA`. Qualquer comparação por string exata precisa normalizar `\xa0` → espaço, ou 262 linhas caem fora do mapeamento.

### 4.3 `status_filtro` — distribuição completa (7 valores + vazio)

| Valor | Contagem | 2024 | 2025 | 2026 |
|---|---|---|---|---|
| `não` | 3.618 | 954 | 1.644 | 1.020 |
| `PROPOSTA` | 1.352 | 571 | 417 | 364 |
| `VENDA` | 1.012 | 524 | 356 | 132 |
| `sim` | 798 | 54 | 238 | 506 |
| `OFF` | 758 | 747 | 5 | 6 |
| `DISTRATO` | 19 | 12 | 6 | 1 |
| `PARCEIRO` | 9 | 9 | 0 | 0 |
| *(vazio)* | 2 | 1 | 0 | 1 |

**A coluna foi reaproveitada e está semanticamente quebrada.** Duas gerações de significado convivem:
- geração antiga: cópia de `STATUS` (`OFF`/`VENDA`/`PROPOSTA`/`DISTRATO`/`PARCEIRO`), 3.148 linhas;
- geração nova: booleano `sim`/`não`, 4.416 linhas, crescendo ano a ano (54 → 238 → 506 para `sim`).

Concordância com `STATUS` é ruim: `STATUS='VENDA'` aparece como `filtro='PROPOSTA'` em 1.027 linhas e como `filtro='VENDA'` em só 789. Cruzando com `Off`: `filtro='não'` + `Off='sim'` = 3.612 — ou seja, na geração nova `status_filtro` é praticamente a **negação** de `Off`, e não um status.

→ **Recomendação: descartar `status_filtro` na importação.** Não é fonte confiável de etapa nem de desfecho.

### 4.4 `statusNumero` — distribuição completa (21 valores + vazio)

`9` 1.176 · *(vazio)* 1.048 · `2` 695 · `3` 672 · `16` 672 · `10` 665 · `19` 586 · `20` 469 · `4` 468 · `13` 364 · `21` 201 · `17` 168 · `18` 119 · `14` 101 · `8` 82 · `15` 48 · `7` 20 · `11` 8 · `12` 3 · `5` 1 · `6` 1 · `1` 1.

### 4.5 Como as quatro colunas se relacionam

```
STATUS        = desfecho  (5 valores)          → deals.outcome
STATUS2       = etapa     (29 valores)         → pipeline_stages.code / cca_stages
statusNumero  = código de STATUS2 (21 valores) → pipeline_stages.position (parcial)
status_filtro = lixo de UI, duas gerações      → descartar
Off           = booleano redundante de STATUS='OFF'
```

- **`statusNumero` → `STATUS2` é praticamente 1:1** (ver tabela em §4.2). As exceções são poucas dezenas de linhas e são erros de digitação, não ambiguidade real. **Mas o mapa é incompleto:** os 1.048 vazios cobrem 6 rótulos que nunca receberam número (`INCOMPLETO` 548, `PENDENTE C/ RESTRIÇÃO` 186, `APROVADO POTENCIAL` 96, `ANÁLISE EXTERNA` 85, `APROV. TOT. RESTRIÇÃO` 69, `APROV. COND. RESTRIÇÃO` 36) — rótulos criados em 2025/2026, depois que a numeração parou de ser mantida. **`statusNumero` não serve como `position` das etapas novas.**
- **`STATUS` × `STATUS2` é hierárquico e consistente**: `VENDA` concentra `ASSINADO` (710), `ASS. BANCO` (699), `EM CONTRATO` (418); `OFF` concentra `APROV. TOTAL` (1.120), `PENDENTE` (633), `APROV. COND.` (630), `REPROVADO` (546). Ou seja, **`STATUS2` é a etapa da esteira de crédito e continua registrada mesmo depois do negócio morrer** — a etapa não é reescrita quando `STATUS` vira `OFF`.
- **`Off` é redundante**: as 4.879 linhas com `Off='sim'` são exatamente linhas com `STATUS='OFF'`. Restam 146 `OFF`+`não` e 52 `OFF`+vazio (inconsistências de gravação). Descartar.

### 4.6 Distribuição por ano (`STATUS2` × ano de criação) — rótulos que nasceram e morreram

Sinaliza quais etapas ainda estão vivas em 2026 e devem virar `pipeline_stages` ativas:

- **Vivas em 2026:** `INCOMPLETO` (288), `PENDENTE` (156), `APROV. TOTAL` (232), `ASS. BANCO` (175), `EM CONTRATO` (185), `BACEN` (210), `REPROVADO` (143), `PENDENTE C/ RESTRIÇÃO` (124), `APROVADO POTENCIAL` (88), `ANÁLISE EXTERNA` (77), `APROV. COND.` (113).
- **Mortas (só 2024):** `APROV. AG. CONT.` (20), `RP APROVADO`, `ENVIO DE RP`, `RC EMITIDA`, `ANÁLISE P/ VIRAR NEGÓCIO` (64 em 2024, 4 em 2025), `INTERNALIZADO` (41 em 2024, 3 depois).
- **Em queda:** `ESTEIRA AGIL` (261 → 71 → 29), `RESTRIÇÃO` (151 → 47 → 3), `ASSINADO` (566 → 104 → 48, substituída por `ASS. BANCO`: 112 → 412 → 175).

---

## 5. (c) Pares duplicados: qual coluna é a boa

| Par | Preench. A | Preench. B | Ambos | Iguais quando ambos | **Coluna boa** | Por quê |
|---|---|---|---|---|---|---|
| `VGV BRUTO` × `vgv_bruto` | 2.780 | **0** | 0 | — | **`VGV BRUTO`** | `vgv_bruto` é 100% vazia. Não há escolha |
| `PARC. DESCONTO` × `PARC_DESCONTO` | **0** | 661 | 0 | — | **`PARC_DESCONTO`** | `PARC. DESCONTO` é 100% vazia |
| `corretor` × `CORRETOR 1` | 7.347 | 7.349 | 7.346 | 7.065 (96,2%) | **`CORRETOR 1`** | 215 grafias vs 287; **7.349/7.349 casam com o catálogo `corretors`** contra 108 linhas de `corretor` fora dele (`CAROLINE FARIAS` 71, `KELVIN VIANA` 25, `THABATA NOBRE` 8, `JUNIOR REZENDES` 3, `INTEGRACAO LEADFY` 1). As 281 divergências são apelido vs nome completo (`Isaias Ribeiro Luca` vs `Isaias Lucca`, `Janaina Silva de Fraga Maciel` vs `Janaina Fraga`) |
| `gerente` × `GERENTE 1` | 7.511 | 7.521 | 7.511 | 7.217 (96,1%) | **`GERENTE 1`** | 17 grafias vs 26 (mistura CAIXA ALTA/Title Case); **7.521/7.521 casam com `gerentes`** contra 127 linhas de `gerente` fora dele (`ROBERTO SANTOS MENDES` 69, `FACEIMOB` 58). Divergências típicas: `Faceimob` → `Gerente Interino` |
| `gerente2` × `GERENTE2` | 154 | 155 | 154 | 151 (98%) | **`GERENTE2`** | Mesmo padrão: 155/155 no catálogo `gerentes` |
| `construtora` × `CONSTRUTORA2` | 7.551 | 7.546 | 7.546 | 7.539 (99,9%) | **`CONSTRUTORA2`** com fallback em `construtora` | `CONSTRUTORA2` tem 0 valores fora do catálogo; `construtora` tem 6 (`MAISLAR`, que é `MAIS LAR` sem espaço). Mas `construtora` cobre 5 linhas em que `CONSTRUTORA2` está vazia → usar `COALESCE(CONSTRUTORA2, construtora)` |
| `obs` × `OBSERVAÇÃO` | **0** | 4.238 | 0 | — | **`OBSERVAÇÃO`** | `obs` é 100% vazia |
| `ref_cch` × `RefCCHcca` | 4.227 | 249 | 241 | 213 (88%) | **`ref_cch`** | `RefCCHcca` é o registro paralelo da CCA, muito menos preenchido |
| `cotista` × `cotistaCCA` | 4.607 | 447 | 443 | 386 (87%) | **`cotista`** | idem |
| `FGTS` × `ValorFGTS` | 405 | 50 | 49 | 0 | **não são par** | `FGTS` é booleano `SIM/NÃO`; `ValorFGTS` é o valor em R$. Ambos úteis, campos distintos |
| `FGTSFuturo` × `ValorFGTSFuturo` | 413 | 6 | 5 | 0 | **`FGTSFuturo`** | idem; `ValorFGTSFuturo` é todo zero |
| `doc` × `documentos` | 2.857 | 4.330 | 2.163 | 0 | **ambos** | Não são duplicatas: `doc` é o id do registro de documentos, `documentos` é a lista de URLs diretas. **2.167 linhas só têm `documentos`** (sem registro em `doc-clientes`) e **694 só têm `doc`** |
| `VGV BRUTO` × `VGV LIQUIDO` | 2.780 | 7.567 | 2.780 | 1.524 | **ambos** | `LIQUIDO = BRUTO − PARC_DESCONTO`, confirmado em 661/661 |
| `ValorCompraVenda` × `VGV BRUTO` | 58 | 2.780 | 54 | 20 | **`VGV BRUTO`** | `ValorCompraVenda` diverge em 34/54 e cobre 0,8% da base |

---

## 6. (d) Formato dos valores monetários

**Sim, tem `R$`; sim, vírgula decimal; sim, ponto de milhar. Não é uniforme dentro da mesma coluna.**

`VGV BRUTO` (2.780 valores) tem quatro formatos convivendo:

| Padrão | Ocorrências | Exemplo |
|---|---|---|
| Só dígitos (inteiro) | 1.197 | `150000` |
| Vírgula decimal, sem milhar | 679 | `187642,71` |
| `R$ ` + traço (nulo formatado) | **632** | `R$ -` |
| `R$ ` + ponto milhar + vírgula decimal | 272 | `R$ 214.752,17` |

`VGV LIQUIDO` (7.567): só dígitos 5.915 · vírgula 691 · `R$` + vírgula 666 (todos `R$0,00`) · `R$` + ponto + vírgula 295 (`R$214.752,17`, **sem espaço depois do `R$`**, ao contrário de `VGV BRUTO`).

**Regra de parsing obrigatória:**

```python
def money(v):
    v = v.strip()
    if not v: return None
    v = v.lower().replace('r$', '').strip().replace(' ', '')
    if v in ('-', ''): return None          # 'R$ -' = nulo, 632 casos
    if ',' in v and '.' in v:               # 1.234.567,89 -> ponto = milhar
        v = v.replace('.', '').replace(',', '.')
    elif ',' in v:                          # 1234,56
        v = v.replace(',', '.')
    return float(v)
```

Demais colunas monetárias **não usam `R$` nem ponto de milhar** — só dígitos ou vírgula decimal:
`PARC_DESCONTO` (531 só dígitos / 130 com vírgula) · `ParcelaAprovada` (77/377) · `RendaAprovada` (86/369) · `rendimentoMensal` (211/103) · `ValorFGTS` (12/38) · `ValorAvaliacao` (41/2) · `ValorCompraVenda` (56/2) · `SubsidioEstadual` e `SubsidioFederal` (100% só dígitos) · `FinanciamentoAprovado` (mistura).

Duas exceções que enganam pelo nome: `ParcelaAprovada` e `RendaAprovada` têm 1 e 2 valores com **vírgula E ponto** — validar caso a caso.

---

## 7. (e) Quantos negócios têm 1, 2, 3 corretores

Contando **pessoas distintas** (normalizando caixa) por linha:

**Usando só as colunas canônicas `CORRETOR 1` / `CORRETOR 2` / `CORRETOR 3`:**

| Corretores no negócio | Negócios | % |
|---|---|---|
| 0 | 204 | 2,70% |
| 1 | 6.536 | 86,36% |
| 2 | 824 | 10,89% |
| 3 | 4 | 0,05% |

**Usando as 5 colunas (canônicas + legadas `corretor` e `corretor2`):**

| Corretores distintos | Negócios |
|---|---|
| 0 | 203 |
| 1 | 6.270 |
| 2 | 1.027 |
| 3 | 68 |

A diferença (68 vs 4 com três corretores) é **artefato de grafia**: `corretor` e `CORRETOR 1` guardam a mesma pessoa com nomes diferentes (`Isaias Ribeiro Luca` / `Isaias Lucca`), inflando a contagem de distintos. **Usar apenas as colunas canônicas.**

**Gerentes** (`GERENTE 1` + `GERENTE 3`): 0 → 47 · 1 → 7.514 · 2 → 7. Contando também `GERENTE2`: 0 → 46 · 1 → 7.113 · 2 → 403 · 3 → 6.
**Diretores** (`Diretor1` + `diretor2`): 0 → 2.471 · 1 → 5.072 · 2 → 25.
**CCA externo** (`cca_externo1..4`): 0 → 6.922 · 1 → 646 (nunca mais de um analista distinto por negócio, porque `cca_externo3` e `4` são cópias).

**Preenchimento posicional:** `CORRETOR 1` 7.349 · `CORRETOR 2` 849 · `CORRETOR 3` 5 · `GERENTE 1` 7.521 · `GERENTE2` 155 · `GERENTE 3` 7 · `Diretor1` 5.086 · `diretor2` 73 · `diretor3` 0.

---

## 8. (f) As colunas de participante são nome de exibição ou `unique id`?

**Todas as colunas de participante são NOME DE EXIBIÇÃO. Zero `unique id`.** Confirmado com regex `^\d{13}x\d{10,25}$` sobre 100% dos valores:

| Coluna | n | `unique id` | nome |
|---|---|---|---|
| `corretor`, `CORRETOR 1/2/3`, `corretor2` | 7.347 / 7.349 / 849 / 5 / 845 | **0** | 100% |
| `gerente`, `GERENTE 1/3`, `gerente2`, `GERENTE2` | 7.511 / 7.521 / 7 / 154 / 155 | **0** | 100% |
| `Diretor1`, `diretor2` | 5.086 / 73 | **0** | 100% |
| `construtora`, `CONSTRUTORA2`, `EMPREENDIMENTO` | 7.551 / 7.546 / 7.529 | **0** | 100% |
| `Creator` | 7.568 | **0** | 100% |
| `cca_externo1..4` | 646 / 296 / 8 / 8 | **0** | e‑mail (não nome) |

**As únicas colunas com `unique id` de verdade:**

| Coluna | n | uid | Alvo | Integridade |
|---|---|---|---|---|
| `doc` | 2.857 | 2.857 (100%) | `doc-clientes.unique id` | **2.857/2.857 casam** |
| `GameCorretor1` | 1.367 | 1.367 (100%) | `gameficacaos.unique id` | **1.367/1.367 casam** |
| `GameCorretor2` | 69 | 69 (100%) | `gameficacaos.unique id` | **69/69 casam** |
| `financeiro` | 7 | lista `" , "` de uids | `financeiros` | 6 das 7 são listas com 2+ ids |

**Ambiguidade do separador `" , "`:** só `documentos` (4.192 linhas com o separador) e `financeiro` (6) usam listas. Ambas contêm URLs e uids — **nenhum dos dois pode conter vírgula**, então o split é seguro nesses dois casos. **Nenhuma coluna de nome de pessoa é lista**, portanto o problema de nome-com-vírgula não se materializa aqui. (`EMPREENDIMENTO` tem 1 valor com vírgula, mas não é lista.)

**Resolução de nome → pessoa (crítico para o mapeamento):**

| Coluna | distintos | casa em `corretors.Nome` | casa em `gerentes.nome` | casa em `Users.Nome_completo` (exato) | fora de todos |
|---|---|---|---|---|---|
| `CORRETOR 1` | 210 | **7.349 (100%)** | 1.718 | 2.164 (29%) | **0** |
| `CORRETOR 2` | 120 | **849 (100%)** | 225 | 211 | 0 |
| `corretor` | 222 | 7.081 | 1.715 | 2.322 | **108 (5 nomes)** |
| `GERENTE 1` | 17 | 7.185 | **7.521 (100%)** | 914 (12%) | **0** |
| `GERENTE2` | 14 | 146 | **155 (100%)** | 16 | 0 |
| `gerente` | 21 | 7.070 | 7.286 | 949 | **127 (2 nomes)** |
| `Diretor1` | 5 | **5.086 (100%)** | 5.086 (100%) | **0 (0%)** | 0 |

⚠️ **Risco alto no caminho até `profiles`.** As colunas canônicas casam 100% com os catálogos intermediários (`corretors`, `gerentes`), mas **esses catálogos não resolvem para `Users` por nome exato**: só 56 dos 210 nomes de `CORRETOR 1` batem com `Users.Nome_completo`; afrouxando para primeiro+último nome, 154/210. Sobram **56 corretores sem match nenhum** (`ADRIEL DIAS`, `ALISSON LUIZ`, `ARCHIMEDES BOFF`, `JUNIOR MORAES`, `LUCAS TELLES`, `IMOB PRIME`…) e 5 dos 17 gerentes (`ALISSON LUIZ`, `ARCHIMEDES BOFF`, `VERONICA OLIVEIRA`, `VICTOR RAFAEL`, `ZONA SUL`).
Agravantes: `corretors` tem **12 nomes duplicados** (`FELIPE DI POMPO` aparece 3×, `ALEXANDRE CHAVES` 2×…) em 365 linhas / 352 nomes distintos, e `corretors.user` **também é nome de exibição, não uid** (294 preenchidos, 0 uids). `Users` tem 296 nomes distintos em 298 linhas.
Há valores que não são pessoa: `Parceiro Externo` (115 negócios), `IMOB PRIME`, `Gerente Interino` (190), `Zona Sul` (146), `Faceimob`, `INTEGRACAO LEADFY`.

**Consequência:** o mapeamento nome→`profiles.id` vai precisar de uma **tabela de‑para curada à mão** (~215 corretores + 17 gerentes + 5 diretores), não de um join automático. Placeholders (`Parceiro Externo`, `Gerente Interino`, `Zona Sul`) precisam virar perfis sintéticos ou `NULL` com registro em `deals.notes`.

---

## 9. (g) `construtora` vs `CONSTRUTORA2` vs catálogo de Construtoras

Catálogo: `export_All-Construtoras-modified_2026-09-08_19-36-44.csv`, **41 construtoras** (`ABACO, ADITAR, APICE, AVULSO, BALIZA, BELMAIS, BELMONTE, BOLOGNESI, CELSUL, CNT, CONCORDIA, COUTO, CYRELA, DALLASANTA, ELIOWINTER, ENGEPP, Harmonia, LOTTICCI, LOTTICI, LOTUS, LYX, MAIS LAR, MC3, MELNICK, MGF, MMR, MNB, MORANA, MRV, PARADIS, PAVEI, RNI, RODOBENS, RPM, SALIS, SOLV, SOUTH, TENDA, VASCO, VIEZZER, VIVER`).

| Coluna | Preenchidos | Casam por nome | Casam por uid | **Não casam** |
|---|---|---|---|---|
| `construtora` | 7.551 | 7.545 (99,92%) | 0 | **6** — todos `MAISLAR` (é `MAIS LAR` sem espaço) |
| `CONSTRUTORA2` | 7.546 | **7.546 (100%)** | 0 | **0** |

As duas divergem entre si em apenas 7 linhas (`AVULSO`↔`VIEZZER`, `MAISLAR`↔`MAIS LAR`, `AVULSO`↔`CELSUL`, `VASCO`↔`MNB`, `TENDA`↔`MRV`, +2). 17 linhas não têm nenhuma das duas.

**Distribuição de `CONSTRUTORA2` (32 valores distintos — completa até o top 30):**
`TENDA` 3.434 · `VASCO` 2.107 · `MRV` 435 · `MC3` 397 · `LYX` 351 · `MORANA` 193 · `APICE` 133 · `SOUTH` 87 · `AVULSO` 56 · `MELNICK` 51 · `ABACO` 44 · `CYRELA` 42 · `LOTUS` 42 · `MNB` 33 · `BOLOGNESI` 25 · `MAIS LAR` 20 · `BALIZA` 17 · `RNI` 15 · `MMR` 14 · `CELSUL` 13 · `COUTO` 8 · `LOTTICI` 7 · `SALIS` 6 · `MGF` 4 · `BELMAIS` 3 · `RODOBENS` 2 · `VIEZZER` 2 · `VIVER` 1 · `ENGEPP` 1 · `CONCORDIA` 1 · (cauda: 2 valores, 2 linhas).

Duas construtoras concentram **73% dos negócios** (TENDA + VASCO = 5.541/7.568).

⚠️ O catálogo tem `LOTTICCI` **e** `LOTTICI` (provável duplicata) — mas os negócios só usam `LOTTICI` (7). 11 construtoras do catálogo nunca aparecem em negócio nenhum.

---

## 10. (h) VGV > 0 e status de venda concluída, por ano

Usando `VGV BRUTO` (com fallback em `VGV LIQUIDO`; são equivalentes: ambos > 0 nas mesmas 2.146 linhas) e ano de `Creation Date`.

**Venda concluída (`STATUS = 'VENDA'`) com VGV > 0:**

| Ano | Negócios | VGV bruto somado |
|---|---|---|
| 2024 | **784** | R$ 157.038.717,83 |
| 2025 | **637** | R$ 142.943.730,37 |
| 2026 (até 08/09) | **408** | R$ 96.900.818,32 |
| **Total** | **1.829** | **R$ 396.883.266,52** |

**100% das 1.829 linhas com `STATUS='VENDA'` têm VGV > 0** — não há venda sem valor. VGV líquido correspondente: R$ 385.834.994,23 (diferença de R$ 11,0 mi = descontos).

**Demais status com VGV > 0** (total geral: 2.146 linhas com valor):

| Status | 2024 | 2025 | 2026 | Total | VGV somado |
|---|---|---|---|---|---|
| `VENDA` | 784 | 637 | 408 | 1.829 | R$ 396.883.266,52 |
| `DISTRATO` | 77 | 56 | 25 | 158 | R$ 34.272.886,62 |
| `OFF` | 58 | 66 | 19 | 143 | R$ 30.929.868,22 |
| `PARCEIRO` | 8 | 0 | 0 | 8 | R$ 1.222.642,54 |
| `PROPOSTA` | 1 | 0 | 7 | 8 | R$ 1.902.596,80 |

- **`DISTRATO` = venda que foi desfeita** — todas as 158 têm valor, o que confirma que passaram por venda antes. Para VGV realizado, subtrair.
- **`OFF` com VGV > 0 (143)** são vendas que caíram depois de fechadas: `STATUS2='QUEDA'` em 104 delas, `DISTRATO` em 11.
- **`PARCEIRO` (8)** são vendas de parceiro externo, todas de 2024 — tratar como `won` com marcação.

**Total de negócios sem valor: 5.422 (71,6%)** — são `PROPOSTA` em andamento e, sobretudo, `OFF` que nunca chegaram a venda.

---

## 11. Relacionamentos

### Saindo de `pipelines`

| Coluna | Formato | Aponta para | Integridade medida |
|---|---|---|---|
| `doc` | `unique id` | `doc-clientes.unique id` (25.890 registros) | **2.857/2.857 (100%)** |
| `GameCorretor1` | `unique id` | `gameficacaos.unique id` (1.063 registros) | **1.367/1.367 (100%)** |
| `GameCorretor2` | `unique id` | `gameficacaos.unique id` | **69/69 (100%)** |
| `financeiro` | lista de `unique id` | `financeiros` (26 registros) | 7 linhas |
| `CORRETOR 1/2/3` | nome | `corretors.Nome` (365 linhas / 352 nomes) | **100% dos preenchidos** |
| `GERENTE 1/3`, `GERENTE2` | nome | `gerentes.nome` (22 linhas / 20 nomes) | **100%** |
| `Diretor1`, `diretor2` | nome | `gerentes.nome` / `corretors.Nome` | **100%** |
| `CONSTRUTORA2` | nome | `Construtoras.nome` (41) | **100%** |
| `construtora` | nome | `Construtoras.nome` | 99,92% (6 falham) |
| `cca_externo1/2` | e‑mail | `Users.email` (298) | 58% / 91% |
| `cca_externo3/4` | e‑mail | — | **0%** |
| `Creator` | nome | `Users.Nome_completo` | não medido isoladamente |
| `EMPREENDIMENTO` | texto livre | **sem catálogo no export** | — |

### Chegando em `pipelines` — ⚠️ todas quebradas por id

| Tabela filha | Registros | Coluna FK | Formato observado |
|---|---|---|---|
| `doc-clientes` | 25.890 | `pipeline` | **nome do cliente** (0 uids) |
| `observacaoPipelines` | 24.766 | `pipeline` | **nome do cliente** (0 uids) |
| `historicoPipes` | 10.343 | `pipeline` | **nome do cliente** (0 uids) |
| `financeiros` | 26 | `pipeline` | **nome do cliente** (0 uids) |
| `vendas` | 6 | `pipeline` | **nome do cliente** (0 uids) |

**Este é o maior risco estrutural da importação.** Como o export é do tipo `-modified`, o Bubble renderizou a FK `pipeline` como o texto de exibição do negócio, que é o **nome do cliente**. Consequências:

- 7.426 nomes de cliente distintos para 7.568 negócios → **127 nomes repetidos, cobrindo 257 linhas**, que não podem ser desambiguados pela FK.
- O caminho seguro para documentos é o inverso: `pipelines.doc` → `doc-clientes.unique id`, que é 100% íntegro. Mas isso só cobre **2.857 negócios** (37,7%); os outros 2.167 negócios com `documentos` preenchido e sem `doc` só têm as URLs diretas.
- Para `observacaoPipelines` (24.766 registros) e `historicoPipes` (10.343) **não existe caminho por id**. Ou se aceita o join por nome (com 257 linhas ambíguas), ou se re-exporta essas tabelas do Bubble **sem** o sufixo `-modified`.

**Recomendação:** pedir novo export de `observacaoPipelines`, `historicoPipes` e `doc-clientes` no formato cru (com `unique id` nas FKs) antes de importar o histórico. Se isso não for possível, importar `deals` + `deal_clients` + `deal_participants` agora e o histórico depois, por nome, marcando as 257 linhas ambíguas.

---

## 12. Chave natural

**`unique id`** é a única chave real: 7.568 valores, 7.568 distintos, 0 nulos. **Deve ser preservado** numa coluna de rastreio (`deals.code` ou um `legacy_id`) — é o que permitirá reconciliar reimportações e ligar as tabelas filhas se um export cru chegar depois.

Chaves de negócio alternativas, todas piores:

| Candidata | Distintas | Repetidas | Linhas afetadas |
|---|---|---|---|
| `unique id` | 7.568 | 0 | 0 |
| (`CLIENTE`, `EMPREENDIMENTO`, `BL - UN`) | 7.526 | 25 | 51 |
| (`CLIENTE`, `EMPREENDIMENTO`) | 7.515 | 35 | 72 |
| (`cpf_numero` 11 dígitos, `EMPREENDIMENTO`) | 5.374 | 14 | 28 |
| `CLIENTE` sozinho | 7.422 | 127 | 257 |
| `cpf_numero` sozinho | 5.383 | 43 | 86 |

---

## 13. Problemas de qualidade

**Estruturais**

1. **17 colunas 100% vazias** (16,2% do domínio): `Campanha`, `Canal`, `Criativo Meta`, `Formulário Meta`, `Fonte`, `dias`, `diretor3`, `enviar`, `obs`, `PARC. DESCONTO`, `vgv_bruto`, `vgv_corretor_1`, `vgv_corretor_2`, `vgv_gerente_1`, `vgv_gerente_2`, `vgv_prentedido`, `Slug`. **Não há rateio de VGV por participante nem atribuição de mídia paga.**
2. **FKs das tabelas filhas vêm como nome de cliente**, não uid (§11). 257 linhas ficam ambíguas.
3. **Nenhuma coluna de participante traz uid**; resolução até `profiles` exige de‑para manual de ~237 nomes, com 56 corretores e 5 gerentes sem correspondência em `Users`.
4. **Sem catálogo de empreendimentos**: 688 valores livres em `EMPREENDIMENTO`, com duplicatas por caixa (`GARDA` 171 / `Garda` 60; `MORADA DO CAMPO` 142 / `Morada do Campo` 40). Precisa de dedup normalizado antes de virar `developer_projects`.
5. **Coluna com espaço no nome:** `dataInicioAtividade ` (espaço final). Quebra qualquer acesso por nome literal.

**Semânticos**

6. **`status_filtro` tem duas gerações de significado** convivendo (cópia de `STATUS` até 2024, booleano `sim/não` depois). Descartar.
7. **`statusNumero` está incompleto**: 1.048 vazios cobrindo 6 rótulos criados em 2025/26. Não serve como `position`.
8. **Nomes de colunas mentem sobre o tipo**: `FGTS`/`FGTSFuturo`/`Fator`/`cotistaCCA` são booleanos `SIM/NÃO`, não valores; `FinanciamentoAprovado` é valor em R$, não booleano; `PARC_DESCONTO` é desconto em R$, não parcela; `dataInicioAtividade` é duração em texto, não data.
9. **Colunas constantes, sem informação:** `emiteNota` (100% `não`, 4.175 linhas), `declaraImpostoRenda` (4.174 `não` × 1 `sim`), `ValorFGTSFuturo` (6 valores, todos 0). Descartar.
10. **`cca_externo3` e `cca_externo4` são cópias literais** uma da outra (mesmos 8 valores, mesmos 6 distintos).

**Sujeira de dado**

11. **NBSP (`\xa0`) dentro de valores** em 3 rótulos de `STATUS2` (262 linhas) e em `OrigemLead` (`Lead\xa0Indicação`, 359 linhas). Normalizar antes de comparar.
12. **`R$ -` como nulo** em 632 valores de `VGV BRUTO`; `R$0,00` em 666 de `VGV LIQUIDO`.
13. **Formatação monetária mista** dentro da mesma coluna (4 padrões em `VGV BRUTO`).
14. **`pis` inutilizável para 21% dos casos**: 3.621 de 4.579 têm 11 dígitos; 196 têm 1 dígito, 133 têm 12, 84 têm 13, 56 têm 14.
15. **`estado_civil` com 39 variantes** para ~6 conceitos, com gênero embutido (`SOLTEIRO`/`SOLTEIRA`/`SOLTEIRO(A)`).
16. **`naturalidade` com 596 variantes**, incluindo espaços à direita (`PORTO ALEGRE ` 355 vs `PORTO ALEGRE` 1.295), abreviações (`POA` 148) e nacionalidade no lugar de cidade (`BRASILEIRO` 174).
17. **Outliers numéricos:** `ValorAvaliacao` = 277.000.194 (dígito colado; sozinho é 97% da soma da coluna); `Prazo` = 4.201 meses; `PARC_DESCONTO` = −2.000 (negativo).
18. **`BL - UN` com placeholders**: `ESCOLHER` 27, `00` 27, `01` 16, `00-00` 8, `0-0` 6, `0000` 6, `EXTERNO` 6 — pelo menos 80 dos 2.377 preenchidos (3,4%) não são bloco/unidade de verdade.
19. **E‑mails de teste em `cca_externo1`**: `a@a.com`, `a@arrombado.com`, `a@aaa.com`, `a@gmal.com` entre os 93 distintos; 270/646 não casam com `Users`.
20. **Duplicatas de cliente:** 127 nomes repetidos (257 linhas); 43 CPFs repetidos (86 linhas). Podem ser recompra legítima ou lançamento duplicado — 25 pares repetem também empreendimento e unidade, esses são suspeitos de duplicidade real.
21. **`mudou_status` com carimbo de migração:** 2.039 linhas (27%) com `Sep 18, 2024` — não é a data real da última mudança nessas linhas.
22. **Fuso horário não declarado** — ver §1.

---

## 14. Volume relevante para importação

**Total: 7.568 negócios. Recomendação: importar todos os 7.568, em duas ondas.**

| Recorte | Linhas | Justificativa |
|---|---|---|
| **Onda 1 — negócios com valor** | **2.146** | `VGV > 0`: 1.829 `VENDA` + 158 `DISTRATO` + 143 `OFF` + 8 `PARCEIRO` + 8 `PROPOSTA`. São os que alimentam VGV, ranking, gamificação e metas. R$ 465,2 mi de VGV bruto |
| **Onda 1b — pipeline vivo** | **494** | `STATUS='PROPOSTA'` — negócios abertos que precisam continuar no funil no dia 1 do novo sistema |
| **Onda 2 — histórico perdido** | 5.422 | `OFF` sem valor. Não afetam nenhum indicador, mas guardam o histórico de esforço do corretor e o motivo da perda (`STATUS2`) |

**O que não vale a pena importar:**

- **Lixo identificado: ~20 linhas** — 16 sem `CLIENTE` (e sem VGV), 4 com "TESTE" no nome. Menos de 0,3%.
- **26 linhas sem corretor e sem gerente** — órfãs, sem dono; importar só se tiverem valor.
- **17 colunas vazias** e **3 colunas constantes** (`emiteNota`, `declaraImpostoRenda`, `ValorFGTSFuturo`): não criar coluna no destino.
- **`status_filtro` e `Off`**: redundantes/quebrados, descartar.

**Não há histórico antigo a cortar:** a base inteira cabe em 28 meses (mai/2024 a set/2026), com `ENVIO` chegando a ago/2023. Nada é velho o suficiente para arquivar.

**Volumes das tabelas satélites que virão junto:** `observacaoPipelines` 24.766 · `doc-clientes` 25.890 (29.447 URLs referenciadas em `documentos`) · `historicoPipes` 10.343 · `gameficacaos` 1.063 · `financeiros` 26 · `vendas` 6. **As três primeiras dependem de resolver o problema de FK por nome (§11).**

---

## 15. Perguntas que não consegui responder por completo

1. **Rateio de VGV entre participantes** — as 4 colunas (`vgv_corretor_1/2`, `vgv_gerente_1/2`) estão 100% vazias no export. Não é possível saber qual era a regra de divisão. `deal_participants.share_pct` terá de ser definido por regra de negócio nova (ex.: 50/50 quando há 2 corretores), não migrado. **Alternativa:** verificar se `gameficacaos` ou `meta-equipes` guardam o rateio; ou pedir novo export caso essas colunas existam preenchidas no Bubble e o export as tenha suprimido.
2. **Origem de mídia paga** — `Campanha`, `Canal`, `Fonte`, `Criativo Meta`, `Formulário Meta` estão vazias. Só resta `OrigemLead` (5 categorias grossas, 52% preenchida). O vínculo negócio↔campanha só é recuperável cruzando com `leadfies` por telefone/nome.
3. **Fuso horário das datas** — não declarado no arquivo; assumi `America/Sao_Paulo`. Não há como confirmar sem um registro de referência conhecido.
4. **Se as 17 colunas vazias estão vazias no Bubble ou foram suprimidas pelo export** — existe só um arquivo de `pipelines` (o `-modified`), sem contraparte crua para comparar. Assumi que estão realmente vazias.
5. **`GERENTE 2` (com espaço)** citada no briefing **não existe** no CSV. O que existe é `GERENTE 3` (7 linhas) mais `GERENTE2` e `gerente2` (sem espaço). A numeração pula o 2 nas colunas com espaço.
6. **Mapeamento nome→`profiles.id`** — só é possível até os catálogos intermediários (`corretors`, `gerentes`), com 100% de cobertura. De lá até `Users`/`profiles` faltam 56 corretores e 5 gerentes, e `corretors` tem 12 nomes duplicados. Precisa de curadoria humana; não dá para resolver só com os arquivos.
