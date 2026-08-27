# Handoff L — Dívida residual: fora o `xlsx`, o erro do banco fala português

Os dois achados que sobraram da auditoria: **S06** (dependência de planilha abandonada com duas CVEs)
e **A05** (30–45 toasts mostrando a mensagem crua do Postgres). Ambos fechados. Mais a limpeza de
documentação pedida.

## 1. Placar

| Item | Estado |
|---|---|
| S06 — troca da dependência de planilha | fechado, `npm audit` limpo de `xlsx` |
| S06 — parser fora da thread principal | **não fechado** — ver §2.4 |
| A05 — erro do banco em pt-BR | fechado: 64 relances + 73 pontos de tela |
| `supabase/README.md` — contagens e tabela `0015`–`0031` | feito |
| `docs/sprints/decisoes.md` — decisão registrada | feito |
| Publicação na Vercel | **não publiquei** — ver §7 |

---

## 2. S06 — entrou o `read-excel-file`, saiu o `xlsx`

### 2.1 Qual pacote e por quê

Escolhi a **saída (b): `read-excel-file@9.3.10`**, do registro npm. Não foi por descarte — testei os
dois candidatos de verdade antes, cada um lendo um `.xlsx` real gerado na hora, e comparei com a
saída (a).

**Contra a saída (a) (SheetJS oficial em `cdn.sheetjs.com`).** Ela corrige as duas CVEs de verdade
(0.19.3 fecha o prototype pollution, 0.20.2 fecha o ReDoS) e teria diff quase zero, porque a API não
muda. Testei: `npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` numa pasta limpa instala e
o `npm audit` fica em **0 vulnerabilidades**. Mas é aí que está o problema — o audit fica quieto
porque o npm **não audita pacote que não veio do registro**, não porque conferiu a versão. Ou seja:
o silêncio seria por invisibilidade, e **uma CVE futura do SheetJS não apareceria mais no audit nem
no dependabot**. Junte a isso que todo `npm i` — máquina de dev, CI, build da Vercel — passaria a
depender de um host fora do registro para não falhar, com a demo do cliente a poucos dias.

**A favor de (b).** Fica no registro (audit e dependabot continuam vigiando), `npm i` não muda para
ninguém, e o pacote é mantido: 9.3.10 foi publicada em **10/08/2026**, MIT, 4 dependências.

**Por que não `exceljs`,** que era o nome citado no enunciado — os dois números que decidiram:

| | `read-excel-file` 9.3.10 | `exceljs` 4.4.0 |
|---|---|---|
| Bundle no navegador (esbuild, minificado) | **66 KB** | 925 KB |
| `npm audit --omit=dev` | limpo | **2 moderadas**, `exceljs >=3.5.0 depends on vulnerable versions of uuid`, sem correção não-quebrante |
| Caminho de navegador | nativo, sem shim | só pelo bundle browserify pré-pronto; sem o campo `browser` dá 110 erros de resolução (`fs`, `stream`, `zlib`, `buffer`) |
| Linha com célula ausente | preenche até a largura da aba, igual ao `defval: ""` do SheetJS | volta **irregular** — `["Bruno","","b@ex.com"]` — e desalinha telefone/e-mail em silêncio |

Trocar um pacote com CVE por outro que já nasce com achado no audit derrotaria o motivo da troca. E
a linha irregular do `exceljs` é a pior classe de defeito para uma importação: não quebra, importa
errado.

### 2.2 O que mudou no código

`src/components/leads/importSheet.ts` — só o miolo do leitor:

```ts
const readWorkbook = async (buffer: ArrayBuffer): Promise<string[][]> => {
  const rows = await readSheet(buffer, 1);
  return rows.map((row) => row.map((cell) => String(cell ?? "").trim()));
};
```

`rowsToLeads` **não mudou** — a matriz de texto que sai é a mesma de antes. O parser de CSV escrito à
mão também não mudou; ele nunca dependeu do `xlsx`.

Duas coisas mudaram de forma que vale saber:

- **`parseSheet` virou `async`.** Ela já devolvia `Promise`, então nenhum chamador mudou.
- **A leitura continua entrando por `FileReader`,** e não por `Blob.text()`/`.arrayBuffer()`. Não foi
  preferência: o **jsdom 20 não implementa esses dois métodos** (confirmei rodando), e é nele que o
  teste do parser roda. `FileReader` existe nos dois lados. Está comentado no arquivo para ninguém
  "modernizar" isso e quebrar o teste.

### 2.3 O SDR passou a usar o mesmo leitor

`src/pages/SdrModule.tsx` tinha um **segundo parser copiado** (`XLSX.read` + `sheet_to_json`). Em vez
de reescrever esse segundo parser, apaguei ele: o upload de remarketing agora chama o mesmo
`parseSheet`, e converte cabeçalho em objeto com `rowsToRecords` (função nova em `importSheet.ts`).

**Isso corrigiu um buraco de tabela junto:** o parser duplicado era o motivo de o upload do SDR **não
ter os limites de 8 MB e 5.000 linhas** que a importação de leads já aplicava desde a Tarefa G. O
mesmo arquivo era recusado numa tela e aceito na outra. Agora não.

### 2.4 O que a troca **não** resolve — leia antes de riscar o S06 inteiro

O achado S06 tem duas metades. A CVE está fechada. **"Parseando planilha de terceiro na thread
principal" continua valendo.** Um agente do meu levantamento afirmou que o `read-excel-file/browser`
parseia num Web Worker; **fui conferir e é falso**. O `readSheetBrowser.js` até passa um
`createWorkerFunction`, mas `parseSpreadsheetContents.js:96` documenta o parâmetro como
*"Creates a worker function. **Not used.**"*. O trabalho roda na thread da página.

Então **os dois limites do G continuam sendo a defesa**, exatamente como ele escreveu — e agora
valem também no SDR. Se um dia isso incomodar, o pacote tem um subpath `/web-worker` de verdade;
é trabalho de configuração de worker no Vite, não uma troca de import.

### 2.5 O `.xls` legado deixou de ser lido — e isso é visível para o usuário

Nem `read-excel-file` nem `exceljs` leem `.xls` (Excel 97-2003, formato OLE2); só o SheetJS lia.
Confirmei nos dois com um buffer de assinatura OLE2 real.

Tratei em vez de deixar quebrar torto:

- O `read-excel-file` marca esse caso com um `code` estável (`XLS_FILE_NOT_SUPPORTED`), documentado
  no próprio pacote. O `importSheet.ts` mapeia esse código para
  **"Planilha no formato antigo (.xls). Abra no Excel e salve como .xlsx ou CSV."**
- A dica da tela parou de prometer XLS: `"CSV ou XLSX exportado do Leadfy · até 8 MB"`.
- **O `accept` do seletor continua aceitando `.xls` de propósito.** Se eu tirasse, o arquivo sumiria
  da janela de escolha e o usuário não descobriria o motivo. Do jeito que está, ele escolhe, lê a
  frase e sabe o que fazer.

### 2.6 `npm audit --omit=dev` — antes e depois

**Antes** (`xlsx` era o único achado sem correção disponível):

```
xlsx  *
Severity: high
Prototype Pollution in sheetJS - https://github.com/advisories/GHSA-4r6h-8v6p-xvw6
SheetJS Regular Expression Denial of Service (ReDoS) - https://github.com/advisories/GHSA-5pgg-2g8v-p4x9
No fix available
node_modules/xlsx

11 vulnerabilities (1 moderate, 10 high)

To address issues that do not require attention, run:
  npm audit fix

Some issues need review, and may require choosing
a different dependency.
```

**Depois** — `xlsx` não aparece em lugar nenhum da saída (`grep -c xlsx` = 0):

```
10 vulnerabilities (1 moderate, 9 high)

To address all issues, run:
  npm audit fix
```

Duas leituras importantes dessa saída:

1. Sumiu o bloco "**Some issues need review, and may require choosing a different dependency**".
   Era o `xlsx` que o gerava. **Todos os 10 achados restantes têm `npm audit fix`** — são
   `@remix-run/router`/`react-router`, `postcss`, `nanoid`, `yaml`, `lodash`, `glob`/`minimatch`,
   `brace-expansion`. São pré-existentes e **fora do escopo desta tarefa**; ficam de pendência.
2. O `read-excel-file` **não** entrou na conta: zero achados para ele e para as 4 dependências dele.

### 2.7 Bundle

O chunk da planilha caiu de **333,45 KB (gzip 114,06)** para **66,50 KB (gzip 20,02)**.
São 267 KB a menos no download de quem abre Leads ou SDR. `vite.config.ts` não precisou mudar: o
`xlsx` nunca foi `manualChunk`, o Vite separava sozinho por ser compartilhado entre duas rotas lazy.

---

## 3. O teste real da importação

O critério de aceite pedia planilha de verdade pela tela, não compilação. Fiz os dois níveis.

### 3.1 Na tela de Leads, no navegador

Planilha gerada na hora: cabeçalho `Cliente, Telefone, Email, Fonte, Observação` + **3 leads**
(Ana Paula Ribeiro / Bruno Tavares / Carla Nogueira).

**`.xlsx` (16.725 bytes)** — o diálogo respondeu:

```
leads-teste.xlsx
CSV ou XLSX exportado do Leadfy · até 8 MB

3 leads serão importados de 3 linhas.

CLIENTE              TELEFONE      EMAIL                       FONTE       OBSERVAÇÃO
Ana Paula Ribeiro    11988770001   ana.ribeiro@exemplo.com     Meta Ads    Quer 2 dormitórios na zona sul
Bruno Tavares        11988770002   bruno.tavares@exemplo.com   Google Ads  Retornar depois das 18h
Carla Nogueira       11988770003   carla.nogueira@exemplo.com  Indicação   Já visitou o decorado
[Importar 3 leads]
```

**`.csv`, mesma planilha, com vírgula dentro de aspas na última observação** — mesma contagem
(`3 leads serão importados de 3 linhas`), e a célula chegou inteira:
`Já visitou o decorado, ligar à tarde`. O parser de CSV continua respeitando aspas.

**`.xls`** (arquivo com assinatura OLE2) — a tela mostrou
`Planilha no formato antigo (.xls). Abra no Excel e salve como .xlsx ou CSV.`

**No SDR (`/sdr` → aba Remarketing)**, com o mesmo `.xlsx`, o toast foi
`Lista "Lista verificação L" criada com 3 contatos` — os 3 contatos saíram do `parseSheet` +
`rowsToRecords` compartilhados, com a coluna `Telefone` casando pelo sinônimo.

**Como foi feito, para ninguém tirar conclusão errada dos dados.** Mesmo caminho do handoff-G §7:
não há credencial para logar na homologação a partir daqui, então subi um **PostgREST/GoTrue de
mentira** no scratchpad e apontei um segundo Vite para ele, com a sessão encenada no `localStorage`.
**Não usei a stack Supabase local de propósito — a Tarefa J está rodando em paralelo neste
diretório e teria colidido.** O que é real: a tela de Leads, o `LeadImportDialog`, o `parseSheet` e o
arquivo `.xlsx`. O que é falso: a sessão e as linhas do banco. Isso não enfraquece a prova, porque
**a contagem e a pré-visualização são calculadas no navegador, antes de qualquer chamada de rede** —
é exatamente o trecho que a troca de dependência afeta. O mock ficou fora do repositório.

Console durante a verificação: só falha de WebSocket do Realtime (`ws://localhost:5401/realtime/...`),
que o mock não implementa. Nenhum erro do app. **Não consegui tirar screenshot** — o painel do
navegador não estava sendo exibido nesta sessão, e a captura depende disso; a prova acima é o texto
extraído da própria tela.

### 3.2 Teste automatizado — `src/components/leads/importSheet.test.ts` (novo)

A verificação de navegador não sobrevive à sessão. O parser agora tem teste próprio, com um
**`.xlsx` binário de verdade** versionado em `src/components/leads/__fixtures__/leads-teste.xlsx`
(16 KB) — compilar não prova nada sobre formato binário. 7 casos:

| Caso | O que trava se quebrar |
|---|---|
| lê o `.xlsx` real: cabeçalho + 3 leads | a troca de biblioteca |
| lê `.csv` com vírgula dentro de aspas | o parser de CSV escrito à mão |
| recusa acima de 8 MB **sem chegar a abrir** | o limite de bytes do G |
| recusa acima de 5.000 linhas | o limite de linhas do G |
| recusa planilha só com cabeçalho | a guarda de planilha vazia |
| `.xls` explica o motivo, não diz "formato não reconhecido" | a regressão de UX da §2.5 |
| `rowsToRecords` preenche coluna faltante | o alinhamento que o SDR usa |

---

## 4. A05 — 137 pontos, em duas camadas

### 4.1 A ordem importa, e é a regra do handoff-D §4

Nove módulos de `src/integrations/supabase/` relançavam com `throw new Error(error.message)`. Isso
**descarta o `code` do Postgres**. Se eu tivesse trocado só os toasts, toda falha cairia na frase
genérica — pior que hoje, porque *pareceria* corrigido. Então: módulo primeiro, tela depois.

**Camada 1 — 64 relances viraram `dbError(rótulo, error)`:**

| Módulo | Pontos |
|---|---|
| `newSchema.ts` | 16 |
| `documents.ts`, `game.ts`, `activities.ts` | 25 |
| `analytics.ts`, `permissions.ts`, `developerSubmissions.ts`, `notifications.ts`, `integrations.ts` | 23 |

O `newSchema.ts` merece nota: ele tinha um helper local `throwIfError` que era uma **reimplementação
do `dbError`**. Trocar o corpo desse helper consertou **16 call sites de uma vez**, sem tocar em
nenhum deles — a correção na causa compartilhada, não em cada chamador.

**Camada 2 — 73 pontos de tela passaram a usar `describeError(err, "<frase>")`:**

| Grupo | Pontos |
|---|---|
| `AdminAllowedIps`, `AdminDailyTeams`, `AdminDevelopers`, `AdminIntegrations`, `AdminPermissions` | 14 |
| `Equipes`, `Marketing`, `Resultados`, `Gamification` | 16 |
| `AdminLeadAutomation`, `Links`, `DataManagement` | 9 |
| `SdrModule` | 8 |
| `BrokerEditModal`, `GamificationAdmin`, `MarketingInvestmentPopup` | 6 |
| `DealDocumentUpload`, `DeveloperSubmissionDialog` | 9 |
| `TaskPanel`, `VisitPanel` | 6 |
| `CampaignPerformancePanel`, `QueuePosition` | 3 |
| `Checkpoint`, `DailyReport` | 2 |

Cada `fallback` foi escrito para a ação daquele ponto, não copiado. Onde a tela já tinha um `title`
genérico ("Erro"), ele passou a dizer a ação. Nenhuma frase nova foi inventada para código que o
helper já cobre.

Os 5 grupos da coluna 2 acima que **não** estavam na lista do enunciado (`DealDocumentUpload`,
`DeveloperSubmissionDialog`, `TaskPanel`, `VisitPanel`, `CampaignPerformancePanel`, `QueuePosition`)
são os "correlatos": são exatamente os chamadores dos módulos que a camada 1 converteu. Deixá-los
seria deixar o `code` chegar e morrer na última linha.

### 4.2 O único código novo no helper: `23514`

`src/lib/supabaseError.ts` ganhou **um** caso, com teste:

```ts
"23514": "Um dos campos está fora do valor permitido.",
```

Foi o único `code` recorrente que apareceu de fato (há 148 `check` constraints nas migrations; o caso
concreto é a constraint de e-mail obrigatório em `developers`, no fluxo externo). Instruí os agentes
a **reportarem** códigos novos em vez de editar o helper, justamente para a fonte única não virar
merge de vários.

**Não adicionei o `PGRST116`** (`.single()` sem linha), que foi levantado como candidato. Não há
evidência de recorrência — é um palpite, e caso especulativo em fonte única é dívida. Se aparecer no
uso real, entra com teste.

### 4.3 O que ficou de fora do A05, e por quê

Ficaram **5 pontos** que ainda leem `err.message`. Nenhum é vazamento — em todos, a mensagem já é
nossa e já está em pt-BR, e `describeError` a **apagaria** (não existe `code` de Postgres nesse
caminho):

| Ponto | Por quê |
|---|---|
| `Checkin.tsx:140` | tudo que chega nesse `catch` é texto nosso: `"Você precisa estar logado…"`, o `data.error` da edge function `broker-checkin`, `functionErrorMessage`. Trocar apagaria a frase útil |
| `pipeline/CheckinQueueBar.tsx:42` | mesmo caminho, mesma edge function |
| `BrokerEditModal.tsx:176` | `fetch` da edge function `provision-broker-user`; o corpo JSON já vem em pt-BR |
| `leads/LeadImportDialog.tsx:48` | é o `ImportError`, escrito em pt-BR neste handoff mesmo |
| `SdrModule.tsx:478` | o ramo `ImportError` da importação; o outro ramo já é `describeError` |

Arquivos inteiros que examinei e **decidi não tocar**:

- **`Settings.tsx`** — os erros são do **GoTrue**, não do Postgres. O arquivo já traduz por código com
  um helper local (`authMessage`/`AUTH_ERRORS`). `describeError` só entende `code` de Postgres e
  devolveria o fallback sempre, **piorando** a mensagem.
- **`Login.tsx`** — mesma razão. O `error.message` ali alimenta só regex de classificação
  (`/rate|limit|seconds/i`, `/expired/i`); o texto mostrado é sempre string fixa em pt-BR. A resposta
  única de "E-mail ou senha inválidos" é deliberada (a tela não pode virar verificador de quem
  trabalha aqui).
- **`functionError.ts`** — outro caminho (corpo JSON das nossas edge functions), explicitamente fora
  do A05.
- **Unificar `sonner` × `use-toast`** — fora de escopo pelo enunciado. Cada arquivo ficou no estilo
  que já usava.

---

## 5. Documentação

**`supabase/README.md`:**

- A tabela de estrutura não pula mais: acrescentei **`0015`–`0031`**, uma frase por migration, lidas
  do cabeçalho de cada arquivo. Agora vai de `0001` a `0034` sem buraco.
- A linha de contagem estava velha (`58 tabelas · 123 policies · 71 funções · 86 asserts`). Rodei
  `./scripts/validate-schema.sh --all` (saída `schema ok`, exit 0) e escrevi o que ele imprime:

  ```
  58 tabelas · 1 view · 124 policies · 89 funções · 13 enums · 253 asserts de teste.
  ```

  Deixei explícito no README de onde sai cada número, porque o harness **não imprime a contagem de
  asserts** — os cinco primeiros vêm do bloco `==> sanidade`; os 253 asserts são as linhas `ok` que
  os 17 arquivos de `supabase/tests/` emitem na mesma execução.
- A frase "algum dos 86 asserts" no texto acima da tabela também foi corrigida para 253.

**`docs/sprints/decisoes.md`** — três linhas novas: a escolha do pacote (com o que a saída (a) custaria
e o `.xls` como consequência aceita), o SDR passando a usar o leitor único, e a regra
`dbError` → `describeError`.

---

## 6. Validações

| Comando | Resultado |
|---|---|
| `npm run typecheck` | limpo nos três projects (`app`, `node`, `e2e`) |
| `npm run lint` | **0 erros, 7 avisos** em `src/` — os 7 pré-existentes de `react-refresh/only-export-components`. Ver a ressalva abaixo sobre `e2e/` |
| `npx vitest run` | **183 testes, 12 arquivos, todos verdes** (eram 176; +7 do parser) |
| `npm run build` | verde, 9,85 s |
| `npm audit --omit=dev` | `xlsx` some; 11 → 10 achados, todos com `npm audit fix` |
| `./scripts/validate-schema.sh --all` | `schema ok`, exit 0 |

Conferi também que ninguém converteu CRLF→LF sem querer: `git diff --numstat` bate com
`git diff --ignore-cr-at-eol --numstat` em todos os arquivos tocados.

**Ressalva honesta sobre o `npm run lint` cheio.** Ele roda `eslint .`, o repositório inteiro. Na
minha primeira execução deu 0 erros; na última, **1 erro** —
`e2e/admin/fechamento-mes.spec.ts:116:69  Unnecessary escape character: \/  no-useless-escape`.
O arquivo é da **Tarefa J**, que está editando `e2e/**` em paralelo neste mesmo diretório (6 specs
modificados enquanto eu trabalhava), e eu não posso tocar nele. `npx eslint src` — todo o meu
escopo — segue em **0 erros, 7 avisos**. Fica para o J.

---

## 7. Publicação — não fiz, e por quê

**Não publiquei.** Três motivos somados:

1. **A CLI da Vercel não está instalada** nesta máquina (o próprio hook da sessão avisa). Publicar
   exigiria instalar uma CLI global e disparar um deploy de **produção** — ação externa e
   irreversível que não vou tomar sem pedido explícito.
2. **A Tarefa J publica.** Minhas mudanças são todas em `src/` e `docs/`; o build dela sai deste mesmo
   working tree, então **o deploy dela já leva o meu junto**. Publicar por cima seria disputar o
   último build sem ganho.
3. O enunciado põe a publicação como condicional ("*Se publicar*").

**Para quem for publicar:** o `dist/` atual já é o build com estas mudanças (o chunk a procurar é
`assets/importSheet-*.js`, ~66 KB — se aparecer um `assets/xlsx-*.js` de 333 KB, o build é antigo).

Como combinado, **não commitei**.

---

## 8. Riscos e pendências

1. **`.xls` deixou de ser lido.** É a única regressão funcional, e é inerente a sair do SheetJS. A
   mensagem diz o que fazer, mas se algum corretor exportar Excel 97-2003 com frequência, isso vai
   aparecer como chamado. O remédio seria voltar ao SheetJS do CDN, com o custo da §2.1.
2. **A planilha continua sendo parseada na thread principal** (§2.4). Os limites de 8 MB e 5.000
   linhas seguram; o `/web-worker` do pacote é o caminho se incomodar.
3. **10 achados de `npm audit` continuam abertos** (react-router, postcss, nanoid, yaml, lodash,
   glob, brace-expansion). São pré-existentes e **todos têm `npm audit fix`** — mas `react-router`
   tem correção de XSS por open redirect e merece decisão própria, porque subir a major toca roteamento
   no meio da semana da demo. Não mexi.
4. **`DailyReport.tsx` (linhas 166, 206, 266)** tem três `catch {}` sem binding que mostram
   "Erro de conexão — tente novamente". Não é ponto do A05 (não vaza nada), mas **engolem o objeto**:
   um 42501 do `public_daily_team` chega ao gerente como se fosse queda de rede. Trocar por
   `catch (err)` + `describeError` é pequeno, mas muda comportamento numa tela que a Tarefa K acabou
   de mexer — deixei para quem for dono dela.
5. **`PGRST116`** (`.single()` sem linha) é o próximo candidato ao `supabaseError.ts`, se aparecer.
6. **`documents.ts` usa `dbError` também nos dois erros de Storage** (upload no bucket,
   `createSignedUrl`). `StorageError` não tem `code`, então a tela cai no fallback — mesmo resultado
   visível de antes, com o erro original preservado em `err.db` para log. É o precedente que o
   `leads.ts` já tinha; a alternativa era ter dois caminhos de erro no mesmo módulo.
7. **Aviso para a Tarefa J:** mexi no caminho de upload de `SdrModule.tsx`, e `e2e/sdr/remarketing.spec.ts`
   está entre os specs que você alterou. Planilha válida se comporta igual (mesma contagem de contatos —
   verifiquei na tela), mas **as mensagens de recusa mudaram** e o upload agora aplica os limites de 8 MB e
   5.000 linhas que só existiam em Leads. Se algum teste casa por texto de erro, é ali que quebra.

---

## 9. Arquivos

**Dependência**
`package.json`, `package-lock.json` — sai `xlsx@^0.18.5`, entra `read-excel-file@^9.3.10`

**Parser**
`src/components/leads/importSheet.ts` · `src/components/leads/importSheet.test.ts` (novo) ·
`src/components/leads/__fixtures__/leads-teste.xlsx` (novo) ·
`src/components/leads/LeadImportDialog.tsx` (só a dica de formato) · `src/pages/SdrModule.tsx`

**Fonte única do erro**
`src/lib/supabaseError.ts` (+`23514`) · `src/lib/supabaseError.test.ts`

**Integrações — `dbError`** (9)
`newSchema.ts` · `documents.ts` · `game.ts` · `activities.ts` · `analytics.ts` · `permissions.ts` ·
`developerSubmissions.ts` · `notifications.ts` · `integrations.ts`

**Telas e componentes — `describeError`** (23, mais o `SdrModule` acima)
`AdminAllowedIps` · `AdminDailyTeams` · `AdminDevelopers` · `AdminIntegrations` · `AdminPermissions` ·
`AdminLeadAutomation` · `Links` · `DataManagement` · `Equipes` · `Marketing` · `Resultados` ·
`Gamification` · `Checkpoint` · `DailyReport` · `BrokerEditModal` · `GamificationAdmin` ·
`MarketingInvestmentPopup` · `DealDocumentUpload` · `DeveloperSubmissionDialog` · `TaskPanel` ·
`VisitPanel` · `CampaignPerformancePanel` · `QueuePosition`

**Documentação**
`supabase/README.md` · `docs/sprints/decisoes.md` · `docs/prompts/handoff-L.md` (este)

**Não toquei** em `supabase/**` (fora a documentação), `docs/demo/**`, `e2e/**` — nem na decomposição
de `components/{leads,pipeline,dashboard,shared,engagement}/**`, fora a troca do parser dentro do
`importSheet.ts`, que era o pedido.
