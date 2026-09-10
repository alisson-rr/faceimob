# Perfil — grupo "Users (pessoas do sistema)"

Export do Bubble legado. Perfilado em 09/09/2026 com `csv.DictReader` (Python 3.12).
Todo número deste documento saiu de um script rodado sobre o arquivo; nada foi estimado.

- **Arquivo:** `DOCUMENTOS/DADOS_BUBBLE/export_All-Users-modified--_2026-09-08_19-44-45.csv` (133.295 bytes)
- **Registros (parse CSV real):** **298**
- **Colunas:** 34
- **Não existe coluna `Creator`** neste export (existe nos demais). Existe `unique id`.

> **Segurança:** a coluna `senha_temporaria` contém senhas em texto claro (298/298 preenchidas).
> Nenhum valor foi lido para a saída, exibido ou copiado. Só metadados (comprimento/cardinalidade).
> CPF, telefone, e-mail, endereço e nomes aparecem **mascarados** em todos os exemplos abaixo.

---

## 1. Resumo de negócio

Esta é a tabela de **pessoas do sistema** (o tipo `User` nativo do Bubble): quem loga, quem recebe lead,
quem aparece no ranking e na hierarquia. Cobre corretores, gerentes, diretores, CCA, sócio, ADM e
serviços gerais — todos com e-mail corporativo `@faceimob.com.br` (296 de 298; 2 exceções em `gmail.com`,
ambas inativas).

É também o **cadastro de RH da operação**: guarda CPF, CRECI, habilitação, data de nascimento, endereço,
data de entrada na empresa, foto de perfil, além dos vínculos hierárquicos (diretor / gerência / equipe).
O Bubble não normalizou isso: as colunas de relacionamento vêm como **texto de exibição**, e há tabelas
satélites redundantes (`corretors`, `gerentes`, `Equipes`) que repetem o mesmo vínculo.

Do total de 298 pessoas, **94 estão ativas** (`Ativo = sim`) — 78 corretores, 7 gerentes, 3 diretores,
2 CCA, 2 sócios, 1 ADM, 1 serviços gerais. As outras 204 são desligados acumulados desde mai/2024.

---

## 2. Perfil coluna a coluna

`%` = preenchimento (não-vazio) sobre 298 linhas. "Card." = valores distintos entre os não-vazios.

| # | Coluna | Tipo observado | % preench. | Card. | Exemplos (mascarados) | Semântica | Referência? |
|---|--------|----------------|-----------:|------:|------------------------|-----------|-------------|
| 1 | `Ativo` | texto `sim`/`não` | 100,0% (298) | 2 | `sim`, `não` | **Flag operacional**: pessoa em atividade hoje. Espelha 1:1 `corretors.ativo`. | não |
| 2 | `colaboradores` | texto | 100,0% (298) | **298** | `Douglas G.`, `Archimedes B.`, `Leone B.` | **Nome de exibição do User no Bubble** — é este valor que aparece nas colunas de relacionamento de TODOS os outros CSVs. Único em 298/298. | não (é o alvo das referências) |
| 3 | `corretor` | texto (nome de exibição) | 3,7% (11) | 11 | `Archimedes B.`, `Junior R.`, `Felipe P.` | Auto-referência residual ao registro em `corretors`. Preenchida em só 11 linhas — campo abandonado. | `nome_exibicao->corretors.Nome` (bate 11/11) e também `->Users.colaboradores` (11/11) |
| 4 | `cpf` | numérico, só dígitos, **sem pontuação** | 98,7% (294) | 288 | `808.***.***-87`, `339.***.***-91`, `016.***.***-71` | CPF do colaborador. | não |
| 5 | `creci` | misto: número **ou** texto livre | 38,3% (114) | 88 | `49245`, `52271`, `61090` | Registro CRECI. 83 numéricos (5–6 dígitos) + 31 valores textuais (`Estágio`, `Não possui`…). | não |
| 6 | `diretor` | texto (nome de exibição) | 72,8% (217) | 5 | `Archimedes B.`, `Mauricio V.`, `Fabio B.` | Diretor a que a pessoa responde. | `nome_exibicao->Users.colaboradores` (**217/217 resolvem, 5/5 valores distintos**) |
| 7 | `divisao` | numérico | 95,6% (285) | **1** | `1` | Constante `1` em todas as 285 linhas preenchidas. Só existe uma divisão. **Sem informação.** | não |
| 8 | `endereco` | texto livre | 78,2% (233) | 226 | `Rua Inconfid...`, `travessa Fra...`, `Rua Celso Fi...` | Endereço residencial, uma string só (rua+número+bairro+cidade). 12–95 chars, média 35. 14 contêm CEP; 6 contêm ` , `; 0 contêm quebra de linha; há NBSP (`\xa0`) em pelo menos 1. | não |
| 9 | `entrada` | data en-US Bubble | 99,0% (295) | 196 | `May 1, 2019 12:00 am`, `Feb 1, 2017 12:00 am`, `Dec 1, 2015 12:00 am` | **Data de admissão.** 294/295 às `00:00` (só data). Faixa 01/01/2013 → 05/09/2026. 288/295 anteriores ao `Creation Date`, coerente com admissão retroativa. | não |
| 10 | `enviou` | texto `sim`/`não` | 95,0% (283) | 2 | `não` (193), `sim` (90) | Flag de "já enviei" de uma ação em lote **feita só em 2024**: `enviou=sim` ocorre em 90 linhas, **todas** criadas em 2024; nenhuma criada em 2025/2026. Provável envio de credencial/comunicado. Sem valor para importação. | não |
| 11 | `equipe` | texto (nome da equipe) | 89,6% (267) | 12 | `Victor`, `Jose Portilho`, `Zona Sul` | Equipe do colaborador. | `nome_exibicao->Equipes.nome` (**267/267 resolvem; os 12 times do CSV de Equipes são exatamente os 12 usados**) |
| 12 | `Funcao` | texto (enum de fato) | 99,7% (297) | 7 | `CORRETOR`, `GERENTE`, `DIRETOR` | **Papel na operação → vira `app_role`.** Distribuição completa na §3. | não (enum) |
| 13 | `GameAtual` | Bubble unique id | 47,7% (142) | 142 | `1788277990186x177400585148673730` | Ponteiro para o registro de gamificação do mês corrente. Timestamps embutidos vão de 28/03/2026 a 05/09/2026. | `unique_id->gameficacaos` (**142/142 batem em `gameficacaos."unique id"`**) |
| 14 | `gerencia` | texto (nome de exibição) | 95,6% (285) | 16 | `Victor R.`, `Leonardo V.`, `Fabio B.` | **Gerente responsável** — este é o campo de gerência que vale (95,6% preenchido). | `nome_exibicao->Users.colaboradores` (**285/285, 16/16 distintos**); também bate em `gerentes.nome` para 15 dos 16 (falta `Kathila Aguiar`) |
| 15 | `gerente` | texto (nome de exibição) | 3,7% (11) | 9 | `Junior R.`, `Alexandre C.`, `Felipe P.` | Campo legado/duplicado de `gerencia`, quase vazio. **Ignorar.** | `nome_exibicao->Users.colaboradores` (11/11) |
| 16 | `habilitacao` | texto (enum de fato) | 61,4% (183) | 3 | `CRECI`, `Não Possui (Estágio)`, `Estágio` | Situação de habilitação profissional. | não (enum) |
| 17 | `imgPerfil` | URL protocol-relative | 29,2% (87) | 87 | `//0b42...cdn.bubble.io/f1768267745552x.../Douglas.png` | Foto de perfil no CDN do Bubble. Detalhe na §8. | arquivo externo |
| 18 | `indicacao` | texto livre (primeiro nome) | 24,8% (74) | 30 | `Leonardo`, `Douglas V.`, `Marcio` | **Quem indicou** a pessoa para a vaga (recrutamento). Texto livre, não é FK: só 10 das 74 linhas (6 dos 30 valores) batem em `colaboradores`; o resto são apelidos/primeiros nomes e até `Anuncio Instagram`. | **não** (texto livre, não resolvível) |
| 19 | `mostrar` | texto `sim`/`não` | 49,0% (146) | 2 | `sim` (145), `não` (1) | Flag "exibir na listagem/ranking". Foi preenchido por uma varredura recente: **todas as 146 linhas com valor têm `Modified Date` em 2026**; nenhuma criação de 2026 ficou vazia. Correlaciona com gamificação: 120 dos 145 `sim` têm `GameAtual`. | não |
| 20 | `nascimento` | data en-US Bubble | 65,8% (196) | 192 | `Mar 11, 1961 12:00 am`, `Mar 25, 1989 12:00 am` | Data de nascimento. Todas às `00:00`. **23 valores absurdos** (ano > 2008, incl. `Mar 1, 2075`) — ver §10. | não |
| 21 | `new_Pontuacao` | — | **0,0% (0)** | 0 | — | Campo de pontuação nunca usado (a pontuação vive em `gameficacaos.pontos`). | não |
| 22 | `niver_dia` | numérico 1–31 | 65,8% (196) | 31 | `12`, `11`, `25` | Dia do aniversário. **Derivado de `nascimento`: 196/196 consistentes, 0 divergentes**, e nunca preenchido sem `nascimento`. Redundante. | não |
| 23 | `niver_mes` | numérico 1–12 | 65,8% (196) | 12 | `7`, `3`, `6` | Mês do aniversário. Mesma derivação, 196/196 consistentes. Redundante. | não |
| 24 | `Nome_completo` | texto | 99,7% (297) | 296 | `Douglas G.`, `Antonio B.`, `Leone B.` | **Nome civil completo.** ≠ `colaboradores` (só 76/298 são iguais). 1 duplicata (`Andre S.` ×2), 1 linha vazia, 0 nomes com vírgula. | não |
| 25 | `senha_temporaria` | texto | 100,0% (298) | 295 | `<redigido>` | **SENHA EM TEXTO CLARO.** Comprimentos: 8 chars (275), 9 (10), 10 (4), 11 (3), 12 (3), 6/7/14 (1 cada). **Não importar. Não logar. Não versionar.** | não |
| 26 | `Status_colab` | texto | 76,8% (229) | 2 | `Ativo` (227), `Off` (2) | Campo de status de colaborador **abandonado** — ver §4. | não |
| 27 | `telefone` | texto, só dígitos | 98,7% (294) | 289 | `51 9****-2662`, `51 9****-4475` | Celular. Formatos: 11 dígitos (260), 10 (30), 9 (4). Sem DDI, sem máscara. 4 grupos duplicados (9 linhas). | não |
| 28 | `venda` | — | **0,0% (0)** | 0 | — | Nunca usado. | não |
| 29 | `vendas_corretor` | — | **0,0% (0)** | 0 | — | Nunca usado (vendas ficam em `corretors.vendas_mes` / `pipelines`). | não |
| 30 | `Creation Date` | data en-US Bubble | 100,0% (298) | 295 | `May 11, 2024 1:07 pm` | Criação do registro. Faixa **11/05/2024 13:07 → 05/09/2026 11:01**. | não |
| 31 | `Modified Date` | data en-US Bubble | 100,0% (298) | 161 | `Feb 3, 2026 2:29 pm` | Última alteração. Faixa 16/05/2024 → 08/09/2026 12:09. Só 161 distintos ⇒ houve edições em lote. | não |
| 32 | `email` | email | 100,0% (298) | **298** | `co***@faceimob.com.br`, `fa***@gmail.com` | **Login do Bubble.** Chave natural. Detalhe na §5. | não (é chave) |
| 33 | `null` | — | **0,0% (0)** | 0 | — | Coluna-lixo do export (nome literal `null`), sempre vazia. | não |
| 34 | `unique id` | Bubble unique id | 100,0% (298) | **298** | `1715443624424x775001821482952600` | PK do Bubble. 298/298 no formato `\d{13}x\d{15,22}`, sem colisão. O timestamp embutido bate com `Creation Date` em 298/298 (< 48h). | PK |

---

## 3. (a) `Funcao` — distribuição completa (7 valores + vazio)

| Valor | Linhas | % | Ativos (`Ativo=sim`) |
|-------|-------:|--:|---------------------:|
| `CORRETOR` | 275 | 92,3% | 78 |
| `GERENTE` | 8 | 2,7% | 7 |
| `DIRETOR` | 5 | 1,7% | 3 |
| `CCA` | 5 | 1,7% | 2 |
| `SÓCIO` | 2 | 0,7% | 2 |
| `ADM` | 1 | 0,3% | 1 |
| `SERVICOS GERAIS` | 1 | 0,3% | 1 |
| *(vazio)* | 1 | 0,3% | 0 |
| **Total** | **298** | 100% | **94** |

Observações para virar `app_role` (enum alvo: `admin | director | manager | broker | cca | sdr | marketing | partner`):

- `CORRETOR` → `broker`; `GERENTE` → `manager`; `DIRETOR` → `director`; `CCA` → `cca`; `ADM` → `admin`; `SÓCIO` → `partner`.
- **`SERVICOS GERAIS` não tem correspondente** no enum alvo (1 pessoa, ativa). Decisão pendente.
- **`sdr` e `marketing` não existem no legado** — nenhuma linha os representa.
- `Funcao` é **single-valued**, mas o alvo (`user_roles`) é N:N. Há evidência de acúmulo de papéis no legado:
  4 pessoas com `Funcao=DIRETOR` e 4 com `Funcao=CORRETOR` aparecem como alvo da coluna `gerencia` de outras
  pessoas (ou seja, atuam como gerente sem ter `Funcao=GERENTE`). Ver §6.
- `SÓCIO` tem acento; `SERVICOS GERAIS` não tem cedilha. A comparação precisa ser literal.
- 1 linha sem `Funcao` (registro de teste: `colaboradores` = `JR`, `Nome_completo` = `sjr`, criada em 11/05/2024, inativa).

---

## 4. (c) `Ativo` × `Status_colab` — o que distingue

Cruzamento completo (298 linhas):

| `Ativo` | `Status_colab` | Linhas |
|---------|----------------|-------:|
| `não` | `Ativo` | 156 |
| `sim` | `Ativo` | 71 |
| `não` | *(vazio)* | 46 |
| `sim` | *(vazio)* | 23 |
| `não` | `Off` | 2 |

**Conclusão: são campos diferentes e só `Ativo` é confiável.**

- **`Ativo` (`sim`/`não`, 100% preenchido)** é o flag operacional vivo. Prova cruzada: fazendo o join
  `Users.colaboradores = corretors.user` contra o CSV `export_All-corretors-modified`, **os dois campos
  concordam em 289/289 linhas com par** (201 `não`/`não`, 88 `sim`/`sim`, zero divergências; 9 usuários
  sem registro em `corretors`). Além disso, `Ativo=sim` concentra-se em registros recentes: 93 das 94
  linhas ativas têm `Modified Date` em 2026.
- **`Status_colab` está abandonado.** Só assume `Ativo` (227) ou `Off` (2), com 69 vazios — e esses 69
  vazios são **todos** de registros criados em 2024. Depois disso o campo passou a ser gravado sempre como
  `Ativo` (105 em 2025, 83 em 2026), inclusive para gente que já saiu: **156 pessoas têm `Ativo=não` e
  `Status_colab=Ativo`**. Ele virou default de formulário, não status.

**Para o schema alvo (`profiles.status`: `active | suspended | terminated`):** usar `Ativo=sim → active`,
`Ativo=não → terminated`. Ignorar `Status_colab`. Não há dado de "suspenso" no legado.
`profiles.hired_at` sai de `entrada`; `terminated_at` **não existe no legado** (nenhuma coluna de desligamento).

---

## 5. (b) E-mails

| Métrica | Valor |
|---------|------:|
| Linhas | 298 |
| Preenchidos | **298 (100%)** |
| Vazios | **0** |
| Únicos (case-sensitive) | **298** |
| Únicos (case-insensitive) | **298** |
| Duplicados | **0** |
| Inválidos (regex `^[^@\s,;]+@[^@\s,;]+\.[A-Za-z]{2,}$`) | **0** |
| Com maiúsculas | 0 |

Domínios (distribuição completa):

| Domínio | Linhas |
|---------|-------:|
| `faceimob.com.br` | 296 |
| `gmail.com` | 2 |

Formato do local-part: 283 de 298 contêm ponto (padrão `nome.sobrenome`), 15 são uma palavra só,
**nenhum contém dígito**. As 2 exceções em `gmail.com` são um `GERENTE` e um `CORRETOR`, ambos `Ativo=não`.

**Conclusão:** `email` é a chave natural desta tabela — 100% preenchida, 100% única, 100% válida,
já em minúsculas. Serve tanto para `profiles.email` (citext, NOT NULL) quanto para criar o usuário no
Supabase Auth.

---

## 6. (d) Hierarquia — para quem apontam e em que formato

**Descoberta central: o alvo das referências é `colaboradores`, não `Nome_completo`.**

`colaboradores` é o campo de exibição do tipo `User` no Bubble (o "display field"). É único em 298/298.
`Nome_completo` é o nome civil e **só coincide com `colaboradores` em 76 de 298 linhas** (ex.: um registro
tem `colaboradores` começando por "Archimedes" e `Nome_completo` começando por "Antonio"). Resolver
hierarquia por `Nome_completo` **falha**.

Taxa de resolução, medida contra os 298 valores de `colaboradores`:

| Coluna | Linhas preench. | Linhas que resolvem | Valores distintos | Distintos que resolvem | Formato |
|--------|----------------:|--------------------:|------------------:|-----------------------:|---------|
| `diretor` | 217 (72,8%) | **217 (100%)** | 5 | **5/5** | nome de exibição |
| `gerencia` | 285 (95,6%) | **285 (100%)** | 16 | **16/16** | nome de exibição |
| `gerente` | 11 (3,7%) | **11 (100%)** | 9 | **9/9** | nome de exibição |
| `corretor` | 11 (3,7%) | **11 (100%)** | 11 | **11/11** | nome de exibição |
| `equipe` | 267 (89,6%) | **267 (100%)** → `Equipes.nome` | 12 | **12/12** | nome da equipe |
| `indicacao` | 74 (24,8%) | **10 (13,5%)** | 30 | 6/30 | texto livre, **não é FK** |

Formato: **todos são texto de exibição single-valued**. Nenhuma coluna deste arquivo contém `unique id`
de outra tabela exceto `GameAtual`. **Nenhuma contém lista com separador ` , `** (0 ocorrências em todas
as colunas de relacionamento — as 6 ocorrências de ` , ` estão em `endereco`, que é texto livre). Ou seja,
**a armadilha da lista ambígua não afeta este arquivo**; ela afeta `Equipes.corretores`, que traz a lista
de corretores concatenada.

### Cadeia hierárquica de fato

`pessoa → equipe → gerencia → diretor`

- `equipe` bate 1:1 com o CSV `export_All-Equipes-modified` (12 times: `Alexandre`, `Alisson`, `Archimedes`,
  `Daiane Dias`, `Faceimob`, `Jose Portilho`, `Leonardo`, `Mauricio`, `Susana`, `Veronica`, `Victor`, `Zona Sul`).
  Nenhum time do CSV está vazio, nenhum valor de `equipe` fica órfão.
- `equipe → gerencia` é quase funcional, **com uma exceção real**: a equipe `Jose Portilho` tem **duas**
  gerências (`Jose Portilho` em 23 linhas e `Junior Rezende` em 22). Todos os outros 11 times mapeiam para
  uma única gerência. Consequência: não dá para derivar `gerencia` a partir de `equipe`; importe as duas colunas.
- `gerencia → diretor` **não é funcional**: `Victor Rafael` aparece sob `Fabio Batista` (47), sob
  `Mauricio Vieira` (1) e com diretor vazio (5); `Archimedes Boff`, `Junior Rezende`, `Mauricio Vieira` e
  `Fabio Batista` aparecem como gerência e como diretor de si mesmos. Isso reflete mudança de estrutura ao
  longo do tempo, não erro de parse.

Distribuição completa de `diretor` (5 valores + vazio):

| Valor | Linhas |
|-------|-------:|
| *(vazio)* | 81 |
| `Fabio Batista` | 77 |
| `Archimedes Boff` | 71 |
| `Mauricio Vieira` | 61 |
| `Junior Rezende` | 6 |
| `Luis Hahn` | 2 |

Distribuição completa de `gerencia` (16 valores + vazio):

| Valor | Linhas |
|-------|-------:|
| `Victor Rafael` | 53 |
| `Leonardo Vallier` | 31 |
| `Fabio Batista` | 30 |
| `Alisson Luiz` | 24 |
| `Jose Portilho` | 23 |
| `Archimedes Boff` | 22 |
| `Junior Rezende` | 22 |
| `Mauricio Vieira` | 20 |
| `Daiane Dias` | 15 |
| `Susana Cristina Prates` | 14 |
| *(vazio)* | 13 |
| `Felipe di Pompo` | 10 |
| `Alexandre Chaves` | 10 |
| `Leone Bampi` | 8 |
| `Gerente Interino` | 1 |
| `Veronica Oliveira` | 1 |
| `Kathila Aguiar` | 1 |

Distribuição completa de `equipe` (12 valores + vazio):

| Valor | Linhas |
|-------|-------:|
| `Victor` | 53 |
| `Jose Portilho` | 45 |
| *(vazio)* | 31 |
| `Leonardo` | 31 |
| `Zona Sul` | 30 |
| `Alisson` | 24 |
| `Archimedes` | 22 |
| `Mauricio` | 20 |
| `Daiane Dias` | 15 |
| `Susana` | 14 |
| `Alexandre` | 10 |
| `Faceimob` | 2 |
| `Veronica` | 1 |

### Papel real ≠ `Funcao`

Cruzando o alvo de cada coluna com a `Funcao` desse alvo:

- alvos de `diretor` (5 pessoas): 5 `DIRETOR` — coerente.
- alvos de `gerencia` (16 pessoas): 8 `GERENTE`, **4 `DIRETOR`, 4 `CORRETOR`**.
- alvos de `gerente` (9 pessoas): 5 `GERENTE`, 3 `CORRETOR`, 1 `DIRETOR`.
- alvos de `corretor` (11 pessoas): 6 `CORRETOR`, 3 `GERENTE`, 2 `DIRETOR`.

Isso confirma o acúmulo de papéis que o alvo modela em `user_roles` (N:N).

### `gerente` e `corretor`: campos mortos

Ambos têm só 11 linhas preenchidas, e nas 14 linhas onde pelo menos um deles aparece o valor quase sempre
**repete `gerencia` ou é auto-referência** (a pessoa apontando para si mesma). Exemplos observados:
uma `GERENTE` com `corretor = gerente = gerencia =` ela mesma; um `CORRETOR` com `corretor =` ele mesmo e
`gerente = gerencia`. São restos de um modelo antigo. **Não importar.**

### Tabelas satélites redundantes

- `export_All-corretors-modified` (365 linhas, 290 users distintos, **6 users com mais de um registro**) —
  duplica `ativo` e acrescenta `vendas_mes`, `VGV_mes`, `agil_qtd`. Todos os `user` menos 1 existem em
  `Users.colaboradores`.
- `export_All-gerentes-modified` (22 linhas, 20 nomes) — 15 dos 16 valores de `gerencia` batem em `nome`;
  `Kathila Aguiar` só existe em `Users`. Traz também `Douglas`, `Parceiro`, `Paulo Rodrigues`, `Zona Sul`,
  `Luis Hahn` que **não** são usados como `gerencia` por ninguém.
- `export_All-Equipes-modified` (12 linhas) — traz `Diretor`, `gerente`, `gerente_gerente` e a **lista**
  `corretores` (separador ` , `, ambíguo).

---

## 7. (e) CPF

| Métrica | Valor |
|---------|------:|
| Preenchidos | 294 (98,7%) |
| Vazios | 4 |
| Com pontuação no arquivo | **0** (só dígitos) |
| Com 11 dígitos | 293 |
| Com 10 dígitos | **1** (zero à esquerda perdido) |
| **Válidos (dígito verificador, algoritmo mod-11)** | **286 (97,3% dos preenchidos)** |
| **Inválidos** | **8** |
| **Grupos duplicados** | **6** (12 linhas envolvidas) |

Os 6 CPFs duplicados **não são a mesma pessoa** em 3 dos 6 casos — são digitação errada:

| CPF (mascarado) | Registros que compartilham |
|-----------------|----------------------------|
| `561.***.***-53` | um `DIRETOR` e um `CORRETOR`, e-mails diferentes — **e o CPF é inválido no DV** |
| `004.***.***-77` | dois `CORRETOR` de nomes diferentes |
| `016.***.***-58` | dois `CORRETOR`, mesmo nome com/sem acento — provável **duplicata real da mesma pessoa** |
| `485.***.***-20` | dois `CORRETOR` de nomes diferentes |
| `866.***.***-15` | dois `CORRETOR` de nome equivalente — provável duplicata real |
| `051.***.***-40` | dois `CORRETOR`, e-mails de prefixo igual — provável duplicata real |

**Consequência:** CPF **não serve como chave natural**. Use `email` (ou `unique id`). Se `profiles.cpf`
ganhar UNIQUE, 6 pares quebram a carga: normalize para 11 dígitos com zero-padding, rejeite/marque os 8 com
DV inválido e trate os 3 pares que parecem ser a mesma pessoa antes de importar.

---

## 8. (g) `imgPerfil` — as imagens são baixáveis? **Sim.**

- 87 linhas preenchidas (29,2%), **87 URLs distintas**, 86 nomes de arquivo distintos.
- Prefixo **único** para todas as 87: `//0b42dac624c17cda9446e55d45fcfe83.cdn.bubble.io/`
- Formato: **URL protocol-relative** (começa com `//`, sem `https:`) — 87/87. É preciso prefixar `https:`.
- Padrão do path: `//<hash-app>.cdn.bubble.io/f<timestamp-ms>x<random>/<NomeDoArquivo>.<ext>`
- Extensões: **86 `.png`, 1 `.jpg`**.
- Nomes de arquivo são humanos e sem padrão (`Douglas.png`, `Arch.png`, `Mauricio.png`, `Fernanda%202.png`)
  — **contêm percent-encoding** (`%20`), então precisam de `urldecode` antes de virar nome no Storage.
- **Verificação executada:** requisição `HEAD` (sem baixar corpo) em 3 URLs distintas → **HTTP 200**,
  `Content-Type: image/png`, tamanhos 691.651 / 942.543 / 827.320 bytes. O CDN é **público, sem autenticação**.
- Tamanho: ~0,7–0,9 MB por foto nas amostras. 87 fotos ⇒ ordem de **60–80 MB** a migrar para o Storage.
  Redimensionar antes de subir é recomendável (`profiles.avatar_url` é só um texto).
- Cobertura ruim: das 94 pessoas ativas, **só 58 têm foto**; e 29 fotos pertencem a gente já inativa.

---

## 9. (f) Colunas de significado obscuro — o que cada uma é

| Coluna | Veredito baseado em dado |
|--------|--------------------------|
| `divisao` | **Constante.** 285 linhas, 1 único valor: `1`. Os 13 vazios são 8 `CORRETOR`, 2 `CCA`, 2 `SÓCIO`, 1 `SERVICOS GERAIS`. Só existiu uma divisão — a coluna nunca discriminou nada. O alvo tem `profiles.division`, mas importá-la só grava `"1"` em todo mundo. **Descartar.** |
| `indicacao` | **Quem indicou a pessoa** no recrutamento. Texto livre, 74 linhas, 30 valores. Não é FK: só 6 dos 30 valores batem em `colaboradores`. Contém apelidos (`Dutra`, `Kevyn`, `ezequyel`), nomes com acento inconsistente (`Verônica` vs `Veronica`) e até canal (`Anuncio Instagram`). O alvo tem `profiles.indication` (text) — cabe como está. |
| `entrada` | **Data de admissão** (`hired_at`). 295 linhas, faixa 01/01/2013 → 05/09/2026, 294 com hora `00:00`. 36 caem no dia 1 do mês (admissão arredondada). 288/295 anteriores ao `Creation Date`, coerente com dado retroativo. |
| `mostrar` | **Flag de exibição em listagem/ranking.** 146 preenchidas (145 `sim`, 1 `não`), 152 vazias. Todas as 146 têm `Modified Date` em 2026 e nenhum registro criado em 2026 ficou vazio ⇒ foi introduzida recentemente e preenchida em varredura. Correlaciona com gamificação (120 dos 145 `sim` têm `GameAtual`), não com `Ativo` (77 `sim` são de gente inativa). **Sem destino no schema alvo; descartar.** |
| `enviou` | **Flag de ação em lote de 2024.** `sim` em 90 linhas, **todas criadas em 2024**; nenhuma criação de 2025 (105) ou 2026 (83) recebeu `sim`. Provável marcação de "credencial/comunicado enviado". Não repetível, sem valor histórico. **Descartar.** |
| `venda` | **Sempre vazia** (0/298). |
| `vendas_corretor` | **Sempre vazia** (0/298). Vendas vivem em `corretors.vendas_mes` / `pipelines`. |
| `new_Pontuacao` | **Sempre vazia** (0/298). Pontuação vive em `gameficacaos.pontos`. |
| `GameAtual` | **FK para o registro de gamificação corrente.** 142 preenchidas, formato `unique id` do Bubble, **142/142 batem em `export_All---gameficacaos-modified--."unique id"`** (arquivo com 1.063 linhas). Timestamps embutidos: 28/03/2026 → 05/09/2026 ⇒ aponta para o "game do mês", não histórico. `gameficacaos.user` é nome de exibição e bate 162/162 em `colaboradores`. |
| `null` | **Coluna-lixo do export**, nome literal `null`, 0/298 preenchida. Artefato do Bubble. |

---

## 10. Problemas de qualidade encontrados

1. **`senha_temporaria` em texto claro**, 298/298 linhas. Risco imediato: o CSV está no repositório em
   `DOCUMENTOS/DADOS_BUBBLE/`. Nunca importar; idealmente tirar o arquivo do versionamento e forçar reset
   de senha para todo mundo.
2. **`Nome_completo` ≠ `colaboradores`** (só 76/298 iguais) e **as FKs apontam para `colaboradores`**.
   Quem tentar resolver hierarquia por `Nome_completo` obtém 0% de acerto em `diretor` e 3/16 em `gerencia`.
3. **8 CPFs com dígito verificador inválido** e **6 grupos de CPF duplicado** (12 linhas), dos quais ~3
   parecem ser a mesma pessoa cadastrada duas vezes.
4. **1 CPF com 10 dígitos** — zero à esquerda perdido por tratamento numérico no Bubble/planilha.
5. **23 datas de nascimento absurdas** (ano > 2008): incluem `Mar 1, 2075`, `Aug 19, 2026`, `Jul 27, 2026`,
   `Feb 7, 2026` e vários de 2024/2025 — inclusive de diretores e do ADM. O campo foi preenchido com a data
   do cadastro. `niver_dia`/`niver_mes` herdam o erro (196/196 consistentes com `nascimento`).
6. **`Status_colab` não reflete a realidade**: 156 pessoas com `Ativo=não` continuam `Status_colab=Ativo`.
7. **`Ativo` não distingue "suspenso"** — só `sim`/`não`. O alvo tem 3 estados; um deles ficará sem origem.
8. **Sem data de desligamento** em lugar nenhum: `profiles.terminated_at` fica NULL para 204 pessoas.
9. **`creci` é campo misto**: 83 numéricos + 31 textos (`Estágio` 16, `Não possui` 9, `Não Possui` 2,
   `Estagio` 2, `32.957` 1 com ponto, `078022F` 1 com letra). Só 1 grupo de CRECI numérico duplicado
   (`51805`, 2 linhas). E é **inconsistente com `habilitacao`**: 5 pessoas marcadas `Não Possui (Estágio)`
   têm CRECI preenchido, 1 marcada `CRECI` não tem, e 48 pessoas com CRECI têm `habilitacao` vazia.
10. **Telefones sem padrão**: 260 com 11 dígitos, 30 com 10, **4 com 9** (inválidos); sem DDI; 4 grupos
    duplicados (9 linhas).
11. **`endereco` é uma string só**, sem CEP separado (só 14 das 233 contêm CEP) e com caracteres invisíveis
    (NBSP `\xa0`) em pelo menos uma linha.
12. **1 registro de teste** (`colaboradores` = `JR`, `Nome_completo` = `sjr`, sem `Funcao`) e
    **1 linha sem `Nome_completo`**. 1 `Nome_completo` duplicado (`Andre S.` ×2).
13. **Fuso horário não declarado** no arquivo. Todas as datas estão no formato en-US
    (`May 11, 2024 6:18 pm`). **Suposição adotada: `America/Sao_Paulo`.** Isso importa para
    `Creation Date`/`Modified Date` (têm hora real); `entrada` e `nascimento` são `00:00` e devem virar
    `date`, não `timestamptz`, para não deslocar um dia.
14. **4 colunas 100% vazias** (`venda`, `vendas_corretor`, `new_Pontuacao`, `null`) e **1 constante**
    (`divisao` = `1`). 5 das 34 colunas não carregam informação nenhuma.
15. **`corretors` tem 6 usuários com mais de um registro** (365 linhas para 290 users) — se o import cruzar
    com esse arquivo, precisa de deduplicação.

---

## 11. Volume relevante para importação

- **298 linhas totais.** Não há linha em branco, não há cabeçalho repetido, não há registro corrompido:
  todas as 298 parsearam com 34 campos.
- **94 pessoas ativas** (`Ativo=sim`) — este é o volume que precisa virar `profiles` + conta no Supabase
  Auth + linha em `user_roles` no dia 1. Distribuição: 78 `CORRETOR`, 7 `GERENTE`, 3 `DIRETOR`, 2 `CCA`,
  2 `SÓCIO`, 1 `ADM`, 1 `SERVICOS GERAIS`. Distribuídas em 10 equipes (6 ativos sem equipe) e 3 diretores
  (`Fabio Batista` 32, `Archimedes Boff` 25, `Mauricio Vieira` 23, 14 sem diretor).
- **204 pessoas inativas.** Valem a pena como `profiles` com `status='terminated'` **se** algum histórico
  (pipeline, lead, venda, gamificação) apontar para elas por nome — e aponta: `corretors` tem 290 users
  distintos e `gameficacaos` tem 162. Importar as 204 sem conta de Auth (só perfil) evita FK órfã no
  histórico. Se o histórico não for importado, as 204 são descartáveis.
- **Lixo a remover antes de carregar:** 1 registro de teste (`JR`/`sjr`), 1 linha sem `Nome_completo`,
  e ~3 pares de CPF duplicado que parecem ser a mesma pessoa cadastrada duas vezes. Isso é ~5 linhas.
- **Sem histórico antigo a podar:** o export inteiro nasceu em 11/05/2024 (data da migração para o Bubble);
  não há anos de registros mortos. O campo `entrada` chega a 2013, mas é só data de admissão retroativa.
- **Colunas a não importar** (5 sem informação + 5 abandonadas): `venda`, `vendas_corretor`,
  `new_Pontuacao`, `null`, `divisao`, `enviou`, `mostrar`, `Status_colab`, `gerente`, `corretor`.
  Mais `senha_temporaria`, que é proibida, e `niver_dia`/`niver_mes`, deriváveis de `nascimento`.
  Restam ~16 colunas úteis de 34.
- **Ativos com dado faltando** (impacta a completude do `profiles` no dia 1): 3 sem CPF, 3 sem telefone,
  33 sem endereço, 25 sem nascimento, 2 sem `entrada`, 14 sem diretor, 7 sem gerência, 6 sem equipe,
  36 sem foto.
- **Anexos:** 87 fotos no CDN público do Bubble, ~0,7–0,9 MB cada, **baixáveis** (HTTP 200 verificado).

---

## 12. Suposições registradas

- **Fuso:** datas sem timezone tratadas como `America/Sao_Paulo`. `Creation Date`/`Modified Date` viram
  `timestamptz`; `entrada` e `nascimento` viram `date` (hora sempre `00:00`).
- **Chave natural:** `email` (100% preenchido, único e válido). `unique id` é o identificador de origem a
  guardar para religar as outras tabelas do Bubble.
- **Chave de join entre CSVs:** `colaboradores` (nome de exibição), verificada com 100% de resolução em
  `diretor`, `gerencia`, `gerente` e `corretor`. Ela é única neste arquivo (298/298), o que a torna segura
  **aqui** — mas o `Nome_completo` duplicado (`Andre S.` ×2) mostra que homônimo é possível; se outro export
  usar um nome que colida, o join precisa de desempate manual.
- **`Ativo` como fonte de `profiles.status`**, corroborada pelo cruzamento com `corretors.ativo` (289/289).
- **Não foi executado nada contra o banco**; nenhum arquivo do repositório foi alterado além deste relatório.
  A única chamada de rede foi um `HEAD` (sem corpo) em 3 URLs do CDN público do Bubble, para responder
  se as imagens são baixáveis.
