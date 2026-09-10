-- =============================================================================
-- 0067 — Um id externo de campanha pertence a UMA campanha
--
-- `leads.campaign_id` guarda só o id externo: o webhook não grava plataforma
-- nenhuma junto. Toda leitura de marketing liga lead a campanha por esse campo
-- sozinho — `marketing_developer_summary` (0063) faz
-- `left join public.ad_campaigns c on c.external_id = l.campaign_id`, e a tela
-- de /marketing indexa `marketing_campaign_stats` pelo `external_id`.
--
-- Só que o unique da tabela é `(platform, external_id)` (0011). Cadastrar o
-- MESMO id externo em duas plataformas era aceito, e aí cada lead da campanha
-- casava com duas linhas: o join multiplica, a soma por construtora fica MAIOR
-- que o total da empresa e o CPL do cabeçalho despenca pela metade. O assert do
-- bloco 4 de `supabase/tests/23_marketing_dados.sql` (`soma_leads =
-- total_leads`) quebraria — hoje não há duplicata no banco, então é falha
-- latente, não corrente.
--
-- O conserto não pode ser no join: o lead não carrega a plataforma, então não
-- há como desempatar na leitura. Ou o id externo é único, ou a conta é
-- ambígua por construção. Como o id é gerado pela própria plataforma de
-- anúncio, exigir unicidade global não tira nada de ninguém.
--
-- O unique `(platform, external_id)` continua: é implicado por este, custa um
-- índice e mantém válido qualquer `on conflict` já escrito contra ele.
-- =============================================================================

create unique index if not exists ad_campaigns_external_id_key
  on public.ad_campaigns (external_id);

comment on index public.ad_campaigns_external_id_key is
  'leads.campaign_id não carrega plataforma: id externo repetido faria o lead ser contado uma vez por plataforma.';
