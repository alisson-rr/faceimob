# Roteiro do cliente — FACEIMOB

Reescrito em **26/08/2026, 19h30 (Brasília)**, depois das Tarefas G (Leads e
Check-in), H (Pipeline e CCA) e K (envio do diário). Todos os números abaixo
saíram de consulta ao banco de homologação nesse horário — nenhum é estimativa.

- **URL:** https://faceimob.vercel.app — último build publicado em 26/08/2026,
  20h (deployment `faceimob-9vmd4uhxa`, bundle `assets/index-DWf46mx_.js`, hash
  conferido contra o `dist/` local).
- **Banco:** homologação (`mcmqgxvtwegtptfseqvw`). Não existe produção ainda.
- **Todos os dados são fictícios.** Nomes, telefones, CPFs e e-mails foram
  inventados; os domínios são `.invalid`, reservado pela RFC 2606 exatamente
  para isto. Nada aqui é de pessoa real.

---

## ⚠️ Três coisas antes de chamar o Douglas

Nenhuma delas é código. Sem as duas primeiras a demonstração não acontece.

### 1. A conta do cliente ainda não existe

Conferido no banco às 19h20 de 26/08: existem **23 perfis**, e a única conta com
e-mail real é a sua. Não há usuário do Douglas. **Sem criá-lo, o passo 1 deste
roteiro não tem como acontecer.**

A ordem importa — notificações, tarefas e presença são gravadas para a conta que
existir **no momento em que o cenário roda**:

```bash
node scripts/demo.mjs showcase:limpar --remote
```

```bash
npm run user:create -- -Email douglas@dominio-do-cliente.com.br -FullName "Douglas" -Role admin -Password
```

```bash
node scripts/demo.mjs showcase --remote
```

A senha é pedida na hora, oculta — não vai para o histórico do PowerShell. Se o
usuário já existir e só faltar a senha:

```bash
npm run user:create -- -Email douglas@dominio-do-cliente.com.br -SetPassword
```

O `showcase` vincula esse mesmo usuário como **corretor da Equipe Paulista** e o
coloca na fila geral, além de admin — papel é N:N no banco. É o que dá sentido
ao passo 7 e o que permite o check-in do passo 3.

### 2. Rode o cenário **dentro da janela de um turno**, pouco antes da demo

A presença dos colegas na fila (passo 3) só é criada quando há turno **aberto no
momento em que o seed roda**, e o cron de check-out automático a fecha ao fim do
turno. Às 19h20 de 26/08 o banco tinha **0 presenças abertas** — quem abrir o
Check-in agora vê a fila vazia.

Pior: os check-ins do cenário têm UUID fixo e o insert é `on conflict do
nothing`. Uma vez criados, **rodar `showcase` de novo não os recria** — é preciso
`showcase:limpar` antes. Por isso o preparo do item 1 já está na ordem certa.

| Turno | Check-in a partir de | Distribui a partir de | Fecha |
|---|---|---|---|
| Manhã | 08:00 | 08:30 | 12:00 |
| Tarde | 13:00 | 13:30 | 18:00 |
| Noite | 18:30 | 19:00 | 21:30 |

**Faça a demonstração entre a coluna "distribui" e a coluna "fecha".** Fora
disso o botão de check-in fica desabilitado e a fila aparece vazia — não é
defeito, é a regra de turno.

### 3. Dois links públicos de diretoria estão **sem PIN**

Conferido às 19h20: `seed-diretoria-daniela` e `diretor-ricardo-sampaio` têm
`pin_hash` nulo e estão ativos. Quem tiver o endereço lê a diretoria inteira —
e o slug é derivado do nome, ou seja, adivinhável. O bloqueio por tentativas
(migration 0034) **não protege link sem PIN**: não há segredo a adivinhar.

Abra **Admin · Diário** e clique em *Gerar PIN* nos dois antes de divulgar a URL.
Enquanto isso não for feito, evite mostrar a tela de links na frente de terceiros.

> Ainda pendente no painel do Supabase: **Authentication → Sign In / Providers →
> "Allow new users to sign up"** precisa ser desligado. O `config.toml` só vale
> para o stack local.

---

## O caminho

Sete passos. Cada um diz o que clicar e o que esperar.

> **Sobre o som:** o navegador só libera áudio depois de um clique ou tecla do
> usuário na página. Na prática isso já acontece sozinho durante a navegação,
> mas se você abrir o Pipeline direto de um F5 e arrastar o cartão sem ter
> clicado em nada antes, a fanfarra sai muda. **Clique em qualquer lugar da tela
> uma vez antes do passo 5.** O confete não depende disso.

### 1. Login

Abra https://faceimob.vercel.app — a rota `/` leva para a tela de entrada.

**O que você vê:** "Entrar no CRM", campos **E-mail** e **Senha**, botão
**Entrar** e, abaixo de um divisor "OU", **Receber código por e-mail**.

Entre com e-mail e senha. O código por e-mail é a alternativa — ele só chega se
o SMTP estiver configurado (ver "O que ainda não está pronto"); a senha não
depende disso.

> Erro de senha diz sempre **"E-mail ou senha inválidos."**, sem distinguir
> e-mail inexistente de senha errada. É de propósito: a tela não pode virar um
> verificador de quem trabalha na empresa. *(Conferido na URL publicada em
> 26/08.)*

### 2. Dashboard

Cai direto nele depois de entrar. O filtro de período abre em **08/2026** — o
mês aberto mais recente; 05/2026 e 06/2026 estão fechados.

Os seis cartões da régua de indicadores:

| Cartão | Valor esperado | O que é |
|---|---|---|
| **Leads** | **73** | total na base, sem filtro de mês |
| **Produção** | **17** | propostas em aberto no mês |
| **Resultado** | **7** | vendas fechadas no mês |
| **Perdas** | **1** | quedas e distratos do mês |
| **Negócios** | **24** | vendas + propostas |
| **VGV** | **R$ 3.081.520,00** | valor das vendas do mês |

Abaixo, o card **Meta do mês** mostra **7 de 14** (metade) e o rótulo "Abaixo da
meta"; ao lado, o funil de vendas; e a lista por construtora. As abas
**Propostas** e **Vendas** trazem o ranking por construtora, a esteira do CCA e
os rankings de corretor, gerente e diretor.

> A meta global só aparece porque existe linha em `goals` para 08/2026. Não há
> tela para cadastrá-la ainda: quem cria é o seed. Virar o mês sem rodar o seed
> faz o cartão voltar a mostrar "—" (com a explicação e o SQL na própria tela).

### 3. Check-in

Menu lateral → **Check-in**.

**O que você vê:** o turno corrente no cabeçalho ("Noite", "Tarde"…), o card
**Janela atual** com o botão de bater ponto, o card **Leads recebidos** com as
atribuições da roleta e o card **Janelas de trabalho** com os três turnos.

Clique em bater ponto. A **posição na fila** aparece sozinha, com os colegas
presentes — se o preparo do item 2 foi feito, são até 5 corretores. Bater
check-out em outra aba muda esta tela sem F5 (é realtime, entrega da Tarefa G).

O bloqueio por IP está liberado para a conta do cliente (`bypass_ip_check`); os
corretores de verdade continuam sujeitos à trava.

### 4. Leads

Menu lateral → **Leads**.

**O que você vê:** 73 leads, filtráveis por origem e situação, com os cartões de
resumo em cima.

| Situação | Quantidade (26/08, 19h20) |
|---|---|
| Na fila (sem dono) | 10 |
| Em atendimento | 20 |
| Em negociação | 19 |
| Convertido em negócio | 14 |
| Perdido | 6 |
| Descartado | 4 |

Origens: Meta Ads 16 · Portal 14 · WhatsApp 14 · Orgânico 14 · Indicação 14 ·
Importação 1.

> **Estes seis números mudam sozinhos entre agora e a demonstração.** A roleta
> distribui lead da fila em até 1 minuto quando há corretor em check-in, e lead
> atribuído que estoura o prazo volta para a fila. É o sistema funcionando. O
> total (73) é que não muda sem alguém importar ou cadastrar.

**Abra um lead pelo nome do cliente** na tabela — o nome é um botão e abre o
modal com as sete abas (Dados, Formulário, Comentar, Anexos, Histórico, Agenda,
Rastreio). O mesmo modal abre pelo **sino do cabeçalho**, que leva para
`/leads?lead=<id>`: são dois caminhos para a mesma tela.

**Atenda um lead:** abra um lead "Na fila", clique em atender e registre o
contato. O lead muda de situação na hora.

> No produto o prazo de atendimento é de 5 minutos; no cenário ele foi alongado
> para 45, só para os leads não sumirem antes de você abrir a tela. Para ver a
> trava de 5 minutos correndo de verdade, use `npm run demo:lead -- --remote`.

### 5. Pipeline

Menu lateral → **Pipeline**. Alterne entre **tabela** e **kanban** pelos dois
botões ao lado da busca.

O kanban abre **sem filtro de mês**, com as nove colunas do catálogo
`pipeline_stages` e a contagem no cabeçalho de cada uma:

| Coluna | Negócios |
|---|---|
| Incompleto | 2 |
| Lead | 2 |
| Proposta | 4 |
| Visita Agendada | 3 |
| Em Análise | 4 |
| Aprovado | 2 |
| Contrato | 3 |
| Fechado | 9 |
| Perdido | 2 |

Total **31 negócios** (25 do cenário + 6 do seed base). A régua acima da lista
mostra "ativos", "na listagem" e "aguardando gerente".

**Abra um cartão:** o modal traz cliente, comprador em conjunta, construtora,
unidade, corretor, gerente e diretor. O rateio de VGV fecha sempre em 100% —
**3 negócios têm dois corretores** e mostram 50/50.

**Mova um negócio:** arraste um cartão de **Proposta** para **Visita Agendada**.
Funciona pelo mouse **e pelo teclado**: com o cartão focado, `Shift + ←/→` move
de coluna (entrega da Tarefa H — seta sozinha não move, porque mover é gravação
no banco).

**Feche uma venda (a comemoração):** arraste **Torre B - 305** — cliente
Priscila Nunes, coluna **Contrato**, R$ 471.420,00 líquido, Horizonte
Urbanismo — para **Fechado**. Confete e som, **uma vez só**: a comemoração
dispara pelo evento que o banco registra em `game_events`, não pela tela.

**Veja a regra recusar:** arraste um cartão da coluna **Incompleto** (Adriano
Camargo, Torre A - 104; ou Bianca Ferrão, Bloco 2 - 51) direto para **Em
Análise**. O sistema recusa: a documentação precisa ser aprovada pelo gerente
antes de entrar no CCA.

**Perca um negócio:** o botão de perder abre uma confirmação com **motivo
obrigatório** (DISTRATO, QUEDA, REPROVADO, OFF). Antes era um interruptor que
encerrava o negócio em um clique, sem perguntar.

> Os documentos anexados são registros sem arquivo no Storage: eles existem para
> as regras de etapa funcionarem. **O download não abre nada.**

### 6. Gamificação

Menu lateral → **Gamificação**.

**O que você vê:** a temporada **Agosto 2026**, aberta desde 01/08, com o selo
"Game ativo", o pódio e a tabela completa.

| # | Corretor | Pontos | Vendas |
|---|---|---|---|
| 🥇 | Ana Oliveira | **2.360** | 3 |
| 🥈 | Diego Costa | **2.250** | 2 |
| 🥉 | Rafael Nogueira | **1.320** | 1 |

Depois vêm Bruno Santos (420), Helena Vasques (320), Carla Lima (310), Tatiane
Prado (200), Elisa Rocha (160), Felipe Martins (160), Gustavo Peixoto (150),
Igor Bandeira (80) e Juliana Terra (50) — mais a sua conta, com 160 pontos. São
**13 colocados**.

**Elisa Rocha tem uma venda e ainda assim está com 160 pontos**: ela levou um
distrato (−600), que aparece em vermelho no detalhamento. É a penalidade
configurada em Regras de pontuação.

Troque a temporada no seletor do topo para a de julho: ela aparece com
**(fechada)** e mostra o placar **congelado**, que não muda mais mesmo que as
regras de pontuação sejam alteradas depois. É o "congelar o período" pedido na
ata.

> Detalhe de acabamento: a temporada de julho ficou gravada com o rótulo
> **"July 2026"**, em inglês — nome herdado do fechamento automático. É só o
> rótulo; o período e o placar estão certos. Se incomodar, dá para renomear pelo
> banco antes da reunião.

### 7. Ver como corretor

No **canto superior direito**, ao lado do sino, há um seletor de papel
("Pré-visualizar como papel"). Escolha **Ver como Corretor**.

**O que você vê:** o menu encolhe para o que um corretor enxerga — somem
Permissões, Integrações, Construtoras, IPs autorizados, Automação de Leads,
Dados. Um ícone de olho e o aviso "pré-visualizando" ficam no cabeçalho. Para
voltar, escolha "Administrador (você)".

> A pré-visualização muda **a interface, não os dados**: o banco continua
> respondendo pelos papéis reais da conta. Serve para conferir menu e botões
> depois de mexer na matriz de permissões, não para auditar visibilidade.

---

## Extras, se sobrar tempo

- **Sino do cabeçalho** — a conta do cenário tem notificações não lidas (venda
  registrada, lead novo, atividade vencida, crédito aprovado, meta em 50%).
  Clicar leva à tela do assunto e marca como lida.
- **CCA Pipeline** — 12 casos: **7 aprovados**, 3 em análise, 1 aguardando
  documento, 1 enviado à construtora. O seletor **"Mover para…"** de cada cartão
  fica sempre visível (não depende de passar o mouse) — entrega da Tarefa H, e é
  o que faz a tela funcionar no toque.
- **Marketing** — aporte de **R$ 37.900,00** em 08/2026 (Horizonte Urbanismo
  R$ 21.500, Viva Lar Incorporadora R$ 16.400), contra R$ 32.700 em 07/2026 e
  R$ 29.900 em 06/2026; mais as campanhas com custo por lead calculado.
- **Equipes** — Paulista 7 membros (Marcos Gerente / Daniela Diretora), Sul 5
  (Fernanda Gerente / Daniela Diretora), Centro 4 (Paula Marchesi / Ricardo
  Sampaio). Duas diretorias.
- **Checkpoint da diretoria** — https://faceimob.vercel.app/diretor/seed-diretoria-daniela
  abre sem sessão e mostra a semana de 24 a 30/08: 32 leads, 9 análises,
  5 aprovações, 2 vendas, quebrado por equipe. **É justamente o link sem PIN do
  aviso lá em cima** — mostre e feche.
- **Diário público** — `/daily/<slug>` pede o PIN da equipe. PIN certo abre a
  escala e grava o checkpoint ("🎯 Checkpoint concluído! +XP"); PIN errado ou
  link bloqueado responde **"Envio recusado"**. *(Os dois caminhos foram
  percorridos na URL publicada em 26/08, com um link descartável que foi
  apagado depois.)*

---

## O que ainda não está pronto

Dito antes para não virar surpresa na frente do cliente.

- **A conta do cliente não existe** enquanto o item 1 do topo não for feito.
- **Aviso "Nova versão disponível!"** aparece em telas que estão atualizadas.
  É um falso positivo do detector de deploy — ele compara os arquivos carregados
  na aba (que incluem os pedaços carregados sob demanda) com os listados no
  `index.html` (que não os inclui). Pode ignorar; clicar em "Atualizar" só
  recarrega a página.
- **Download de documento não funciona** — os anexos do cenário são registros
  sem arquivo no Storage.
- **Código por e-mail** só chega se o SMTP estiver configurado. A senha entra
  sempre.
- **WhatsApp não dispara**: o cron de envio está pausado de propósito, com 77
  mensagens na fila. Dá para mostrar a fila; não despause.
- **Meta global de vendas** não tem tela de cadastro; hoje vem do seed.
- **Logo no tema claro** ainda é a arte de letra branca sobre placa azul da
  marca — falta o asset com letra escura.
- **Datas do diário público** aparecem rotuladas como "ontem" mostrando a data
  de **hoje**. O valor gravado é o de hoje; o rótulo é que está errado.
- **Duas etapas do CCA dividem o mesmo tom** ("Pendência de Documentos" e
  "Reprovado" em vermelho; "Enviado à Construtora" e "Enviado à Agência" em
  azul) — a paleta tem 6 tons para 6 etapas. O nome da etapa está no cartão, e
  dá para trocar a cor pelo editor de estágio da própria tela.

---

## Números conferidos — 26/08/2026, 19h20 (Brasília)

| Item | Valor |
|---|---|
| Perfis no total | 23 |
| Corretores · gerentes · diretores | 13 · 3 · 2 |
| Equipes ativas | 3 (2 diretorias) |
| Leads no total (do cenário) | 73 (60) |
| Negócios no total (do cenário) | 31 (25) |
| Vendas no total (em 08/2026) | 9 (7) |
| VGV das vendas de 08/2026 | R$ 3.081.520,00 |
| VGV de todos os negócios do cenário | R$ 10.329.060,00 |
| Meses fechados | 05/2026 e 06/2026 |
| Meta global de vendas em 08/2026 | 14 |
| Metas cadastradas | 16 |
| Documentos anexados | 68 |
| Casos no CCA | 12 |
| Temporada aberta | Agosto 2026 (desde 01/08) |
| Colocados no ranking da temporada | 13 |
| Aporte de marketing em 08/2026 | R$ 37.900,00 |
| Diários de equipe gravados | 7 |
| Visitas | 8 |
| Notificações de WhatsApp represadas | 77 (cron pausado de propósito) |

SQL de conferência (SQL editor do Supabase):

```sql
select
  (select count(*) from public.leads)                                     as leads,
  (select count(*) from public.deals)                                     as negocios,
  (select count(*) from public.deals where outcome = 'won')               as vendas,
  (select count(*) from public.profiles)                                  as perfis,
  (select count(distinct profile_id) from public.user_roles
    where role = 'broker')                                                as corretores,
  (select count(*) from public.game_events
    where season_id = public.current_game_season())                       as eventos,
  (select to_char(sum(vgv_net), 'FM999G999G999D00') from public.deals
    where month_base = date '2026-08-01' and outcome = 'won')             as vgv_08;
```

```sql
select full_name, points, sales from public.game_ranking
 where season_id = public.current_game_season()
 order by points desc, full_name;
```

```sql
-- Os seis indicadores do Dashboard para 08/2026, na mesma conta da tela.
select count(*) filter (where outcome = 'open')                      as producao,
       count(*) filter (where outcome = 'won')                       as resultado,
       count(*) filter (where outcome = 'lost')                      as perdas,
       count(*) filter (where outcome in ('open','won'))             as negocios,
       to_char(sum(vgv_net) filter (where outcome = 'won'),
               'FM999G999G999D00')                                   as vgv
  from public.deals where month_base = date '2026-08-01';
```

---

## Aplicar e remover o cenário

```bash
node scripts/demo.mjs showcase --remote
```

```bash
node scripts/demo.mjs showcase:limpar --remote
```

Ambos são idempotentes **para os dados**; a exceção é a presença do check-in
(ver o item 2 do topo), que só é recriada depois de um `showcase:limpar`.

**Pré-requisito, uma vez por máquina** — a CLI precisa saber qual é o projeto:

```bash
npx supabase link --project-ref mcmqgxvtwegtptfseqvw
```

Sem `--remote` os mesmos comandos rodam contra o Supabase local
(`npm run db:start`). O `showcase` não precisa de `SUPABASE_SERVICE_ROLE_KEY` —
fala com o banco pela CLI, não pela API REST. Os comandos antigos (`preparar`,
`lead`, `limpar`) continuam exigindo a chave.

---

## Publicar de novo, depois de mexer no front

```bash
npm run build
```

```bash
npx vercel deploy --prod --yes --archive=tgz --scope alissons-projects-b1faee75
```

> **Os dois argumentos não são enfeite.** Sem `--scope` a CLI responde
> *"Not authorized"* (a conta logada é `devalissonrosa-6549`, e o projeto vive no
> time `alissons-projects-b1faee75`). Sem `--archive=tgz` o envio dos ~30 MB do
> diretório morre no meio com `fetch failed` — o `tgz` manda um pacote só e
> passa de primeira. Ambos foram necessários em 26/08.

Confira que o que está no ar é o que você acabou de construir:

```bash
curl -s https://faceimob.vercel.app/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'
```

O resultado tem que ser igual ao do `dist/index.html` local.

Primeira vez numa máquina nova:

```bash
npx vercel login
```

```bash
npx vercel link --yes --project faceimob
```

As três variáveis públicas já estão cadastradas em production e preview.
**Nunca** cadastre a service role key nem o token da Vercel: tudo com prefixo
`VITE_` vai para o bundle do navegador.

> O projeto ficou conectado ao repositório GitHub `alisson-rr/faceimob` durante o
> `vercel link`. Se alguém fizer push na branch padrão, a Vercel publica sozinha.
