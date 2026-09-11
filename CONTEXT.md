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

**CCA** — a *tela* onde a análise de crédito acontece depois disso. Esteira Ágil
é o **evento**, CCA é a **tela**; a operação fala "esteira" para as duas coisas.
Ao escrever na interface, o nome da tela é **CCA**. *(Decisão de 10/09/2026.)*

---

## Jogo e período

**Temporada** — o ciclo do jogo. **Não é mês de calendário**: abre e fecha por
decisão de quem administra. Um mês corrido pode conter duas temporadas, e uma
temporada pode atravessar a virada do mês.

**Fechar a temporada** — congelar o ranking, travar o período e empurrar para o
ciclo seguinte o que ficou em aberto. É irreversível e é ato de administrador.

**Semana** — **filtro, não ciclo**. O jogo fecha por temporada; a operação
premia por semana, mas isso é **leitura**: a mesma pontuação da temporada,
recortada de segunda a domingo. Semana **não** congela ranking, não fecha nada e
não é ato de administrador.

> "Fechar a semana" não existe. Se alguém disser isso, quer dizer "olhar o
> ranking da semana".

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

**Papel efetivo** — com os papéis acumulados, quem decide uma autorização é
**um só**: o de maior precedência que a pessoa tem. Isso não é detalhe. Toda
conta nova ganha *corretor* de brinde e nunca o perde, então quase todo mundo é
corretor **mais alguma coisa** — e perguntar "ela tem o papel de corretor?"
responde "sim" para quase todo o cadastro, liberando o que não devia. A pergunta
que autoriza é "qual é o papel dela, afinal?".

- **Corretor** — atende lead, toca negócio, pontua no jogo.
- **Gerente** — tudo do corretor, mais a equipe: confere documento, lança
  diário, enxerga os números de quem está abaixo.
- **Diretor** — enxerga as equipes das quais é responsável.
- **Admin** — configura o sistema. Não é um degrau acima do diretor: é outro
  eixo.
- **Sócio** — **mesma permissão do Admin, sem exceção**. A operação quer dois
  nomes na tela, não dois níveis de acesso. *(Decisão de 10/09/2026: quando o
  cliente diz "administrador", o Sócio está incluído.)* Já houve uma tentativa
  de resolver isso transformando todo sócio em admin, e ela foi revertida —
  Sócio continua sendo um papel próprio; o que muda é a autorização responder
  por ele igual responde por Admin.

**Quem enxerga quem** sai de um lugar só. Se a hierarquia mudar, muda ali —
nunca tela por tela.

---

## Cofre de credenciais

**Cofre** — onde ficam as chaves das integrações de fora (WhatsApp, Meta,
e-mail, IA de voz). Vive no banco, num lugar que a API pública não expõe, e
**nunca devolve o valor gravado**: dá para escrever e para saber se o campo está
preenchido, nunca para ler de volta.

A consequência é a parte que já mordeu: colada a chave errada, ninguém mais vê o
valor para comparar. O que existe no lugar da leitura é o **teste de conexão** da
tela de integrações, que pergunta ao próprio provedor se a chave gravada funciona
— e, onde esse teste não é possível, a tela diz qual é o motivo. Sem apertá-lo, o
erro só aparece semanas depois, num log do provedor.

> "Configurado" no cofre quer dizer *tem alguma coisa aqui*, e não *tem a coisa
> certa aqui*.
