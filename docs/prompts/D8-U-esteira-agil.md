# Tarefa U — Esteira Ágil: o passo de revisão existe, mas o rótulo permite pular ele

> Contexto do agente: **limpo**. Roda **em paralelo com T**; as duas não compartilham nenhum arquivo.
> **Leia a seção "O que já existe" inteira antes de escrever uma linha.** O erro mais caro desta
> tarefa é construir de novo um fluxo que já está pronto, testado e no ar.

## Contexto

- Repo: `C:\Users\Alisson\CascadeProjects\FACEIMOB`, branch `nova`. URL no ar:
  **https://faceimob.vercel.app** (homologação `mcmqgxvtwegtptfseqvw`). Leia `.claude/CLAUDE.md`,
  `.claude/rules/{code-style,security}.md`, e `docs/prompts/handoff-R.md` §2.2 e §5 — a Tarefa R
  acabou de fazer exatamente este tipo de análise no mesmo vocabulário de status, e o raciocínio dela
  sobre "encerrar ≠ contar como perda" é o molde do que você vai fazer aqui.
- **O repositório está commitado** (`5943b45`, 27/08). O banco de homologação pode receber migration
  e semente sem cerimônia — não existe produção. Mas **os dados da demonstração estão nele**: não
  rode `showcase:limpar` sem avisar no handoff.
- **Você pode editar:** `supabase/migrations/` (arquivos novos), `supabase/seeds/`,
  `src/components/pipeline/**`, `src/lib/dealStatus.ts`, `src/lib/dealStatus.test.ts`,
  `e2e/admin/**`, `e2e/manager/**`, `e2e/broker/**`.
- **NÃO toque em:** `src/components/layout/AppLayout.tsx`, `src/components/NotificationBell.tsx`,
  `src/components/engagement/Podium.tsx` — **são da Tarefa T**, que roda agora.
- **Não publique.** A Tarefa T publica nesta rodada.

## O pedido do cliente, na letra

> "Me pediram uma etapa entre o corretor e o gerente, no envio para Esteira Ágil. Para revisão.
> Colocar essa etapa, quem valida é o gerente do corretor."

## O que já existe — conferido no banco e no código, não suposto

**A etapa está construída inteira**, na migration `supabase/migrations/20260810170000_0028_document_review.sql`,
cujo próprio cabeçalho diz: *"Conferência documental entre corretor e gerente"*.

| Peça | Onde | O que faz |
|---|---|---|
| Estado | `deals.document_review_status` | `draft` → `pending` → `approved` \| `returned` |
| Corretor envia | `submit_deal_for_manager_review(deal_id)` | só um **corretor do negócio** (ou admin); recusa se faltar documento obrigatório; **recusa se o negócio não tiver gerente vinculado**; notifica os gerentes |
| Gerente decide | `review_deal_documents(deal_id, approve, reason)` | devolução **exige motivo** e notifica os corretores; aprovação chama `submit_deal_for_analysis` **na mesma transação** |
| Trava de etapa | `deals_guard_stage()` | mover para `under_analysis`/`approved`/`contract`/`closed` sem aprovação levanta *"A documentação precisa ser aprovada pelo gerente antes de entrar no CCA."* |
| Trava de coluna | `deals_guard_document_review()` | as 6 colunas da conferência **só mudam pelas RPCs do fluxo** — `update` direto é recusado com 42501 |
| Tela | aba **Anexos** do modal do negócio | mostra "Aguardando gerente"; botões **"Aprovar e enviar ao CCA"** e **"Devolver"** com motivo obrigatório |
| Lista | `src/components/pipeline/DealFilters.tsx:84` + `Pipeline.tsx:98` | filtro "Aguardando gerente" e contador de pendências clicável |
| Rótulos | `src/components/pipeline/review.ts` | "Em preparação" / "Aguardando gerente" / "Devolvido" / "Conferido" |
| E2E | `e2e/broker/revisao-documental.spec.ts`, `e2e/manager/revisao-documental.spec.ts` | envio, aprovação com entrada no CCA, e devolução com motivo |

**E "Esteira Ágil" é esse mesmo evento.** O gatilho de gamificação
(`0010_gamification.sql:362`) pontua `'esteira'` quando `cca_cases.status` vira `'under_review'`, e
o rótulo desse evento na tela de Gamificação é literalmente **"Envio Esteira Ágil"**
(`src/pages/Gamification.tsx:42`). Ou seja: **o que o jogo chama de "Envio Esteira Ágil" é a entrada
no CCA, e ela já passa obrigatoriamente pela aprovação do gerente.**

**Conclusão: não construa o fluxo. Ele existe.** O que falta são três coisas, abaixo.

## Entrega 1 — 🟠 O rótulo "13. ESTEIRA AGIL" permite dizer que foi, sem ter ido

`deals.status_detail` é uma coluna de **texto livre**, sem trigger e sem constraint — conferido:
`grep status_detail supabase/migrations/*.sql` devolve só o `add column` e o `comment` da `0020`.

O catálogo de 32 rótulos (`src/components/pipeline/statuses.ts`) oferece no Select da tabela:

```
{ label: "13. ESTEIRA AGIL",  tone: "success" },
{ label: "RET. ESTEIRA AGIL", tone: "success" },
```

Qualquer pessoa que possa editar o negócio marca esses dois **sem conferência, sem CCA e sem
pontuação**. A tela passa a dizer "ESTEIRA AGIL" em verde para um negócio que nunca foi revisado e
não tem caso no CCA. **É a mesma classe do "19. REPROVADO" que a Tarefa R acabou de fechar:** um
rótulo que promete um fato que o sistema sabe verificar.

**Hoje não há nenhum negócio nesse estado na homologação** (medido: 0 rotulados com esteira, 31
negócios, 12 com caso no CCA) — então isto é buraco estrutural, não incêndio. **Muito provavelmente é
o que motivou o pedido do cliente:** alguém viu, ou temeu ver, um negócio marcado como esteira sem
ter passado pelo gerente.

**Decida com evidência, e escreva a decisão com as consequências.** Dois caminhos honestos:

- **(a) Travar os dois rótulos.** Eles saem do Select e passam a ser escritos pelo sistema quando o
  negócio entra no CCA (`under_review`) e quando volta. **Consequência:** a operação perde a
  capacidade de registrar o rótulo para negócio que foi à esteira **por fora** do sistema — e essa
  gente está migrando de planilha, onde escrever o rótulo à mão era o normal.
- **(b) Manter escolhível e fazer a tela contar as duas verdades.** O `document_review_status` já
  aparece como selo ("Aguardando gerente" / "Conferido") e já tem filtro. Bastaria o rótulo de
  esteira não poder ser *lido* como prova de que passou. **Consequência:** continua sendo possível
  marcar sem ter ido; o que muda é que a tela não mente mais, porque mostra os dois estados juntos.

**Não escolha por gosto.** Olhe: quem edita `status_detail` hoje (papel e caminho), o que o catálogo
diz de si mesmo no comentário do topo do arquivo (*"o vocabulário que a operação usa na planilha"*),
e se existe algum consumidor que lê esses dois rótulos como fato. Diga no handoff o que teria
acontecido no outro caminho.

**Deixe a decisão travada em teste**, como a R fez: `statuses.test.ts` já reprova quem acrescenta
rótulo ao catálogo sem decidir o que ele significa. Estenda o mesmo padrão para o que você decidir
aqui — senão o próximo rótulo de esteira volta pelo mesmo lugar.

## Entrega 2 — 🔴 A demonstração não consegue mostrar o passo que o cliente pediu

Medido na homologação agora:

```
document_review_status | quantos
-----------------------+--------
approved               | 25
draft                  |  6
pending                |  0     <-- nenhum
returned               |  0     <-- nenhum
```

**Não há um único negócio aguardando conferência.** O contador de pendências do Pipeline mostra zero,
o filtro "Aguardando gerente" não devolve nada, e o botão "Aprovar e enviar ao CCA" não aparece em
lugar nenhum. **Um cliente que abrisse o sistema hoje concluiria que o passo não existe — que é
exatamente o que ele concluiu.**

Ponha o cenário na semente (`supabase/seeds/`, que é catálogo em 4 fases e **idempotente** — mantenha
assim):

- **um negócio em `pending`**, de um corretor cujo gerente é o gerente da equipe dele, com os
  documentos obrigatórios anexados, para o gerente aprovar **ao vivo** na demonstração e ver o
  negócio entrar no CCA e a comemoração/pontos saírem;
- **um negócio em `returned`**, com motivo escrito, para mostrar o outro lado (o corretor vê a
  devolução e o motivo).

**Duas armadilhas do banco, e as duas vão te morder se você ignorar:**

1. **`deals_guard_document_review()` recusa `update` direto nessas colunas** (42501) para qualquer
   `current_user` que não seja `postgres` ou `service_role`. Semente que roda por
   `supabase db query --linked` passa; semente que roda como usuário comum, não. Confirme por qual
   caminho a sua semente executa antes de escrever o SQL.
2. **`submit_deal_for_manager_review` exige documento obrigatório.** Um `pending` sem anexo é um
   estado que o fluxo real não produz — não crie um cenário que a aplicação não conseguiria criar,
   porque ele engana quem for testar depois.

Prefira **chegar ao estado pelas próprias RPCs** em vez de escrever as colunas na mão: o cenário fica
igual ao real e você prova o fluxo de quebra. Se não der, diga por que não deu.

**Atualize `docs/demo/roteiro-cliente.md`** com o trecho novo: onde clicar, o que o gerente vê, o que
o corretor recebe. Este é o pedido explícito do cliente — ele vai querer ver funcionando.

## Entrega 3 — 🟠 "August 2026" está no ar, na tela de Gamificação

`close_game_season` (`0032_game_cycle_month.sql:154-158`, herdado da `0010:291`) grava o rótulo da
temporada seguinte com `to_char(current_date + 1, 'TMMonth YYYY')`. O `lc_time` do projeto é
`en_US.UTF-8`, então sai **em inglês** numa tela em pt-BR. A Tarefa O corrigiu o dado à mão
(`July 2026` → `Julho 2026`), mas **a origem continua lá** e o próximo fechamento automático traz o
problema de volta.

E a Tarefa Q confirmou que já está visível: o `PageHeader` da Gamificação mostra hoje
*"Temporada **August 2026** · 01/08/2026 → em andamento"*.

**A correção já foi pesquisada e testada no banco pela Tarefa O** (`handoff-O.md` §5.2), inclusive o
caminho que **não** funciona:

- `set lc_time = 'pt_BR.UTF-8'` na função é **recusado pelo container** — o locale não está instalado.
- O que funciona, determinístico e sem depender de ambiente:

```sql
(array['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
       'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'])
  [extract(month from d)::int] || ' ' || extract(year from d)::text
```

Faça a migration nova (`0035`), aplique na homologação, **e corrija o `August 2026` que já está
gravado**. Confira depois que a tela mostra o rótulo em português.

## Entrega 4 — medir a divergência do aprovador, **sem mudar a regra**

Aqui está a única coisa que o pedido do cliente descreve e que o código faz **diferente** — e é uma
decisão de produto que **não é sua**.

`review_deal_documents` autoriza assim:

```sql
if not public.is_admin() and not exists (
  select 1 from public.deal_participants dp
  where dp.deal_id = p_deal_id and dp.profile_id = auth.uid() and dp.role = 'manager'
)
```

Ou seja: **um gerente participante do negócio** (o do rateio), ou admin. O cliente disse
**"o gerente do corretor"**, que no modelo do banco é outra coisa: `teams.manager_id` da equipe em que
o corretor está por `team_members`.

**Hoje elas coincidem** — medido na homologação: dos **34** pares corretor×negócio, em **34** o
gerente da equipe do corretor está entre os gerentes do negócio; **zero divergência**, zero negócio
sem gerente, zero corretor sem gerente de equipe. Mas isso é propriedade dos **dados**, não regra: o
formulário do negócio deixa escolher qualquer gerente no rateio.

**O que você faz:** escrever no handoff, com SQL e números, **em que situações elas divergem** — pelo
menos estes três casos, e qualquer outro que você encontrar:

1. o rateio nomeia um gerente de outra equipe (o formulário permite);
2. o negócio tem dois corretores de equipes diferentes — aí existem **dois** "gerentes do corretor";
3. o corretor muda de equipe depois do negócio criado.

E dizer, para cada uma das três regras possíveis, o que quebra:

- **manter como está** (gerente participante);
- **trocar** para gerente da equipe do corretor — cuidado: `submit_deal_for_manager_review` hoje
  recusa envio se não houver gerente **participante**; com a regra nova essa checagem tem de mudar
  junto, senão o negócio trava de um jeito novo;
- **aceitar os dois** (participante **ou** gerente da equipe do corretor) — mais largo, nenhum
  negócio trava, e é ampliação de autorização.

**Não implemente nenhuma das três.** Autorização em RPC `security definer` não se altera por
iniciativa de agente. Entregue a medição e as consequências; a decisão volta do Alisson e vira tarefa
própria.

## Fora de escopo (anote, não faça)

- O popover do sino e o `num()` do pódio — **Tarefa T**.
- A correção histórica do diário e o calendário vermelho do Histórico (`handoff-M.md` §5 e §6). É
  migration, mas é outra decisão de produto.
- Mover `tailwindcss-animate` para `devDependencies` (`handoff-O.md` §8).
- Publicar.

## Critérios de aceite

- `npm run typecheck` · `npm run lint` (0 erros, no máximo os 7 avisos pré-existentes) ·
  `npx vitest run` (**199 testes em 15 arquivos** hoje, mais os seus) · `npm run build` verdes.
- `./scripts/validate-schema.sh --all` verde (precisa de Docker) — você criou migration.
- `npx playwright test e2e/broker/revisao-documental.spec.ts e2e/manager/revisao-documental.spec.ts`
  verdes, e um teste novo cobrindo a sua decisão da Entrega 1.
- A semente continua **idempotente**: rodar duas vezes não duplica nada. Prove com contagem.
- Na homologação: um negócio em `pending`, um em `returned`, e a temporada com rótulo em português.

## Entrega

Não commite. Escreva `docs/prompts/handoff-U.md`: **primeiro**, uma frase dizendo se você confirmou ou
refutou que a etapa já existia (se refutou, mostre onde eu errei); a decisão da Entrega 1 com o que
teria acontecido no outro caminho; como você chegou ao `pending` e ao `returned` e por qual caminho a
semente escreve; a migration `0035` e a conferência na tela; e a medição da Entrega 4 com o SQL, os
números e as consequências das três regras — essa última é o que vai virar a próxima decisão, então
escreva para alguém decidir lendo só ela.
