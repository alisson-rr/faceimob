# Glossário do FACEIMOB

Vocabulário do domínio. **Só termos** — nada de tabela, função ou arquivo: isso
vive em `PLANEJAMENTO.md`, `docs/sprints/` e no próprio código.

Um termo entra aqui quando alguém já se confundiu com ele, ou quando o sentido
no FACEIMOB é diferente do sentido óbvio da palavra.

---

## Vencimento — a palavra vale para duas coisas

Esta distinção derrubou uma conversa inteira em 01/09/2026. Os dois mecanismos
existem, são independentes, e **nenhum dos dois encosta no outro**.

### Lead vencido

O corretor pegou o lead e **não atendeu dentro do prazo**. O lead volta para a
fila e é oferecido ao próximo da vez.

É automático, é do sistema, e o corretor não escolhe nada — só perde a vez.

### Atividade vencida

Um **compromisso que a pessoa marcou para ela mesma**, dentro de um lead ou de
um negócio, e cuja data passou. *"Ligar para o João quinta às 14h."*
*"Levar o contrato assinado até dia 10."*

É manual, é da pessoa, e nada acontece sozinho quando vence — o valor está em
**alguém ver que venceu**.

> Ao falar, use **"lead vencido"** e **"atividade vencida"** por extenso.
> "Venceu" sozinho é ambíguo neste projeto.

---

## Fila, roleta e trava

**Roleta** — a distribuição automática de leads entre os corretores presentes.
Não é sorteio: é ordem de fila.

**Fila** — os corretores que fizeram check-in e estão aptos a receber lead,
na ordem em que vão receber. Sair da fila é fazer check-out, ser bloqueado, ou
o turno terminar.

**Trava de atendimento** — o intervalo em que um lead recém-distribuído fica
reservado para um corretor só. Enquanto dura, mais ninguém pega. Quando acaba,
o lead está *vencido* (ver acima).

**Check-in** — declarar presença para entrar na fila. Só vale dentro da janela
de um turno e a partir de um endereço de rede autorizado. Presença é o estado;
check-in é o ato de abri-la.

---

## Negócio, rateio e conferência

**Negócio** — a venda em andamento, depois que o lead virou oportunidade real.
Um negócio tem mais de um dono.

**Rateio** — a divisão do valor do negócio entre as pessoas que participaram.
Fecha em 100%; é o rateio, não o cadastro do lead, que define quem ganha
comissão e quem pontua.

**Conferência documental** — o passo em que o **gerente confere os documentos
do corretor antes de o negócio seguir para análise de crédito**. O corretor
envia, o gerente aprova ou devolve. Devolução exige motivo.

Quem aprova é **gerente do rateio daquele negócio** — não necessariamente o
gerente da equipe do corretor. *(Decisão de 01/09/2026: fica assim.)*

**Esteira Ágil** — o nome que a operação dá à entrada do negócio na análise de
crédito. É o **mesmo evento** que a aprovação da conferência documental
dispara: não são dois passos, são dois nomes para a fronteira entre o corretor
e o crédito.

---

## Jogo e período

**Temporada** — o ciclo do jogo. **Não é mês de calendário**: abre e fecha por
decisão de quem administra. Um mês corrido pode conter duas temporadas, e uma
temporada pode atravessar a virada do mês.

**Fechar a temporada** — congelar o ranking, travar o período e empurrar para o
ciclo seguinte o que ficou em aberto. É irreversível e é ato de administrador.

---

## Diário e checkpoint — não são sinônimos

**Diário** — o lançamento **da equipe, feito pelo gerente, sobre o dia de
hoje**: quantos leads, quantos atendimentos, quantas vendas. Entra por um link
público protegido por PIN, sem login.

**Checkpoint** — a **leitura consolidada** desses números por quem está acima:
o gerente vê a equipe, o diretor vê as equipes todas.

Diário é escrita; checkpoint é leitura. O mesmo número aparece nos dois.

---

## Papéis

Papel é **acumulável**: a mesma pessoa pode ser diretor, gerente e corretor ao
mesmo tempo, e isso é o caso normal, não a exceção.

- **Corretor** — atende lead, toca negócio, pontua no jogo.
- **Gerente** — tudo do corretor, mais a equipe: confere documento, lança
  diário, enxerga os números de quem está abaixo.
- **Diretor** — enxerga as equipes das quais é responsável.
- **Admin** — configura o sistema. Não é um degrau acima do diretor: é outro
  eixo.

**Quem enxerga quem** sai de um lugar só. Se a hierarquia mudar, muda ali —
nunca tela por tela.
