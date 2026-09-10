# Tarefa P — A rede de segurança que falta: perder negócio, teclado, e limpar o `e2e:remote`

> Contexto do agente: **limpo**. Roda **em paralelo com M, N e O**. Você é o único que mexe em `e2e/`; eles são os únicos que mexem em `src/` e `package.json`. **Importante:** enquanto eles editam `src/`, sua suíte vai falhar de forma intermitente por motivo que não é seu. Leia a seção "Como conviver com as outras tarefas" antes de começar a debugar.

## Contexto

- Repo: `C:\Users\Alisson\CascadeProjects\FACEIMOB`, branch `nova`. Leia `.claude/CLAUDE.md`, `e2e/README.md`, e `docs/prompts/handoff-J.md` §2 inteira — a J acabou de reparar 20 arquivos da suíte depois da decomposição de G/H/F e explica por que cada seletor quebrou. **Não redescubra isso.**
- **Você pode editar:** `e2e/**` e `playwright.config.ts`.
- **NÃO toque em `src/`** — três tarefas estão lá. Se um teste seu falhar por defeito do produto, **descreva no handoff** com arquivo, linha e reprodução; não conserte.
- **NÃO rode contra a homologação** até o item 3 existir e estar provado no alvo local. O item 3 é justamente o que torna isso seguro.

## Estado de onde você parte

A J deixou a suíte em **136 testes, 134 passando**. As 2 que falham (`broker/trava-atendimento.spec.ts:63` e `:80`) **passam quando o arquivo roda sozinho** — são flaky, não regressão, e o item 4 é sobre elas. **Zero `test.skip`**; mantenha assim.

## Entrega 1 — perder negócio (F14) — é o primeiro da fila e a J foi explícita

**O buraco:** era um interruptor que encerrava o negócio num clique. A Tarefa H trocou por um `AlertDialog` com **motivo obrigatório**. E `grep -rn 'perder\|DISTRATO\|QUEDA' e2e/**/*.spec.ts` **não acha nada**.

É a mudança de maior risco do Pipeline **sem nenhuma cobertura**. A J leu o código e disse que parece certo — leitura não é teste.

O que o teste tem de cobrar, no banco e não só na tela:

- Perder um negócio **exige** confirmação: pedir para perder sem confirmar não muda `deals`.
- O motivo é **obrigatório**: confirmar sem motivo não grava.
- Com motivo, `deals` reflete a perda **e o motivo fica registrado onde a tela promete** — confira onde o `LoseDealDialog` manda, não onde você imagina.
- **Cancelar o diálogo não deixa efeito colateral** (é o caso que costuma escapar: fechar o diálogo depois de já ter mexido no estado local).

`e2e/admin/pipeline-negocio.spec.ts` é o vizinho mais próximo e já cria negócio pela tela conferindo `deals`, `deal_clients` e `deal_participants`. Siga o feitio dele.

## Entrega 2 — o gesto de mover o cartão

**Nenhum dos dois caminhos foi exercitado de verdade:**

- **Teclado (`Shift+←/→`)** — `DealCard.tsx:40-56` faz o cartão `role="button"` com `tabIndex`, Enter/Espaço abre, `Shift+←/→` chama o mesmo `onMove` do `onDrop`, e seta sozinha é ignorada de propósito. **Ninguém apertou a tecla** — nem a J, nem a suíte. Este é fácil e é o que o Playwright faz bem: focar e apertar tecla é gesto real, não evento sintético.
- **Arrastar com o mouse** — a suíte dispara `dragstart`/`drop` sintéticos (`broker/etapas.spec.ts`). O **efeito** está provado nos dois sentidos (etapa permitida grava, etapa negada avisa e não grava); o **gesto** não. Melhorar isso exige `mouse.down/move/up` de verdade e é notoriamente instável com HTML5 drag-and-drop. **Tente uma vez.** Se ficar instável, **deixe o sintético e escreva no handoff que o gesto continua descoberto** — teste flaky é pior que buraco conhecido.

Cubra também a regra do teclado que é fácil de quebrar numa refatoração: **seta sem `Shift` não move**.

## Entrega 3 — `deprovisionE2EUsers()`, para o `e2e:remote` voltar a ser usável

**É a entrega mais valiosa desta tarefa**, e o motivo pelo qual a J não rodou contra a homologação:

`provisionE2EUsers()` cria **10 contas `e2e.*@faceimob.test` e 2 equipes** (`Equipe E2E Alfa` e `Beta`) no banco alvo, e **não existe o inverso**. Rodar contra a homologação hoje coloca "E2E Corretor" nas listas de equipe e soma 5 corretores à contagem que o cliente vê. Pior: um spec **encerra a temporada aberta do game** e a reabre no `afterAll` — se a execução for interrompida no meio (aconteceu duas vezes com a J), a homologação fica com a temporada **fechada** e o pódio da demonstração some.

Escreva o inverso e ligue no `globalTeardown`. Três coisas que decidem se isto presta:

1. **Tem de rodar mesmo quando a suíte falha ou é interrompida.** Teardown que só roda no caminho feliz não resolve o caso que a J descreveu — que foi exatamente uma interrupção. Confira o que o Playwright garante e o que não garante, e diga no handoff qual é o buraco que sobra.
2. **Apague só o que você criou**, por marcador explícito (o padrão `e2e.*@faceimob.test` e os nomes das duas equipes). Nunca por "criado recentemente", nunca por varredura ampla. O banco alvo pode ser a homologação com os dados da demonstração.
3. **A temporada do game precisa voltar ao estado anterior** mesmo com interrupção — é o que mais dói se ficar torto. Se não der para garantir pelo teardown, a alternativa honesta é o spec que fecha a temporada **não** rodar no alvo remoto; diga isso.

**Prove no alvo local:** conte perfis, equipes e temporadas antes; rode a suíte; conte depois; devem bater. Rode de novo **interrompendo no meio** (Ctrl+C) e conte outra vez. Cole os dois números no handoff.

## Entrega 4 — destravar `trava-atendimento`

**A causa já é conhecida** (handoff-J §2.1): o banco é um só e os crons estão rodando. `release_expired_leads()` passa a cada 30 s e devolve para a fila o lead que estourou o prazo; `trava-atendimento` cria justamente um lead com prazo curto e conta com ele na lista do corretor. Na execução completa há minutos entre o `beforeAll` e a asserção; isolado, segundos.

**Conserte o cenário do teste, não a aplicação, e não mascare com `retries`.** O caminho mais provável é o teste criar o seu lead no momento em que vai usá-lo, em vez de no `beforeAll` — mas confirme a causa antes, medindo, e não pelo que este parágrafo diz.

O `playwright.config.ts` já registra a dívida de fundo ("`ponytail`: paralelismo só volta com um banco por worker"). **Não resolva isso agora** — é outra escala de trabalho.

## Entrega 5 — o `.xls` recusado (🟢, se sobrar tempo)

A Tarefa L trocou o `xlsx` por `read-excel-file`, e com isso **`.xls` (Excel 97-2003) deixou de ser lido**. Foi tratado: a tela mostra *"Planilha no formato antigo (.xls). Abra no Excel e salve como .xlsx ou CSV."* e o seletor continua aceitando `.xls` **de propósito**, para o usuário descobrir o motivo em vez de o arquivo sumir da janela.

Existe teste em `importSheet.test.ts`, mas **nenhum cobra a frase aparecendo na tela**. É uma regressão visível que ninguém veria.

## Como conviver com as outras tarefas

M, N e O estão editando `src/` e `package.json` **enquanto você roda**. A J perdeu uma execução completa porque a L deixou `newSchema.ts` com erro de sintaxe por alguns minutos.

- Antes de cada execução longa: `npm run typecheck`. Se falhar em arquivo que não é seu, **espere** — não é regressão sua.
- Se um seletor quebrar em tela que a N está mexendo (cabeçalho, badges, rótulos), confirme com `git diff` antes de reescrever o seletor. Pode ser mudança legítima em curso.
- A O sobe o `react-router` no meio. Se rota parar de resolver depois disso, **é o bump, não o seu teste** — avise no handoff.

## Fora de escopo (anote, não faça)

- Um banco por worker para devolver o paralelismo.
- Cobrir `Checkin.tsx` e `LeadDetailModal.tsx`, que ninguém decompôs ainda.
- Teste do sino abrindo o lead por `?lead=<id>`: a J marcou como não reexecutado (§1.2, passo 4c) mas o contrato tem dois testes no `handoff-G` §7. Baixa prioridade — a menos que sobre tempo, aí é um teste barato.

## Critérios de aceite

- `npm run typecheck` · `npm run lint` (a suíte E2E entra nos dois) verdes.
- `npx supabase db reset && npx playwright test` no alvo local, com o placar em números: quantos passam, quantos falham, e **de que**. Suíte vermelha documentada vale mais que placar maquiado.
- **Zero `test.skip` novos.** Se pular algum, liste quais e por quê.
- O item 3 provado com as contagens antes/depois, **incluindo a execução interrompida**.
- **Não publique** — a Tarefa O publica por último nesta rodada.

## Entrega

Não commite. Escreva `docs/prompts/handoff-P.md`: o placar em números; o que o teste de perder negócio cobra e o que deliberadamente não cobra; se o gesto do mouse ficou coberto ou continua descoberto (e por quê); as contagens antes/depois do `deprovision`, com e sem interrupção, e qual buraco sobra; a causa medida do `trava-atendimento`; e qualquer defeito de produto que você tenha encontrado sem corrigir.
