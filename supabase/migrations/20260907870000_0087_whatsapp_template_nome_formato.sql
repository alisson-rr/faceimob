-- =============================================================================
-- 0087 — nome de template de WhatsApp no formato que a Meta registra.
--
-- `whatsapp_templates.name` NÃO é rótulo: é a chave do disparo. O
-- `meta-ads-webhook` (boas-vindas) e o `sdr-whatsapp-broadcast` (remarketing)
-- mandam `tpl.name` para a Graph API, que só conhece template com nome em
-- minúsculas, dígitos e `_`. Um nome como "Boas Vindas" era aceito aqui e
-- recusado lá: a falha aparecia em `remarketing_contacts.last_error` ou no
-- silêncio das boas-vindas, longe de quem cadastrou.
--
-- A aba WhatsApp passou a barrar o formato na tela, mas a tela não é a única
-- porta: todo papel de `whatsapp_templates_write` (admin, marketing, sdr —
-- migration 0069) grava por PostgREST direto, e os seeds também escrevem aqui.
-- O CHECK é o ponto por onde todos passam.
--
-- 512 é o limite de nome da Meta, cobrado por `char_length` e não pelo regex:
-- a repetição `{1,512}` estoura o limite de 255 do motor de regex do Postgres
-- ("invalid repetition count(s)"). As linhas de hoje ('boas_vindas_faceimob',
-- 'retomada_interesse') já obedecem, então a constraint entra validada.
-- =============================================================================

-- Ambiente que já rodava com o campo livre pode ter nome fora do padrão. Sem o
-- pré-teste, o `add constraint` abortaria com um 23514 seco — sem dizer QUAL
-- linha renomear — e travaria a fila de migrations desse ambiente.
do $$
declare
  fora_do_padrao text;
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.whatsapp_templates'::regclass
      and conname = 'whatsapp_templates_name_format'
  ) then
    return;
  end if;

  select string_agg(quote_literal(name), ', ' order by name)
    into fora_do_padrao
    from public.whatsapp_templates
   where name !~ '^[a-z0-9_]+$' or char_length(name) > 512;

  if fora_do_padrao is not null then
    raise exception
      'Templates com nome que a Meta não registra: %. Renomeie cada um (só minúsculas, dígitos e "_", até 512 caracteres) e aplique a 0087 de novo.',
      fora_do_padrao;
  end if;

  alter table public.whatsapp_templates
    add constraint whatsapp_templates_name_format
    check (name ~ '^[a-z0-9_]+$' and char_length(name) <= 512);
end $$;

comment on column public.whatsapp_templates.name is
  'Nome EXATO do template aprovado na Meta — é por ele que o disparo casa (Graph API). '
  'Só minúsculas, dígitos e "_" (constraint whatsapp_templates_name_format, migration 0087).';
