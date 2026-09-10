-- -----------------------------------------------------------------------------
-- 0025 — a posição do participante do negócio passa a ser dado, não acaso
--
-- A tela tem slots nomeados desde a ata de 23/07: "Corretor 1/2/3" e
-- "Gerente 1 (Obrigatório)" / "Gerente 2 (opcional)". No banco, porém,
-- `deal_participants` só guardava (deal, profile, role): a leitura reconstruía
-- os slots pela ordem de `created_at`, e todas as linhas de um mesmo negócio são
-- gravadas no MESMO insert — logo com o mesmo `created_at`, ao microssegundo.
--
-- Consequência: quem estava em "Gerente 1" reaparecia em "Gerente 2" depois do
-- reload, sem ninguém ter editado nada. Para o corretor o efeito é pior do que
-- parece — ele reabre o negócio, vê o nome errado no slot obrigatório e
-- "corrige", trocando de verdade quem responde pelo negócio.
--
-- `ordinal` guarda o slot. `deal_clients` já usava a mesma ideia.
-- -----------------------------------------------------------------------------
alter table public.deal_participants
  add column if not exists ordinal smallint not null default 1;

-- Backfill determinístico: mantém a ordem que a leitura antiga *tentava* usar.
with numerado as (
  select id,
         row_number() over (partition by deal_id, role order by created_at, id) as n
  from public.deal_participants
)
update public.deal_participants p
   set ordinal = least(numerado.n, 3)::smallint
  from numerado
 where numerado.id = p.id;

alter table public.deal_participants
  add constraint deal_participants_ordinal_check check (ordinal between 1 and 3);

comment on column public.deal_participants.ordinal is
  'Slot do participante dentro do papel (Corretor 1/2/3, Gerente 1/2/3). A tela depende dele para não trocar as pessoas de lugar entre um reload e outro.';
