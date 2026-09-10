# Perfil — `leadfies` (LEADS) — export Bubble

**Arquivo:** `DOCUMENTOS/DADOS_BUBBLE/export_All-leadfies-modified--_2026-09-08_19-40-11.csv`
**Tamanho:** 56.299.714 bytes · **Colunas:** 42 · **Registros (parse CSV real):** **102.799**
**Linhas com nº de campos diferente do header:** 0 · **`unique id` distintos:** 102.799 (0 repetidos)
**Data do perfil:** 09/09/2026 · **Método:** `csv` do Python 3.12, streaming linha a linha (scripts em scratchpad, nada gravado no repo).

Destino provável no schema alvo (`docs/importacao/SCHEMA_ALVO.md`): tabela **`leads`**, com desdobramentos para
`lead_sources` (Fonte), `distribution_groups` (Grupo), `profiles` (Corretor/Gerente), `lead_events`/`lead_comments`
(Observações e Obs. atividade) e `remarketing_contacts` (Reavivar em). Este documento **não** faz o mapeamento —
só descreve o que existe no CSV.

---

## 1. Resumo executivo (o que precisa ser lido antes de mapear)

1. **São 102.799 leads**, criados entre **02/01/2024 00:58** e **05/09/2026 12:39** (coluna `Criado em`).
   Distribuição por ano: 2024 = 35.723 (34,8%) · 2025 = 40.505 (39,4%) · 2026 = 26.071 (25,4%) — mais 499 registros
   em formato de data diferente (todos fev/2026).
2. **O arquivo tem corrupção de encoding gravada nos bytes**: 337.879 ocorrências do caractere U+FFFD (`EF BF BD`).
   Cada letra acentuada virou um U+FFFD. `Em negociação` aparece como `Em negocia��o` em 63.788 linhas e
   corretamente em 1.097. **Isso infla artificialmente a cardinalidade de toda coluna de texto** e precisa de
   um passo de reconciliação na importação (§4).
3. **Das 4 colunas de "criação", só uma presta**: `Criado em` (texto `dd/mm/yy HH:MM`). `Data Criação` e
   `data_criacao` estão **100% vazias**; `Criado_em` tem o **ano errado em 2.638 registros**.
4. **`correto` e `Gerentererr` não são colunas do domínio** — existem só num lote de 719 leads de Instagram
   de nov/2024 (§5). `Corretorszz`/`Gerenteszz` são fotografias antigas/denormalizadas do mesmo dado.
5. **Todos os campos de relacionamento são NOME DE EXIBIÇÃO, não `unique id`.** Zero valores em formato
   `13dígitos x dígitos` em qualquer coluna de relacionamento (§9).
6. **Volume real de contatos únicos é ~79.6 mil**, não 102.8 mil: 77.591 telefones normalizáveis distintos;
   14.005 telefones aparecem em 2+ leads (36.751 leads envolvidos).
7. **Só 40,2% dos leads (41.367) tiveram qualquer atividade nos últimos 12 meses.** O resto é histórico morto.

---

## 2. Armadilhas de parsing (obrigatório respeitar)

| Armadilha | Evidência | O que fazer |
|---|---|---|
| Encoding corrompido no arquivo | 337.879 bytes `EF BF BD`. O arquivo **é UTF-8 válido**, o dano já veio gravado (perda irreversível byte a byte) | Reconciliar por domínio fechado (§4). Não dá para reconstruir texto livre. |
| Quebra de linha dentro de campo | `Mensagem` tem até 1.621 chars com `\n`; `Observações` até 3.913 | Parser CSV de verdade (feito). `wc -l` não vale. |
| 4 formatos de data no mesmo arquivo | `dd/mm/yy HH:MM`, `dd/mm/yy HH:MM:SS`, `MMM D, YYYY h:mm am`, `YYYY/mm/dd HH:MM` (499 linhas) | Parser multi-formato. |
| Listas multivaloradas | Separador é **`, ` (vírgula + espaço)**, **não** `" , "`. Ocorre em `Gerente` (2.151 células com 2 itens) e `Motivos de perda` (até 8 itens) | Split por `, `. Ambíguo se um nome tiver vírgula — nenhum nome no arquivo tem. |
| Ano de 2 dígitos | `Criado em` = `02/01/24` | Interpretar como 20xx; validado contra `Mês` e `Creation Date`. |

**Suposição de fuso (registrada):** o CSV não declara timezone. Assumido **America/Sao_Paulo** para
`Criado em`, `Data atividade`, `Reavivar em`, `Reavivado em` (campos preenchidos pela aplicação em horário local)
e para `Creation Date`/`Modified Date` (metadados do Bubble). Se `Creation Date` for UTC, as contagens diárias
deslocam no máximo 3h — nenhuma conclusão deste relatório muda.

---

## 3. Tabela de colunas (todas as 42)

`fill%` sobre N = 102.799. Cardinalidade = valores distintos brutos (com o mojibake contando como valor próprio).
Exemplos mascarados conforme regra de dados pessoais.

| # | Coluna | Tipo observado | fill % | Card. | Exemplos (mascarados) | Semântica | Referência |
|---|---|---|---|---|---|---|---|
| 1 | `Atividade` | texto | 98,8% | 208 (203 canônicos) | `Retornar para cliente` · `Em atendimento` · `Ver mensagem do interessado` | Etapa/ação corrente do lead no funil. Os 5 primeiros valores cobrem 97,0%; a cauda são **respostas de chatbot vazadas** para o campo | não |
| 2 | `Cidade` | texto | 49,2% | 751 (≤529 canônicos) | `porto_alegre` · `poa_zona_norte` · `Canoas` | Cidade/região de interesse, vinda do formulário. Slug (`porto_alegre`) e livre (`Porto Alegre`) misturados | não |
| 3 | `Cliente` | texto | 99,4% | 61.518 | `Ale***` · `Rossana P. P.` · `May S.` | Nome do lead (livre, muitas vezes só primeiro nome) | não |
| 4 | `correto` | texto | **0,5%** (468) | 45 | `Isadora C.` · `Valmir B.` · `Susana C. P.` | **Coluna morta.** Só existe no lote Instagram nov/2024 (§5). Concorda com `Corretor` em 409/468 | nome→`profiles` |
| 5 | `Corretor` | texto | 100,0% (102.798) | 304 (292 canônicos) | `Rudinei T. D. S.` · `Roberto C.` · `Marcio G.` | **Corretor responsável — coluna boa.** Sempre 1 valor por célula | nome_exibicao→`profiles` |
| 6 | `Corretorszz` | texto | 97,1% | 258 | `Rudinei T. D. S.` · `Roberto C.` · `Marcio G.` | Cópia denormalizada/antiga do corretor. Igual a `Corretor` em 91,4%; difere em 5.710 | nome_exibicao→`profiles` |
| 7 | `Criado em` | texto data `dd/mm/yy HH:MM` | 100,0% | 92.375 | `02/01/24 18:37` · `03/01/24 10:33` | **Data/hora real de criação do lead — coluna boa** | não |
| 8 | `Criado_em` | data `MMM D, YYYY h:mm a` | 100,0% | 866 | `Jan 2, 2024 12:00 pm` | Espelho do anterior, **sempre 12:00** (só data). **Ano errado em 2.638 linhas** | não |
| 9 | `Código` | numérico/texto | **0,6%** (662) | 94 | `249` · `201` · `FI-296` | Código do empreendimento no **TecImob**. Aparece só quando `Fonte = TecImob 2` | id externo (TecImob) |
| 10 | `Data atividade` | data `dd/mm/yy HH:MM:SS` | 97,9% | 70.804 | `15/01/24 17:28:00` | Data da última/próxima atividade registrada. **Coluna boa** (a `_` correspondente está vazia) | não |
| 11 | `Data Criação` | — | **0,0%** | 0 | `""` | Vazia em 100% | descartar |
| 12 | `Data_atividade` | — | **0,0%** | 0 | `""` | Vazia em 100% | descartar |
| 13 | `data_criacao` | — | **0,0%** | 0 | `""` | Vazia em 100% | descartar |
| 14 | `Email` | texto | 96,9% | 75.766 | `ma***@hotmail.com` · `ro***@gmail.com` | E-mail do lead. 99.051 válidos, 596 inválidos | não |
| 15 | `Fonte` | texto | 100,0% | 14 | `Facebook Leads` · `Chatbot Leadfy` · `WhatsApp` | Origem do lead | valor→`lead_sources` |
| 16 | `Gerente` | texto, lista `, ` | 97,4% | 33 (30 canônicos) | `Archimedes B.` · `Leone B.` · `Archimedes B., Susana C. P.` | **Gerente responsável — coluna boa.** 2.151 células com 2 nomes | lista_nomes→`profiles` |
| 17 | `Gerentererr` | texto | **0,5%** (468) | 4 | `Mauricio V.` · `Archimedes B.` | **Coluna morta.** Só no lote Instagram; 4 nomes | nome→`profiles` |
| 18 | `Gerenteszz` | texto | 95,5% | 15 | `Archimedes B.` · `Leone B.` · `Gerente I.` | Cópia denormalizada, **sempre 1 valor**. Igual a `Gerente` em 88,1% | nome_exibicao→`profiles` |
| 19 | `Grupo` | texto | 87,7% | 49 | `Roleta Geral` · `ChatBot` · `Direcionado MC3` | Grupo/fila de distribuição do lead | valor→`distribution_groups` |
| 20 | `Identificador` | texto 6 chars | 95,5% | 95.285 | `sdrtwp` · `gidqdb` · `su54af` | Slug curto quase único (6 chars a-z0-9). 1.635 repetidos, máx 4 leads no mesmo | id externo |
| 21 | `Imóvel` | texto | 91,9% | 335 (316 canônicos) | `Morana \| Singular` · `Casas Vasco` · `Pinheiros \| MC3` | **Nome da campanha/anúncio**, não um imóvel. Contém o nome da construtora | texto→`developers`/`ad_campaigns` (por substring) |
| 22 | `Mensagem` | texto longo | 68,7% | 18.189 | `chatbot: fcimb1\nsession: rBwKMf` · `Você quer morar em porto alegre? sim,_na_zona_leste` | **Payload bruto do formulário/chatbot.** 44.336 no formato `pergunta? resposta`, 21.800 `chave: valor` | não (vira `raw_payload`) |
| 23 | `Motivos de perda` | texto, lista `, ` | 34,6% | 322 (24 motivos reais) | `Cliente sem interesse` · `Apenas pesquisando` · `Cliente sem interesse, Demora no retorno` | Motivo(s) do arquivamento. Até 8 itens por célula | valor(es) enum |
| 24 | `Mês` | data com ano falso 2001 | 100,0% | 51 | `Jan 24, 2001 12:00 am` | **Competência mês/ano do lead codificada como `MMM DD`** onde `DD` = ano de 2 dígitos (§8) | derivável |
| 25 | `novo` | texto | 15,7% (16.181) | 1 (`sim`) | `sim` | Flag de "lead novo" ligada só a partir de **25/03/2026** (§8) | não |
| 26 | `Obs. atividade` | texto | **2,7%** (2.790) | 704 | `Cliente não responde Wpp` · `mandei msm 2 x` · `aguardando retorno` | Observação curta da atividade | não |
| 27 | `Observações` | texto longo | **7,2%** (7.432) | 6.026 | `02/01/2024 20:15 - Chamei zap` · `cliente aprovado mas parou de responder` | Diário livre do corretor, com data embutida no texto | não (vira `lead_comments`) |
| 28 | `Preço` | — | **0,0%** | 0 | `""` | Vazia em 100% | descartar |
| 29 | `Reavivado em` | data `dd/mm/yy` | **4,8%** (4.960) | 226 | `13/01/24` · `07/01/24` | Data em que o lead **foi** reavivado (§10) | não |
| 30 | `Reavivado_em` | — | **0,0%** | 0 | `""` | Vazia em 100% | descartar |
| 31 | `Reavivar em` | data `dd/mm/yy` | **6,2%** (6.395) | 875 | `13/01/24` · `07/01/24` | Data agendada para reavivar (§10) | não |
| 32 | `Reavivar_em` | — | **0,0%** | 0 | `""` | Vazia em 100% | descartar |
| 33 | `Status` | texto | 99,3% | 6 (4 canônicos) | `Arquivado` · `Novo` · `Em negociação` | Situação do lead | valor enum |
| 34 | `Telefone` | texto | 99,9% (102.694) | 80.033 | `(51) 9****-3682` · `(51) 9****-0385` | Telefone principal. 100.337 normalizáveis para E.164 BR | não |
| 35 | `Tipo de Negociação` | texto | 99,3% | 2 | `Compra` · `Indefinido` | Tipo de operação | valor enum |
| 36 | `Vida` | texto | 99,3% | 2 (1 canônico) | `1ª` | **Constante `1ª` em 100% dos preenchidos.** Campo morto (§8) | descartar |
| 37 | `whatsapp` | numérico/texto | **0,7%** (719) | 679 | `(48) 9****-9037` · `(51) 9****-6281` | WhatsApp — só no lote Instagram nov/2024 | não |
| 38 | `Creation Date` | data Bubble | 100,0% | 191 | `May 14, 2024 12:55 am` | Criação do **registro no Bubble**, não do lead. Mín 14/05/2024 = data da migração inicial | metadado |
| 39 | `Modified Date` | data Bubble | 100,0% | 192 | `May 15, 2024 1:10 am` · `Jan 29, 2025 3:17 pm` | Última alteração do registro | metadado |
| 40 | `Slug` | — | **0,0%** | 0 | `""` | Vazia em 100% | descartar |
| 41 | `Creator` | texto | 100,0% | 2 | `Douglas G.` (102.798) · `(App a.` (1) | Usuário Bubble que criou. Praticamente constante | descartar |
| 42 | `unique id` | uid Bubble | 100,0% | 102.799 | `1715658950499x132032603743673650` | **PK do Bubble. Única, sem repetição.** Chave natural do import | PK |

> Cardinalidades acima de 60.000 (`Cliente`, `Criado em`, `Data atividade`, `Email`, `Identificador`,
> `Telefone`, `unique id`) foram contadas por hash blake2b-64; a chance de colisão em 100 mil valores
> é ~3e-10, então trate como exatas.

---

## 4. Distribuições completas

### 4.1 `Status` — 4 valores reais (6 brutos, por causa do mojibake)

| Valor | Registros | % de N |
|---|---:|---:|
| Em negociação | **64.885** | 63,12% |
| Arquivado | **36.265** | 35,28% |
| Novo | 871 | 0,85% |
| Negócio fechado | **59** | 0,06% |
| *(vazio)* | 719 | 0,70% |

Detalhe do mojibake: `Em negocia<?><?>o` 63.788 + `Em negociação` 1.097 · `Neg<?>cio fechado` 16 + `Negócio fechado` 43.

**Leitura de negócio:** `Em negociação` é o estado *default*, não um sinal de atividade — 63% dos leads
estão nele, inclusive leads de 2024 sem toque desde então. `Negócio fechado` tem só **59 registros**,
ou seja, a venda **não é registrada aqui** (mora em `pipelines`/`vendas`).

### 4.2 `Fonte` — 14 valores (distribuição completa)

| Valor | Registros | % de N |
|---|---:|---:|
| Facebook Leads | 94.421 | 91,85% |
| Chatbot Leadfy | 3.703 | 3,60% |
| WhatsApp | 1.792 | 1,74% |
| Importados da planilha | 813 | 0,79% |
| TecImob 2 | 742 | 0,72% |
| BotConversa | 464 | 0,45% |
| Instagram | 409 | 0,40% |
| Facebook | 267 | 0,26% |
| Facebot | 68 | 0,07% |
| Não definido | 51 | 0,05% |
| Site Faceimob | 22 | 0,02% |
| Indicação | 2 | 0,00% |
| VivaReal | 1 | 0,00% |
| Integracao Leadfy | 1 | 0,00% |
| *(vazio)* | 43 | 0,04% |

Por ano: Facebook Leads 30.426 (2024) / 38.192 (2025) / 25.803 (2026) — o canal é estável e dominante.
`Facebook`, `Facebot` e `Instagram` são resíduo de nomenclatura antiga de 2024/2025.

### 4.3 `Tipo de Negociação` — 2 valores (distribuição completa)

| Valor | Registros | % de N |
|---|---:|---:|
| Compra | 94.757 | 92,18% |
| Indefinido | 7.323 | 7,12% |
| *(vazio)* | 719 | 0,70% |

Campo sem informação útil: 92% é o mesmo valor e não existe "Aluguel"/"Venda".

### 4.4 `Motivos de perda` — 24 motivos reais (distribuição completa, por item)

A célula é **multivalorada** (separador `, `): 32.339 leads com 1 motivo, 2.567 com 2, 537 com 3,
90 com 4, 10 com 5, 4 com 6, 1 com 7, 2 com 8 — **67.249 leads sem motivo**.
Total de ocorrências: **39.541** em 35.550 leads. Percentual abaixo é sobre ocorrências.

| Motivo | Ocorrências | % |
|---|---:|---:|
| Cliente sem interesse | 12.048 | 30,47% |
| Demora no retorno | 7.903 | 19,99% |
| Apenas pesquisando | 4.463 | 11,29% |
| Contato Inválido | 4.063 | 10,27% |
| Cliente sem perfil | 3.804 | 9,62% |
| Possui Restrição | 2.291 | 5,79% |
| Bloqueado pelo Cliente | 1.029 | 2,60% |
| Lead duplicado | 1.010 | 2,55% |
| Produto não agradou | 781 | 1,98% |
| Em atendimento | 422 | 1,07% |
| Já foi vendido | 291 | 0,74% |
| Já comprou | 286 | 0,72% |
| Retornar para cliente | 271 | 0,69% |
| Desempregado | 231 | 0,58% |
| Em outro Atendimento | 215 | 0,54% |
| Ver mensagem do interessado | 158 | 0,40% |
| Primeiro contato | 97 | 0,25% |
| Reprovado | 93 | 0,24% |
| Cobrar cliente | 44 | 0,11% |
| Lead Teste | 34 | 0,09% |
| Visita Agendada | 3 | 0,01% |
| Em negociação | 2 | 0,01% |
| Documentação Pendente | 1 | 0,00% |
| Em Proposta | 1 | 0,00% |

**Atenção:** 9 desses "motivos" (`Em atendimento`, `Retornar para cliente`, `Ver mensagem do interessado`,
`Primeiro contato`, `Cobrar cliente`, `Visita Agendada`, `Em Proposta`, `Documentação Pendente`, `Em negociação`)
são valores de **`Atividade`** que vazaram para o campo errado — 999 ocorrências. Não são motivo de perda.
`Lead duplicado` (1.010) e `Lead Teste` (34) marcam lixo explícito.

### 4.5 `Grupo` — 49 valores (distribuição completa)

| Valor | Reg. | | Valor | Reg. | | Valor | Reg. |
|---|---:|---|---|---:|---|---|---:|
| Roleta Geral | 69.919 | | Isadora | 223 | | Gerente Alisson | 24 |
| *(vazio)* | 12.687 | | Lots | 184 | | Diretor Mauricio | 22 |
| ChatBot | 4.685 | | Zona Sul (Distribuição) | 179 | | OPEN | 21 |
| ELITE | 3.034 | | Gerente Victor | 161 | | Cascata Diretor Fabio | 15 |
| Zona Norte (Distribuição) | 1.806 | | Hierarquia Sul | 156 | | Equipe Canoas GRUPO | 14 |
| Abaco | 1.788 | | Gerente Susana | 116 | | Gerente Daiane | 11 |
| WhatsApp | 1.553 | | Esperanza | 113 | | Hierarquia Archimedes | 6 |
| MC3 PONTAL | 1.480 | | Caroline Farias | 110 | | Hierarquia Mauricio | 6 |
| Sul | 654 | | BotConversa | 104 | | Gerente Alexandre | 5 |
| Leads Equipe Mauricio | 629 | | Alisson | 102 | | Gerente Mauricio | 3 |
| Canoas | 578 | | MORANA | 98 | | Repique Norte | 1 |
| Novos Negócios | 549 | | Gerente Veronica | 77 | | Hierarquia Canoas | 1 |
| TENDA | 479 | | Direcionado MC3 | 66 | | Hierarquia Lots | 1 |
| Lead Qualificado | 431 | | MRV Monaco | 66 | | API | 1 |
| Leads Equipe Leone | 292 | | Gerente José | 64 | | | |
| | | | MRV | 62 | | | |
| | | | LYX | 53 | | | |
| | | | AP Olavio | 53 | | | |
| | | | Leads Equipe Zona Sul | 48 | | | |
| | | | Site Faceimob | 45 | | | |
| | | | Gerente Leonardo | 24 | | | |

**Três semânticas misturadas no mesmo campo:** fila de roleta (`Roleta Geral`, `Zona Norte (Distribuição)`),
direcionamento por construtora/produto (`TENDA`, `MRV`, `Abaco`, `MC3 PONTAL`, `LYX`, `MORANA`) e
direcionamento nominal a uma pessoa (`Gerente Victor`, `Isadora`, `Alisson`, `Caroline Farias`).
Os 12.687 vazios são quase todos `Facebook Leads` (11.476).

### 4.6 `Atividade` — 208 valores brutos / 203 canônicos (top 12 + cauda)

| Valor | Reg. | % |
|---|---:|---:|
| Em atendimento | 36.181 | 35,20% |
| Primeiro contato | 29.199 | 28,40% |
| Retornar para cliente | 22.758 | 22,14% |
| Ver mensagem do interessado | 7.409 | 7,21% |
| Cobrar cliente | 4.031 | 3,92% |
| Em negociação | 494 | 0,48% |
| Em Proposta | 133 | 0,13% |
| Aguardando Documentação | 122 | 0,12% |
| Visita Agendada | 119 | 0,12% |
| Enviar Fotos/Vídeos | 60 | 0,06% |
| Sem resposta | 52 | 0,05% |
| Em Análise de Crédito | 26 | 0,03% |
| *(vazio)* | 1.258 | 1,22% |
| **cauda (~191 valores)** | 957 | 0,93% |

A cauda é **texto de pergunta do chatbot gravado no campo errado**
(`Qual a cidade de seu interesse? poa_zona_sul` = 76, `Qual sua localização de preferência? …` = 54 etc.).
Os 12 valores acima são o vocabulário real do funil.

### 4.7 `Cidade` — 751 brutos / ≤529 canônicos (top 20 + cauda)

| Valor | Reg. | | Valor | Reg. |
|---|---:|---|---|---:|
| porto_alegre | 11.432 | | nh | 460 |
| canoas | 8.459 | | nova_hartz | 399 |
| são_leopoldo | 4.730 | | são_leo_ | 390 |
| novo_hamburgo | 4.290 | | eldorado_do_sul | 253 |
| poa_zona_sul | 3.294 | | esteio | 139 |
| gravataí | 2.740 | | porto_alegre/zn | 121 |
| viamão | 2.469 | | região_metrop._de_poa | 89 |
| alvorada | 2.439 | | outra_cidade | 74 |
| cachoeirinha | 2.039 | | Caxias do Sul | 67 |
| guaiba | 1.548 | | Pelotas | 48 |
| porto_alegre_zona_sul | 1.459 | | Passo Fundo | 42 |
| porto_alegre_zona_norte | 1.177 | | *(cauda ~505 valores)* | 1.475 |
| poa_zona_norte | 932 | | *(vazio)* | 52.234 |

Campo sujo por natureza (vem do valor bruto do formulário do Meta). `porto_alegre`, `Porto Alegre`,
`porto alegre`, `Porto alegre`, `Porto Alegre RS` e `porto_alegre/zn` são a mesma coisa.

### 4.8 `Imóvel` (campanha) — 335 brutos / 316 canônicos (top 15)

| Valor | Reg. | | Valor | Reg. |
|---|---:|---|---|---:|
| Porta de Entrada \| Cidades | 13.634 | | Casas e Apartamentos Faceimob 2 | 3.534 |
| Programa MCMV | 8.722 | | Vasco \| Casas Região Metrop. | 3.399 |
| Programa MCMV 2 | 7.336 | | Geral \| Cidades | 2.985 |
| Feirão \| Faceimob | 4.971 | | Casa ou Ap \| Cidades | 2.630 |
| Casa ou AP | 4.520 | | Abaco \| Bella Citta | 2.318 |
| Vasco \| Solar dos Passaros | 4.362 | | CLT \| Faceimob | 2.222 |
| Vasco \| Casa de 2 dorm | 4.348 | | Porta de Entrada | 2.187 |
| Casas Vasco | 4.229 | | *(vazio)* | 8.344 |

Contém o nome da construtora como substring:
`vasco` 22.162 · `mc3` 3.826 · `abaco` 2.594 · `tenda` 2.059 · `mnb` 1.108 · `morana` 671 · `lyx` 506 ·
`apice` 433 · `south` 428 · `mrv` 360 · `celsul` 125 · outros 64 (`mgf` 23, `couto` 16, `harmonia` 13, `belmonte` 4, `rni` 3, `viver` 3,
`lotus` 1, `baliza` 1) — **34.336 casamentos**, contados por substring, então um mesmo lead pode
casar com mais de um nome.
Comparado contra os 41 nomes do export `Construtoras`.

---

## 5. Colunas quase-duplicadas — veredito por par

### 5.1 Datas de criação: **`Criado em` é a boa**

| Par | Ambas preenchidas | Data igual | Data diferente |
|---|---:|---:|---:|
| `Criado em` × `Criado_em` | 102.798 | 89.376 (86,9%) | **12.923 (12,6%)** |
| `Criado em` × `Creation Date` | 102.798 | 1.917 (1,9%) | 100.382 (97,7%) |
| `Criado_em` × `Creation Date` | 102.798 | 12.571 (12,2%) | 90.227 (87,8%) |
| `Criado em` × `Data Criação` | 0 | — | `Data Criação` 100% vazia |
| `Criado em` × `data_criacao` | 0 | — | `data_criacao` 100% vazia |

**Diagnóstico da divergência `Criado em` × `Criado_em`:** 2.638 registros têm delta de exatamente **−366 dias**
(ano errado). Exemplo real: `Criado em = 01/01/25 10:17`, `Criado_em = Jan 1, 2024 12:00 pm`,
`Creation Date = Jan 10, 2025`, `Mês = Jan 25` (=jan/2025). O `Criado_em` gravou **2024** onde deveria 2025 —
bug clássico de workflow em virada de ano. As demais divergências (≈10.285) são de 1 a ~30 dias:
`Criado_em` foi regravado quando o lead foi reciclado.

**`Criado em` é confirmado como correto** por bater com `Mês` em **101.580 de 101.580** registros comparáveis (100%).

**`Creation Date` não serve como data do lead**: mínimo em **14/05/2024 00:55** (data da carga inicial no Bubble)
e apenas 191 timestamps distintos para 102.799 registros — os leads de 2024 foram criados em lote.

> **Regra de ouro:** `created_at` do lead = `Criado em`.
> `Creation Date` só vale como "data de entrada no Bubble".
> `Criado_em`, `Data Criação` e `data_criacao` devem ser **descartadas**.

**Os 499 registros ISO:** `Criado em` no formato `YYYY/mm/dd HH:MM` — `2026/02/02` (217), `2026/02/01` (214),
`2026/02/03` (49), `2026/02/11` (19). Todos com `Creation Date = Feb 11, 2026` e `Mês = fev/2026`.
É um lote reimportado em 11/02/2026 com formatador diferente. Parseáveis, sem ambiguidade.

### 5.2 Corretor: **`Corretor` é a boa**

| Par | A preench. | B preench. | Ambas | Iguais | Diferentes |
|---|---:|---:|---:|---:|---:|
| `Corretor` × `correto` | 102.798 | **468** | 468 | 409 | 59 |
| `Corretor` × `Corretorszz` | 102.798 | 99.846 | 99.846 | 93.986 (91,4%) | 5.710 |
| `correto` × `Corretorszz` | 468 | 99.846 | 468 | 453 | 15 |

- **`Corretor`**: 100,0% preenchida (falta 1 registro), 304 valores brutos / 292 canônicos, sempre 1 nome por célula. **Use esta.**
- **`Corretorszz`**: 97,1%, 258 valores. É uma cópia congelada (nomes ligeiramente diferentes:
  `Everton Goncalves da Silva` em `Corretor` vs `Everton Silva` em `Corretorszz`). Serve só como
  auditoria de reatribuição — 5.710 leads trocaram de corretor.
- **`correto`**: 468 registros, **todos dentro do lote Instagram de 719** (§6). Descartar.

### 5.3 Gerente: **`Gerente` é a boa**

| Par | A preench. | B preench. | Ambas | Iguais | Diferentes |
|---|---:|---:|---:|---:|---:|
| `Gerente` × `Gerentererr` | 100.101 | **468** | 468 | 395 | 73 |
| `Gerente` × `Gerenteszz` | 100.101 | 98.215 | 97.512 | 90.574 (88,1%) | 6.938 |
| `Gerentererr` × `Gerenteszz` | 468 | 98.215 | 468 | 468 | 0 |

- **`Gerente`**: 97,4%, 33 valores brutos / 30 canônicos, **multivalorada** (2.151 células com 2 nomes,
  ex. `Archimedes B., Susana C. P.`). **Use esta.**
- **`Gerenteszz`**: 95,5%, 15 valores, sempre 1 nome. Contém `Gerente Interino` (1.345) que não existe em `Gerente`.
  É a "gerência efetiva no momento", útil se você quiser 1 gerente só.
- **`Gerentererr`**: 468 registros, todos no lote Instagram, 4 nomes. Descartar. (O sufixo `err` sugere
  que a própria equipe marcou a coluna como errada.)

### 5.4 Data de atividade

| Par | A preench. | B preench. |
|---|---:|---:|
| `Data atividade` × `Data_atividade` | 100.670 (97,9%) | **0** |

Sem conflito: `Data_atividade` está 100% vazia. **Use `Data atividade`.**

### 5.5 Reavivar / Reavivado

| Par | A preench. | B preench. | Ambas | Datas iguais |
|---|---:|---:|---:|---:|
| `Reavivado em` × `Reavivado_em` | 4.960 | **0** | — | — |
| `Reavivar em` × `Reavivar_em` | 6.395 | **0** | — | — |
| `Reavivado em` × `Reavivar em` | 4.960 | 6.395 | 4.960 | **4.958 (99,96%)** |

`Reavivado_em` e `Reavivar_em` estão vazias. E `Reavivado em` é praticamente um subconjunto idêntico de
`Reavivar em` — só 2 registros divergem, e 1.435 têm `Reavivar em` sem `Reavivado em`.

---

## 6. O lote anômalo de 719 registros (Instagram, nov/2024)

719 leads têm `Status`, `Tipo de Negociação`, `Vida`, `Grupo`, `Atividade`, `Motivos de perda`,
`Identificador`, `Mensagem` e `Observações` **todos vazios**, e `whatsapp` preenchido (718) —
`whatsapp` só existe neste lote. `Mês` neles é uma **data real** (`Nov 13–30, 2024`, ~40/dia) em vez do
código do §8. `Fonte = Instagram` em 676. `correto` (468) e `Gerentererr` (468) existem **apenas aqui**.

Colunas preenchidas nesse lote: `Cliente` 713 · `Corretor` 719 · `Corretorszz` 468 · `Criado em` 719 ·
`Email` 673 · `Gerente` 468 · `Gerenteszz` 719 · `Imóvel` 681 · `Telefone` 718 · `whatsapp` 718 · `Cidade` 254.

**Conclusão:** carga manual/planilha de leads de Instagram de novembro/2024, com layout próprio.
Trate como um caso especial ou descarte (0,70% do arquivo).

---

## 7. Datas e volume histórico

### 7.1 Faixas

| Coluna | Mínimo | Máximo | Parseadas | Não parseadas |
|---|---|---|---:|---:|
| `Criado em` | **02/01/2024 00:58** | **05/09/2026 12:39** | 102.299 | 499 (formato ISO, §5.1) |
| `Criado_em` | 01/01/2024 12:00 | 05/09/2026 00:00 | 102.798 | 0 |
| `Creation Date` | 14/05/2024 00:55 | 05/09/2026 12:44 | 102.799 | 0 |
| `Modified Date` | 15/05/2024 01:10 | 05/09/2026 12:45 | 102.799 | 0 |
| `Data atividade` | 25/04/2016 11:07 | **18/09/2026 11:30** (futuro) | 100.670 | 0 |
| `Reavivar em` | 03/01/2024 | 06/09/2024 | 6.395 | 0 |
| `Reavivado em` | 03/01/2024 | 19/08/2024 | 4.960 | 0 |
| `Mês` | (código, ver §8) | | 102.798 | 0 |

`Data atividade` tem 5 outliers pré-2024 (2016: 2, 2018: 2, 2019: 1) e datas no futuro (agendamentos).

### 7.2 Leads por ano de criação (`Criado em`, fallback `Creation Date`)

| Ano | Leads | % | Arquivados | Em negociação | Novo | Neg. fechado |
|---|---:|---:|---:|---:|---:|---:|
| 2024 | 35.723 | 34,75% | 15.631 | 18.924 | 401 | 48 |
| 2025 | 40.505 | 39,40% | 11.526 | 28.713 | 265 | 1 |
| 2026 (até 05/09) | 26.571 | 25,85% | 9.108 | 17.248 | 205 | 10 |

### 7.3 Recência — quanto é histórico morto

Última atividade = `max(Modified Date, Data atividade, Criado em)` por lead:

| Janela | Leads | % de N |
|---|---:|---:|
| Atividade nos últimos 12 meses (≥ 09/09/2025) | **41.367** | **40,2%** |
| Atividade há mais de 12 meses | 61.432 | 59,8% |
| Em `Em negociação`/`Novo` **e** ativos ≤12m | **27.477** | 26,7% |

Distribuição mensal da última atividade (todos os 102.799):

```
2024-05 11550 | 2024-06   658 | 2024-07  8061 | 2024-08  3683 | 2024-09  2990 | 2024-10  2711
2024-11  1643 | 2024-12  1924 | 2025-01  8430 | 2025-02  3689 | 2025-03  2909 | 2025-04  3184
2025-05  2240 | 2025-06  2569 | 2025-07  2406 | 2025-08  2676 | 2025-09  2437 | 2025-10  3759
2025-11  3270 | 2025-12  4407 | 2026-01  5089 | 2026-02  3451 | 2026-03  2797 | 2026-04  4489
2026-05  3352 | 2026-06  2486 | 2026-07  2349 | 2026-08  1902 | 2026-09  1688
```

Os picos de 2024-05 (11.550), 2024-07 (8.061) e 2025-01 (8.430) são **atualizações em massa**
(migração e reprocessamentos), não atividade comercial real.

---

## 8. Semântica dos campos obscuros

### `Vida` — campo morto
102.079 preenchidos, **um único valor: `1ª`** (`1<?>` 92.269 + `1ª` 9.810). Nenhum lead tem "2ª vida".
Modelava reciclagem de lead ("segunda vida") mas nunca foi usado. **Descartar.**

### `novo` — flag de corte temporal
16.181 registros com o valor `sim`, único valor existente. Todos criados entre **25/03/2026 00:15** e
**05/09/2026 12:39**. Nenhum lead anterior a 25/03/2026 tem a flag. É um marcador ligado numa mudança
de fluxo em mar/2026 (provavelmente "lead da nova entrada/roleta nova"), **não** "lead não trabalhado" —
4.420 deles já estão `Arquivado`. **Derivável de `Criado em`; descartar.**

### `Grupo` — fila de distribuição
Ver §4.5. É o grupo da roleta/direcionamento. Mapeia para `distribution_groups`, mas com três semânticas
misturadas (fila, produto e pessoa) que precisam ser separadas.

### `Identificador` — slug curto do lead
6 caracteres `[a-z0-9]`, 98.206 preenchidos, **95.285 distintos**. 1.635 valores repetem (4.556 leads),
no máximo 4 leads com o mesmo. Não é chave confiável — é um código curto para link/atendimento
(equivalente ao `slug` do Bubble, que aqui está vazio). 4.593 leads sem identificador.

### `Código` — código de empreendimento do TecImob
662 preenchidos (0,6%), 94 valores: inteiros de 101 a 312 e 3 no formato `FI-296`/`FI-312`/`FI-310`.
Aparece **quase só quando `Fonte = TecImob 2`** (456 de 662) e `Grupo = ChatBot`. O `Imóvel` correspondente
traz o nome do empreendimento (`Villa Pienza`, `Residencial Puerto Madero`, `Recanto Cristal`, `Parque Pontal`).
É o ID do imóvel no portal TecImob, não um código de lead.

### `Mês` — competência codificada
Preenchida em 102.798 registros, 51 valores distintos, **99,3% com ano 2001**. O padrão é
`MMM DD, 2001` onde **`MMM` = mês e `DD` = ano de dois dígitos**:

- `Jan 25, 2001` = **janeiro/2025** (6.365 leads)
- `Dec 25, 2001` = dezembro/2025 (4.906) · `Jan 26, 2001` = janeiro/2026 (4.355) · `Jun 24, 2001` = junho/2024 (4.307)

**Validação:** o par (mês, ano) decodificado bate com o de `Criado em` em **101.580 de 101.580** registros
comparáveis — 100%. Os 719 restantes são o lote Instagram, onde `Mês` é uma data real de nov/2024.
**É a competência do lead, 100% derivável de `Criado em`. Descartar.**

---

## 9. `Corretor` / `Gerente`: nome de exibição, não `unique id`

**Zero** valores em formato `unique id` (`\d{13}x\d+`) em `Corretor`, `Gerente`, `Cliente`, `Imóvel`,
`Grupo`, `Identificador`, `Fonte` ou `Creator`. Todos os relacionamentos vieram como **texto de exibição**.

Casamento contra os outros exports (chave = nome sem acento, minúsculo):

| Campo | Nomes distintos | Casam com o export de referência | Leads cobertos |
|---|---:|---:|---:|
| `Corretor` → `export_All-corretors` (352 nomes) | 292 (297 chaves ASCII) | **263** | **95.576 / 102.798 (93,0%)** |
| `Gerente` → `export_All-gerentes` (20 nomes) | 18 (após split `, `) | **14** | **96.318 / 102.252 ocorrências (94,2%)** |

**Corretores sem correspondência (7.222 leads, top 12):**
`everton goncalves da silva` 1.642 · `fabiano rodrigues vieira` 918 · `caroline farias` 618 ·
`janaina silva de fraga maciel` 543 · **`usurio repique` 530** · **`em espera` 497** ·
`sonia mara castro viana` 484 · `isaias ribeiro luca` 403 · `roberto santos mendes` 322 ·
`caroline elias de menezes` 188 · `thabata nobre` 155 · `kelvin viana` 144.

Dois casos são **placeholders de sistema, não pessoas**: `Usuário Repique` (530) e `Em espera` (497) —
1.027 leads que na prática estão **sem corretor**. O resto são grafias divergentes
(`Everton Goncalves da Silva` vs `Everton Silva`, `Thabata` vs `Tabhata`, `Janaina Fraga` vs
`Janaina Silva de Fraga Maciel`) ou pessoas desligadas ausentes do export de corretores.

**Gerentes sem correspondência:** `roberto santos mendes` 3.394 · **`faceimob` 1.573 (não é pessoa)** ·
`maurcio vieira` 526 (grafia com mojibake de `Maurício Vieira`, que já existe como `Mauricio Vieira`) ·
`douglas gomes` 441.

**Consequência para o import:** o casamento tem de ser por nome normalizado + tabela de aliases manual
para ~30 grafias. Não existe caminho por ID. Um erro aqui reatribui lead para o corretor errado.

---

## 10. `Reavivar em` / `Reavivado em` modelam remarketing?

**Sim, mas de forma rudimentar e abandonada.**

- `Reavivar em`: 6.395 leads (6,2%), datas de **03/01/2024 a 06/09/2024**.
- `Reavivado em`: 4.960 leads (4,8%), datas de **03/01/2024 a 19/08/2024**.
- Coincidem exatamente em **4.958 de 4.960** casos (99,96%); só 2 divergem.
- 1.435 leads têm `Reavivar em` **sem** `Reavivado em` — agendamentos que nunca foram executados.
- Distância entre `Reavivar em` e `Criado em`: 5.890 no mesmo mês, 401 com 1 mês, 77 com 2, 24 com 3, 3 com 4.

**Leitura:** era um agendamento de "reavivar este lead nesta data" (`Reavivar em`) com uma marcação de
execução (`Reavivado em`) que na prática gravava a mesma data — ou seja, o "reavivamento" era imediato,
não havia janela real. **O recurso foi usado só em 2024 e depois abandonado** (nenhum registro em
2025 ou 2026, e são 8 meses de uso contra 32 meses de base). Não há campanha, template, canal, resultado
nem contagem de tentativas — nada que sustente `remarketing_lists`/`remarketing_contacts` do schema alvo.

**Consequência:** importar isso como remarketing traria 6.395 registros de um processo morto há 2 anos.
O valor útil é só histórico (`lead_events` com `kind = 'revived'`), se é que vale.

---

## 11. Contato: telefone e e-mail

Normalização E.164 BR aplicada: só dígitos; remove prefixo `55`/`0`; exige 10 ou 11 dígitos;
DDD na lista oficial dos 67 DDDs válidos; 11 dígitos exigem `9` como primeiro do assinante.

| Métrica | Registros | % de N |
|---|---:|---:|
| `Telefone` preenchido | 102.694 | 99,90% |
| `Telefone` **normalizável para E.164** | **100.337** | **97,61%** |
| `Telefone` preenchido mas inválido | 2.357 | 2,29% |
| `whatsapp` preenchido | 719 | 0,70% |
| `whatsapp` normalizável | 703 | 0,68% |
| **Algum telefone normalizável** (`Telefone` ou `whatsapp`) | **100.337** | **97,61%** |
| `Email` preenchido | 99.647 | 96,93% |
| `Email` **válido** (regex) | **99.051** | **96,35%** |
| `Email` preenchido mas inválido | 596 | 0,58% |
| **Telefone E-MAIL ambos vazios** | **0** | **0,00%** |
| Sem nenhum contato **utilizável** (nem tel válido nem e-mail válido) | **45** | 0,04% |

**Padrões dos 2.357 telefones inválidos:**
`+# (##) #### ####` 784 (DDI de outro país) · `(###) ##### ####` 413 (DDD de 3 dígitos) ·
`##### ####` 408 (sem DDD) · `#############` 143 · `##############` 88 · `(##) ##### ####` 78 ·
`+## (##) #### ####` 73 · `###############` 64 · `#### ####` 50 · `(##) #### ####` 32.
Boa parte dos 78+32 com máscara aparentemente correta falha por DDD inexistente ou 8º dígito ≠ 9.

**E-mails inválidos:** o padrão dominante é o literal **`none` (462 registros)** — placeholder, não e-mail.
Os outros 134 são erros de digitação (`…@gmail.com9913`, `@gmail.2019com`, `@gmail.c`).

---

## 12. Duplicidade

### 12.1 Por telefone normalizado

| Métrica | Valor |
|---|---:|
| Telefones distintos (E.164) | **77.591** |
| Telefones que aparecem em 2+ leads | **14.005** |
| Leads envolvidos em telefone repetido | **36.751 (35,8%)** |
| Leads que são repetição (excedente) | **22.746** |
| Telefones atendidos por **mais de 1 corretor** | **10.846** |
| Telefones com mais de 1 `Status` | 6.574 |

Histograma de leads por telefone:

```
1 lead : 63.586 | 2: 9.623 | 3: 2.243 | 4: 1.247 | 5: 421 | 6: 186 | 7: 98 | 8: 68
9: 47 | 10: 20 | 11: 12 | 12: 8 | 13: 10 | 14: 8 | 15: 4 | 16: 4 | 18: 1 | 19: 1 | 20: 2 | 21: 1 | 22: 1
```

O recordista tem **22 leads no mesmo telefone**. Telefones distintos por ano de primeira aparição:
2024 = 28.325 · 2025 = 29.250 · 2026 = 20.016.

### 12.2 Por e-mail

| Métrica | Valor |
|---|---:|
| E-mails válidos distintos | **75.378** |
| E-mails em 2+ leads | 14.268 |
| Leads envolvidos em e-mail repetido | 37.941 (36,9%) |

### 12.3 Por nome + telefone

| Métrica | Valor |
|---|---:|
| Nomes (`Cliente`) distintos, minúsculo | 60.095 |
| Nomes repetidos | 12.493 |
| Pares (telefone, nome) distintos | 85.821 |
| Pares repetidos | 9.734 |
| Leads em par repetido | 24.250 |

### 12.4 Quantos clientes reais existem

Identidade = telefone E.164 válido, ou e-mail válido quando não há telefone:

> **79.587 identidades distintas** para 102.799 leads. 45 leads sem chave nenhuma.
> Ou seja, **~23.200 leads (22,6%) são o mesmo cliente reentrando** — o que é coerente com
> `Lead duplicado` aparecer 1.010 vezes em `Motivos de perda` (a equipe só marcou 4% das duplicatas).

`unique id` não tem duplicata (102.799/102.799), então a duplicidade é de **cliente**, não de registro.

---

## 13. Relacionamentos (FKs candidatas, todas por nome)

| Coluna | Aponta para | Formato | Cobertura |
|---|---|---|---|
| `Corretor` | `export_All-corretors` / `Users` → `profiles` | nome de exibição, 1 valor | 263/292 nomes, 93,0% dos leads |
| `Corretorszz` | idem (snapshot antigo) | nome de exibição, 1 valor | 258 valores |
| `correto` | idem (só lote Instagram) | nome de exibição | 468 registros |
| `Gerente` | `export_All-gerentes` → `profiles` | **lista** separada por `, ` | 14/18 nomes, 94,2% |
| `Gerenteszz` | idem (snapshot, 1 valor) | nome de exibição | 15 valores |
| `Gerentererr` | idem (só lote Instagram) | nome de exibição | 468 registros |
| `Fonte` | `lead_sources` (a criar) | rótulo | 14 valores |
| `Grupo` | `distribution_groups` (a criar) | rótulo | 49 valores |
| `Imóvel` | `developers` / `ad_campaigns` | **substring** do nome da construtora | 34.336 casamentos, 19 das 41 construtoras |
| `Código` | empreendimento no TecImob | id externo numérico | 662 registros |
| `Creator` | `Users` (Bubble) | nome de exibição, ~constante | 102.798 = `Douglas Gomes` |
| `unique id` | PK do Bubble | `\d{13}x\d{15,}` | 102.799 únicos |

Referências **de entrada** esperadas (a confirmar nos perfis das outras entidades):
`pipelines`, `historicoPipes`, `observacaoPipelines` e `ligacoes` devem apontar para este `unique id`
ou para o nome do cliente.

---

## 14. Problemas de qualidade (lista consolidada)

1. **Encoding corrompido irreversivelmente**: 337.879 U+FFFD. Cada acento virou 1 caractere perdido.
   Recuperável só para domínio fechado (`Status`, `Fonte`, `Motivos de perda`, `Grupo`, `Atividade`) por
   casamento por subsequência com as variantes limpas. Em `Cidade` (133 valores mojibake sem variante limpa),
   `Cliente`, `Observações` e `Mensagem`, **é perda definitiva**.
2. **7 colunas 100% vazias**: `Data Criação`, `Data_atividade`, `data_criacao`, `Preço`, `Reavivado_em`,
   `Reavivar_em`, `Slug`.
3. **2 colunas quase vazias e restritas a um lote**: `correto` (468), `Gerentererr` (468).
4. **1 coluna constante**: `Vida` = `1ª` sempre. E `Creator` = `Douglas Gomes` em 102.798/102.799.
5. **`Criado_em` com ano errado em 2.638 registros** (delta de −366 dias).
6. **4 formatos de data no mesmo campo** `Criado em` (499 em ISO).
7. **Vazamento de campo**: valores de `Atividade` gravados em `Motivos de perda` (999 ocorrências) e
   perguntas de chatbot gravadas em `Atividade` (~191 valores distintos, 957 registros).
8. **`Cidade` sem padronização**: 751 grafias para ~50 cidades reais; slug e texto livre no mesmo campo.
9. **2.357 telefones não normalizáveis** e **462 e-mails literalmente `none`**.
10. **22,6% de duplicidade de cliente** (79.587 identidades para 102.799 leads).
11. **Placeholders como corretor**: `Usuário Repique` (530) e `Em espera` (497) — 1.027 leads sem dono real.
12. **`Gerente` multivalorado** (2.151 leads com 2 gerentes) contra `Gerenteszz` sempre singular — decidir qual regra vale.
13. **Datas de atividade no futuro** (até 18/09/2026) e 5 outliers pré-2024 (2016–2019).
14. **`Status` não registra venda**: só 59 `Negócio fechado` em 102.799 leads.
15. **Sem campo de LGPD**: não há consentimento, opt-out ou origem de consentimento em lugar nenhum.

---

## 15. Volume relevante para importar

| Recorte | Leads | Comentário |
|---|---:|---|
| Total no CSV | 102.799 | — |
| (−) Lote Instagram nov/2024 sem status | −719 | layout próprio, sem dado de funil |
| (−) `Lead Teste` / `Lead duplicado` marcados | −1.044 | lixo declarado pela própria equipe |
| (−) Sem contato utilizável | −45 | nem telefone válido nem e-mail válido |
| **Base limpa** | **≈100.991** | |
| **Contatos únicos** (dedup por telefone/e-mail) | **79.587** | −22,6% de duplicidade real |
| **Com atividade nos últimos 12 meses** | **41.367** | 40,2% do total |
| **Ativos e recentes** (`Em negociação`/`Novo` + atividade ≤12m) | **27.477** | o que um corretor ainda trabalharia |
| **Criados em 2026** | **26.571** | 25,9% |

**Recomendação de corte (com consequências):**

- **Opção A — importar tudo (102.799):** preserva histórico completo para relatórios de conversão
  multi-ano. Custo: a base de leads nasce com 60% de registros mortos, 22,6% de duplicidade,
  e a roleta/dashboards precisam de filtro de recência em toda query. Também traz 100 mil telefones
  para dentro do escopo de LGPD sem base de consentimento.
- **Opção B — importar ativos recentes (≈27.477) e arquivar o resto em tabela fria:** o CRM nasce
  utilizável, a roleta não vê lixo. Custo: relatórios históricos de 2024/2025 exigem consultar a tabela fria;
  e "reavivar lead antigo" deixa de ser possível pela UI sem um passo extra.
- **Opção C (intermediária) — importar os 41.367 com atividade ≤12m, deduplicados para ~34–36 mil:**
  equilíbrio entre histórico útil e higiene. É a que eu tomaria como padrão.

Em qualquer opção: **deduplicar por telefone E.164** antes de inserir, mantendo o lead **mais recente**
como principal e os demais como `lead_events`/histórico — senão 14.005 telefones geram atendimento
concorrente na roleta (10.846 deles já têm mais de um corretor no histórico).

---

## 16. O que não foi possível responder

1. **Não dá para reconstruir o texto acentuado corrompido** em campos livres (`Cliente` 61.518 valores,
   `Observações`, `Mensagem`, `Cidade`). Cada acento virou U+FFFD e a informação do byte original se perdeu
   no arquivo. Para domínio fechado a reconciliação por subsequência funciona; para nome próprio, não —
   `Mar<?>a` pode ser `María` ou `Marça`.
2. **Não foi possível confirmar o fuso horário**. O CSV não declara. Adotado America/Sao_Paulo (§2).
   Só o dono do app Bubble (ou o setting do app) resolve isso.
3. **Não foi possível confirmar o significado exato de `novo`** além do corte temporal (25/03/2026).
   O CSV tem só o valor `sim`; a regra que liga a flag está no workflow do Bubble, fora do export.
4. **A relação entre `leadfies` e `pipelines`/`historicoPipes` não foi verificada** — está fora do escopo
   deste grupo e exige o perfil daquelas entidades.
5. **`Identificador` não pôde ser mapeado a uma origem** (`utm_content`? id do formulário Meta?):
   é um slug de 6 chars sem correspondência óbvia com nenhuma outra coluna deste CSV.
6. **Cardinalidade canônica exata** de `Cidade`, `Imóvel` e `Motivos de perda` fica em faixa
   (≤529, ≤316, 24 motivos reais) porque 133/72/116 valores mojibake não têm par limpo no arquivo
   para reconciliar automaticamente.

---

*Todos os números deste relatório saem de scripts Python executados sobre o CSV; nenhum foi estimado.
Nenhum arquivo do repositório foi alterado e nenhuma consulta foi feita ao banco.*
