# Handoff O — O roteador que publica as rotas anônimas subiu de patch; o resto do audit era build disfarçado de produção

> Tarefa O, 27/08/2026 · branch `nova` · **nada commitado** · **publicado** (§6 — eu sou quem
> publica nesta rodada).

---

## 0. Em uma linha

`npm audit --omit=dev` saiu de **10 achados (9 high, 1 moderate)** para **2 moderate**, o
`react-router-dom` subiu de `6.30.1` para `6.30.6` sem uma linha de `src/` mudar, as duas moderate
que sobram **não alcançam este app** (verifiquei, não repeti a análise do enunciado), e o dado que
muda a leitura de quem vier depois: **6 dos 7 achados restantes não eram de produção** — entravam
pelo `--omit=dev` por uma classificação errada no `package.json`.

---

## 1. Placar

| Item | Estado |
|---|---|
| Bump `react-router-dom` `^6.30.1` → `^6.30.6` | fechado — 3 dos 5 GHSAs de rota |
| As 2 moderate restantes | **abertas no audit, fechadas na prática** — §3 |
| `npm audit fix` no resto (7 pacotes) | fechado, sem `--force` |
| Rótulo `July 2026` na homologação | fechado por `UPDATE`; **origem é migration, não é minha** — §5 |
| Decisão em `docs/sprints/decisoes.md` | 2 linhas, com data |
| Publicação na Vercel | feita, conferida no ar — §6 |
| `src/` intacto | conferido por checksum antes e depois: idêntico |

**Não toquei em `src/`, `e2e/` nem `supabase/migrations/`.** Os arquivos que mexi são exatamente os
três combinados: `package.json`, `package-lock.json`, `docs/sprints/decisoes.md` — mais este handoff.
O bump **não exigiu mudança de código**, como o enunciado previa.

---

## 2. O bump

### 2.1 Os números conferidos, não refeitos

Confirmei no registro antes de editar: `6.30.6` existe, é a última da linha `6.30.x`, e declara
`react-router@6.30.6` + `@remix-run/router@1.23.4` — acima da faixa vulnerável `<=1.23.2`.
O `npm install` mexeu em **3 pacotes**, exatamente esses:

```
@remix-run/router   1.23.0 -> 1.23.4
react-router        6.30.1 -> 6.30.6
react-router-dom    6.30.1 -> 6.30.6
```

**Os dois caminhos errados, confirmados na prática.** O `npm audit fix` sem `--force` de fato pula o
bump — rodei depois do bump explícito e ele nem menciona o roteador. E o `--force` continua
anunciando `Will install react-router-dom@7.18.2, which is a breaking change` na saída do audit
atual. O bump foi escrito à mão no `package.json`.

### 2.2 O que o 1.23.4 fecha, no código, não no rótulo do audit

Não confiei no número do `npm audit`. Baixei `@remix-run/router@1.23.0` e `@1.23.4` numa pasta
limpa e comparei os dois `dist/router.js`. As duas mudanças que importam:

```js
// nova em 1.23.4 — o `//` deixa de sobreviver à resolução de caminho
const removeDoubleSlashes = path => path.replace(/\/\/+/g, "/");

// em resolveTo():
toPathname = removeDoubleSlashes(toPathname);
if (toPathname.startsWith("/")) {
  pathname = resolvePathname(toPathname.substring(1), "/");   // <- 1.23.0 devolvia toPathname cru
}

// nova em normalizeRedirectLocation(): lista de protocolos recusados
let invalidProtocols = ["about:", "blob:", "chrome:", "chrome-untrusted:", "content:",
  "data:", "devtools:", "file:", "filesystem:", "javascript:"];
if (invalidProtocols.includes(url.protocol)) throw new Error("Invalid redirect location");
```

**E confirmei que esse código está no bundle que foi publicado**, não só no `node_modules`:
`resolvePathname(...substring(1),"/")` aparece em `dist/assets/react-Do7E6ex0.js`, e o padrão
equivalente do 1.23.0 não aparece em chunk nenhum.

A `invalidProtocols` **não** entrou no bundle, e isso é esperado, não falha: `normalizeRedirectLocation`
só é usada pelo data-router (`createBrowserRouter` + loaders). Este app monta `<BrowserRouter>`
declarativo, então esse trecho é removido pelo tree-shaking. Vale registrar porque é a mesma razão
pela qual a GHSA-337j não alcança o app (§3).

### 2.3 O antes

Fecha 3 dos 5 GHSAs de rota: **GHSA-2w69-qvjg-hvjx** (XSS via open redirect, a única `high`),
**GHSA-2j2x-hqr9-3h42** (`//` reinterpretado como URL protocolo-relativa) e
**GHSA-9jcx-v3wj-wh4m** (redirecionamento externo por caminho não confiável).

`npm audit --omit=dev` **antes** de qualquer mudança minha:

```
# npm audit report

@remix-run/router  <=1.23.2
Severity: high
React Router vulnerable to XSS via Open Redirects - https://github.com/advisories/GHSA-2w69-qvjg-hvjx
React Router's same-origin redirect with path starting // causes open redirect via protocol-relative URL reinterpretation - https://github.com/advisories/GHSA-2j2x-hqr9-3h42
fix available via `npm audit fix`
node_modules/@remix-run/router
  react-router  6.0.0 - 7.17.0
  Depends on vulnerable versions of @remix-run/router
  node_modules/react-router
    react-router-dom  6.0.0-alpha.0 - 6.30.2
    Depends on vulnerable versions of @remix-run/router
    Depends on vulnerable versions of react-router
    node_modules/react-router-dom

brace-expansion  2.0.0 - 2.1.3
Severity: high
brace-expansion: Zero-step sequence causes process hang and memory exhaustion - https://github.com/advisories/GHSA-f886-m6hf-6m8v
brace-expansion: DoS via exponential-time expansion of consecutive non-expanding {} groups - https://github.com/advisories/GHSA-3jxr-9vmj-r5cp
brace-expansion: DoS via unbounded expansion length causing an out-of-memory process crash - https://github.com/advisories/GHSA-mh99-v99m-4gvg
brace-expansion: DoS via unbounded intermediate arrays, bypassing the CVE-2026-14257 mitigation - https://github.com/advisories/GHSA-rgw5-rvv9-x895
fix available via `npm audit fix`
node_modules/glob/node_modules/brace-expansion

glob  10.2.0 - 10.4.5
Severity: high
glob CLI: Command injection via -c/--cmd executes matches with shell:true - https://github.com/advisories/GHSA-5j98-mcp5-4vw2
fix available via `npm audit fix`
node_modules/glob

lodash  <=4.17.23
Severity: high
lodash vulnerable to Code Injection via `_.template` imports key names - https://github.com/advisories/GHSA-r5fr-rjxr-66jc
lodash vulnerable to Prototype Pollution via array path bypass in `_.unset` and `_.omit` - https://github.com/advisories/GHSA-f23m-r3pf-42rh
Lodash has Prototype Pollution Vulnerability in `_.unset` and `_.omit` functions - https://github.com/advisories/GHSA-xxjr-mmjv-4gpg
fix available via `npm audit fix`
node_modules/lodash

minimatch  9.0.0 - 9.0.6
Severity: high
minimatch has a ReDoS via repeated wildcards with non-matching literal in pattern - https://github.com/advisories/GHSA-3ppc-4f35-3m26
minimatch has ReDoS: matchOne() combinatorial backtracking via multiple non-adjacent GLOBSTAR segments - https://github.com/advisories/GHSA-7r86-cg39-jmmj
minimatch ReDoS: nested *() extglobs generate catastrophically backtracking regular expressions - https://github.com/advisories/GHSA-23c5-xmqv-rm74
fix available via `npm audit fix`
node_modules/glob/node_modules/minimatch

nanoid  <=3.3.17
Severity: high
nanoid: non-secure generators can loop indefinitely with negative size - https://github.com/advisories/GHSA-28wg-ghj8-5hjv
nanoid: custom generators can loop indefinitely when size is zero - https://github.com/advisories/GHSA-2v37-7h3g-55p8
fix available via `npm audit fix`
node_modules/nanoid

postcss  <=8.5.22
Severity: high
PostCSS has XSS via Unescaped </style> in its CSS Stringify Output - https://github.com/advisories/GHSA-qx2v-qp2m-jg93
PostCSS: Arbitrary file read and information disclosure via attacker-controlled sourceMappingURL in CSS comments - https://github.com/advisories/GHSA-6g55-p6wh-862q
PostCSS: incomplete fix of GHSA-6g55-p6wh-862q — attacker-controlled sourceMappingURL reads arbitrary .map files when `from` is unset - https://github.com/advisories/GHSA-fxqj-rqcc-2cmp
PostCSS: Path Traversal in Previous Source Map Auto-Loading (sourceMappingURL) leads to Arbitrary .map File Disclosure - https://github.com/advisories/GHSA-r28c-9q8g-f849
fix available via `npm audit fix`
node_modules/postcss


yaml  2.0.0 - 2.8.2
Severity: moderate
yaml is vulnerable to Stack Overflow via deeply nested YAML collections - https://github.com/advisories/GHSA-48c2-rrv3-qjmp
fix available via `npm audit fix`
node_modules/yaml

10 vulnerabilities (1 moderate, 9 high)

To address all issues, run:
  npm audit fix
```

O roteador respondia por **3 das 10 entradas** (`@remix-run/router`, `react-router`,
`react-router-dom`), com severidade agregada `high`.

### 2.4 O depois

`npm audit --omit=dev` **depois** do bump e do `npm audit fix`:

```
# npm audit report

react-router  6.0.0 - 7.17.0
Severity: moderate
React Router: Open redirect via backslash in <Link> and useNavigate (CVE-2025-68470 bypass) - https://github.com/advisories/GHSA-wrjc-x8rr-h8h6
React Router: Arbitrary Constructor Injection via deserializeErrors() in React Router SSR Hydration - https://github.com/advisories/GHSA-337j-9hxr-rhxg
fix available via `npm audit fix --force`
Will install react-router-dom@7.18.2, which is a breaking change
node_modules/react-router
  react-router-dom  6.0.0-alpha.0 - 7.17.0
  Depends on vulnerable versions of react-router
  node_modules/react-router-dom

2 moderate severity vulnerabilities

To address all issues (including breaking changes), run:
  npm audit fix --force
```

**10 achados (9 high, 1 moderate) → 2 achados (0 high, 2 moderate).** É o número que o enunciado
previa.

---

## 3. As duas que sobram — e por que não migrar para o v7 agora

Fui conferir as duas no código deste repositório em vez de repetir o enunciado. As duas checagens
batem com ele.

| Aviso | Alcança este app? | O que eu medi |
|---|---|---|
| **GHSA-337j-9hxr-rhxg** — injeção de construtor via `deserializeErrors()` na hidratação SSR | **Não** | `grep -rnE 'StaticRouter\|hydrateRoot\|renderToString\|renderToPipeableStream\|createStaticHandler\|createStaticRouter\|StaticRouterProvider'` em `src/`, `e2e/` e `index.html`: **zero ocorrências**. O app monta com `createRoot` (`main.tsx:22`) e `<BrowserRouter>` (`App.tsx:97`) — nem o data-router é usado. `deserializeErrors` não roda, e a §2.2 mostra que o trecho vizinho nem chega ao bundle |
| **GHSA-wrjc-x8rr-h8h6** — open redirect por barra invertida em `<Link>` e `useNavigate` (bypass do CVE-2025-68470) | **Não, e é defesa própria, não sorte** | Existe **um** `navigate()` com valor não literal no app inteiro: `NotificationBell.tsx:104`, `navigate(resolveLink(item.link))`. **Zero** `<Link to={variável}>` e **zero** `<Navigate to={variável}>` |

### 3.1 O estado do guard da Tarefa M no momento em que fechei

**Entregue e no ar.** Não estou dizendo isso pela análise — o código existe:

```ts
// src/components/NotificationBell.tsx:29 e :50
const INTERNAL_PATH = /^\/(?![/\\])[A-Za-z0-9\-._~/?=&%]*$/;
export function resolveLink(link: string): string {
  if (!INTERNAL_PATH.test(link)) return SAFE_LINK;   // SAFE_LINK = "/dashboard"
  return link.replace(/^\/leads\/([0-9a-fA-F-]{36})$/, "/leads?lead=$1");
}
```

É lista de permitidos, não lista de proibidos: exige barra inicial, recusa `/` e `\` na segunda
posição, e o conjunto de caracteres não admite `\`, `:` nem espaço. `NotificationBell.test.ts`
(4 casos, 12 asserts) cobre `//host`, `\\host`, `https://host`, `/\host`, `javascript:` e os
caracteres de controle que a análise de URL do navegador remove (`/<TAB>/host`, `/<LF>/host`).
**Os 190 testes passam neste working tree**, o dela inclusive.

Então, ao contrário do que o enunciado admitia como possibilidade: **não estou deixando a
GHSA-wrjc aberta na prática.** O guard existe, tem teste, e o valor perigoso vem de
`notifications.link` — cuja policy de INSERT cobra papel, não conteúdo. Validar o destino é a
defesa certa; o patch do v7 seria um segundo cinto, não o cinto.

### 3.2 A conclusão registrada

`docs/sprints/decisoes.md`, duas linhas com data de 27/08/2026. A primeira: **fica no 6.x com o
patch; migrar para o v7 é sprint própria, não item de segurança** — com os GHSAs nominados, os dois
caminhos errados (`audit fix` e `--force`) e a consequência aceita. Sem isso o próximo `npm audit`
reabre a discussão do zero e alguém migra major numa tarde.

---

## 4. O resto do audit — e a metade que a saída mentia

Rodei `npm audit fix` **sem** `--force` e os sete fecharam. Depois fui ver, um a um, de onde cada um
entra. **Aqui está o achado que muda a frase:**

| Pacote | Caminho até a raiz (com `--omit=dev`) | É produção mesmo? |
|---|---|---|
| `postcss` | `tailwindcss-animate` → `tailwindcss` | **não — build** |
| `nanoid` | `tailwindcss-animate` → `tailwindcss` → `postcss` | **não — build** |
| `yaml` | `tailwindcss-animate` → `tailwindcss` → `postcss-load-config` | **não — build** |
| `glob` | `tailwindcss-animate` → `tailwindcss` → `sucrase` | **não — build** |
| `minimatch` | idem, via `glob` | **não — build** |
| `brace-expansion` | idem, via `minimatch` | **não — build** |
| `lodash` | `recharts` → `lodash` | **sim — produção** |

**Por que os seis apareciam sob `--omit=dev`.** O `tailwindcss` está corretamente em
`devDependencies`. O que fura é o `tailwindcss-animate`, que está em **`dependencies`** e declara
`"peerDependencies": {"tailwindcss": ">=3.0.0 || insiders"}` — sem nenhuma `dependencies` própria.
O npm segue a aresta do peer a partir de um pacote de produção e arrasta a árvore inteira do
Tailwind para dentro da visão "produção". Tailwind é ferramenta de build: **nada disso vai para o
navegador.**

**O `lodash` é o único de verdade.** Ele está no bundle publicado (`dist/assets/charts-D-mCD4m1.js`),
e o `recharts` importa `lodash/omit` — uma das funções citadas em GHSA-f23m-r3pf-42rh e
GHSA-xxjr-mmjv-4gpg (prototype pollution). Atenuante que vale registrar: os dois arquivos do
`recharts` que chamam `omit` são `Treemap.js` e `Funnel.js`, e este app não usa nenhum dos dois
(só `LineChart`/`CartesianGrid`/etc.). O `_.template` do terceiro aviso não é importado por ninguém.
De qualquer forma **fechou**: `lodash 4.17.21 → 4.18.1`.

**Então a frase correta para quem ler depois é:** eram **9 high no build e 1 achado real de
produção**, não "9 high em produção". Os dois números são muito diferentes.

**O que eu não fiz, de propósito.** Não movi `tailwindcss-animate` para `devDependencies`. A
reclassificação é correta e o build da Vercel instala `devDependencies`, mas mexer em classificação
de dependência na véspera de publicar troca um relatório enganoso por um risco de instalação — e o
relatório enganoso agora está documentado. Fica como pendência de uma linha para a próxima rodada.
Está registrado na segunda linha de `decisoes.md`.

### 4.1 O que o `npm audit fix` moveu

Não foi só os sete: ele subiu junto o que estava no mesmo intervalo semver. O que importa saber:

```
lodash    4.17.21 -> 4.18.1     postcss   8.5.6  -> 8.5.26     nanoid  3.3.11 -> 3.3.18
yaml      2.6.0   -> 2.9.0      glob      10.4.5 -> 10.5.0     vite    5.4.19 -> 5.4.21
minimatch 9.0.5   -> 9.0.9      rollup    4.24.0 -> 4.63.0     vitest  3.2.4  -> 3.2.7
```

`rollup 4.24 → 4.63` e `vitest 3.2.4 → 3.2.7` são saltos grandes para ferramenta de build na véspera
da demo. Por isso a validação da §7 rodou inteira depois, e o build publicado foi conferido no ar
(§6). Nenhuma quebrou nada.

### 4.2 O que sobra no audit completo (com dev)

`npm audit` sem `--omit=dev`: **18 (3 moderate, 14 high, 1 critical) → 4 (3 moderate, 1 high)**.
Os dois que não fecham sem quebra:

- **`esbuild` ≤0.24.2** (`GHSA-67mh-4wv8-2f99`) por baixo do `vite@5`. É o **servidor de
  desenvolvimento** aceitando requisição de qualquer site — não existe em produção. A correção é
  `vite@8`, mudança maior. O `high` que sobra no relatório é o `vite` herdando essa entrada.
- **`react-router`**, as duas moderate da §3.

---

## 5. O rótulo em inglês — corrigido na homologação, e onde ele nasce

### 5.1 O UPDATE

```sql
update public.game_seasons
   set label = 'Julho 2026', updated_at = now()
 where id = '2c76a7d0-8d8d-4929-ac7b-2b3c8885b50b' and label = 'July 2026';
```

Estado depois, conferido:

| label | período | fechada | linhas no placar |
|---|---|---|---|
| Agosto 2026 | 2026-08-01 → (aberta) | não | 0 |
| **Julho 2026** | 2026-07-01 → 2026-07-31 | sim | **5** |
| Temporada historica demonstrativa | 2026-04-01 → 2026-04-30 | sim | 3 |

Só o rótulo mudou: período e as 5 linhas do placar congelado estão intactos.

### 5.2 A origem — é migration, e migration não é minha nesta rodada

**Quem escreve:** `public.close_game_season`, em
`supabase/migrations/20260821120000_0032_game_cycle_month.sql:154-158` (o mesmo trecho nasceu em
`20260725120900_0010_gamification.sql:291`):

```sql
insert into public.game_seasons (label, period_start)
values (
  coalesce(p_next_label, to_char(current_date + 1, 'TMMonth YYYY')),
  current_date + 1
);
```

**Por que sai em inglês, medido no próprio banco de homologação:**

```
current_setting('lc_time')                    -> en_US.UTF-8
to_char(date '2026-07-01','TMMonth YYYY')     -> July 2026      <- é a string exata que estava lá
to_char(date '2026-08-01','TMMonth YYYY')     -> August 2026
```

O prefixo `TM` do `to_char` é "translation mode": ele usa o `lc_time` da sessão. O `lc_time` do
projeto é `en_US.UTF-8`, então `TMMonth` devolve inglês. **O problema volta no próximo fechamento
automático**: `close_month_and_season` chama `close_game_season(null, false)` — com `p_next_label`
nulo, o `coalesce` sempre cai no `to_char`.

**A correção óbvia não funciona, e testei antes de sugerir.** Pôr `set lc_time = 'pt_BR.UTF-8'` na
função é recusado pelo container:

```
invalid value for parameter "lc_time": "pt_BR.UTF-8"
```

O locale não está instalado. **Sobra o mapeamento explícito**, que é determinístico e não depende de
locale nenhum — testado no banco, devolve `Julho 2026`:

```sql
(array['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
       'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'])
  [extract(month from d)::int] || ' ' || extract(year from d)::text
```

**Consequência de cada caminho:** trocar o `to_char` por esse array numa migration nova resolve para
sempre e não depende do ambiente; deixar como está significa que todo fechamento automático grava um
rótulo em inglês numa tela em pt-BR, e alguém corrige à mão todo mês. **Quem pegar
`supabase/migrations/` faz em uma linha.**

---

## 6. Publicação e o que está no ar

Publiquei por último, como combinado. **M e N entregaram** (`handoff-M.md` e `handoff-N.md`, ambos
de hoje). **A Tarefa P não rodou** — não existe `handoff-P.md` e nenhum arquivo de `e2e/` foi tocado
hoje. **Publiquei mesmo assim, e o motivo é verificável:** `e2e/**` é suíte Playwright, não entra no
`vite build` (a raiz é `index.html` → `src/main.tsx`); se P entregar depois, não há nada dela para
republicar.

```bash
npx vercel deploy --prod --yes --archive=tgz --scope alissons-projects-b1faee75
```

Os três argumentos do handoff-J §7 continuam necessários. Passou de primeira, sem `fetch failed`.
Deployment `dpl_2yieg7kbhbKR7W95FQXq6U3XG3at`, `READY`, aliased para `https://faceimob.vercel.app`.

### 6.1 O que está no ar bate com o `dist/` local

```
no ar   -> assets/index-oQLdfviq.js   assets/index-xTwAaupC.css
dist/   -> assets/index-oQLdfviq.js   assets/index-xTwAaupC.css
```

Antes do meu deploy o ar tinha `index-DWf46mx_.js` — o build da Tarefa J. **O que subiu agora leva
M, N e O.** `react-Do7E6ex0.js` e `charts-D-mCD4m1.js` respondem 200. Como a Vercel compila do zero
a partir do `package-lock.json` e o hash saiu idêntico ao local, o lock que está no working tree
reproduz este build.

### 6.2 As rotas, abertas na URL publicada

Não consegui **rota autenticada**: não há credencial de login da homologação nesta máquina (o `.env`
só tem `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` e `VITE_SUPABASE_PROJECT_ID`) — a mesma
limitação dos handoffs J e L. Em troca, cobri o roteador pelo lado que **não** precisa de sessão, que
é justamente onde um bump de roteador quebra:

| O que abri | Resultado |
|---|---|
| `/login` | tela "Entrar no CRM" renderizada, console limpo |
| `/` | → `/dashboard` → `/login` — **duas** `<Navigate replace>` encadeadas |
| `/pipeline` (protegida) | → `/login` pelo `RequireAuth` |
| `/team` | → `/equipes` → `/login` — outra cadeia de duas |
| `/reset-password` | → `/login` |
| `/rota-inexistente-teste-O` | 404 do app, com a frase certa e o caminho ecoado |
| `/daily/seed-daily-sul` | "CHECKPOINT DIÁRIO", formulário de PIN (o link tem PIN e está pedindo) |
| `/diretor/seed-diretoria-daniela` | Checkpoint Semanal completo, com dados reais: 32 leads, funil 28,1% / 55,6% / 40,0%, Equipe Paulista e Equipe Sul |
| rota inexistente via `curl` | HTTP 200 — o rewrite de SPA do `vercel.json` continua servindo o `index.html` |

**A navegação client-side, que é o teste que importa.** No 404 existe um `<Link to="/dashboard">` de
verdade (`NotFound.tsx:31`). Marquei `window.__marcadorO`, disparei o clique nele e conferi depois:

```
sem_recarga_de_pagina: true      // o marcador sobreviveu -> não houve reload
path_final: "/login"             // <Link> -> /dashboard -> RequireAuth -> <Navigate> -> /login
host: "faceimob.vercel.app"
```

Ou seja: `<Link>`, casamento de rota e `<Navigate replace>` funcionando em cadeia, tudo no cliente,
com a versão nova do roteador. Console sem erro nenhum — a única linha que aparece é o log
proposital do próprio app (`404: rota inexistente acessada: /rota-inexistente-teste-O`).

**E o vetor do patch, observado no ar:**

```
(barra barra)evil.example   -> host faceimob.vercel.app, path "/evil.example"
/daily//evil.example        -> host faceimob.vercel.app, path "/daily/evil.example"
```

O `//` foi **normalizado para `/`** e a navegação não saiu do host. É o `removeDoubleSlashes` do
1.23.4 (§2.2) funcionando em produção, não uma inferência do número do audit.

**Ressalva honesta sobre o método:** o painel do navegador não estava sendo exibido nesta sessão, e
clique por coordenada não compõe frame — os dois primeiros cliques que tentei não fizeram nada. Por
isso o clique do `<Link>` foi disparado como evento na própria âncora, que percorre o mesmo
`onClick` do React que um clique de usuário percorre. Pelo mesmo motivo **não há screenshot**; a
prova acima é texto extraído da página publicada e o valor de `location` lido nela. Não tentei tirar
conclusão dos links da tela do diretor: eles são `<a target="_blank">` comuns, não `<Link>` — fui ao
fonte conferir quando um clique neles não navegou, em vez de registrar uma regressão que não existe.

---

## 7. Validação

```bash
npm run typecheck   # ✅ os 3 projects (app, node, e2e)
npm run lint        # ✅ 0 erros · 7 avisos pré-existentes (react-refresh em ui/*, AuthContext, ComparativeFunnel, UpdateNotifier)
npx vitest run      # ✅ 190 testes em 14 arquivos
npm run build       # ✅ 12,4 s
```

Os 190 incluem os 4 de `NotificationBell.test.ts` (M) e os 3 de `type-scale.test.ts` (N) — este
working tree tem as três tarefas juntas e passa inteiro.

**`src/` intacto:** tirei o `sha256sum` da árvore de `src/` antes de mexer em qualquer coisa e de
novo no fim — **idêntico**. `git diff --stat -- src/` continua exatamente nos mesmos
`80 files changed, 3938 insertions(+), 6341 deletions(-)` que já estavam aí quando comecei (são de M,
N e das tarefas anteriores, não meus).

---

## 8. Arquivos e pendências

**Editados** — `package.json` (uma linha: `react-router-dom` `^6.30.1` → `^6.30.6`) ·
`package-lock.json` (bump + `npm audit fix`) · `docs/sprints/decisoes.md` (2 linhas) ·
`docs/prompts/handoff-O.md` (novo).

**Banco de homologação** — um `UPDATE` em `game_seasons.label`, §5.1.

**Fica aberto, com dono sugerido:**

1. **O `to_char(..., 'TMMonth YYYY')` de `close_game_season`** — quem pegar `supabase/migrations/`.
   Uma linha, o array pronto está na §5.2, e o caminho por locale já foi descartado com teste.
2. **`tailwindcss-animate` em `dependencies`** — mover para `devDependencies` faz o
   `npm audit --omit=dev` voltar a significar o que o nome diz (§4). Depois da demo.
3. **`esbuild`/`vite`** — só fecha com `vite@8`, mudança maior, e é servidor de desenvolvimento.
   Mesma sprint da eventual migração do roteador para o v7.
4. **Tarefa P** não rodou. Nada do que ela faz está publicado porque nada do que ela faz vai para o
   bundle; se ela entregar, **não precisa republicar** por causa disso.
