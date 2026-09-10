-- =============================================================================
-- 0095 · Revogar credencial do cofre nunca funcionou: `secret` é `not null`
--
-- `public.revoke_integration_secret()` (0082) apaga o valor com
-- `set secret = null, active = false`. `private.integration_credentials.secret`
-- é `text not null` desde a 0011. A RPC inteira, portanto, sempre estourou
-- 23502 (`null value in column "secret" ... violates not-null constraint`) — o
-- botão "Revogar" do Admin · Integrações nunca apagou nada, e a chave que
-- alguém revogou por ter vazado continuou no banco, ativa.
--
-- Reproduzido pelo harness SQL em `supabase/tests/82_sdr_cofre_fila.sql`, que
-- cobra `secret is null` depois de revogar e parava justamente aí.
--
-- POR QUE TORNAR A COLUNA NULA, E NÃO GRAVAR STRING VAZIA. O schema já foi
-- escrito esperando ausência: `list_integrations()` devolve
-- `has_secret = (c.secret is not null and c.secret <> '')` desde a 0011 — os
-- dois lados do `or` só fazem sentido se o valor puder faltar. Gravar `''` em
-- vez de nulo faria "sem segredo" ter duas representações e deixaria a coluna
-- prometendo um invariante ("toda linha tem segredo") que a revogação existe
-- para quebrar.
--
-- POR QUE É SEGURO PARA QUEM LÊ. Os seis leitores do cofre filtram `and active`
-- (`private.get_integration_secret` e os cinco `select secret into v_url/v_key`
-- das 0018, 0020, 0059, 0065 e 0083), e a revogação desativa a linha na mesma
-- instrução. Nenhum deles chega a ver a linha revogada, muito menos o nulo.
--
-- POR QUE NÃO ENTRA UM CHECK "ativa implica ter segredo". Seria a trava natural
-- para substituir o `not null`, mas `set_integration_secret()` aceita qualquer
-- texto e a homologação pode ter linha ativa com segredo vazio (é o caso que o
-- `c.secret <> ''` de `list_integrations` cobre). Um check assim faria ESTA
-- migration falhar no deploy sobre dado que já existe. Fica registrado:
-- ponytail: sem check de "ativa tem segredo"; evoluir quando
-- `select count(*) from private.integration_credentials where active and
-- coalesce(secret,'') = ''` der zero em produção.
--
-- Idempotente: `drop not null` sobre coluna já nula é no-op.
-- Não muda nada em `public`: `private` não é exposto pelo PostgREST e
-- `types.ts` não precisa ser regerado.
-- =============================================================================

alter table private.integration_credentials
  alter column secret drop not null;

comment on column private.integration_credentials.secret is
  'Segredo da integração. Nulo significa revogado (0095): revoke_integration_secret apaga o valor e desativa a linha na mesma instrução, e todo leitor do cofre filtra por active.';
