# Plano da API FaceImob para o agente de voz da 3C

Data: 16/10/2026. Estado: API implementada; credencial, autorização de acesso e
homologação pendentes.

O contrato para entrega ao cliente está em [API para a 3C](./3c-agente-voz.md).

A 3C precisa consultar e atualizar leads, oferecer horários durante a ligação e
registrar o agendamento e o resultado da conversa. A proposta é publicar uma
Edge Function dedicada, com as oito operações do PDF, usando a infraestrutura
atual e preservando o webhook de voz existente.

Definição de escopo confirmada pelo usuário: a FaceImob entrega a API e protege
acesso, vínculo com o corretor e conflitos de agenda. A 3C define expediente,
dias, duração, antecedência e horizonte e envia os intervalos nas requisições.
O compromisso é uma visita na agenda do corretor responsável atual. Leads
encerrados permanecem como estão, sem reativação pela integração.

## Base conferida

- Projeto local atualizado por fast-forward na `main`, alinhada ao GitHub em
  `2ae329e447b6869f3a6d7eadecef4037abc7a5e4`.
- Em 16/10 às 12:25 BRT, a release ativa e os containers de frontend e funções
  da VPS usavam esse mesmo commit, com saúde normal. Não havia release posterior
  nos diretórios de publicação; as fontes Supabase conferidas eram idênticas.
- A branch anterior `codex/meta-lead-phone` foi preservada. Os dois arquivos SQL
  locais sem commit também foram preservados, com os mesmos hashes.
- Fonte de requisitos: PDF “FaceImob × 3C — Especificação de integração do
  Agente de Voz”, de 16/10/2026, oito páginas. O arquivo está em Downloads.

O webhook atual recebe `lead_qualified`, `transcript` e `status`, autentica por
segredo compartilhado e deduplica por `external_id`. Isso não oferece as rotas,
a deduplicação por telefone nem a agenda exigidas pelo novo contrato.

## Contrato a disponibilizar

Base confirmada: `https://app.faceimob.com.br/functions/v1/integracao-3c`.
O domínio `api.faceimob.com.br/v1` do PDF é ilustrativo. A base confirmada aproveita
o domínio e o roteamento atuais, sem exigir outro serviço ou DNS.

| Operação | Comportamento do contrato |
| --- | --- |
| `GET /leads` | Buscar por `telefone`, `email` ou `id`. Ausência é `200` com `encontrado:false` e `lead:null`. |
| `POST /leads` | Receber nome, telefone, e-mail, origem, etapa, observação e dados adicionais. Novo: `201` e `criado:true`; telefone existente: `200`, mesmo ID e `criado:false`. |
| `PATCH /leads/{id}` | Alterar somente os campos enviados. Retornar `200` com `id` e `atualizado:true`, ou `404` para lead inexistente. |
| `GET /agenda/disponibilidade` | Receber `inicio`, `fim`, `duracao_min` e, conforme a agenda definida, `agenda_id`. Retornar objeto com `horarios`, inclusive array vazio. Responder em até um segundo. |
| `POST /agenda/eventos` | Receber lead, agenda, início, fim, tipo, título, observação e origem. Revalidar ocupação na gravação. Retornar `201` com `evento_id` e `criado:true`, ou `409` com `HORARIO_OCUPADO`. |
| `POST /leads/{id}/ligacoes` | Acrescentar data, duração em segundos, desfecho e resumo ao histórico. Retornar `201` com `ligacao_id` e `registrado:true`. |
| `GET /etapas` | Listar os identificadores e nomes realmente aceitos na integração. |
| `GET /agendas` | Listar somente agendas autorizadas, com identificador, nome e tipo. |

Todas as entradas e respostas são JSON, com objeto na raiz. A busca devolve
`id`, `nome`, `telefone`, `email`, `etapa_id`, `corretor_id` e `criado_em`.
Datas seguem ISO 8601 com fuso explícito; telefone usa somente dígitos com DDI e
DDD. Os erros seguem `{erro,mensagem}` e status HTTP: `400` para entrada inválida,
`401` para chave ausente ou inválida, `404` para recurso inexistente, `409` para
conflito, `422` para regra de negócio e `500` para falha interna. Período inválido
ou excessivo usa `422` e `PERIODO_INVALIDO`.

Não há no PDF contrato de cancelamento ou consulta individual de evento. Esses
endpoints não entram nesta entrega inicial.

## O que reaproveitar e o que falta

**Leads e etapas.** Usar `public.leads`: `full_name`, `phone`, `phone_raw`, `email`,
`source_id`, `notes`, `funnel_stage`, `assigned_to` e `created_at`. A origem é
resolvida em `lead_sources`; cadastrar `agente_ia_3c` de forma incremental se esse
for o código confirmado. Não substituir origem, UTM, responsável ou payload
anterior quando o POST apenas encontrar um lead existente.

O esquema versionado normaliza telefones com `normalize_phone`: remove formatação e
acrescenta `55` a números brasileiros de dez ou onze dígitos. Não corrige
automaticamente o nono dígito. `leads_phone_idx` não é único; a unicidade atual é
de `external_id`. A criação da 3C precisa buscar e criar em uma transação com
proteção por telefone normalizado. Conferir duplicidades existentes antes de
definir a resposta para múltiplos cadastros; não apagar, fundir ou impor uma
unicidade global sobre o histórico como parte desta integração. Outros canais
que criarem o mesmo contato simultaneamente precisam participar da mesma regra
se a garantia de deduplicação também abranger essas entradas.

`etapa_id` deve mapear o funil do lead (`funnel_stage`), que é separado do estado
operacional da roleta (`status`) e das etapas de negócio. O catálogo atual tem
`new`, `first_contact`, `no_response`, `warm`, `hot`, `gathering_docs`,
`scheduled_visit` e `qualified`. “Visita agendada” corresponde a
`scheduled_visit`; “Descartado” é um estado operacional, não uma etapa desse
enum. O mapeamento de desfechos precisa respeitar essa distinção e as regras
existentes de encerramento. Um PATCH de etapa não deve redistribuir o lead.

Para `dados_adicionais`, a proposta é usar
`raw_payload.integracoes.tres_c.dados_adicionais` e merge transacional das
chaves enviadas, preservando os dados de outros canais. A tela hoje só exibe
respostas de formulário em `raw_payload.fields`; estender essa leitura e o
modal para também mostrar os dados da 3C, sem sobrescrever respostas da Meta. Fechar
obrigatoriedade, limites, tratamento de `null` e remoção de campos no contrato;
não permitir atualização arbitrária de colunas pelo fornecedor.

**Agenda.** Reaproveitar `public.visits`, ligada a lead/negócio e corretor,
acrescentando `ends_at` e os metadados do contrato. `agenda_id` identifica o
corretor responsável atual; o agendamento não redistribui nem reativa o lead.
`tasks` continua representando prazos de atividades.

A 3C envia `inicio`, `fim` e `duracao_min` em cada consulta. A API calcula
intervalos livres dentro dessa janela e exclui ocupações. Há somente um limite
técnico de 5.000 candidatos por consulta, sem truncamento da resposta. A duração
é um inteiro positivo até o limite de `integer`; não depende de configuração
administrativa. Expediente, dias, antecedência e horizonte pertencem à 3C.

A reserva grava exatamente o início e o fim recebidos, exigindo fim posterior
ao início, acesso autorizado, corretor atual do lead ativo e ausência de
conflito. Não impõe grade fixa nem rejeita noite ou passado por regra comercial.
A gravação usa transação e retorna `409` quando houver disputa, inclusive contra
outra reserva conhecida do CRM.

Visitas agendadas sem fim, antigas ou novas manuais, bloqueiam o dia da agenda
até correção manual ou cancelamento no CRM. Não presumir duração nem reescrever
histórico. Os fluxos manuais oferecem início explícito e término opcional; com
ambos informados, reservam somente o intervalo e permitem outras visitas no
mesmo dia. O calendário do negócio exige a hora inicial e recebe a hora final
no mesmo dia escolhido. O painel mostra o fim e o adaptador traduz o conflito.
Registros manuais sem término podem continuar coexistindo no mesmo dia; cada
um bloqueia o dia para reservas da 3C. Se uma das visitas tem fim explícito,
qualquer sobreposição é impedida.

**Ligações.** Reaproveitar `lead_events`, que aceita `kind`, `actor_id` e `detail`
JSON. Criar um evento por ligação, por exemplo `voice_ai_call`, contendo os
quatro campos do PDF. Retornar o ID desse evento como `ligacao_id` e ajustar a
apresentação do histórico para mostrar a data real enviada pela 3C, resumo,
duração e desfecho. `created_at` continua identificando quando o evento foi
registrado, que pode ser depois da ligação. Não gravar
essa sequência sobrescrevendo `leads.notes` ou usando um comentário editável.

**Autenticação.** Reaproveitar o cofre e a tela de Integrações, com uma chave
exclusiva da 3C, por exemplo no slot `3c/api_token`. Vincular a chave a uma
identidade técnica dedicada e às agendas e aos leads autorizados. O usuário
técnico não deve ganhar papel de corretor nem de administrador por conveniência.

A configuração administrativa contém apenas `enabled`, `integration_user_id`,
`allowed_group_ids`, `default_group_id`, `agenda_ids` e `outcomes`. A tela serve
para autorizar acesso e gerenciar a chave; não contém regras de atendimento.

A função terá `verify_jwt=false`, porque validará a chave Bearer recebida. Isso
não dispensa a autorização de cada operação e recurso. O Bearer opaco não serve
como JWT de usuário nas RPCs atuais; o adaptador precisa estabelecer o ator
técnico explicitamente. A service role, se necessária internamente, permanece
exclusiva do servidor e exige consultas restritas. Não será entregue à 3C.

Preservar o vínculo e as agendas ao rotacionar a chave: hoje a tela salva a
credencial com `config={}` e o backend substitui esse metadata. Também tratar
revogação com leitura fresca ou cache limitado na nova integração, pois
`getSecret` mantém valores positivos sem prazo. Não é necessário criar uma
plataforma genérica de permissões para atender um fornecedor.

## Sequência de implementação

1. **Fechar o contrato da API.** Registrar a definição de escopo acima e os
   campos, códigos, respostas e semântica de repetição em um contrato público
   específico da 3C. Usar a base HTTPS confirmada. Saída: contrato que as duas
   equipes conseguem implementar sem interpretar os exemplos como regras.
2. **Implementar acesso e leads.** Criar a função e a configuração de JWT,
   credencial própria, identidade técnica, autorização, busca/criação/PATCH e
   catálogo de etapas, com notas e dados adicionais visíveis no modal do lead.
   Preservar o webhook antigo. Saída: quatro operações
   verificadas, incluindo deduplicação concorrente e atualização parcial.
3. **Implementar agenda.** Fazer migrations aditivas, disponibilidade dentro da
   janela enviada pela 3C, reserva atômica e catálogo de agendas. Saída: três
   operações verificadas, sem reserva
   simultânea para a mesma ocupação e com a latência medida pelo HTTPS.
4. **Implementar histórico e repetição segura.** Registrar ligações e exibi-las
   no histórico. Combinar com a 3C um identificador de chamada/evento ou chave
   de idempotência para retries de ligações e reservas, que o PDF não define.
   Saída: oitava operação verificada, sem duplicação por reenvio e com tratamento
   de falha parcial entre reserva, PATCH e histórico. Uma chamada nova deve
   continuar gerando um registro novo.
5. **Homologar e entregar.** Preparar lead e agenda de teste isolados da
   operação real, validar a sequência completa junto da 3C e entregar base,
   credencial por cofre seguro e exemplos reais de resposta. A publicação usa
   o pipeline existente, com backup, migrations pendentes e verificação da
   release e dos serviços. A entrega só estará comprovada após os testes da
   3C, incluindo reserva visível ao corretor e histórico legível.

## Escopo definido e pendências de liberação

- Visitas por corretor, sempre na agenda do responsável atual. Novos leads
  aguardam a roleta; a reserva retorna `422 AGUARDANDO_DISTRIBUICAO` se ainda
  não houver responsável. Leads encerrados não são reativados.
- A 3C controla as regras comerciais de atendimento e envia período, duração
  e intervalo de reserva. Não há parâmetros de expediente a configurar no CRM.
- Desfechos de ligação são registros no histórico; não encerram nem movem o
  lead automaticamente. O PATCH muda somente os campos permitidos no contrato.
- A busca aceita exatamente um filtro; cadastro ambíguo exige identificar o
  ID correto. Extras são mesclados apenas no espaço da 3C, preservando os demais.
- Para liberar, faltam autorizar os grupos, o grupo de entrada e as agendas,
  gerar/compartilhar a chave por cofre seguro e executar os testes conjuntos.

## Verificação para aceite

- Chave ausente, inválida ou revogada é recusada; a identidade da integração
  não acessa lead ou agenda fora do alcance definido.
- Busca sem correspondência retorna `200` e `encontrado:false`; busca por cada
  filtro devolve o cadastro correto, com telefone e datas no formato combinado.
- Criações simultâneas do mesmo telefone devolvem o mesmo ID; POST de existente
  e PATCH preservam dados, histórico, responsável e campos não enviados.
- Catálogos fornecem códigos aceitos; etapa do lead não altera indevidamente
  status da roleta nem etapa de negócio.
- Disponibilidade respeita a janela e a duração enviadas pela 3C e as ocupações,
  sem impor expediente, antecedência ou horizonte do CRM. Array vazio é sucesso;
  período inválido ou mais de 5.000 candidatos retorna `422` sem truncamento.
- Reserva grava o intervalo exato solicitado, inclusive fora do horário
  comercial quando não houver conflito. Exige fim posterior ao início e
  corretor responsável atual, mantendo encerrados sem reativação.
- Disponibilidade atende ao requisito de até um segundo, medido na rota HTTPS
  com cenários representativos, incluindo inicialização e concorrência.
- Duas reservas conflitantes produzem uma criação e um `409`; conflito também
  é impedido contra gravação manual. Cancelamento existente libera a ocupação
  conforme a regra confirmada.
- Eventos e ligações ficam ligados ao lead e visíveis à equipe autorizada.
  Reenvio não duplica uma mesma operação e chamadas distintas se acumulam.
- Testes de contrato HTTP, concorrência SQL e apresentação do histórico passam;
  as migrations são verificadas sobre banco com histórico, sem seed ou reset.
- A 3C executa a primeira rodada conjunta e confere respostas reais de todas as
  operações antes da liberação operacional.

## Referências no código

- [Webhook atual](../../supabase/functions/voice-ai-webhook/index.ts), linhas
  61–185; [contrato anterior](./voice-ai-webhook.md).
- [Leads e histórico](../../supabase/migrations/20260725120400_0005_leads.sql),
  linhas 18–159; [normalização](../../supabase/migrations/20260725120000_0001_foundation.sql),
  linhas 125–143; [funil](../../supabase/migrations/20260725120000_0001_foundation.sql),
  linhas 36–55.
- [Visitas](../../supabase/migrations/20260725120500_0006_deals.sql), linhas
  366–386; [escrita compartilhada](../../src/integrations/supabase/activities.ts),
  linhas 179–229; [agendamento no lead](../../src/components/VisitPanel.tsx),
  linhas 51–65; [agendamento no negócio](../../src/components/pipeline/ScheduleVisitDialog.tsx),
  linhas 46–66 e 109–110.
- [Roteamento de funções](../../deploy/functions-main.ts), linhas 12–38;
  [empacotamento](../../deploy/package.py), linhas 23–27;
  [configuração de JWT](../../supabase/config.toml), linhas 46–50.
- [Cofre e cache](../../supabase/functions/_shared/secrets.ts), linhas 23–125;
  [gravação da credencial](../../src/integrations/supabase/integrations.ts),
  linhas 39–49; [tela de Integrações](../../src/pages/AdminIntegrations.tsx),
  linha 374; [autorização por usuário](../../supabase/functions/_shared/auth.ts),
  linhas 83–99.

As oito operações, a configuração administrativa, as migrations e os ajustes
diretamente afetados de agenda e histórico foram implementados e validados em
ambiente isolado. A publicação segue o pipeline existente. A integração permanece
desativada até a autorização dos grupos e agendas e a configuração da credencial;
a homologação conjunta com a 3C continua pendente. As regras comerciais de
atendimento são responsabilidade da 3C.
