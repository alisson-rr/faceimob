# Instruções do projeto

## Contexto

- Nome: FACEIMOB
- Objetivo: CRM da operação imobiliária — roleta de distribuição de leads com trava de atendimento, check-in por IP e turno, pipeline de negócios com rateio automático de VGV, esteira de crédito (CCA), SDR por IA, diário de equipe e gamificação. Substitui a stack anterior em Bubble/N8N; nada foi importado do banco antigo.
- Stack: React 18 + TypeScript 5 + Vite 5, Tailwind + shadcn/ui (Radix), TanStack Query, React Router 6, Recharts, framer-motion. Backend Supabase (Postgres com RLS, Auth, Storage, Edge Functions em Deno, pg_cron). Vitest para testes de front; Electron empacota a versão desktop.
- Arquitetura:
  - `src/pages/` uma tela por rota · `src/components/` compartilhados, com `ui/` = primitivos shadcn · `src/contexts/AuthContext.tsx` = sessão e papéis.
  - `src/integrations/supabase/`: `client.ts` (cliente), `types.ts` (**gerado** por `supabase gen types` — não editar à mão), `newSchema.ts` (ponte que traduz o schema novo para a forma legada que as telas esperam: `broker1/2/3`, `manager1/2/3`, `cotista2`), `leads.ts`.
  - `supabase/migrations/` é a fonte de verdade do domínio: 18 migrations numeradas `0001`–`0018`, 58 tabelas, RLS em todas. `supabase/functions/` = 11 edge functions, mais `_shared/` (cofre de credenciais e Brevo). `supabase/tests/` = harness SQL de asserts. `supabase/seeds/` = catálogo em 4 fases, idempotente. `supabase/migrations_legacy/` é histórico, não é aplicado.
  - Invariantes do banco: papel é N:N em `user_roles` (um diretor pode ser gerente e corretor); toda visibilidade sai de `auth_visible_profiles()` — mudar hierarquia é mexer em um lugar só; a superfície anônima são exatamente três RPCs (`public_daily_team`, `public_daily_submit`, `public_director_checkpoint`).
- Estado e prioridades: `PLANEJAMENTO.md` (placar por requisito e fases). O gap declarado é frontend e integrações, não banco.
- Fonte de verdade das tarefas: `docs/sprints/` — `plano-entrega.md` (plano ativo) e `decisoes.md` (decisões tomadas e pendentes). `sprint-01.md`…`sprint-05.md` são histórico.
- Instalar: `npm i`
- Desenvolver: `npm run dev`. Supabase local: `npm run db:start` / `db:reset`. Seed remoto: `npm run db:seed:remote`.
- Validar: `npm run lint` · `npm run typecheck` · `npx vitest run` · `./scripts/validate-schema.sh --all` para migrations, RLS e asserts SQL (precisa de Docker, não usa a CLI do Supabase).

**Armadilha do typecheck:** `npx tsc --noEmit` na raiz **não checa nada**. O `tsconfig.json` tem `"files": []` e usa project references; sem `-b` o tsc não segue as referências e sai com 0 sem olhar arquivo nenhum. Use `npm run typecheck` (que aponta para `tsconfig.app.json` e `tsconfig.node.json`). O `npm run build` é `vite build` puro e também não faz typecheck — o esbuild só acusa erro de sintaxe, não de tipo.

Armadilha do ambiente: tudo com prefixo `VITE_` é substituído em build e vai para o bundle do navegador. Segredo de servidor vive só em secret de edge function ou em `private.integration_credentials`.

## Comunicação

- Responda em português brasileiro, de forma direta e prática.
- Comece pelo resultado ou pela decisão; detalhe apenas o necessário.
- Informe suposições que alterem o resultado e riscos que ainda existam.
- Não trate uma hipótese como fato. Aponte a evidência usada.
- Sempre falei de forma clara e objetiva. Quando conveniente use exemplos práticos.
- Sempre que houver decisões comente "consequências" de seguir cada caminho.
- Quando houver um erro ou problema de validação, sempre me traga alternativas de soluções.

## Forma de trabalhar

1. Entenda o pedido, os critérios de aceite e o fluxo afetado.
2. Leia as instruções aplicáveis e inspecione o estado atual antes de editar.
3. Preserve alterações do usuário e evite arquivos fora do escopo.
4. Corrija a causa raiz no ponto compartilhado mais estreito possível.
5. Implemente o menor diff completo e seguro.
6. Rode a menor validação capaz de detectar uma regressão real.
7. Entregue um resumo com mudanças, validações e pendências.

Pergunte somente quando faltar uma decisão que mudaria materialmente a solução. Para detalhes seguros e reversíveis, faça a suposição mais conservadora e siga.

## Graphify: contexto antes de arquivos

- Quando `graphify-out/graph.json` existir, comece perguntas sobre o codebase com `graphify query "<pergunta>"`.
- Use `graphify path "<A>" "<B>"` para rastrear relações e `graphify explain "<conceito>"` para um nó específico.
- Se existir `graphify-out/wiki/index.md`, use-o para navegação ampla. Leia `GRAPH_REPORT.md` apenas para revisões de arquitetura ou quando a consulta não bastar.
- O grafo orienta a busca, mas o código-fonte confirma o comportamento antes de qualquer edição.
- Depois de mudanças estruturais em código, rode `graphify update .`. Não reconstrua o grafo para uma alteração trivial de texto.

## Simplicidade com Ponytail

- Em tarefas de código, use o Ponytail em modo `full` quando o plugin estiver disponível.
- Reutilize primeiro o que já existe; depois biblioteca padrão, recurso nativo e dependência já instalada. Crie código novo somente se esses níveis não resolverem.
- Não adicione abstrações, configurações, camadas ou dependências para necessidades hipotéticas.
- A menor solução ainda precisa preservar validação, segurança, tratamento contra perda de dados e acessibilidade.
- Se um atalho consciente tiver limite real, registre `ponytail: <limite>; evoluir quando <condição mensurável>`.

## Limites e segurança

- Não execute ação destrutiva, publique, envie mensagens, altere permissões ou mexa em produção sem autorização explícita.
- Nunca exponha segredos. Use variáveis de ambiente e mantenha apenas `.env.example` versionado.
- Valide entradas nas fronteiras, aplique autorização no recurso e use consultas parametrizadas.
- Não silencie erros nem enfraqueça verificações apenas para fazer testes passarem.

## Definição de pronto

Uma tarefa termina quando o comportamento pedido funciona, a validação relevante passou, não há mudanças colaterais conhecidas e a entrega explica qualquer risco ou passo manual restante.
