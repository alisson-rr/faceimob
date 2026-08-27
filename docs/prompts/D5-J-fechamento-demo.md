# Tarefa J — Fechamento da demo: smoke de ponta a ponta, roteiro com números reais, entrega

> Contexto do agente: **limpo**. Uma sessão. É a última tarefa da sprint: nada de refatorar, nada de tela nova. O trabalho aqui é **provar que o caminho do cliente funciona do começo ao fim** e deixar a entrega apresentável. A Tarefa **L roda em paralelo** (ela mexe em `src/` e pode publicar) — combine o deploy final: **quem publicar por último confere o hash**.

## Contexto
- Repo: `C:\Users\Alisson\CascadeProjects\FACEIMOB`, branch `nova`. URL do cliente: **https://faceimob.vercel.app** (homologação `mcmqgxvtwegtptfseqvw`).
- Leia, nesta ordem: `docs/sprints/sprint-demo.md` (o placar), `docs/demo/roteiro-cliente.md` (o roteiro que a Tarefa C escreveu — está desatualizado), e os handoffs **G, H, K** (as três últimas entregas, que mudaram Leads, Pipeline/CCA e o envio do diário). Os handoffs A–F e I são consulta, não leitura obrigatória.
- A suíte de ponta a ponta já existe: `e2e/` com um *project* por papel (admin, diretor, gerente, corretor, CCA, SDR, marketing, anônimo) e `npm run e2e:remote`. Leia `e2e/README.md` antes de rodar.
- **Você pode editar:** `e2e/**`, `docs/demo/**`, `docs/sprints/**`, `docs/design-system/*.png`, `PLANEJAMENTO.md`, `supabase/README.md` **só se a Tarefa L não tiver feito**, e `scripts/demo.mjs`.
- **NÃO toque em `src/`.** Se o smoke achar um defeito, você **descreve** no handoff com arquivo, linha e como reproduzir — não conserta. Exceção única: um defeito que impeça o cliente de completar o caminho (tela branca, erro que bloqueia login, botão principal que não responde). Nesse caso conserte o mínimo, marque com `<!-- J: correção de bloqueio -->` no handoff e diga exatamente o que mudou.

## Entregas

### 1. Smoke real do caminho do cliente
O caminho é: **Login (senha e código) → Dashboard → Check-in → Leads (atender um lead) → Pipeline (mover negócio; venda → confete) → Gamificação (pódio) → RoleSwitcher (visão de corretor)**.

Percorra-o **no navegador, na URL publicada**, com o usuário do cliente. Em cada passo registre: funcionou / funcionou com ressalva / quebrou, com captura quando quebrar. Preste atenção especial ao que acabou de mudar:
- Leads: abrir o lead **pela linha da tabela** e **pelo sino** (`?lead=<id>`) — são dois caminhos, os dois têm que abrir o mesmo modal.
- Pipeline: mover no kanban **pelo mouse e pelo teclado**; perder um negócio (tem que pedir confirmação); criar/editar pelo `DealDetailModal` (o diálogo inline foi removido).
- CCA: o Select "Mover para…" aparece **sem hover** e no toque.
- Venda: o confete e o som saem **uma vez só** (o gatilho é realtime em `game_events`; se sair duas vezes, é bug e é o mais visível da demo).
- Diário público: envio com PIN certo grava; **com PIN errado a tela diz que falhou** (é a correção da Tarefa K — a tela antiga dizia "Checkpoint concluído").

### 2. A suíte automatizada
`npm run e2e:remote`. Ela não roda desde antes da decomposição de Leads e Pipeline: **espere seletor quebrado**, porque a estrutura de DOM mudou nas duas telas. Conserte os **seletores** (é `e2e/`, é seu); não conserte o app. Se um teste falhar por comportamento e não por seletor, isso é um achado — registre e siga.

Se a suíte estiver longe demais de verde para o tempo que você tem, **pare, e diga com números** quantos specs passam, quantos falham por seletor e quantos por comportamento. Suíte vermelha documentada vale mais que suíte "consertada" com `skip`. **Não use `test.skip` para fechar o placar** — se pular algum, liste quais e por quê.

### 3. Roteiro do cliente, com os números que estão no banco
`docs/demo/roteiro-cliente.md` foi escrito antes de G, H e K. Reescreva para bater com o que o Douglas vai ver hoje:
- Consulte o banco para os números reais (`npx supabase db query --linked`, ou o MCP se tiver): quantos leads, negócios, VGV do mês, quem está no pódio, qual temporada está aberta.
- Passo a passo numerado, com o que clicar e **o que esperar** em cada passo, incluindo som e confete (e o aviso de que o som pede um clique antes de tocar — política de áudio do navegador; está no handoff-B §9.1).
- Uma seção curta de **"o que ainda não está pronto"**, honesta: o que ele vai encontrar incompleto. Melhor ele ler isso do que descobrir clicando.
- Como entrar: e-mail, senha, e a alternativa por código.

### 4. Varredura de 375 px e tema claro
As telas novas (Leads, Check-in, Pipeline, CCA, Dashboard) foram capturadas pelos agentes, mas ninguém olhou o conjunto. Percorra as cinco em **375 px** e em **tema claro**, e liste o que está quebrado: transbordo horizontal, texto abaixo de 12 px, contraste ruim, coluna espremida. **Descreva, não conserte** (regra do topo). O handoff-H §10.5 já aponta um transbordo horizontal que escapa pelo `main` do `AppLayout` — confirme se ainda acontece e em quais telas.

### 5. Gravação de backup
Grave o caminho do item 1 em vídeo (qualquer captura de tela serve) e salve em `docs/demo/`. É o seguro contra "a internet caiu na hora da reunião" ou "o banco de homologação ficou fora do ar". Sem áudio narrado; o roteiro do item 3 é a narração.

### 6. Deixar o placar honesto
- `docs/sprints/sprint-demo.md`: status final de cada tarefa, e a lista do que sobrou aberto, com dono.
- `PLANEJAMENTO.md`: a auditoria achou 14 afirmações desatualizadas nos docs (`docs/auditoria-2026-08-21.md`, seção de inventário). Corrija pelo menos as que dizem que algo está pronto e não está — documento que mente é pior que documento vazio.
- Uma seção **"Próxima sprint"** no `sprint-demo.md`, juntando o que os handoffs G, H, K e L deixaram anotado como fora de escopo. É o ponto de partida da próxima conversa, não precisa estar priorizado.

### 7. Publicação final
Depois que a Tarefa L entregar (ou se ela não for rodar): `npm run build` e `npx vercel deploy --prod --yes`. Confira que o hash de `curl -s https://faceimob.vercel.app/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'` bate com o do `dist/index.html`, e **refaça o item 1 rapidamente contra o build final** — smoke feito num build que não é o publicado não prova nada.

## O que já é sabido (não precisa achar de novo)
- Os dois links públicos de diretor (`seed-diretoria-daniela`, `diretor-ricardo-sampaio`) estão **sem PIN**; fechar é ação manual do usuário na tela Admin · Diário. Se ainda estiverem abertos quando você passar, **repita o aviso no handoff**, em cima.
- O auto-cadastro do projeto remoto precisa ser desligado no painel (Authentication → Sign In / Providers). É manual, e é o item de segurança mais urgente que sobrou.
- As cores das etapas do CCA foram normalizadas no banco (chave semântica). "Pendência de Documentos" e "Reprovado" ficaram no mesmo tom (`danger`), assim como "Enviado à Construtora" e "Enviado à Agência" (`info`) — a paleta tem 6 tons. Dá para diferenciar pelo editor de estágio na própria tela; **cite no roteiro** se achar que confunde.
- 77 notificações represadas em `notifications` com `channel='whatsapp'` e `sent_at` nulo, com o cron pausado de propósito. **Não despause** (handoff-I §7.6).

## Critérios de aceite
- `npm run typecheck` · `npm run lint` · `npx vitest run` · `npm run build` verdes.
- O item 1 percorrido **na URL publicada**, com resultado passo a passo escrito.
- Números do roteiro conferidos contra o banco, não estimados.
- O vídeo existe e abre.
- Nenhuma credencial em arquivo, log, captura ou vídeo. **Confira o vídeo e as capturas antes de salvar** — senha digitada, token na barra de endereço e e-mail pessoal aparecem em gravação de tela com facilidade.

## Entrega
Não commite. Escreva `docs/prompts/handoff-J.md`: o resultado passo a passo do smoke, o placar da suíte E2E em números, a lista de defeitos achados (arquivo, linha, como reproduzir, gravidade), o que foi corrigido como bloqueio (se houve), e o estado final da publicação.
