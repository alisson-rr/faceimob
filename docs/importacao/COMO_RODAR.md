# Como rodar a importação do Bubble

Guia de operação. Não precisa saber programar: é copiar comando, olhar o resultado e seguir.

**O que entra:** pessoas e equipes, catálogo (construtoras, empreendimentos, links, dicas, mural),
negócios com clientes/participantes/esteira de crédito, os comentários e a trilha de anexos dos
negócios, o jogo com as metas, os leads com comentários e ligações, e os documentos dos negócios —
estes com o arquivo indo para o Storage privado.
**O que NÃO entra:** o arquivo dos negócios parados há mais de 12 meses (a linha entra marcada como
não migrada, decisão N-28) e os 746 arquivos que só aparecem em `pipelines.documentos`, sem
correspondência em `doc-clientes`.

Tudo é reexecutável: cada linha importada fica registrada em `public.import_bubble_map`, e rodar de
novo pula o que já entrou. Não há "importar duas vezes por engano".

---

## 1. Antes de rodar

Uma vez, na ordem:

1. **Node 22 ou mais novo.** Com Node 20 o script para na primeira linha com
   `native WebSocket not found`. Conferir com `node -v`; se for 20, `nvm install 22 && nvm use 22`.
2. **Migration `0096` aplicada** (`supabase/migrations/20260909960000_0096_import_bubble_map.sql`).
   É ela que cria a tabela de rastro `import_bubble_map`. Sem ela o orquestrador aborta e diz isso.
3. **`.env` na raiz** com `VITE_SUPABASE_URL` apontando para o banco certo. **Confira duas vezes qual
   banco é.**
4. **Chave de serviço no ambiente** (nunca em arquivo, nunca commitada):
   ```powershell
   $env:SUPABASE_SERVICE_ROLE_KEY = "cole aqui a service_role de Project Settings → API"
   ```
   Ela vale só para esta janela do terminal. Fechou o terminal, precisa exportar de novo.
5. **Os exports em `DOCUMENTOS/DADOS_BUBBLE/`**, como vieram do Bubble: o reexport em JSON dentro de
   `json/` e os CSVs de 08/09 na raiz da pasta. Nenhum precisa ser editado — cada carga escolhe
   sozinha o arquivo mais novo, JSON antes de CSV.
6. **Espaço e banda para a carga de documentos** (a última): ela baixa ~4,4 GB (mediana da amostra)
   a ~8,9 GB (média) do CDN do Bubble e sobe o mesmo volume para o Storage. Pode ser rodada
   sozinha e retomada depois.

---

## 2. Preparar o banco

Rode este bloco **como `postgres`** (MCP do Supabase ou `psql` — a chave de serviço não tem permissão
para desligar gatilho). É o que impede a importação de disparar notificação, distribuir lead do
legado e reescrever data de negócio antigo — e o que libera os meses já fechados para receber o
histórico. Tudo o que ele desliga volta na seção 5.

```sql
-- 0. ANOTE quais robôs estão ativos agora. A seção 5 religa só estes: se algum estava
--    pausado de propósito, ligar todos no fim o traria de volta sem ninguém pedir.
select jobname from cron.job where jobname like 'faceimob-%' and active order by 1;
--    (num banco recém-aplicado são os 10 que o PLANO conta)

-- 1. congelar os robôs de horário (um deles roda a cada minuto).
--    `alter_job` só desliga: o agendamento continua guardado e volta com um comando só.
--    Não use `cron.unschedule` aqui — os robôs nascem espalhados por 7 migrations e
--    recriá-los à mão depois é a forma mais fácil de perder um pelo caminho.
select cron.alter_job(jobid, active := false) from cron.job where jobname like 'faceimob-%';

-- 2. pausar a roleta de leads e calar os dois avisos automáticos de lead.
--    Sem os dois `notify_*` a carga de leads ABORTA na própria sonda: eles notificam
--    o corretor a cada lead atribuído e a cada prazo estourado, e são 102.799 leads.
update public.automation_settings
   set leads_paused = true, notify_on_assign = false, notify_on_timeout = false
 where id;

-- 3. desligar os gatilhos que atrapalham a carga de negócios
--    (um comando por gatilho: a sintaxe não aceita lista)
alter table public.deals             disable trigger deals_default_month_base;
alter table public.deals             disable trigger deals_add_creator_participant;
alter table public.deals             disable trigger deals_award_points;
alter table public.deal_participants disable trigger deal_participants_autofill;
alter table public.deal_participants disable trigger deal_participants_award_points;
alter table public.cca_cases         disable trigger cca_cases_sync_esteira_label;
alter table public.cca_cases         disable trigger cca_award_points;
alter table public.cca_cases         disable trigger notify_cca_case_created;
-- e o único da carga de documentos: sem ele, cada anexo de negócio incompleto
-- pontua o jogo na temporada aberta HOJE, com documento de 2024.
alter table public.deal_documents    disable trigger deal_documents_award_points;
-- NÃO desligue `deal_participants_resplit`: é ele que divide a comissão entre os corretores.
-- NÃO desligue NENHUM gatilho de `leads`, `lead_comments`, `lead_events`, `deal_history` ou
-- `document_types`. Em especial `leads_normalize` PRECISA FICAR LIGADO: é ele que deriva o
-- telefone no formato do sistema a partir do texto do Bubble. Desligado, os 100.342 telefones
-- entram fora do padrão, a busca por telefone e a dedupe de lead param de achar — e a carga de
-- leads aborta antes de gravar, porque confere isso com um lead descartável.
-- `deal_history` (comentários e trilha de anexos) não tem gatilho nenhum: nada a fazer.

-- 4. reabrir os meses fechados. A carga de negócios se recusa a gravar negócio em mês
--    fechado, e o gatilho `deals_guard_closed_month` recusaria linha a linha: ele só isenta
--    o administrador, e a chave de serviço não é administrador. Sem este passo a importação
--    para na terceira carga (501 negócios caem em mês fechado num banco com os seeds).
--    A cópia guarda as linhas inteiras e a seção 5 refecha tudo. NÃO apague a cópia.
--    O gatilho de log sai junto: sem isso, apagar os meses grava em `month_reopenings`
--    uma reabertura por mês, sem responsável, e esse rastro contábil falso fica para sempre.
alter table public.closed_months disable trigger closed_months_log_reopen;
create table if not exists private.closed_months_import as table public.closed_months;
delete from public.closed_months;
```

Confira que a preparação pegou:

```sql
select count(*) from cron.job where jobname like 'faceimob-%' and active;  -- esperado: 0
select leads_paused, notify_on_assign, notify_on_timeout
  from public.automation_settings where id;                                -- esperado: t | f | f
select count(*) from public.closed_months;                                 -- esperado: 0
select count(*) from private.closed_months_import;  -- ANOTE: é quantos meses voltam na seção 5

-- os gatilhos desligados são exatamente estes 9, e `leads_normalize` NÃO está entre eles
select tgrelid::regclass as tabela, tgname
  from pg_trigger where not tgisinternal and tgenabled = 'D' order by 1, 2;
```

---

## 3. Ensaio (não grava nada)

```powershell
node scripts/import/run.mjs --dry-run
```

Lê os exports inteiros, resolve todos os vínculos, imprime o relatório de cada carga e **não escreve
uma linha**. Nenhum arquivo é baixado: a carga de documentos só mede o tamanho de uma amostra de 30
no CDN, para estimar o volume. Demora alguns minutos. O que olhar no fim:

- **O inventário fecha em `+0` em todas as linhas.** É a prova de que o ensaio não gravou.
- **As contagens de cada carga batem com o esperado:** 298 pessoas, 12 equipes, 41 construtoras,
  618 empreendimentos, 3 links, 10 dicas, 18 avisos, 7.579 negócios, 7.560 casos de crédito,
  24.628 comentários de negócio, 10.110 linhas de trilha de anexos, 7 temporadas, 35 regras,
  629 linhas de pódio, 191 metas, 66 resultados anuais, 102.799 leads, 7.432 comentários de lead,
  6.337 ligações e 29.573 documentos (21.758 com arquivo, 7.815 marcados como não migrados).
- **Os avisos (`!`) de vínculo não resolvido.** Alguns são esperados e estão explicados no cabeçalho
  de cada carga (`scripts/import/01-pessoas.mjs` e seguintes). Uma enxurrada de "não resolvido" quer
  dizer que a carga anterior não rodou, ou que o CSV errado foi escolhido.
- **Qualquer `ABORTADO`.** O motivo vem escrito junto com o comando que resolve.

Para ensaiar uma carga só: `node scripts/import/run.mjs negocios --dry-run`.

---

## 4. Carga de verdade

```powershell
node scripts/import/run.mjs --gatilhos-desligados
```

A opção `--gatilhos-desligados` é a sua confirmação de que o bloco da seção 2 já foi rodado. Não dá
para verificar isso de fora do banco (o PostgREST não lê o catálogo de gatilhos), então o
orquestrador confia na sua palavra — e a carga de negócios ainda confere sozinha, gravando um
negócio descartável e apagando em seguida antes de começar de verdade. Dois passos da seção 2 ele
confere sozinho e para antes da primeira gravação: a roleta pausada e nenhum mês fechado. A carga de
leads confere mais dois, do mesmo jeito, com um lead descartável: os dois avisos automáticos
desligados e o `leads_normalize` LIGADO.

As sete cargas rodam em sequência, cada uma no seu processo: **pessoas → catálogo → negócios →
histórico → jogo e metas → leads → documentos**. Nenhuma transação envolve duas cargas. Se uma
falhar, o orquestrador para ali; as anteriores continuam gravadas e válidas.

Uma carga só, quando você já sabe qual: `node scripts/import/run.mjs negocios --gatilhos-desligados`
(os nomes são `pessoas`, `catalogo`, `negocios`, `historico`, `jogo-metas`, `leads`, `documentos`).

A ordem não é gosto — é dependência:

| Carga | Exige antes | Por quê |
|---|---|---|
| `historico` (03b) | `negocios` | o comentário aponta para o negócio, e o vínculo sai do de-para |
| `leads` (05) | `pessoas` | sem ela o lead nasce sem corretor responsável, e a reexecução **não** conserta (o insert é `DO NOTHING` na chave do lead) |
| `documentos` (06) | `pessoas` e `negocios` | o documento aponta para o negócio (obrigatório) e para quem anexou |

As duas últimas são as demoradas: `leads` lê 102.799 linhas e `documentos` baixa e sobe os arquivos,
em blocos, retomando de onde parou. Rodar `node scripts/import/run.mjs documentos
--gatilhos-desligados` de novo depois de uma queda **não rebaixa o que já entrou**.

No fim, a carga de negócios imprime `início da carga (para as consultas de aceite):
2026-09-09T17:03:11.244Z`. **Copie esse instante** — é ele que a seção 6 usa (termina em `Z`, é
UTC). Se você rodou só as outras cargas, anote a hora de início **com o fuso**: `2026-09-09 14:00-03`.

---

## 5. RELIGAR O BANCO — não pule esta parte

**Enquanto isto não for feito o sistema fica sem notificação, sem histórico de esteira, sem
distribuição de lead, sem pontuação no jogo e com os meses de fechamento contábil abertos.**
Rode como `postgres`, na ordem inversa:

```sql
-- 1. gatilhos de volta
alter table public.deal_documents    enable trigger deal_documents_award_points;
alter table public.cca_cases         enable trigger notify_cca_case_created;
alter table public.cca_cases         enable trigger cca_award_points;
alter table public.cca_cases         enable trigger cca_cases_sync_esteira_label;
alter table public.deal_participants enable trigger deal_participants_award_points;
alter table public.deal_participants enable trigger deal_participants_autofill;
alter table public.deals             enable trigger deals_award_points;
alter table public.deals             enable trigger deals_add_creator_participant;
alter table public.deals             enable trigger deals_default_month_base;

-- 2. os meses fechados voltam exatamente como estavam (mesma data, mesmo responsável)
insert into public.closed_months select * from private.closed_months_import
on conflict (period) do nothing;
alter table public.closed_months enable trigger closed_months_log_reopen;
drop table if exists private.closed_months_import;

-- confira que nenhuma reabertura falsa ficou registrada
select count(*) from public.month_reopenings where reopened_by is null;  -- esperado: 0

-- 3. a roleta de leads e os dois avisos de lead voltam.
--    ANTES do `update` abaixo, rode a conferência de notificações da seção 6: depois dele ela
--    não acusa mais nada, porque o que estava na fila passa a contar como despachado.
--    O `update` carimba como despachada a fila de e-mail/WhatsApp que a carga possa ter criado:
--    sem ele o robô de envio manda mensagem de dado de 2024 para cliente real.
--    (`in_app` fica de fora: é o sininho dentro do sistema, não sai para ninguém.)
update public.notifications
   set sent_at = now(), last_error = 'descartada: carga de dados legados'
 where channel <> 'in_app' and sent_at is null
   and created_at >= timestamptz '2026-09-09T17:03:11Z';   -- o instante da seção 4
update public.automation_settings
   set leads_paused = false, notify_on_assign = true, notify_on_timeout = true
 where id;

-- 4. o jogo precisa de uma temporada aberta, senão todo corretor recebe aviso de "jogo parado".
--    As 7 temporadas do Bubble entram fechadas; esta linha abre a de produção se não houver nenhuma.
insert into public.game_seasons (label, period_start)
select public.season_label_ptbr(current_date), public.month_start(current_date)
where not exists (select 1 from public.game_seasons where closed_at is null);

-- 5. os robôs de horário voltam — SÓ os que estavam ativos na seção 2. Cole a lista anotada lá;
--    ligar todos traria de volta um robô que alguém tinha pausado de propósito.
select cron.alter_job(jobid, active := true) from cron.job
 where jobname in ('faceimob-assign-queued', 'faceimob-notify-dispatch' /* … a lista da seção 2 */);
```

Conferência do religamento:

```sql
select count(*) from cron.job where jobname like 'faceimob-%' and active;  -- quantos nomes você anotou
select leads_paused, notify_on_assign, notify_on_timeout
  from public.automation_settings where id;                                -- esperado: f | t | t
select count(*) from public.closed_months;                                 -- o número anotado na seção 2
select count(*) from public.game_seasons where closed_at is null;          -- esperado: 1
select tgrelid::regclass as tabela, tgname, tgenabled
  from pg_trigger where not tgisinternal and tgenabled <> 'O';             -- esperado: 0 linhas
```

A última consulta lista qualquer gatilho que tenha ficado desligado. `0 linhas` = todos ligados.

---

## 6. Conferir que deu certo

Toda conferência é escopada por procedência (`import_bubble_map`). **Nunca use `count(*)` da tabela**:
o banco já tem dado de seed e de demonstração, e o total somado reprova uma carga correta.

```sql
-- volumes do que foi importado
select entidade, tabela_destino, count(*)
  from public.import_bubble_map group by 1,2 order by 1,2;
-- user→profiles 298 · equipe→teams 12 · construtora→developers 41 ·
-- empreendimento→developer_projects 618 · link→useful_links 3 · dica→gold_tips 10 ·
-- mensagem→important_notices 18 · pipeline→deals 7.579 · pipeline→cca_cases 7.560 ·
-- observacao→deal_history 24.628 · historico_pipe→deal_history 10.110 ·
-- temporada→game_seasons 7 · regra_jogo→game_scoring_rules 35 · placar→game_season_results 629 ·
-- meta_equipe→goals 191 · resultado_anual→annual_results 66 ·
-- lead→leads 102.799 · lead→lead_comments 7.432 · ligacao→lead_events 6.337 ·
-- doc_arquivo→deal_documents 29.573

-- o VGV bateu ao centavo
select round(sum(vgv_gross), 2) from public.deals d
  join public.import_bubble_map m on m.registro_id = d.id and m.tabela_destino = 'deals';
-- esperado: 465819613.45

-- nenhum gatilho escapou: ninguém foi notificado pela importação.
-- Troque o instante pelo que a carga de negócios imprimiu (seção 4) — sempre com fuso, senão
-- o editor SQL lê como UTC e a janela abre 3 h antes. As notificações de seed e de demonstração
-- já nascem com `sent_at` preenchido, então não entram nesta conta.
select count(*) from public.notifications
 where sent_at is null and created_at >= timestamptz '2026-09-09T17:03:11Z';
-- esperado: 0. Se vier número, confira o `kind` antes (o sistema em uso também notifica) e apague:
--   delete from public.notifications
--    where sent_at is null and created_at >= timestamptz '2026-09-09T17:03:11Z';

-- a comissão fecha 100% em todo negócio com corretor (só nos negócios importados:
-- `deal_participants` também tem seed e demonstração)
select p.deal_id from public.deal_participants p
  join public.import_bubble_map m on m.registro_id = p.deal_id and m.tabela_destino = 'deals'
 where p.role = 'broker' group by 1 having sum(p.share_pct) <> 100;       -- esperado: 0 linhas

-- os leads entraram com o desfecho certo e NENHUM foi parar na roleta
select l.status, count(*) from public.leads l
  join public.import_bubble_map m on m.registro_id = l.id and m.tabela_destino = 'leads'
 group by 1;
-- esperado: in_progress 65.756 · lost 31.160 · discarded 5.824 · converted 59
--           e nenhuma linha 'queued', 'assigned' ou 'attending'

-- o telefone do lead foi normalizado (se vier número, `leads_normalize` estava desligado
-- e a carga de leads precisa ser refeita — a busca por telefone não acha esses leads)
select count(*) from public.leads
 where external_id like 'bubble:leadfy:%' and phone is not null and phone !~ '^55[0-9]{10,11}$';
-- esperado: 0

-- documentos: quem ficou sem o arquivo está marcado no caminho, e só ele
select (storage_path like '%/nao-migrado/%') as sem_arquivo, count(*)
  from public.deal_documents d
  join public.import_bubble_map m on m.registro_id = d.id and m.entidade = 'doc_arquivo'
 group by 1;                                    -- esperado: false 21.758 · true 7.815

-- documentos: nenhum CPF sobrou no nome que a tela mostra e o e-mail anexa (N-27)
select count(*) from public.deal_documents d
  join public.import_bubble_map m on m.registro_id = d.id and m.entidade = 'doc_arquivo'
 where d.stored_name ~ '[0-9]{3}[.-][0-9]{3}[.-][0-9]{3}' or d.stored_name ~ '[0-9]{11}';
-- esperado: 0
```

Os arquivos que foram para o Storage não têm SQL que case linha e objeto (são duas gravações
diferentes). A conferência é pela tela do negócio, ou repetindo a carga `documentos`: ela só reenvia
o que ainda não está no de-para.

O cabeçalho de cada carga (`scripts/import/01-pessoas.mjs` … `06-documentos.mjs`) traz a lista
completa de conferências daquele domínio, com o número esperado ao lado de cada uma.

Na tela, o teste rápido: entrar no sistema, abrir **Pipeline** (negócios do legado aparecem, com os
comentários e a caixa de documentos de um negócio recente), **Leads** (a base do legado, com o
telefone formatado), **Equipes** (12 equipes), **Gamificação → temporadas anteriores** (7 pódios) e
**Resultados** (a série anual sem buracos além dos conhecidos).

---

## 6.1. Readmitir alguém que veio desligado do Bubble

As 205 pessoas desligadas entram como **suspensas**, com a conta de login bloqueada até 2126.
Elas não entram como "desligadas" porque o banco exige data de desligamento junto com esse estado,
e o Bubble não exporta essa data (decisão N-10).

Consequência prática: a tela de edição só oferece o botão de reativar acesso para quem está marcado
como *desligado*. Para uma dessas 205, mudar o status na tela para **Ativo não destrava o login** —
a pessoa continua trancada do lado de fora, sem mensagem de erro.

Se alguém for readmitido, tire o bloqueio pelo banco, rodando como `postgres`:

```sql
update auth.users
   set banned_until = null
 where email = 'pessoa@faceimob.com.br';
```

Confira quem ainda está bloqueado por causa da importação:

```sql
select p.email, p.status, u.banned_until
  from auth.users u
  join public.profiles p on p.id = u.id
  join public.import_bubble_map m on m.registro_id = p.id and m.tabela_destino = 'profiles'
 where u.banned_until > now()
 order by p.email;
```

Quando a operação levantar as datas reais de desligamento, o certo é rodar um `update` que grave
`status = 'terminated'` e `terminated_at` juntos — o banco recusa um sem o outro.

---

## 7. Se der errado

**Parou no meio.** A mensagem diz em qual carga. Corrija o que ela apontou e rode de novo só aquela:
`node scripts/import/run.mjs negocios --gatilhos-desligados`. O que já entrou não entra duas vezes.

**Rodou duas vezes sem querer.** Não faz mal: a segunda passada encontra tudo no `import_bubble_map`
e não grava nada. O inventário no fim mostra `+0`.

**Entrou dado errado e você quer refazer do zero.** Apagar a importação é destrutivo e não tem
script: cada tabela depende da outra (negócio aponta para construtora, participante aponta para
negócio) e o banco recusa o `delete` fora de ordem. No Supabase **local** o caminho é recriar tudo
com `npm run db:reset` e repetir este guia da seção 2. Em **homologação ou produção não existe botão
de desfazer** — não improvise um `delete`: chame quem escreveu o importador. Para saber o que a carga
criou, a resposta está em `import_bubble_map` (`registro_id` é a linha, `tabela_destino` é onde ela
está).

**A mensagem fala em mês fechado.** Você pulou o passo 4 da seção 2. Nem desligar gatilho resolve:
a carga de negócios confere `public.closed_months` por conta própria e para antes de gravar, e o
gatilho `deals_guard_closed_month` só isenta o administrador — a chave de serviço não fura a trava.
Rode o passo 4, repita a carga e não esqueça o passo 2 da seção 5, que refecha os meses.

**A mensagem fala em `SUPABASE_SERVICE_ROLE_KEY`.** A variável se perde quando o terminal fecha.
Exporte de novo (seção 1, item 4).

**A mensagem fala em `import_bubble_map`.** A migration 0096 não foi aplicada (seção 1, item 2).

**A mensagem fala em `native WebSocket`.** Node antigo: `nvm use 22`.
