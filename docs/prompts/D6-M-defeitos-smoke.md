# Tarefa M — Os três defeitos de comportamento que o smoke deixou

> Contexto do agente: **limpo**. Tarefa curta e cirúrgica: três arquivos, três defeitos, nenhuma refatoração. Roda **em paralelo com N, O e P** — os quatro têm listas de arquivos que não se cruzam.

## Contexto

- Repo: `C:\Users\Alisson\CascadeProjects\FACEIMOB`, branch `nova`. URL no ar: **https://faceimob.vercel.app** (homologação `mcmqgxvtwegtptfseqvw`). Leia `.claude/CLAUDE.md`, `.claude/rules/{code-style,security}.md`, e `docs/prompts/handoff-J.md` §3 (foi o smoke que achou dois destes).
- **Você pode editar exatamente estes três arquivos:** `src/components/UpdateNotifier.tsx`, `src/pages/DailyReport.tsx`, `src/components/NotificationBell.tsx`.
- **NÃO toque em:** o resto de `src/` — a Tarefa **N** está fazendo a varredura de tipografia e o cabeçalho a 375 px agora, e vai passar por vários arquivos · `package.json`/`package-lock.json` (Tarefa **O**) · `e2e/**` (Tarefa **P**) · `supabase/**` (ninguém nesta rodada — leia o item 2 antes de pensar em migration).
- Exceção da regra de N: **os `text-[10px]`/`text-[9px]` dentro de `DailyReport.tsx` são seus**, porque o arquivo é seu. Está combinado com a N; ela não vai abrir esse arquivo. Aplique o mesmo piso de 12 px que ela vai aplicar (`text-xs` = 0.75 rem), sem inventar tamanho novo.
- Erro de banco é `describeError`/`dbError` de `@/lib/supabaseError`. Sem hex, sem paleta literal.

## Entrega 1 — o aviso falso de "Nova versão disponível" (🟠 é o mais visível)

**Onde:** `src/components/UpdateNotifier.tsx:17-24` (assinatura carregada) e `:27-35` (assinatura remota).

**O que acontece:** em qualquer rota com pedaço próprio — ou seja, praticamente todas — o banner "Nova versão disponível!" e o botão flutuante aparecem em poucos segundos, num build recém-publicado, sem nada de novo para baixar. Reproduzido na URL publicada com console limpo.

**Por quê:** o detector compara dois conjuntos que nunca podem ser iguais.

- `loadedSignature` lê os assets **presentes no DOM daquela aba**, e isso inclui os pedaços que a rota carregou sob demanda (`DailyReport-*.js`, `ComparativeFunnel-*.js`, `pt-BR-*.js`…).
- `fetchRemoteSignature` lê os assets **listados no `index.html`**, que só tem a entrada e o que ela pré-carrega.

Qualquer rota lazy diverge. O detector está comparando "o que esta aba carregou" com "o que o app carrega no boot" — duas perguntas diferentes.

**O que fazer:** comparar só o que identifica o build, que é a entrada. Filtrar as duas listas por `/assets/index-` resolve com uma linha em cada lado. Se sobrar mais de uma entrada depois do filtro, é sinal de que o `vite.config.ts` mudou de forma que quebra a premissa — nesse caso não avise, e deixe um comentário dizendo por quê. **Falso negativo aqui é barato; falso positivo é o cliente vendo o app pedir atualização o tempo todo.**

**Como provar:** `npm run build`, sirva o `dist/` (`npx vite preview`), abra duas rotas com pedaço próprio (`/pipeline` e `/leads` servem) e confirme que o banner **não** aparece. Depois toque um arquivo qualquer de `src/`, rebuilde por cima do mesmo servidor e confirme que ele **aparece**. Sem os dois lados, o conserto não está provado — e a versão de hoje passaria num teste que só olha o primeiro.

## Entrega 2 — o diário grava o dia errado (🔴 este é perda de dado, e é maior do que o smoke descreveu)

**Onde:** `src/pages/DailyReport.tsx` — o estado `date`, o `submit` em `:290`, a chamada em `:310`, e os rótulos em `:393` e `:650`.

**Os fatos, já conferidos — não precisa reconferir, mas confirme antes de editar:**

1. `public_daily_submit(p_slug text, p_pin text, p_entries jsonb)` **não recebe data.** O corpo (migration `0009`, `supabase/migrations/20260725120800_0009_daily.sql:251`) faz `insert into public.daily_reports (team_id, report_date, submitted_at) values (v_link.team_id, current_date, now()) on conflict (team_id, report_date) do update set submitted_at = now()`.
2. O `submit` da tela manda `p_slug`, `p_pin` e `p_entries`. **O estado `date` nunca sai da tela.**
3. Mesmo assim a tela tem seletor de Histórico, um estado de "(editando)" e o aviso amarelo *"Editando um dia anterior: 20/08/2026"*.

**Logo:** abrir o Histórico, escolher 20/08, preencher e salvar **sobrescreve o checkpoint de hoje** — porque o `on conflict (team_id, report_date) do update` casa com a linha de hoje. O gerente acha que corrigiu o passado e apagou o presente. Silenciosamente.

E o rótulo mente na outra direção: `:86` é `const yesterday = new Date()` — que é **hoje**. A tela escreve "Data (ontem)" e "abrir o checkpoint de **ontem (26/08)**" em 26/08.

**A correção, e por que é esta:**

Faça a tela dizer a verdade sobre o que o banco faz — **não** adicione parâmetro de data à RPC. Motivos, para você não ficar em dúvida no meio:

- `public_daily_submit` é uma das **exatamente três** RPCs da superfície anônima do projeto (as outras são `public_daily_team` e `public_director_checkpoint`). Mudar a assinatura dela é mexer na superfície que a `0019` e a `0033` endureceram, e `supabase/**` não é seu nesta tarefa.
- `report_date = current_date` é a convenção desde a `0009`. **Todo dado já gravado segue ela**, e o funil e os relatórios leem em cima disso. Mudar a data que se grava mudaria o significado de linhas existentes.

Então, dentro de `DailyReport.tsx`:

- **Os rótulos passam a falar de hoje.** `yesterday` é um nome que mente; troque por algo que descreva o que a variável é. O calendário em `:548` usa `yesterday` como fim do intervalo — confira o que isso deve ser depois da troca, não troque no automático.
- **O caminho de editar dia anterior para de enviar.** Enquanto `date !== todayStr`, o botão de salvar fica desabilitado e o aviso amarelo passa a dizer a verdade: que esta tela só grava o checkpoint de hoje, e que dia anterior se corrige por outro caminho. Não deixe um botão que parece que grava e grava em outro lugar.
- **Não invente uma tela de correção histórica.** Se ela é necessária, é decisão de produto com migration junto, e vira tarefa própria. Anote no handoff.

**Como provar:** contra o stack local (`npm run db:start`, `npx supabase db reset`), envie um checkpoint por um link com PIN e confira em `daily_reports` que `report_date` é hoje. Depois abra o Histórico, selecione um dia anterior e confirme que **não há como enviar**. Diga no handoff qual foi a consulta.

## Entrega 3 — o sino navega para onde a notificação mandar (🟡 endurecimento de uma linha)

**Onde:** `src/components/NotificationBell.tsx:23` e `:74`.

```ts
const resolveLink = (link: string) => link.replace(/^\/leads\/([0-9a-fA-F-]{36})$/, "/leads?lead=$1");
// ...
navigate(resolveLink(item.link));
```

`resolveLink` **reescreve** um formato e deixa passar todo o resto. `item.link` vem da coluna `notifications.link`.

**Por que isso alcança alguém:** a policy `notifications_insert` tem `with check (has_any_role('admin','director','manager'))` — sem restrição de `profile_id` e sem restrição do conteúdo de `link`. Um gerente pode inserir notificação **no sino de qualquer perfil** com o `link` que quiser. Hoje só os triggers das migrations escrevem ali (`0011`, `0028`, `0032`), montando o caminho a partir de ids, então **não está sendo explorado**. Mas o guard custa uma linha e a superfície já existe.

**O que fazer:** validar na função compartilhada, que é o ponto por onde os dois usos passam. Aceite apenas caminho interno; qualquer outra coisa vira um destino seguro (a própria lista de notificações ou a home) em vez de virar `navigate()`. Cuide dos três formatos que enganam validação ingênua: `//host`, `\\host` e `https://host` — o primeiro e o segundo são exatamente os que os avisos abertos do `react-router` exploram (a Tarefa **O** está subindo a versão em paralelo; o guard aqui é a outra metade, e as duas juntas fecham o assunto sem migrar para o v7).

**Deixe um teste.** É lógica não trivial numa fronteira de confiança: um `resolveLink.test.ts` pequeno, ou exporte a função e teste junto — cinco casos (`/leads/<uuid>`, `/pipeline`, `//externo`, `\\externo`, `https://externo`) bastam. O repositório já tem esse formato em `src/lib/supabaseError.test.ts`.

## Também nestes arquivos, se der (🟢)

- O `<button>` sem nome acessível ao lado de "XP do mês", no cartão de XP do diário público (`DailyReport.tsx`).
- Os `text-[10px]`/`text-[9px]` de `DailyReport.tsx` — ver a exceção no topo.

## Fora de escopo (anote, não faça)

- A varredura de `text-[Npx]` no resto do app e o `.text-eyebrow` do kit — **é da Tarefa N**.
- Subir `react-router` — **é da Tarefa O**.
- Qualquer teste em `e2e/` — **é da Tarefa P**.
- Decompor `DailyReport.tsx` (é grande), unificar `sonner` × `use-toast`, mexer no cron.

## Critérios de aceite

- `npm run typecheck` · `npm run lint` (0 erros, no máximo os 7 avisos pré-existentes) · `npx vitest run` (183 testes hoje, mais os seus) · `npm run build` verdes.
- O detector de versão provado nos **dois** sentidos (item 1).
- O envio do diário conferido **no banco**, com a consulta escrita no handoff (item 2).
- `resolveLink` com teste (item 3).
- **Não publique.** A Tarefa O publica por último nesta rodada, porque o bump de dependência dela muda o bundle. Se O não for rodar, publique você: `npx vercel deploy --prod --yes --archive=tgz --scope alissons-projects-b1faee75` — os três argumentos importam, o handoff-J §7 explica por quê — e confira o hash de `curl -s https://faceimob.vercel.app/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'` contra o do `dist/index.html`.

## Entrega

Não commite. Escreva `docs/prompts/handoff-M.md`: o que o detector de versão comparava e o que passou a comparar, a prova dos dois sentidos; o que a tela do diário fazia com data de dia anterior e o que faz agora, com a consulta ao banco; os formatos que o `resolveLink` recusa; e — se você achar que a correção histórica do diário precisa existir de verdade — o que ela exigiria.
