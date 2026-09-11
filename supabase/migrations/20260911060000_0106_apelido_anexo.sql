-- =============================================================================
-- 0106 · Apelido do anexo
--
-- O QUE FOI PEDIDO, em 10/09/2026: "permitir renomear anexo". Na volta o cliente
-- aceitou o desenho de APELIDO: o nome real do arquivo continua saindo do molde
-- por tipo (`document_types.naming_pattern`), porque é ESSE nome que vai
-- anexado no e-mail da construtora — `supabase/functions/submission-dispatch/
-- index.ts` monta cada `attachment` com `stored_name`. O apelido é só o rótulo
-- que aparece na tela.
--
-- POR QUE UMA COLUNA NOVA, E NÃO RENOMEAR `stored_name`. Trocar o `stored_name`
-- mudaria o nome do anexo que a construtora recebe e o nome do download
-- assinado — ou seja, o registro do que já foi enviado. O dossiê é prova desde a
-- 0077; o apelido é etiqueta.
--
-- POR QUE UMA RPC, E NÃO UMA POLICY DE UPDATE. `deal_documents` não tem policy
-- de UPDATE nenhuma, e não pode ganhar uma: a 0023 concede `update` de TABELA a
-- `authenticated`, então uma policy nova abriria junto `storage_path`,
-- `stored_name`, `version` e `superseded_at` — exatamente o que a 0077 travou
-- para o dossiê parar de mudar debaixo de quem confere. `rename_deal_document`
-- é `security definer`, cobra `can_edit_deal` e grava UMA coluna.
-- =============================================================================

alter table public.deal_documents
  add column if not exists display_name text;

-- Fronteira no banco, não só na tela. Apelido em branco é ausência de apelido (a
-- tela manda `null` para limpar), e 120 é o que cabe numa linha da lista a
-- 375 px sem empurrar "Baixar"/"Excluir" para fora — o mesmo número está em
-- `MAX_DOCUMENT_ALIAS`, no front.
alter table public.deal_documents
  drop constraint if exists deal_documents_display_name_check;

alter table public.deal_documents
  add constraint deal_documents_display_name_check
  check (
    display_name is null
    or (btrim(display_name) = display_name and length(display_name) between 1 and 120)
  );

comment on column public.deal_documents.display_name is
  'Apelido exibido na tela (0106). NULL = a tela mostra `stored_name`. Nunca vai no e-mail da construtora: o anexo continua saindo com `stored_name`.';

-- -----------------------------------------------------------------------------
-- rename_deal_document — a única porta de escrita do apelido.
-- -----------------------------------------------------------------------------
create or replace function public.rename_deal_document(p_document_id uuid, p_alias text)
returns public.deal_documents
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_alias text := nullif(btrim(coalesce(p_alias, '')), '');
  v_deal  uuid;
  v_row   public.deal_documents;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  select deal_id into v_deal
  from public.deal_documents
  where id = p_document_id;

  -- Documento inexistente e documento fora do seu alcance dão a MESMA recusa: a
  -- função é `security definer` e enxerga a tabela inteira, então distinguir os
  -- dois casos aqui contaria a quem não pode ver que o id existe.
  if v_deal is null or not public.can_edit_deal(v_deal) then
    raise exception 'Documento fora do seu alcance, ou você não edita este negócio.'
      using errcode = '42501';
  end if;

  if length(v_alias) > 120 then
    raise exception 'Apelido longo demais (máx. 120).' using errcode = 'P0001';
  end if;

  update public.deal_documents
     set display_name = v_alias
   where id = p_document_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.rename_deal_document(uuid, text) from public, anon;
grant execute on function public.rename_deal_document(uuid, text) to authenticated;

comment on function public.rename_deal_document is
  'Apelido do anexo (pedido de 10/09/2026). Grava só `display_name`, cobra `can_edit_deal` e não toca em `stored_name` — o nome que vai anexado no e-mail da construtora. `p_alias` nulo ou em branco limpa o apelido.';
