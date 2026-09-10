-- -----------------------------------------------------------------------------
-- 0054 — o sino tinha um destino que dava 404
--
-- O QUE ESTAVA ERRADO
--
-- `notifications.link` guardava '/daily' em um aviso de `kind='daily_submitted'`
-- (origem: `supabase/seeds/040_reports_game_workspace.sql`, destinatário: a
-- diretora). Não existe rota `/daily` sem parâmetro: `App.tsx` só registra
-- `/daily/:teamId/:slug` e `/daily/:slug`. Clicar no aviso levava ao NotFound.
--
-- O `resolveLink` do front (src/lib/notificationLink.ts) não salva este caso, e
-- não deveria: '/daily' É um caminho interno bem formado — a lista branca dele
-- existe para barrar `//host`, `\\host` e `javascript:`, não para adivinhar
-- rotas. Quem sabe o destino certo é quem escreveu o aviso.
--
-- POR QUE /checkpoint
--
-- O aviso diz "as duas equipes enviaram o fechamento diário" e vai para um
-- diretor. Diário é ESCRITA (link público com PIN, sem login); a leitura
-- consolidada desses mesmos números é o **Checkpoint** (ver CONTEXT.md). E
-- `menu.checkpoint` é concedido a director, manager e partner — o destinatário
-- abre a tela. Mandar para `/daily/<slug>` de uma equipe seria escolher uma das
-- duas equipes que o texto cita.
--
-- ESCOPO
--
-- Só corrige o dado que já existe. A origem (o seed) continua escrevendo
-- '/daily' e está registrada como pendência para o dono daquele arquivo: num
-- `db reset` local o seed roda DEPOIS das migrations e a linha volta.
--
-- Idempotente: o `where` não casa nada na segunda execução.
-- -----------------------------------------------------------------------------

update public.notifications
   set link = '/checkpoint'
 where link = '/daily';

-- -----------------------------------------------------------------------------
-- 0054b — a foto de perfil não tinha limite nenhum
--
-- O QUE ESTAVA ERRADO
--
-- O bucket `avatars` estava com `file_size_limit` e `allowed_mime_types` NULOS:
-- qualquer autenticado gravava arquivo de qualquer tipo e qualquer tamanho na
-- própria pasta (a policy `avatars_write` só confere a pasta = `auth.uid()`).
-- A tela até dizia "envie uma imagem de até 5 MB", mas essa regra não existia em
-- lugar nenhum — e a URL assinada resultante é gravada em `profiles.avatar_url`
-- e renderizada em <img> por todo colega visível.
--
-- POR QUE NO BUCKET
--
-- São DOIS caminhos de upload no front (`src/pages/Settings.tsx` e
-- `src/components/BrokerEditModal.tsx`). Validar só na tela deixa o outro
-- caminho aberto e não vale nada contra quem chama a API direto: a fronteira
-- que os dois atravessam é o Storage. As telas continuam validando para dar a
-- mensagem antes de gastar a subida.
--
-- ESCOPO
--
-- Só o bucket de avatar. `deal-documents` e `lead-attachments` recebem PDF e
-- planilha, com limites próprios a definir por quem cuida daqueles fluxos.
--
-- Idempotente: `update` com valores fixos; rodar de novo grava o mesmo valor.
-- -----------------------------------------------------------------------------

-- O `do` condicionado a coluna existe porque `scripts/validate-schema.sh` roda
-- as migrations contra um `storage.buckets` reduzido (00_supabase_stubs.sql),
-- sem as colunas de limite. Em Supabase de verdade as duas existem.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets'
      and column_name = 'file_size_limit'
  ) then
    execute $sql$
      update storage.buckets
         set file_size_limit = 5 * 1024 * 1024,
             allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
       where id = 'avatars'
    $sql$;
  end if;
end
$$;
