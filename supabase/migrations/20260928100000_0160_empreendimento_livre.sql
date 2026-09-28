-- Empreendimento em texto livre no negócio (pedido do cliente em 28/09/2026).
--
-- Até aqui o negócio só guardava `project_id`, e o campo da tela era uma lista
-- dos empreendimentos cadastrados da construtora: empreendimento que o admin
-- ainda não cadastrou travava o negócio. Agora o nome digitado é o dado
-- (`project_name`), e `project_id` continua ligado quando o nome bate com um
-- empreendimento cadastrado daquela construtora — relatório e campanha que
-- usam o vínculo seguem funcionando para esses.
--
-- Sem backfill: a leitura usa `project_name` e, na falta dele, o nome do
-- cadastro pelo `project_id`, então os negócios de antes aparecem iguais.

alter table public.deals
  add column if not exists project_name text;

alter table public.deals
  add constraint deals_project_name_length
  check (project_name is null or char_length(project_name) <= 120);

comment on column public.deals.project_name is
  'Empreendimento digitado no negócio (0160). project_id só quando o nome bate com o cadastro da construtora.';
