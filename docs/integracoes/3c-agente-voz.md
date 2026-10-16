# API FaceImob para o agente de voz da 3C

Atualizado em 16/10/2026. **Estado: implementada, aguardando credencial,
autorização de acesso e homologação.** A liberação depende das agendas e dos
grupos autorizados, da entrega segura da chave e dos testes conjuntos com a 3C.

A API permite buscar e criar leads, atualizar seu cadastro e etapa comercial,
consultar horários de corretores, marcar visitas e registrar ligações. O webhook
de voz anterior permanece separado e mantém seu contrato.

A 3C define as regras comerciais de expediente, dias de atendimento, duração,
antecedência e horizonte de oferta. Envia o período e a duração na consulta e o
intervalo exato na reserva. A FaceImob valida o acesso, os formatos, o corretor
responsável e os conflitos com compromissos existentes.

Base da integração na infraestrutura atual da FaceImob:

```text
https://app.faceimob.com.br/functions/v1/integracao-3c
```

Os caminhos abaixo são relativos a essa base. Não é necessário login de usuário
nem cabeçalho `apikey`. A autenticação usa exclusivamente a chave própria da 3C.

## Acesso e formato

Enviar em todas as operações:

```http
Authorization: Bearer <CHAVE_RECEBIDA_PELO_COFRE_SEGURO>
```

Em POST e PATCH, enviar também `Content-Type: application/json`. Entrada e saída
têm um objeto JSON na raiz. O corpo de cada requisição deve ter até 64 KiB;
arrays na raiz, campos desconhecidos e campos obrigatórios ausentes são recusados.
GET recebe parâmetros na URL; POST e PATCH recebem campos somente no corpo.

A chave é gerada em **Admin → Integrações → 3C — agente de voz**, com 32 bytes
aleatórios, representados por 64 caracteres hexadecimais. Seu valor aparece uma
única vez para ser guardado em um gerenciador de senhas. Compartilhar com a 3C
por cofre seguro; nunca por chat, e-mail, WhatsApp ou parâmetro de URL. Não enviar
à 3C credenciais de banco, `service_role` ou credenciais pessoais.

Rotação e revogação são verificadas a cada chamada, sem cache de chave nem
retaguarda por variável de ambiente. A chave antiga deixa de autenticar após a
troca ou revogação. Uma chave válida com integração desligada ou configuração
incompleta recebe `503`. A suspensão de qualquer grupo ou agenda configurados
também exige revisão da configuração antes de retomar a integração.

Datas usam ISO 8601 com fuso explícito, como `2026-10-20T14:00:00-03:00` ou
`2026-10-20T17:00:00Z`. Segundos podem ser omitidos; a API os completa com `:00`.
O fuso informado identifica o instante da consulta e do compromisso; as regras
comerciais de horário são aplicadas pela 3C.

Enviar telefone somente com dígitos, DDI e DDD. Por compatibilidade, a API aceita
formatação usual, até 40 caracteres e de 10 a 15 dígitos, e normaliza números
brasileiros de 10 ou 11 dígitos acrescentando `55`. Não acrescenta nem remove o
nono dígito. A resposta entrega o número normalizado.

**Todos os IDs dos exemplos são UUIDs fictícios de teste.** Telefones, datas,
nomes e horários são ilustrativos e não representam configuração ou registros
de produção. Utilizar os IDs reais recebidos pela busca e pelos catálogos;
reutilizar horários efetivamente retornados pela disponibilidade.

## Leads

### Buscar lead

```http
GET /leads?telefone=5542999999999
GET /leads?email=maria@example.invalid
GET /leads?id=11111111-1111-4111-8111-111111111111
```

Enviar **exatamente um** filtro: `telefone`, `email` ou `id`, sem parâmetros
repetidos. A busca respeita os grupos e corretores autorizados.

Resposta `200` quando encontrado:

```json
{
  "encontrado": true,
  "lead": {
    "id": "11111111-1111-4111-8111-111111111111",
    "nome": "Maria Souza",
    "telefone": "5542999999999",
    "email": "maria@example.invalid",
    "etapa_id": "new",
    "corretor_id": "22222222-2222-4222-8222-222222222222",
    "criado_em": "2026-10-16T10:00:00-03:00"
  }
}
```

Sem correspondência acessível: `200` com
`{"encontrado":false,"lead":null}`. Havendo mais de um cadastro correspondente,
retorna `422 LEAD_AMBIGUO`; usar o ID do CRM para identificar o cadastro correto.
`corretor_id` pode ser `null` enquanto o lead aguarda distribuição. Cadastros
existentes sem telefone ou e-mail devolvem `null` nesses campos.

### Criar lead

```http
POST /leads
```

```json
{
  "nome": "Maria Souza",
  "telefone": "5542999999999",
  "email": "maria@example.invalid",
  "origem": "agente_ia_3c",
  "etapa_id": "new",
  "observacao": "Contato da lista de reativação",
  "dados_adicionais": { "interesse": "Apartamento de dois quartos" }
}
```

| Campo | Obrigatório | Regra |
|---|---|---|
| `nome` | Sim | Texto não vazio, até 200 caracteres. |
| `telefone` | Sim | Telefone válido conforme as regras gerais. |
| `email` | Não | E-mail válido, até 254 caracteres; aceita `null`. |
| `origem` | Não | Texto não vazio, até 100 caracteres. A origem de aquisição gravada pelo CRM é sempre `agente_ia_3c`, independentemente deste valor. |
| `etapa_id` | Não | Código de `/etapas`; padrão `new`. |
| `observacao` | Não | Texto não vazio, até 10.000 caracteres; aceita `null`. |
| `dados_adicionais` | Não | Objeto JSON, dentro do limite total da requisição. |

Novo cadastro: `201` com
`{"id":"11111111-1111-4111-8111-111111111111","criado":true}`.

Se o telefone já estiver cadastrado em um único lead acessível: `200` com o
mesmo ID e `criado:false`, **sem alterar nenhum dado desse lead**. Duplicidades
preexistentes retornam `422 LEAD_AMBIGUO`. Se o cadastro já existir fora do
alcance autorizado, retorna `404 LEAD_NAO_ENCONTRADO` e não cria uma cópia.

O novo lead entra no grupo de entrada configurado, aguardando a roleta do CRM.
Este POST não escolhe corretor. Antes de marcar uma visita, consultar o lead e
confirmar seu `corretor_id` e a agenda autorizada correspondente.

### Atualizar lead

```http
PATCH /leads/11111111-1111-4111-8111-111111111111
```

```json
{
  "etapa_id": "scheduled_visit",
  "observacao": "Visita combinada após qualificação",
  "dados_adicionais": { "renda": "5 a 10 mil" }
}
```

Enviar ao menos um campo. Os únicos campos aceitos são `nome`, `telefone`,
`email`, `etapa_id`, `observacao` e `dados_adicionais`, com os limites da criação.
Não enviar `id` no corpo, `origem`, responsável, grupo ou status operacional.

Campos omitidos ficam intactos. `email:null` e `observacao:null` limpam esses
campos; os demais campos não aceitam `null`. `observacao` substitui a observação
do cadastro e não funciona como histórico acumulativo.

As chaves de `dados_adicionais` são mescladas no primeiro nível, exclusivamente
no espaço `raw_payload.integracoes.tres_c.dados_adicionais`, preservando dados
de outros canais. Uma chave enviada substitui seu valor anterior; objetos
aninhados não têm merge recursivo. O valor `null` de uma chave é armazenado como
`null`, sem removê-la. O objeto vazio não apaga dados anteriores. As informações
da 3C ficam visíveis separadamente das respostas Meta no detalhe do lead.

Resposta `200`:
`{"id":"11111111-1111-4111-8111-111111111111","atualizado":true}`.
Lead inexistente ou fora do alcance: `404`. Telefone pertencente a outro cadastro:
`409 TELEFONE_JA_CADASTRADO`.

O PATCH não redistribui o lead nem reabre leads perdidos, descartados ou
convertidos. Mudar a etapa de um lead encerrado retorna `422 LEAD_ENCERRADO`.
Reativação depende de uma decisão comercial específica e não acontece por
criação, atualização, agendamento ou registro de ligação.

## Catálogos

### Etapas comerciais

```http
GET /etapas
```

```json
{
  "etapas": [
    { "id": "new", "nome": "Novo" },
    { "id": "first_contact", "nome": "Primeiro contato" },
    { "id": "no_response", "nome": "Sem resposta" },
    { "id": "warm", "nome": "Morno" },
    { "id": "hot", "nome": "Quente" },
    { "id": "gathering_docs", "nome": "Coleta de documentos" },
    { "id": "scheduled_visit", "nome": "Visita agendada" },
    { "id": "qualified", "nome": "Qualificado" }
  ]
}
```

Resposta `200`. Na criação e no PATCH também são aceitos os aliases
`novo` → `new` e `visita_agendada` → `scheduled_visit`. A busca devolve os códigos
canônicos. Etapa comercial é diferente do status da roleta e da etapa de negócio;
`descartado` não é um código de etapa aceito. Etapa desconhecida retorna
`422 ETAPA_INVALIDA`.

### Agendas

```http
GET /agendas
```

Resposta `200`, somente com agendas de corretores autorizados:

```json
{
  "agendas": [
    {
      "id": "22222222-2222-4222-8222-222222222222",
      "nome": "Corretor de exemplo",
      "tipo": "corretor"
    }
  ]
}
```

O `id` da agenda identifica o corretor. Consultar ambos os catálogos na
configuração e atualizá-los quando a FaceImob alterar as permissões combinadas.

## Agenda de visitas

### Consultar horários disponíveis

```http
GET /agenda/disponibilidade?inicio=2026-10-20T09:00:00-03:00&fim=2026-10-20T18:00:00-03:00&duracao_min=30&agenda_id=22222222-2222-4222-8222-222222222222
```

`inicio`, `fim` e `duracao_min` são obrigatórios. `agenda_id` é opcional: sem
ele, a consulta considera todas as agendas permitidas. `duracao_min` deve ser
inteiro positivo de até 2.147.483.647, definido pela 3C para essa consulta. Os
30 minutos acima são ilustrativos.

Resposta `200`:

```json
{
  "horarios": [
    {
      "inicio": "2026-10-20T16:00:00-03:00",
      "fim": "2026-10-20T16:30:00-03:00",
      "agenda_id": "22222222-2222-4222-8222-222222222222"
    }
  ]
}
```

Sem opções: `200` com `{"horarios":[]}`. A API gera intervalos dentro da janela
enviada, com a duração solicitada, e exclui os que conflitam com ocupações. A 3C
seleciona a janela conforme suas regras comerciais e oferece ao lead os horários
que forem adequados.

`inicio` deve preceder `fim`. Não há expediente, antecedência mínima, dias de
atendimento ou horizonte obrigatório configurados na FaceImob. A consulta não
é recusada por ser à noite, no passado ou em um dia específico da semana.
Período inválido retorna `422 PERIODO_INVALIDO`. O limite técnico é de 5.000
horários candidatos, antes de eliminar ocupações: reduzir a janela ou indicar
uma agenda se excedê-lo. A resposta não é truncada. Agenda inválida ou não
autorizada retorna `404 AGENDA_NAO_ENCONTRADA`.

Visitas agendadas sem horário de término, antigas ou criadas manualmente,
bloqueiam o dia inteiro daquela agenda até correção manual ou cancelamento pelo
CRM. Ao agendar manualmente, o corretor pode informar início e fim para reservar
somente aquele intervalo e permitir outras visitas no mesmo dia. Nenhuma duração
é presumida. Os registros manuais sem término mantêm a possibilidade de
coexistir no mesmo dia, mas esse dia fica ocupado para a 3C. Quando uma visita
tem término informado, sua sobreposição com outra visita é impedida, inclusive
contra um registro manual que ocupe o dia inteiro. No diálogo do negócio, os
horários informados pertencem ao dia escolhido no calendário. O requisito de resposta durante a ligação é
até um segundo; a medição pelo HTTPS publicado integra a homologação.

### Criar evento

```http
POST /agenda/eventos
Idempotency-Key: visita-ligacao-externa-123
```

```json
{
  "lead_id": "11111111-1111-4111-8111-111111111111",
  "agenda_id": "22222222-2222-4222-8222-222222222222",
  "inicio": "2026-10-20T16:00:00-03:00",
  "fim": "2026-10-20T16:30:00-03:00",
  "tipo": "visita",
  "titulo": "Visita com Maria Souza",
  "observacao": "Interesse em apartamento no Centro",
  "origem": "agente_ia_3c"
}
```

Todos os campos acima são obrigatórios, exceto `observacao`. IDs precisam ser
UUIDs válidos. `tipo` deve ser `visita`; `titulo` aceita até 200 caracteres,
`origem` até 100 e `observacao` até 10.000. Textos enviados não podem ser vazios;
`observacao` pode ser `null`.

`inicio` e `fim` são definidos pela 3C e gravados como enviados; o fim deve ser
posterior ao início. A reserva não precisa seguir uma grade fixa ou coincidir
com a duração de uma consulta anterior. A 3C aplica as regras comerciais para
decidir o intervalo; a API não o rejeita por antecedência, expediente ou passado.
`agenda_id` deve ser o corretor responsável atual por um lead ativo. Sem
responsável, retorna `422 AGUARDANDO_DISTRIBUICAO`. Corretor diferente ou lead
encerrado retorna `422 AGENDAMENTO_NAO_PERMITIDO`. A API não usa o agendamento
para repassar ou reativar o lead.

Resposta `201`:
`{"evento_id":"33333333-3333-4333-8333-333333333333","criado":true}`.
O evento fica vinculado ao lead e visível na agenda de visitas do corretor.

A ocupação é revalidada ao gravar, inclusive contra agendamentos manuais com ou
sem término informado.
Conflito retorna `409 HORARIO_OCUPADO`; consultar a disponibilidade novamente.
Consultar um horário livre não o reserva. Não há nesta API operações de consulta
individual, edição ou cancelamento de evento; usar o CRM para essas ações.

## Histórico de ligações

```http
POST /leads/11111111-1111-4111-8111-111111111111/ligacoes
Idempotency-Key: ligacao-externa-123
```

```json
{
  "data": "2026-10-16T14:32:00-03:00",
  "duracao_seg": 245,
  "desfecho": "agendado",
  "resumo": "Cliente confirmou interesse. Visita combinada para 20/10 às 16h."
}
```

Os quatro campos são obrigatórios. `duracao_seg` deve ser inteiro entre 0 e
86.400. `resumo` deve ser texto não vazio, com até 10.000 caracteres.
`desfecho` deve ter até 64 caracteres e pertencer à lista acordada e configurada
na FaceImob; a lista inicial é `agendado`, `nao_qualificado` e `sem_interesse`.

Resposta `201`:
`{"ligacao_id":"44444444-4444-4444-8444-444444444444","registrado":true}`.

Cada ligação é um registro novo no histórico, com data real, resumo, duração e
desfecho legíveis. O registro não substitui notas, não altera etapa, não encerra
e não reativa o lead. Se houver mudança de etapa comercial, a 3C deve enviar o
PATCH separadamente conforme o mapeamento combinado. Lead inexistente ou fora
do alcance retorna `404 LEAD_NAO_ENCONTRADO`.

## Reenvio seguro

`Idempotency-Key` é opcional e recomendada para produção em
`POST /agenda/eventos` e `POST /leads/{id}/ligacoes`. Aceita de 1 a 128 caracteres
ASCII visíveis, sem espaços. Não é aceita na criação de lead nem no PATCH.

Para uma mesma operação, reenviar a mesma chave e os mesmos dados devolve a
resposta original, inclusive `201` e o mesmo ID, sem criar outra reserva ou
ligação. A ordem das propriedades JSON não importa. Usar a mesma chave com
outros dados retorna `409 IDEMPOTENCIA_CONFLITO`. Uma ligação ou reserva nova
deve usar chave nova. Reenvios continuam sujeitos ao acesso e à configuração
vigentes.

Sem essa chave, um reenvio de ligação pode gerar outro registro; uma repetição
de reserva pode retornar conflito. A criação de lead usa o telefone normalizado
para devolver um cadastro existente, independentemente desse cabeçalho.

As operações são separadas. Se reserva, PATCH ou histórico falharem em momentos
diferentes, preservar os IDs e as chaves já utilizados e repetir somente a etapa
pendente. Uma falha no PATCH não cancela a visita já criada.

## Erros

Formato comum:

```json
{
  "erro": "HORARIO_OCUPADO",
  "mensagem": "O horário já foi ocupado. Consulte a disponibilidade novamente."
}
```

| HTTP | Exemplos de código | Conduta da 3C |
|---|---|---|
| `400` | `DADOS_INVALIDOS` | Corrigir corpo, filtro, tipo, tamanho, data, campo obrigatório ou chave de idempotência. |
| `401` | `CHAVE_INVALIDA`, `NAO_AUTORIZADO` | Conferir a chave entregue pela FaceImob; chave ausente, inválida ou revogada não autentica. |
| `404` | `LEAD_NAO_ENCONTRADO`, `AGENDA_NAO_ENCONTRADA`, `ROTA_INEXISTENTE` | Conferir ID, caminho e alcance autorizado. Não presume permissão sobre outro cadastro. |
| `405` | `METODO_NAO_PERMITIDO` | Usar o método previsto para a rota. |
| `409` | `HORARIO_OCUPADO`, `TELEFONE_JA_CADASTRADO`, `IDEMPOTENCIA_CONFLITO` | Resolver a disputa ou a identificação antes de tentar novamente. |
| `422` | `PERIODO_INVALIDO`, `ETAPA_INVALIDA`, `LEAD_AMBIGUO`, `LEAD_ENCERRADO`, `AGUARDANDO_DISTRIBUICAO`, `AGENDAMENTO_NAO_PERMITIDO` | Ajustar os dados ou aguardar a ação comercial/distribuição necessária. |
| `500` | `ERRO_INTERNO` | Tratar como falha do CRM; preservar a chave de idempotência ao repetir uma criação. |
| `503` | `INTEGRACAO_INDISPONIVEL` | Aguardar a FaceImob habilitar ou revisar a configuração. |

Usar o status e `erro` para decidir o fluxo; `mensagem` é texto para leitura
humana e pode ser ajustado sem alterar o código do erro.

## Configuração e homologação

1. **FaceImob:** selecionar agendas de corretores e grupos autorizados, grupo
   de entrada e desfechos aceitos. A configuração de acesso nasce desligada.
2. **FaceImob:** salvar a configuração, gerar a chave exclusiva, guardá-la em
   cofre e compartilhá-la de forma segura. A identidade técnica é criada pelo
   servidor e preservada nas alterações e rotações. Ativar somente após revisar
   a credencial e o alcance autorizado.
3. **3C:** configurar a base HTTPS, Bearer e JSON; consultar os catálogos, mapear
   IDs e etapas e usar identificadores estáveis de reenvio. Aplicar suas regras
   de atendimento ao escolher `inicio`, `fim` e `duracao_min` em cada consulta e
   o intervalo exato de cada reserva.
4. **Ambas as equipes:** usar um lead e uma agenda de homologação autorizados,
   testar as oito operações, telefone existente, cadastro ambíguo, distribuição
   pendente, conflito de horário, reenvio, revogação e registros visíveis ao
   corretor. Medir disponibilidade pelo HTTPS publicado em até um segundo.
5. **Ambas as equipes:** conferir respostas reais do ambiente liberado e a
   sequência consulta → reserva → PATCH → histórico antes da operação real.

A configuração administrativa contém somente ativação, identidade técnica,
grupos permitidos, grupo de entrada, agendas permitidas e desfechos. Não há
campos de expediente, duração, antecedência ou horizonte para preencher na
FaceImob. As respostas com os IDs reais do ambiente liberado serão conferidas
na homologação conjunta.

Leads perdidos, descartados ou convertidos permanecem encerrados, sem reativação
pela API. Usar o ID do CRM na lista enviada à 3C quando disponível.

### Mensagem para encaminhar ao cliente

> A API da FaceImob para a 3C está implementada. A 3C define suas regras de
> atendimento e envia o período e a duração na consulta e o intervalo exato da
> visita na reserva. A FaceImob confere acesso, corretor responsável e conflitos.
> Para liberar, faltam autorizar os grupos e as agendas, entregar a chave por
> cofre seguro e fazer os testes conjuntos. Leads encerrados permanecem como
> estão, sem reativação pela API. A base é
> https://app.faceimob.com.br/functions/v1/integracao-3c.
