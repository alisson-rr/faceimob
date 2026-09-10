# Handoff M — Os três defeitos de comportamento que o smoke deixou

27/08/2026 · branch `nova` · **nada commitado** · **não publicado** (a Tarefa O
publica por último nesta rodada; ver §7).

Arquivos alterados — exatamente os três combinados, mais um teste novo:

| Arquivo | O quê |
|---|---|
| `src/components/UpdateNotifier.tsx` | detector de versão compara só a entrada |
| `src/pages/DailyReport.tsx` | a tela para de mentir sobre a data e para de sobrescrever hoje |
| `src/components/NotificationBell.tsx` | `resolveLink` só aceita caminho interno |
| `src/components/NotificationBell.test.ts` | **novo** — 4 casos de `resolveLink` |

Nada fora disso foi tocado. `.claude/launch.json` recebeu uma entrada temporária
para servir o `dist/` durante a prova da §1 e **foi revertida** (`git diff` limpo).

---

## 1. 🟠 O aviso falso de "Nova versão disponível"

### O que ele comparava

Dois conjuntos que nunca podiam ser iguais:

- `loadedSignature` lia **todos** os assets presentes no DOM daquela aba — o que
  inclui os chunks que a rota carregou sob demanda;
- `fetchRemoteSignature` lia os assets **listados no `index.html`** — só a
  entrada e o que ela pré-carrega.

Medido na rota `/daily/<slug>` do build atual, dentro da própria página:

```
antes_dom: 22        // DailyReport-*.js, ComparativeFunnel-*.js, pt-BR-*.js, …
antes_remote: 6      // index-*.js, index-*.css, react, motion, charts, supabase
antes_iguais: false
```

22 ≠ 6 em qualquer rota com chunk próprio — ou seja, em todas.

### O que passou a comparar

Só a **entrada**, que é o que identifica o build. As duas listas passam pela
mesma função:

```ts
const ENTRY_ASSET = /^\/assets\/index-[A-Za-z0-9_-]+\.(?:js|css)$/;

function entrySignature(paths: string[]): string | null {
  const entry = Array.from(new Set(paths.filter((p) => ENTRY_ASSET.test(p))));
  if (entry.filter((p) => p.endsWith(".js")).length !== 1) return null;
  return entry.sort().join("|");
}
```

O par que sobra é `index-*.js` + `index-*.css` — os dois estão no `index.html`
**e** no DOM (script + link do tema), então a comparação é entre iguais.

**A guarda da premissa.** A entrada é o único `index-*.js` porque o
`manualChunks` do `vite.config.ts` só nomeia `react`, `charts`, `supabase` e
`motion`. Se um dia aparecer um segundo — um chunk lazy vindo de um módulo
`index.ts`, que o Rollup nomearia `index-<hash>.js` e que estaria no DOM sem
estar no `index.html` — a premissa caiu e o detector volta a comparar conjuntos
diferentes. Nesse caso `entrySignature` devolve `null` e **o aviso não aparece**.
Falso negativo custa uma atualização manual; falso positivo é o cliente vendo o
app pedir atualização o tempo todo.

### A prova, nos dois sentidos

`npm run build`, `vite preview` do `dist/`. **Servido pelo IP da LAN
(`192.168.2.7:4173`), não por `localhost`** — o hook do detector faz `return`
cedo em `localhost`/`127.0.0.1`, então uma prova em localhost não prova nada:
o banner ficaria escondido pelo motivo errado.

**Sentido 1 — mesmo build, rota lazy, sem aviso.**

| Rota | Assets no DOM | Banner |
|---|---|---|
| `/daily/prova-m-detector-inexistente` | 22 | ❌ não apareceu, console limpo |
| `/diretor/prova-m-inexistente` | 16 | ❌ não apareceu |

E a assinatura nova batendo, medida na página:

```
depois_dom:    "/assets/index-B9WhOCYW.css|/assets/index-D3_6mVeW.js"
depois_remote: "/assets/index-B9WhOCYW.css|/assets/index-D3_6mVeW.js"
depois_iguais: true
```

Não é `null` — o detector está **armado**, não desligado.

**Sentido 2 — build novo por cima do mesmo servidor, com aviso.**
Acrescentei uma linha de comentário em `src/pages/Gamification.tsx` (arquivo que
vive **só** num chunk lazy) e reconstruí. A entrada mudou de `index-D3_6mVeW.js`
para `index-Bg6Q8F7a.js`; na aba que já estava aberta, **dentro da varredura de
30 s e sem nenhuma interação**, apareceram o banner "Nova versão disponível!" e o
botão flutuante. O comentário foi revertido (`git checkout --`).

> Detalhe que vale registrar porque eu não tinha certeza antes de medir:
> **mexer só num chunk lazy muda o hash da entrada**. O Rollup embute o nome
> com hash do chunk dentro da entrada que o importa, então a mudança propaga.
> Filtrar pela entrada **não** cria ponto cego para alteração de rota.

---

## 2. 🔴 O diário gravava o dia errado

### O que a tela fazia

`public_daily_submit(p_slug, p_pin, p_entries)` **não recebe data**. O corpo
(`0009:251`, substituído pela `0034:50`) faz:

```sql
insert into public.daily_reports (team_id, report_date, submitted_at)
values (v_link.team_id, current_date, now())
on conflict (team_id, report_date) do update set submitted_at = now()
```

O estado `date` da tela nunca saía do navegador. Mesmo assim havia seletor de
Histórico, estado "(editando)" e o aviso "Editando um dia anterior: 20/08/2026".
Resultado: escolher 20/08, preencher e salvar **sobrescrevia o checkpoint de
hoje**, porque o `on conflict` casava com a linha de hoje. Silenciosamente.

E o rótulo mentia na outra direção: `const yesterday = new Date()` — que é hoje.
A tela escrevia "Data (ontem)" e "abrir o checkpoint de ontem (26/08)" em 26/08.

**Medido, não deduzido.** Contra o stack local, com uma equipe, um perfil e um
link descartáveis (apagados depois, §2.3), mandei pela RPC exatamente o payload
que a tela mandaria ao "editar 20/08":

```sql
select public.public_daily_submit(
  'prova-m-descartavel', :'pin',
  jsonb_build_array(jsonb_build_object(
    'profile_id', 'cc000000-0000-0000-0000-0000000000b1',
    'leads', 0, 'analyses_sent', 0, 'sales', 0)));
-- {"saved": 1, "report_id": "5a1c06b9-2fd3-4282-9462-c11872381057"}
```

Antes dessa chamada a linha de hoje tinha 7 leads / 3 análises / 1 venda. Depois:

```
 report_date | e_hoje | leads | analyses_sent | sales
-------------+--------+-------+---------------+-------
 2026-08-27  | t      |     0 |             0 |     0
```

**Nenhuma linha para 20/08 foi criada** e a de hoje foi zerada. É perda de dado,
e é maior do que o smoke descreveu.

### O que a tela faz agora

Não mexi na RPC — a decisão e o porquê:

- `public_daily_submit` é uma das **exatamente três** RPCs da superfície anônima.
  Mudar a assinatura mexe no que a `0019`, a `0033` e a `0034` endureceram, e
  `supabase/**` não é desta tarefa.
- `report_date = current_date` é a convenção desde a `0009`. Todo dado já gravado
  segue ela; o funil e os relatórios leem em cima disso. Mudar a data gravada
  mudaria o significado de linhas existentes.

Então a tela passou a dizer a verdade sobre o que o banco faz:

| Antes | Agora |
|---|---|
| `const yesterday = new Date()` | `const today = new Date()`, com comentário explicando por que a data é sempre hoje |
| "Registre a performance da sua equipe **de ontem**" | "…**de hoje**" |
| `Data (ontem)` / `(editando)` | `Data (hoje)` / `(dia anterior — só leitura)` |
| "abrir o checkpoint de **ontem** (26/08)" | "abrir o checkpoint de **hoje** (27/08)" |
| "Preencher/Editar o daily **de ontem**" | "…**de hoje**" |
| "Para editar outros dias, use o **Histórico**" | "O **Histórico** abre os outros dias para conferir; gravar, só o de hoje" |
| Calendário: "Preenchido — clique para editar" | dia anterior: "abre só para conferir; esta tela grava o checkpoint de hoje" |
| Aviso amarelo: "Editando um dia anterior: 20/08/2026" | "Dia anterior aberto só para conferir: 20/08/2026 — esta tela grava sempre o checkpoint de hoje (27/08/2026), por isso o botão Salvar está desligado aqui. Para corrigir um dia anterior, fale com a administração." |
| `Salvar Checkpoint` sempre habilitado | `disabled` enquanto `date !== todayStr`, com `title` explicando |

**Sobre o `end: yesterday` do calendário (`:548`) — conferi em vez de trocar no
automático.** A expressão era
`eachDayOfInterval({ start: startOfMonth(new Date()), end: yesterday })`, e como
`yesterday` já valia `new Date()`, o intervalo sempre foi "do dia 1 até hoje" —
que é o certo para um calendário do mês corrente. A troca de nome preserva o
comportamento; deixei um comentário dizendo isso, para ninguém "corrigir" depois.

**Guard também no `submit`.** O botão desabilitado já basta pelo caminho da UI,
mas o `submit` é o ponto por onde qualquer envio passa; um atalho de teclado
futuro não pode reabrir a porta. São 6 linhas com o motivo escrito.

### 2.3 A prova no banco, e a consulta

Contra o **stack local** (`supabase_db_mcmqgxvtwegtptfseqvw`, já de pé).
**Não rodei `supabase db reset`** de propósito: o banco local é um só e a
Tarefa P está com a suíte E2E nesta mesma rodada — um reset no meio derrubaria a
execução dela. Em vez disso criei o cenário descartável, provei e apaguei — é o
mesmo padrão do handoff-J §1.2.

Cenário: equipe `PROVA M (descartavel)` (inativa), conta descartável banida
`prova-m@faceimob.invalid`, link `prova-m-descartavel` com PIN de 6 dígitos
gerado na hora (`extensions.crypt(:'pin', extensions.gen_salt('bf', 10))`). O PIN
não está em arquivo nenhum e o link não existe mais.

Percorri a tela publicada do `dist/` (PIN → "Preencher o daily de hoje" →
7 leads / 3 análises / 1 venda → Salvar → `🎯 Checkpoint concluído! +137 XP`), e
**esta é a consulta**:

```sql
select r.report_date,
       r.report_date = current_date as e_hoje,
       r.submitted_at,
       e.leads, e.analyses_sent, e.sales
from public.daily_reports r
join public.daily_entries e on e.report_id = r.id
where r.team_id = 'cc000000-0000-0000-0000-0000000000a1'
order by r.report_date;
```

```
 report_date | e_hoje |         submitted_at          | leads | analyses_sent | sales
-------------+--------+-------------------------------+-------+---------------+-------
 2026-08-27  | t      | 2026-08-27 13:20:19.814673+00 |     7 |             3 |     1
(1 row)
```

Depois abri o **Histórico** e cliquei em 20/08. Medido na página:

```json
{ "data": "2026-08-20",
  "salvar_disabled": true,
  "salvar_title": "Esta tela grava só o checkpoint de hoje",
  "aviso": "Dia anterior aberto só para conferir: 20/08/2026 … o botão Salvar está desligado aqui." }
```

**Limpeza conferida** — o banco voltou ao estado anterior:
`teams 4 · links 3 · daily_reports 4 · profiles 24`, e `0` linhas do cenário
descartável (`sobrou_link 0`, `sobrou_team 0`).

---

## 3. 🟡 O sino navegava para onde a notificação mandasse

`resolveLink` reescrevia um formato e deixava passar todo o resto direto para o
`navigate`. O `link` vem de `notifications.link`, e a policy
`notifications_insert` só cobra papel (`admin`/`director`/`manager`): não
restringe `profile_id` nem o conteúdo do link. Hoje só os triggers das migrations
(`0011`, `0028`, `0032`) escrevem ali, montando o caminho a partir de ids — então
não está sendo explorado. Mas quem tem o papel pode gravar o destino que quiser
no sino de qualquer perfil, e o guard custa uma linha.

Passou a ser **lista branca**, não lista negra:

```ts
const INTERNAL_PATH = /^\/(?![/\\])[A-Za-z0-9\-._~/?=&%]*$/;
const SAFE_LINK = "/dashboard";
```

**O que ele recusa** (tudo cai em `/dashboard`):

| Formato | Por quê |
|---|---|
| `//externo.example` | referência relativa ao protocolo — o navegador resolve para outra origem |
| `\\externo.example` | idem; o WHATWG normaliza contrabarra para barra na análise de URL |
| `/\externo.example` | a mistura das duas, que passa por "começa com barra" |
| `https://externo.example` | absoluta, não começa com `/` |
| `javascript:alert(1)` | esquema, não começa com `/` |
| `/<TAB>/externo.example`, `/<LF>/…` | tab, CR e LF são **removidos** na análise de URL: `/<TAB>/host` vira `//host` |
| `/leads ?lead=1` | espaço fora da lista branca |

E o que passa: `/pipeline` (intacto) e `/leads/<uuid>` → `/leads?lead=<uuid>`
(a reescrita de sempre, que existe porque a rota `/leads/<id>` não existe).

**Teste:** `src/components/NotificationBell.test.ts`, 4 blocos cobrindo os cinco
casos pedidos mais os três extras da tabela. `resolveLink` foi exportado para
isso, com um `eslint-disable-next-line react-refresh/only-export-components` —
sem ele o lint iria a 8 avisos, e o critério de aceite é ≤ 7. **A casa natural da
função é `src/lib/`** (é onde moram `supabaseError`, `dealStatus`, `format`), e
movê-la para lá apaga o `disable` e dispensa o `vi.mock` do cliente Supabase no
teste. Não fiz porque criar arquivo em `src/lib/` está fora da lista desta
tarefa. **É uma linha de follow-up para quem pegar a próxima rodada.**

Isto e o bump do `react-router` (Tarefa O) são as duas metades do mesmo assunto:
os avisos abertos do router são justamente sobre `//host` e `\\host`. Com as duas
juntas não é preciso migrar para o v7.

---

## 4. 🟢 Acabamento nestes arquivos

**Botão sem nome acessível** (`DailyReport.tsx`, cartão de XP): o `<button>` do
tooltip ganhou `aria-label="Como o XP é calculado"`. Confirmado na árvore de
acessibilidade da página servida.

**Piso de 12 px** — a exceção combinada com a Tarefa N. **26 ocorrências** de
`text-[8px]` / `text-[9px]` / `text-[10px]` / `text-[11px]` viraram `text-xs`
(0.75 rem). Sem tamanho novo inventado. Medido na página, contando elementos de
texto com `font-size < 12px`:

| Largura | Antes | Depois |
|---|---|---|
| 375 px | — | **0** |
| 768 px | — | **0** |
| 1280 px | — | **0** |

**Efeito colateral medido e aceito.** Em **exatamente 768 px** (o breakpoint `md`,
onde o cabeçalho da tabela aparece), o rótulo `Ligações` passa a precisar de 65 px
numa coluna de 53 px — a 9 px cabia em 49 px. Como o cabeçalho não tem `truncate`
e é `text-center`, ele transborda 6 px para cada lado, **dentro do `gap-2` de
8 px**: não cobre o rótulo vizinho. Os outros oito rótulos não transbordam (são
multi-palavra e quebram em duas linhas, o que já acontecia a 9 px). Não vale
`truncate` — trocaria "um pouco largo" por "Ligaçõ…".

**Rolagem horizontal a 375 px — corrigida de quebra.** Durante a medição achei
que a página tinha 463 px de conteúdo em 375 px de viewport. Investiguei antes de
mexer: a **causa é anterior** ao meu diff (452 px já com os 10 px originais), e a
fonte única é a tira "Funil Ideal", um `flex items-center gap-4` com rótulo +
SVG de 96 px + coluna de metas + painel de texto, sem tratamento responsivo. Um
`flex-wrap` resolve inteiro:

```
375 px · antes 463 · depois 375   (com o formulário aberto, 0 elementos transbordando)
1280 px · sem mudança (a tira continua numa linha só, 114 px de altura)
```

Registrei o número no comentário do código. Fiz porque o arquivo é meu, o piso de
12 px tinha piorado o caso em 11 px, e deixar rolagem horizontal na tela que o
gerente abre pelo celular contradiz o que a Tarefa N está arrumando ao lado.

---

## 5. O que **não** foi feito, e por quê

**Fora de escopo por combinação:** varredura de `text-[Npx]` no resto do app e
`.text-eyebrow` (Tarefa N) · `react-router` (Tarefa O) · `e2e/**` (Tarefa P) ·
decompor `DailyReport.tsx` · unificar `sonner` × `use-toast` · cron.

**Limite que fica registrado, e é do banco, não da tela:**
`public_daily_team` devolve `today` filtrado por `report_date = current_date`. Por
isso `filledDates` nunca tem mais que um dia, e **o calendário do Histórico pinta
de vermelho ("Não preenchido") todo dia anterior, mesmo os que têm checkpoint**.
Não dá para consertar no front — a RPC não conta essa informação. O `title` de
cada dia anterior agora diz o que a tela realmente faz, mas a cor continua
enganando. Candidato à mesma migration da §6.

---

## 6. A correção histórica do diário precisa existir? Acho que sim — e não é aqui

**Sim.** Hoje, o gerente que perde um dia não tem como lançá-lo: o funil do mês
fica subnotificado para sempre, e é justamente o número que a diretoria lê.

**Mas não pelo link público.** O link anônimo não pode escolher a data: quem tem
o slug e o PIN passaria a poder reescrever qualquer dia do histórico da equipe,
e a superfície anônima é o que a `0019`/`0033`/`0034` passaram três migrations
endurecendo. Dar data a `public_daily_submit` desfaz isso.

O que a correção exigiria, em ordem de custo:

1. **Tela autenticada, sem migration para o write.** A policy `daily_reports_write`
   (`0009:431`) já permite `is_admin() or team_id in (select auth_led_team_ids())`
   para `for all`, e `daily_entries_write` acompanha. Ou seja: um admin ou o
   gestor da equipe **já pode** gravar `report_date` de qualquer dia pelo cliente
   normal. Falta a tela — `Checkpoint.tsx` hoje só lê. É o menor caminho: um
   editor por (equipe, data) reaproveitando a grade que o `DailyReport` já tem.
2. **Migration para a trilha de auditoria.** `daily_reports` tem `submitted_by`,
   mas nada registra que uma linha foi *corrigida* — quem, quando, do quê para
   quê. Correção retroativa de número que a diretoria lê sem trilha é convite a
   discussão sem árbitro. É a parte que exige migration de verdade.
3. **Opcional, e só se o diário público tiver de mostrar o passado com honestidade:**
   `public_daily_team` devolver as datas preenchidas do mês (§5). A forma
   conservadora é devolver **só as datas**, nunca os números — a superfície
   anônima não precisa saber quanto cada dia produziu para pintar um calendário.

**Consequência de adiar:** nada quebra e nada se perde a mais — desde este diff,
a tela não destrói mais o dia de hoje. O que fica é o buraco no mês quando alguém
esquece de lançar, e o calendário vermelho da §5. **Consequência de fazer agora:**
é tela nova + migration de auditoria, ou seja, tarefa própria — não cabia nesta.

---

## 7. Validação e publicação

```
npm run typecheck   ✅ limpo (app + node + e2e)
npm run lint        ✅ 0 erros, 7 avisos — os 7 pré-existentes, nenhum novo
npx vitest run      ✅ 14 arquivos, 190 testes (183 da base + 4 meus + 3 de tarefa paralela)
npm run build       ✅
```

**Não publiquei.** O enunciado pede que a Tarefa O publique por último nesta
rodada, porque o bump de dependência dela muda o bundle. **Se O não for rodar,
quem publicar usa** — os três argumentos importam (handoff-J §7):

```bash
npx vercel deploy --prod --yes --archive=tgz --scope alissons-projects-b1faee75
```

e confere o hash contra o `dist/index.html` local:

```bash
curl -s https://faceimob.vercel.app/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'
```

O `dist/` que ficou no disco foi reconstruído **com o ambiente normal** (aponta
para a homologação `mcmqgxvtwegtptfseqvw`; conferido que não sobrou nenhuma
referência a `127.0.0.1:54321` do build temporário da §2.3).
