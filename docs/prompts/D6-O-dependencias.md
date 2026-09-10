# Tarefa O — O `react-router` tem 4 avisos *high* de redirecionamento aberto, e é dependência de produção

> Contexto do agente: **limpo**. Tarefa curta (uma hora), mas é a de segurança desta rodada e é quem **publica por último**. Roda **em paralelo com M, N e P**; espere as três entregarem antes do item 5.

## Contexto

- Repo: `C:\Users\Alisson\CascadeProjects\FACEIMOB`, branch `nova`. URL no ar: **https://faceimob.vercel.app**. Leia `.claude/CLAUDE.md`, `.claude/rules/security.md`, e `docs/prompts/handoff-L.md` §2 — a Tarefa L acabou de fazer exatamente este tipo de troca com o `xlsx` e o raciocínio dela sobre "audit silencioso ≠ audit limpo" vale aqui.
- **Você pode editar:** `package.json`, `package-lock.json`, `docs/sprints/decisoes.md`, e aplicar **um** `UPDATE` no banco de homologação (item 4).
- **NÃO toque em `src/`** — as Tarefas **M** e **N** estão dentro de `src/` agora. Se o bump exigir mudança de código (não deve), **pare e escreva no handoff** em vez de editar. · `e2e/**` é da Tarefa **P** · `supabase/migrations/**` não é de ninguém nesta rodada.

## Por que esta tarefa existe

A Tarefa L fechou o `xlsx` porque o enunciado dela citava o S06 nominalmente. Ninguém olhou o resto do `npm audit --omit=dev`, e lá dentro está o achado maior: **`react-router-dom@6.30.1`, dependência de produção, com 4 avisos *high*** de redirecionamento aberto e XSS. O app tem rotas públicas anônimas (`/daily/<slug>`, `/diretor/<slug>`) numa URL que o cliente vai receber — redirecionamento aberto em URL pública é phishing pronto.

## Entrega 1 — o bump

**Já medi o remédio. Confira os números, não refaça a pesquisa:**

Subir `react-router-dom` de `^6.30.1` para **`^6.30.6`** — patch, mesma linha maior, **zero mudança de código**. Isso puxa `react-router@6.30.6` e `@remix-run/router@1.23.4`, e o `1.23.4` está **acima** da faixa vulnerável `<=1.23.2`.

Medido numa pasta limpa: o audit vai de **9 avisos de rota (4 *high*)** para **2 *moderate***.

Fecha, entre outros:
- `@remix-run/router` — *React Router vulnerable to XSS via Open Redirects* (GHSA-2w69-qvjg-hvjx)
- *React Router's same-origin redirect with path starting `//` causes open redirect via protocol-relative URL reinterpretation*
- *React Router has unexpected external redirect via untrusted paths*

**Atenção ao caminho errado:** `npm audit fix` **sem `--force` não faz este bump** — ele pula porque o resolvedor não considera a subida. E `npm audit fix --force` faz coisa **pior**: leva para `react-router-dom@7.18.2`, que é mudança maior. Faça o bump explícito no `package.json`.

## Entrega 2 — as 2 que sobram, e por que não migrar para o v7 agora

Depois do bump sobram duas *moderate*, e **as duas só têm correção no v7**:

| Aviso | Alcança este app? |
|---|---|
| **GHSA-337j-9hxr-rhxg** — *Arbitrary Constructor Injection via `deserializeErrors()` in React Router SSR Hydration* | **Não.** É caminho de hidratação de SSR. Este app é SPA pura em Vite: `grep -rn 'StaticRouter\|hydrateRoot\|renderToString\|createStaticHandler' src/` não acha nada. `deserializeErrors` não roda. |
| **GHSA-wrjc-x8rr-h8h6** — *Open redirect via backslash in `<Link>` e `useNavigate` (bypass do CVE-2025-68470)* | **Só com destino não confiável**, e existe **exatamente um** `navigate()` com valor não literal no app: `src/components/NotificationBell.tsx:74`, `navigate(resolveLink(item.link))`, com `item.link` vindo da coluna `notifications.link`. Nenhum `<Link to={}>` com valor variável. |

**A segunda está sendo fechada em paralelo:** a Tarefa **M** está pondo um guard em `resolveLink` que recusa `//host`, `\\host` e `https://host`. Validar o destino é a defesa certa aqui de qualquer forma — não confiar num remendo de biblioteca para um valor que vem do banco.

**Conclusão a registrar em `docs/sprints/decisoes.md`, com a data:** fica no 6.x com o patch; migrar para o v7 é sprint própria, não item de segurança. **Escreva isso**, senão o próximo `npm audit` reabre a discussão do zero e alguém migra major numa tarde.

**Se a Tarefa M não tiver entregado** quando você fechar: diga no handoff que a GHSA-wrjc **continua aberta na prática** até o guard existir. Não escreva que está resolvida por conta da análise — a análise diz que o vetor é estreito, não que ele está fechado.

## Entrega 3 — o resto do audit

Sobram, todos com correção sem quebra: `postcss`, `nanoid`, `yaml`, `lodash`, `glob`, `minimatch`, `brace-expansion`.

Rode o `npm audit fix` (**sem `--force`**) e depois **confira, um a um, quais são de produção e quais são de ferramenta de build**. `--omit=dev` já filtra, mas `postcss` e `nanoid` aparecem lá porque entram por caminho de runtime do Tailwind/Vite — vale dizer no handoff em qual metade cada um cai, porque "9 *high* em produção" e "9 *high* no build" são frases muito diferentes para quem lê depois.

Se algum não resolver sem quebra, **deixe aberto e escreva por quê**. Não force.

## Entrega 4 — o rótulo da temporada em inglês (🟢, 30 segundos)

Na homologação, `game_seasons.label` da temporada de julho é **"July 2026"** — inglês numa tela em pt-BR, herdado do fechamento automático. Só o rótulo; período e placar estão certos, e a temporada aberta ("Agosto 2026") está certa.

Um `UPDATE` na homologação resolve. **Vá na origem também:** se quem gera o rótulo no fechamento automático usa `to_char` sem locale ou formatação do lado do JS em inglês, o próximo fechamento traz o problema de volta. Ache quem escreve (`close_game_season` na `0032` é o candidato) e **diga no handoff onde está** — a correção é migration, e migration não é sua nesta rodada.

## Entrega 5 — publicar por último

Você é quem publica nesta rodada, porque o bump muda o bundle e faria as outras três republicarem por cima.

Espere M, N e P entregarem (ou confirme que não vão rodar). Então:

```bash
npx vercel deploy --prod --yes --archive=tgz --scope alissons-projects-b1faee75
```

**Os três argumentos importam** — sem `--scope` a CLI responde "Not authorized" mesmo logada, e sem `--archive=tgz` o envio morre com `fetch failed` no meio. Está no handoff-J §7.

Confira depois:

```bash
curl -s https://faceimob.vercel.app/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'
```

contra o do `dist/index.html`. E **abra a URL publicada** — pelo menos a tela de login, uma rota autenticada e `/daily/<slug>` — para confirmar que a navegação não regrediu com a versão nova do roteador. Bump de roteador que passa no build e quebra rota em runtime é o modo clássico de falhar aqui.

## Critérios de aceite

- `npm run typecheck` · `npm run lint` · `npx vitest run` · `npm run build` verdes.
- `npm audit --omit=dev` **antes e depois** colados no handoff.
- Nenhuma linha de `src/` alterada — `git diff --stat -- src/` vazio no seu escopo.
- As rotas abertas na URL publicada depois do deploy, com o que você viu escrito.
- A decisão do item 2 em `docs/sprints/decisoes.md`, com data.

## Entrega

Não commite. Escreva `docs/prompts/handoff-O.md`: audit antes/depois, o que o bump fechou e o que sobrou com o motivo de cada sobra, quais achados são de produção e quais são de build, o estado do guard da Tarefa M no momento em que você fechou, onde nasce o rótulo em inglês, e a conferência do que está no ar.
