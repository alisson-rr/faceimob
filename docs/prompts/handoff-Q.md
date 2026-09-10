# Handoff Q — Restauração da tela de Gamificação

**Data:** 27/08/2026 · **Branch:** `nova` · **Publicado:** sim, `index-B7h7QudJ.js`
**Arquivo alterado em `src/`:** exatamente um — `src/pages/Gamification.tsx`.

---

## 0. Resumo em cinco linhas

A tela voltou. O arquivo recuperado da sessão da Tarefa B compilou contra a árvore de hoje **sem
um único ajuste** — mas ele estava faltando trabalho de uma tarefa que o enunciado não cita: a
**Tarefa L** (26/08) tinha adotado `describeError` neste arquivo, e essa adoção morreu no mesmo
`git checkout --`. Recuperei as quatro substituições exatas da L do transcript dela e apliquei.
Os 5 testes que a Tarefa P deixou vermelhos estão verdes (medido antes e depois, não citado).
Suíte completa sobre o arquivo publicado: **147 passaram, 0 falharam, 1 pulada por horário**.
Publicado, com o hash conferido nos dois lados.

---

## 1. O que o arquivo restaurado tinha que o atual não tinha

O `git diff` entre os dois não é um diff — é uma substituição: **419+/493-**. Os dois arquivos não
compartilham estrutura. O que voltou, por item:

| O que voltou | Onde | O que havia no lugar |
|---|---|---|
| `PageHeader` (`<h1>` único + eyebrow "GAMIFICAÇÃO") | 323 | um `div` centralizado com `<h1 className="text-3xl">` escrito à mão e duas coroas decorativas |
| `SectionCard` (titula em `<h2>`) — 8 usos | 365, 383, 432, 436, 453, 466 | `Card`+`CardHeader`+`CardTitle` cru, que titula em `<h3>` — era o que reprovava `admin:193` |
| `Podium` de `@/components/engagement` | 433 | pódio próprio em `motion.div`, com `text-yellow-400` / `text-gray-300` / `text-amber-600` chumbados e **sem `aria-label`** — era o que reprovava `admin:163` |
| `num()` / `brl()` / `date()` de `@/lib/format` | 162-164, 291 | `{s.points}` cru e `(s.vgv / 1000000).toFixed(1)+"M"` — era o que reprovava `admin:108`, `admin:120` e `broker:23` |
| `EmptyState` / `LoadingState` / `StatusBadge` | 404-412, 425, 346 | `RefreshCw` girando com "Carregando dados reais...", `Badge` com `border-green-500/40` |
| TanStack Query no lugar de `useState`+`useEffect` | 182-228 | `fetchGameState()` com 6 `useState` e um `useEffect` |
| **`closeMonthAndSeason(monthStart(...))`** — o achado G01 | 282 | `closeGameSeason()`, que trava o mês **sem migrar as propostas abertas** |
| Estado "jogo parado" + `openGameSeason` | 364-381 | não existia: sem temporada aberta a tela mostrava ranking vazio sem explicar |
| Ciclo por período real (`02/07 → 05/08`) | 119-121 | `MONTHS[date.getMonth()]` — "Agosto 2026" derivado do relógio, ignorando o período da temporada |
| Tokens `text-gold`/`silver`/`bronze`, `sr-only` na coluna de posição, `aria-label` no seletor, `htmlFor` nos pesos | vários | cores fixas de tema escuro e nenhum rótulo acessível |

E o que a versão de hoje tinha e **não** foi trazido, com o motivo:

- **`breakdown` por evento** (`incompletos/esteiras/aprovados/vendas/distratos`). Verifiquei: na
  versão antiga ele é montado em `buildScores` e **nunca lido no JSX** — `grep -n "breakdown"` no
  arquivo antigo devolve só a declaração do tipo e a montagem. Quem consome de verdade é
  `src/hooks/useGameRanking.ts:81,104`, que continua intacto. Deletar código morto não é perder feature.
- **`if (!isAdmin || closing) return`** no fechamento. Redundante na versão nova: o botão só renderiza
  sob `isAdmin && isCurrent && !isClosed`, o `AlertDialogAction` tem `disabled={closeMutation.isPending}`,
  e `close_month_and_season` recusa não-admin com 42501 no servidor.
- **Vendas e VGV no cartão do pódio.** A versão antiga mostrava `{s.vendas} vendas` e `VGV: X.XM`
  embaixo do nome; a nova passa só a equipe em `detail`. **Decisão consciente:** o `detail` do
  `Podium` é uma linha só com `truncate`, e a 375 px "Equipe Paulista · 3 vendas · R$ 2.400.000"
  some nas reticências. Os dois números estão na tabela logo abaixo, na mesma tela. Se preferir a
  densidade, a mudança é uma linha (`detail: <>{s.team} · {num(s.vendas)} vendas</>`) e `brl`/`num`
  já estão importados.
- **`.sort()` extra nos grupos de diretoria/gerência.** Redundante: `buildScores` já ordena, e
  `forEach`+`push` sobre `Map` preserva ordem. A versão nova ainda melhora o desempate no ranking
  congelado (`a.points === b.points ? 0 : ...`), que mantém o `rank` do banco.

---

## 2. O que precisei ajustar — e por que não foi o que o enunciado previa

**Nada precisou ser ajustado para a árvore de hoje.** `npm run typecheck` passou de primeira sobre
o arquivo recuperado, sem tocar em uma linha. Conferi um por um antes de rodar: `gameKeys.{all,
seasons,rules,results}`, `closeMonthAndSeason` (1 argumento, devolve `{period, moved_deals,
next_season_id}`), `openGameSeason(label)`, `monthStart(iso)`, os 12 campos de `RankingRow`,
`PodiumEntry.avatarUrl` aceitando `string | null`, `StatusTone` com `neutral`/`success`/`warning`,
`EmptyState tone="danger"`, `LoadingState variant="table"`, `PauseCircle`/`Play` no lucide instalado,
e os tokens `gold`/`silver`/`bronze`/`highlight` no `tailwind.config.ts`. Zero divergência.

O `closeGameSeason(undefined, true)` → `closeGameSeason()` que a Tarefa N repôs **não** precisou vir:
o arquivo da B não chama `closeGameSeason` em lugar nenhum — ele chama `closeMonthAndSeason`, que é
justamente a correção do G01 que a N estava tentando remendar por fora.

### 2.1 O ajuste que foi preciso: a Tarefa L também tinha editado este arquivo

O enunciado parte do princípio de que só a remontagem da B (23/08) foi apagada. **Não foi.** Em
26/08 a Tarefa L adotou `describeError` em 23 telas, e o `handoff-L.md` §9 lista `Gamification`
entre elas. O `git checkout --` de hoje apagou as duas camadas de uma vez, e o arquivo recuperado
é de 23/08 — três dias *antes* da L. Restaurá-lo puro devolveria o kit e devolveria junto três
`error.message` crus na tela do usuário.

Não inferi o conteúdo: **recuperei as substituições exatas** do transcript da L (subagente
`a60590ffd29305c9a` do workflow `wf_df9effdd-dff`, 26/08 22:25). São quatro pares, aplicados literalmente:

```diff
+ import { describeError } from '@/lib/supabaseError';                                   // linha 22

- description: error instanceof Error ? error.message : 'Erro desconhecido',
+ description: describeError(error, 'Não foi possível encerrar a temporada.'),           // 298

- description: error instanceof Error ? error.message : 'Erro desconhecido',
+ description: describeError(error, 'Não foi possível abrir a temporada.'),              // 314

- description={loadError instanceof Error ? loadError.message : 'Erro desconhecido.'}
+ description={describeError(loadError, 'Não foi possível carregar a gamificação.')}     // 411
```

Duas provas de que é o texto certo, não uma reconstrução plausível:

1. **Os quatro âncoras casaram 1:1** no arquivo recuperado (o script da L aborta com `count != 1`).
   O âncora do import é `import { brl, date, num } from '@/lib/format';`, que **só existe na versão
   da B** — ou seja, a L editou exatamente este arquivo, e o recuperado é byte a byte o que ela viu.
2. **A conta fecha.** A L declarou `"adopted": 16` para o grupo `Equipes/Marketing/Resultados/
   Gamification`. Hoje, com a restauração: Equipes 7 + Marketing 1 + Resultados 3 + Gamification 3
   + os 2 `dbError` do Marketing = **16**. Antes da minha restauração dava 13.

Confirmei também que as outras 23 telas da lista da L estão intactas — nenhuma outra perdeu essa camada.

---

## 3. Placar dos 5 testes — antes e depois, medido

Não citei o handoff-P: rodei os dois specs com a versão quebrada (copiando o arquivo de volta com
`cp`, nunca por git) e depois com a restaurada.

```
ANTES  (HEAD quebrado)                                   DEPOIS (restaurado + L)
admin:108  o placar da tela é game_events        FALHOU   ok  (1.5s)
admin:120  mudar a regra muda o placar           FALHOU   ok  (1.4s)
admin:163  o pódio mostra os três primeiros      FALHOU   ok  (1.4s)
admin:193  agrupa pelo diretor real da equipe    FALHOU   ok  (1.5s)
broker:23  vê o próprio placar de game_events    FALHOU   ok  (1.5s)
broker:56  ranking da equipe, sem a rival        ok       ok  (1.4s)
broker:73  não pode encerrar nem abrir o admin   ok       ok  (1.3s)
                                    5 failed, 2 passed    7 passed (36.2s)
```

Bate exatamente com o que a Tarefa P mediu em §7.1. Nenhum seletor foi tocado.

**Nota sobre `broker:73`, que passava mesmo com a tela quebrada.** Ele ancora em
`getByRole("heading", { name: /ranking completo/i })` **sem nível**, e a versão quebrada tinha
"Ranking Completo — Agosto 2026" num `CardTitle` (`<h3>`). O teste não está errado, mas essa âncora
não distingue o kit do cartão cru — quem cobra o `<h2>` é o `admin:193`.

### 3.1 Suíte completa

Rodei duas vezes: uma logo depois de restaurar o arquivo da B, outra depois de aplicar as quatro
substituições da L — a segunda é a que vale, porque é o arquivo que está no ar.

```
                                   1ª (só a B)      2ª (B + L, o que foi publicado)
testes declarados                       148                     148
  passaram                              146                     147
  falharam                                0                       0
  puladas                                 2                       1
  duração                              5.6 min                 5.4 min
```

As puladas são `test.skip(!turnoAtual, "fora de qualquer janela de turno")` em
`e2e/broker/roleta.spec.ts:180` e `:236`: dependem da hora do relógio, não do código — por isso o
número muda entre execuções. A P mediu 147 declarados às 11h50; hoje são 148 porque a Tarefa R criou
`e2e/admin/perder-negocio.spec.ts` às 12h37, no meio da rodada. **Zero falhas nas duas execuções.**

Demais portões, todos sobre o arquivo final:

```
npm run typecheck   exit 0
npm run lint        0 erros, 7 avisos (os 7 pré-existentes de react-refresh)
npx vitest run      15 arquivos, 199 testes, 199 passaram
npm run build       ✓ built in 9.41s
grep -c "Podium\|SectionCard\|PageHeader\|num(" src/pages/Gamification.tsx   →  20
git diff --numstat -- src/pages/Gamification.tsx  →  419  493   (era 1  1)
```

**Baseline honesto.** Quando comecei, `npm run lint` tinha **1 erro** e `npx vitest run` tinha **1
arquivo que nem coletava** (`src/lib/notificationLink.test.ts` — o regex `(?![/\])` em
`notificationLink.ts` deixa a classe de caracteres sem fechar) mais 1 teste falhando
(`type-scale.test.ts`). Os dois eram da Tarefa S, que os corrigiu ao vivo enquanto eu trabalhava.
Registro porque o enunciado dizia "190 testes verdes hoje" e o que encontrei foram **186 com 2
arquivos vermelhos** — o número do enunciado contava 4 testes que não estavam rodando.

---

## 4. O que eu vi na tela

Capturas em `docs/design-system/`, prefixo `smoke-q-` (6 arquivos). `smoke-j-*` (12) e `smoke-n-*` (18)
intactos, conferido por contagem.

```
smoke-q-gamification-dark-375.png             smoke-q-gamification-light-375.png
smoke-q-gamification-diretorias-dark-375.png  smoke-q-gamification-diretorias-light-375.png
smoke-q-gamification-dark-1280.png            smoke-q-gamification-light-1280.png
```

Medido por código na página (mesmo método da varredura da N), logado como admin, nos dois temas:

```
gamification·dark·375    transbordo=0  menorFonte=11  <12px=1  <11px=0  erros=0
gamification·light·375   transbordo=0  menorFonte=11  <12px=1  <11px=0  erros=0
gamification·dark·1280   transbordo=0  menorFonte=11  <12px=4  <11px=0  erros=0
gamification·light·1280  transbordo=0  menorFonte=11  <12px=4  <11px=0  erros=0
```

**`menorFonte=11` era o resultado esperado e é o resultado obtido.** A N mediu 12 nesta tela, mas
mediu na tela quebrada, que não tinha `PageHeader` e portanto não tinha `.text-eyebrow`. Com o
cabeçalho de volta o 11 px reaparece — e é a exceção escrita do X07 (caixa alta, tracking 0.14em),
não uma regressão. `<11px=0` nas quatro combinações, então o `type-scale.test.ts` da N continua verde.

O que está na tela, conferido item a item:

- **Pódio:** três degraus na ordem visual 2–1–3, coroa balançando no 1º, anel de ouro/prata/bronze.
  `aria-label` dos três: `"2º lugar: Bruno Santos, 990 pontos"`, `"1º lugar: Ana Oliveira, 2440 pontos"`,
  `"3º lugar: Diego Costa, 540 pontos"`.
- **Números em pt-BR:** coluna "Pontos" sai `2.440`, `990`, `540`, `290`, `10`, `-600`.
- **Abas:** `Geral · Diretorias · Gerências · Admin` (a quarta só para admin — o corretor vê três,
  provado pelo `broker:73`). Botão **"Fechar gameficação"** presente, com o diálogo de pesos.
- **Cabeçalhos:** `<h1>` "Ranking do game" único; `<h2>` "Pontuação por movimento", "Campeões gerais",
  "Ranking completo"; na aba Diretorias, um `<h2>` "Diretoria &lt;nome&gt;" por cartão.
- **Transbordo:** zero na horizontal nos dois temas e nas duas larguras. Os únicos retângulos que
  passam de 375 px estão clipados por ancestral com `overflow` — os três círculos decorativos do
  `BrandMotif` e a `<table>` dentro do `div.overflow-auto` do shadcn, que é rolagem interna
  intencional. **Console limpo: 0 erros** nas quatro combinações.
- **Tema claro:** paleta correta, contraste preservado, nenhum resto de cor de tema escuro
  (`text-yellow-400`/`text-gray-300`/`text-amber-600` sumiram junto com o pódio caseiro).

---

## 5. Publicação

```
npx vercel deploy --prod --yes --archive=tgz --scope alissons-projects-b1faee75
→ dpl_FUUtqSFiGFKDvjX4td8HFrstepxx   READY   production
```

```
no ar     : assets/index-B7h7QudJ.js
dist local: assets/index-B7h7QudJ.js      ✅ iguais
build da O: assets/index-oQLdfviq.js      ✅ diferente
```

Conferi também o chunk da tela: `https://faceimob.vercel.app/assets/Gamification-DFoibZDV.js`
responde e contém "Ranking do game" / "Campeões gerais" — a tela restaurada está no ar, não só um
bundle novo.

**O deploy carregou o que estava na árvore às 13h05**, incluindo trabalho em voo das Tarefas R e S
(`LoseDealDialog.tsx`, `useDealActions.ts`, `dealStatus.ts`, `statuses.test.ts`, `NotificationBell.tsx`,
`notificationLink.ts`, `type-scale.test.ts`). `--archive=tgz` sobe a árvore inteira; não dá para
publicar só o meu arquivo. Os portões da §3.1 passaram sobre essa mesma árvore, então nada foi ao ar
quebrado — mas quem quiser saber exatamente o que foi publicado tem o `dpl_FUUtqSFiGFKDvjX4td8HFrstepxx`.

> **Para a R e a S:** vocês **não** republicam. Quando entregarem, quem republica é o Alisson, com o
> mesmo comando acima. Os três argumentos importam: sem `--scope` a CLI responde "Not authorized"
> mesmo logada, e sem `--archive=tgz` o envio morre com `fetch failed`.

---

## 6. Outros sinais de trabalho apagado — o item mais valioso

Varri o repositório inteiro por cinco ângulos independentes, com verificação adversarial de cada
achado. **Resultado: um achado novo (o da Tarefa L, §2.1) e prova negativa nos demais.**

### 6.1 A armadilha da própria varredura — leia isto antes de repetir a busca

O jeito óbvio de procurar trabalho apagado é varrer os transcripts por `tool_use` com `file_path`
apontando para o arquivo. **Esse método é cego e quase me fez publicar a perda da L.**

Ele devolveu, para `src/pages/Gamification.tsx` em toda a `~/.claude/projects`, exatamente duas
edições: o `Write` da B (23/08) e o `Edit` de uma linha da N (27/08). Nenhuma da L. Eu ia concluir
"a L super-declarou no handoff dela" — conclusão errada, com evidência que parecia forte.

O que salvou foi rodar um **controle**: apliquei a mesma busca ao `Equipes.tsx`, que
comprovadamente tem 8 `describeError` postos pela L. **Deu zero também.** Um método que não acha o
que sabidamente existe não pode provar ausência. Duas causas, e as duas precisam ser tratadas:

1. **Edição de subagente fica em subdiretório.** Um `glob("projects/*/*.jsonl")` não alcança
   `<sessao>/subagents/workflows/wf_*/agent-*.jsonl`. Tem que ser `os.walk` recursivo.
2. **Nem toda edição passa por `Edit`/`Write`.** Metade dos subagentes da L aplicou as trocas por
   `Bash`, com um script Python em heredoc contendo um dicionário `EDITS`. Esses registros **não têm
   `file_path`** — o nome do arquivo só aparece dentro do corpo do comando.

A busca que funciona:

```python
# recursiva, e casando o NOME do arquivo em qualquer lugar do input da ferramenta,
# nao so no campo file_path
import json, io, os
base = r"C:\Users\Alisson\.claude\projects"
for root, _, files in os.walk(base):                      # recursivo: pega subagents/
    for fn in (f for f in files if f.endswith(".jsonl")):
        for ln, line in enumerate(io.open(os.path.join(root, fn), encoding="utf-8", errors="replace"), 1):
            if "Gamification.tsx" not in line:
                continue
            rec = json.loads(line)
            for c in (rec.get("message") or {}).get("content") or []:
                if isinstance(c, dict) and c.get("type") == "tool_use":
                    # o alvo pode estar em file_path OU no corpo de um command
                    if "Gamification.tsx" in json.dumps(c.get("input") or {}, ensure_ascii=False):
                        print(rec.get("timestamp"), c.get("name"), fn, ln)
```

**O ângulo que de fato achou a perda foi outro:** cruzar o que cada handoff **declara** ter feito
contra o que o arquivo **tem hoje**. O `handoff-L.md` §9 lista 24 arquivos que receberam
`describeError`; 23 tinham, um tinha zero. Declaração × estado é mais forte do que transcript ×
estado, porque não depende de como a edição foi aplicada.

### 6.2 Prova negativa nos outros ângulos

| Ângulo | O que mediu | Resultado |
|---|---|---|
| Comandos de risco nos transcripts de 26–27/08 | 22 comandos com `checkout\|restore\|clean\|stash\|reset\|rm -rf` | **exatamente dois** `git checkout --`: `src/pages/Gamification.tsx` (Tarefa M) e `src/index.css` (Tarefa N, já restaurado). Os `rm -rf` são legítimos: as 3 edge functions aposentadas pela I (aparecem como `D`) e o harness `.medicao-n` da própria N |
| "Rastreado + idêntico ao HEAD + escrito hoje" | `git ls-files` inteiro | **um** arquivo: `.claude/launch.json` (ver §6.3). Nenhum em `src/`, `e2e/`, `supabase/`, `scripts/` |
| Diffs ≤ 6 linhas | 19 arquivos, lidos um a um | todos legitimamente cirúrgicos (troca de token em `ui/*`, correção de locator em `e2e/*`, o prefixo numerado do `dealStatus.ts`, a linha do `globalTeardown`). Só o `Gamification.tsx` (1+/1-) estava fora do padrão |
| Adoção do kit | 19 páginas sem `@/components/shared`, cruzadas com os handoffs | 18 nunca foram remontadas ou têm diff grande coerente com o que declararam. Só a Gamificação era declarada remontada e não estava |
| Integridade estrutural | 100 imports `@/…` resolvidos, export × import cruzado | **zero inconsistência** — descarta módulo parcialmente revertido nos 6 diretórios untracked (`shared/`, `pipeline/`, `engagement/`, `dashboard/`, `leads/`, `lib/engagement/`) |
| Saúde do que já foi restaurado | `src/index.css` | de pé: 308 linhas, `--radius: 1rem`, sem "Instrument Serif", `.text-eyebrow` com `uppercase` + `0.14em` nas linhas 251-257 |
| Resto do trabalho da Tarefa B | 10 pontos fora do Gamification | todos presentes (`sound.ts`, `PipelineTopRanking`, `gameKeys`/`closeMonthAndSeason`/`openGameSeason`/`monthStart` no `game.ts`, `EngagementLayer`+`SoundToggle` no `AppLayout`, `useQuery` no `useGameRanking`) — o checkout pegou um arquivo só |

### 6.3 `.claude/launch.json` — informativo, precisa de 30 segundos de um humano

É o único outro arquivo do repositório com a assinatura da reversão: rastreado, byte a byte igual ao
commit `24dc516`, e **escrito hoje às 10:27:41** — quatro segundos depois do `Gamification.tsx`
(10:27:37, medido pela P em §7.1). O `handoff-M.md` declara: "`.claude/launch.json` recebeu uma
entrada temporária para servir o `dist/` durante a prova da §1 e **foi revertida**".

**Não há perda demonstrável:** o conteúdo do HEAD é coerente com o resto da árvore (`port: 8080` +
`autoPort: true` batem com `vite.config.ts:15`), e nenhum handoff de A a P declara alteração
permanente ali. Registro porque uma config revertida não quebra typecheck, nem lint, nem teste —
passa despercebida. Abrir o arquivo e confirmar que a única entrada (`faceimob-dev`) é tudo o que
deveria estar lá fecha o assunto.

---

## 7. Achados fora do meu escopo (anotados, não corrigidos)

1. **O pódio não usa `num()`.** Na mesma tela, o mesmo número aparece `2440` no degrau e `2.440` na
   tabela. `src/components/engagement/Podium.tsx` renderiza `{points}` cru (o valor do `useCountUp`),
   e o `aria-label` do `<li>` também: `"1º lugar: Ana Oliveira, 2440 pontos"`. É exatamente a classe
   de inconsistência que o `lib/format.ts` existe para impedir. **Não toquei**: é componente do kit
   (`src/components/engagement/`), não é meu arquivo, e a mudança mexe no `aria-label` que o
   `admin:163` cobra — o teste casa `/lugar:/` e sobreviveria, mas isso é decisão de quem é dono do
   kit, com a suíte junto. **Aparece na demonstração**: o pódio é o primeiro elemento visual da tela.
2. **"August 2026" está no ar.** O `to_char(..., 'TMMonth')` do fechamento automático de temporada
   (handoff-O §5.2) gera o rótulo em inglês, e ele é o que o `PageHeader` mostra: *"Temporada
   **August 2026** · 01/08/2026 → em andamento"*, mais o seletor de temporada. Está nas capturas.
   É migration, e migration não é desta rodada — mas quem for gravar a demonstração vai ver isso.
3. **`e2e/admin/perder-negocio.spec.ts` e `e2e/broker/kanban-gesto.spec.ts` são novos e untracked.**
   Aparecem como `??`. O enunciado da minha tarefa dizia "e2e/** — ninguém nesta rodada"; a Tarefa R
   criou o primeiro (12:37). Não é problema, mas explica a suíte ter passado de 146 para 147 testes
   declarados enquanto eu trabalhava.
4. **`provisionE2EUsers()` é idempotente mas não é seguro sob concorrência.** `ensureTeam` faz
   select-então-insert; com o harness da Tarefa S rodando no mesmo banco local, as duas execuções
   colidiram no `teams_slug_key` (23505) e uma delas deixou o `e2e.admin` com `full_name: "e2e.admin"`
   e papel `broker` em vez de `admin` — a tela abriu como corretor e o pódio sumiu. Não é defeito da
   aplicação e não afeta a suíte (que roda serial, `workers: 1`), mas morde qualquer harness paralelo.
   `ponytail: enquanto for um banco só, harness paralelo confere o papel depois de provisionar;
   resolver de verdade só com um banco por worker.`

---

## 8. Arquivos

**Alterado em `src/` (1):** `src/pages/Gamification.tsx` — restaurado da sessão da Tarefa B
(`7e39eab8`, linha 386) + as 4 substituições da Tarefa L (`wf_df9effdd-dff` / `a60590ffd29305c9a`).

**Criados:**

- `docs/design-system/smoke-q-gamification-{dark,light}-{375,1280}.png` e
  `docs/design-system/smoke-q-gamification-diretorias-{dark,light}-375.png` (6)
- `docs/prompts/handoff-Q.md` (este)
- `.harness-q.local/` (2 arquivos) — harness efêmero de captura, porta 5197. **Não é código do
  produto**: importa `mintSession`/`storageStateFor`/`provisionE2EUsers` de `e2e/support/` sem
  editar nada lá, no mesmo feitio do `.harness-s.local/` da Tarefa S. Pode apagar quando quiser.

**Não toquei:** `src/components/pipeline/**`, `src/lib/dealStatus.ts` (R) · `src/components/NotificationBell.tsx`,
`src/pages/Checkpoint.tsx`, `src/components/shared/BrandMotif.tsx`, `src/lib/type-scale.test.ts` (S) ·
`e2e/**` · `supabase/**` · `package.json`.

**Nada foi commitado**, como pedido. **E devia ser.** A causa raiz das duas perdas de hoje não é o
`git checkout --` — é o fato de 159 arquivos de cinco dias de trabalho viverem só na árvore de
trabalho, o que transforma o comando mais banal do git em apagador. Enquanto isso for verdade, cada
tarefa que precisar desfazer uma alteração temporária é uma chance de perder um dia. **Um commit
resolve; a decisão é sua.** Até lá, a regra que segui e recomendo: para alteração temporária,
`cp arquivo arquivo.bak` antes e restaurar da cópia — nunca por git.
