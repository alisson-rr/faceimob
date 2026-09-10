-- A análise de crédito é editada na aba CCA do modal de negócio, em /pipeline.
-- O papel cca tinha permissão de banco para editar, mas o guard da rota o
-- barrava antes de chegar ao formulário.
insert into public.role_permissions (role, permission, allowed)
values ('cca', 'menu.pipeline', true)
on conflict (role, permission) do update set allowed = excluded.allowed;
