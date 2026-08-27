# Tarefa L — Dívida residual: trocar o `xlsx` (S06) e terminar o A05

> Contexto do agente: **limpo**. Tarefa curta (uma a duas horas). As Tarefas A–K já foram entregues; a URL do cliente está no ar em https://faceimob.vercel.app. A Tarefa **J roda em paralelo** neste diretório — ela não toca `src/`, mas **publica**: avise no handoff se você publicar, e confira o hash no fim.

## Contexto
- Repo: `C:\Users\Alisson\CascadeProjects\FACEIMOB`, branch `nova`. Leia `.claude/CLAUDE.md`, `.claude/rules/{code-style,security}.md`, `docs/design-system.md`, e as linhas **S06** e **A05** da tabela em `docs/auditoria-2026-08-21.md`. Leia também `docs/prompts/handoff-G.md` §6 (por que o S06 ficou de fora) e `handoff-D.md` §4 (a regra de adoção do `describeError`).
- **Você pode editar:** `package.json`, `package-lock.json`, `src/components/leads/importSheet.ts`, `src/pages/SdrModule.tsx`, e os arquivos que ainda usam `error.message` cru nos toasts (`src/pages/Equipes.tsx`, `AdminLeadAutomation.tsx`, `Links.tsx`, `DataManagement.tsx`, `Resultados.tsx`, `Marketing.tsx`, `Settings.tsx`, `AdminIntegrations.tsx`, `AdminPermissions.tsx`, `AdminAllowedIps.tsx`, `AdminDevelopers.tsx`, `AdminDailyTeams.tsx`, `Gamification.tsx`, `Checkpoint.tsx`, `DailyReport.tsx` e correlatos), mais `src/lib/supabaseError.ts` se precisar de um caso novo.
- **NÃO toque em:** `supabase/**`, `docs/demo/**`, `e2e/**` (agente J) · a decomposição já entregue de `components/{leads,pipeline,dashboard,shared,engagement}/**` — você só troca a chamada do parser em `importSheet.ts`, não redesenha o módulo.
- Sem hex e sem paleta literal. Erro de banco é `describeError`/`dbError` de `@/lib/supabaseError`.

## Entregas

### 1. S06 — a dependência de planilha (é o item de segurança)
`xlsx@0.18.5` do registro npm está **abandonado nessa versão** e carrega CVE-2023-30533 (prototype pollution) e CVE-2024-22363 (ReDoS). Ele parseia planilha enviada por terceiro em dois lugares: `src/components/leads/importSheet.ts:11` (importação de leads) e `src/pages/SdrModule.tsx:14`.

Duas saídas — **escolha uma e justifique no handoff**:
- **(a) SheetJS oficial**, que corrigiu as duas CVEs mas publica fora do npm (`https://cdn.sheetjs.com/xlsx-<versão>/xlsx-<versão>.tgz` como `dependencies`). Menor diff: a API não muda. Custo: a instalação passa a depender de um host que não é o registro npm — registre isso no `README` e em `decisoes.md`, porque afeta qualquer máquina que rode `npm i`.
- **(b) `exceljs`** (ou equivalente mantido no npm). Diff maior — a leitura de worksheet muda — mas a origem da dependência continua sendo o registro. `importSheet.ts` já isola o parser: é o único lugar que precisa mudar de forma real.

Regra que vale para as duas: **os limites que o G colocou em `importSheet.ts` (tamanho e número de linhas) ficam.** Eles reduzem superfície e continuam valendo depois da troca.

Depois: `npm audit --omit=dev` não pode mais acusar `xlsx`. Cole a saída no handoff (antes e depois).

### 2. A05 — terminar os toasts em português
São os 30–45 toasts que ainda mostram o erro cru do Postgres para o usuário ("new row violates row-level security policy for table ..."). O helper existe desde a Tarefa D: `describeError` em `src/lib/supabaseError.ts`, com teste.

**A regra de adoção (do handoff-D §4), que não pode ser pulada:** se o erro vier de uma função que faz `throw new Error(error.message)`, troque essa função por `dbError(label, error)` **primeiro** — senão o `code` do Postgres se perde no caminho e todo erro cai no texto genérico, o que é pior que hoje porque parece corrigido.

Não invente mensagem nova para código que o helper já cobre; se aparecer um `code` recorrente que ele não trata (RLS, unique, FK, check…), **acrescente o caso no `supabaseError.ts` com teste** em vez de escrever o texto na tela — é a fonte única.

### 3. Limpeza de documentação (rápido)
- `supabase/README.md`: a linha de contagem ("58 tabelas · 123 policies · 71 funções · 86 asserts") está velha — o harness de hoje imprime outros números (handoff-K §8.9). Rode `./scripts/validate-schema.sh --all` e escreva o que ele imprimir. A tabela de estrutura também pula da `0014` para a `0032`: acrescente as linhas `0015`–`0031`, `0033` e `0034` (uma frase cada, lendo o cabeçalho de cada migration).
- `docs/sprints/decisoes.md`: registre a decisão do item 1 (qual pacote, por quê, e o que muda no `npm i`).

## Fora de escopo (anote, não faça)
- `handle_new_auth_user` concede `broker` a toda conta nova (`0002`) — precisa de migration, e `supabase/**` não é seu.
- Decompor `Checkin.tsx` (290 linhas) e `LeadDetailModal.tsx` (489) — o handoff-G §6 diz onde cortar, mas é estética, não risco.
- Unificar os dois estilos de toast (`sonner` × `use-toast`) — toca tela demais para o momento.

## Critérios de aceite
- `npm run typecheck` · `npm run lint` (0 erros, no máximo os 7 avisos pré-existentes) · `npx vitest run` · `npm run build` verdes.
- **Teste real do parser, não só compilação:** importe uma planilha `.xlsx` e um `.csv` de verdade pela tela de Leads e confirme a contagem de linhas. Uma planilha de 3 linhas gerada na hora serve. Sem isso a troca de dependência não está verificada — anote o que você importou e o que apareceu.
- `npm audit --omit=dev` sem `xlsx` (saída antes/depois no handoff).
- Se publicar: `npm run build` e `npx vercel deploy --prod --yes`, e o hash de `curl -s https://faceimob.vercel.app/` batendo com o do `dist/index.html`. Se a Tarefa J publicar depois de você, tudo bem — o último build ganha, desde que contenha o seu.

## Entrega
Não commite. Escreva `docs/prompts/handoff-L.md`: qual pacote entrou e por quê, o que muda para quem roda `npm i`, o teste real da importação, quantos toasts adotaram o `describeError` e quais arquivos ficaram de fora, saída do `npm audit`.
