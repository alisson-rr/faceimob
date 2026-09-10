#!/usr/bin/env node
/**
 * Carga 05 — Leads, comentários do lead e ligações.
 *
 * Origem : export_All-leadfies-modified--_2026-09-08_19-40-11.csv (102.799 × 42)
 *          export_All-ligacoes_2026-09-08_19-41-06.csv (8.365 × 6, SEM `unique id`)
 *          export_All-Users_* (índice de nomes: `Corretor`/`Gerente`/`Creator` são NOME)
 * Destino: public.leads · public.lead_comments · public.lead_events (kind='call')
 *          · public.lead_sources (5 códigos novos)
 * De-para: import_bubble_map — entidade 'lead' → 'leads' e 'lead_comments';
 *          entidade 'ligacao' → 'lead_events'.
 *
 * `leadfies` NÃO veio no reexport de N-05 e não virá: o CSV de 08/09 é o arquivo
 * final. Por isso as duas decisões que `DECISOES.md` adiava "para depois do
 * reexport" — N-02 (`Arquivado` → `lost`/`discarded`) e N-03/R-08 (a escada de
 * nomes) — estão fechadas aqui, com o número medido no próprio CSV, e não no
 * reexport que não existe.
 *
 *   node scripts/import/05-leads.mjs --dry-run    → lê, resolve, mede e NÃO grava
 *   node scripts/import/05-leads.mjs              → grava (exige SUPABASE_SERVICE_ROLE_KEY)
 *   node scripts/import/05-leads.mjs --autoteste  → confere as regras, sem banco
 *
 * Pré-requisito: a carga 01 (pessoas). Sem ela `assigned_to` e `author_id` ficam
 * nulos em 100% das linhas e a reexecução NÃO conserta (o insert é DO NOTHING).
 *
 * ─── N-02 / R-07: 'Arquivado' vira 'lost' ou 'discarded'? ────────────────────
 *
 * O mapa dizia "Grupo A (1.044 leads)" e listava motivos que somam 5.107
 * ocorrências. Remedido linha a linha no CSV, com o coringa de U+FFFD ligado:
 *
 *   Contato Inválido  4.063 leads   ·   Lead duplicado  1.010   ·   Lead Teste  34
 *   → 5.107 pares (motivo, lead) em 5.105 leads distintos (2 leads têm dois deles).
 *
 * Os 5.107 do mapa são pares, não leads — essa metade dele fecha. O 1.044 não
 * fecha por caminho nenhum: o número que sai quando o mojibake é ignorado (a
 * variante `Contato Inv<FFFD>lido`, sozinha 3.502 leads, não casa com a string
 * crua) é 1.605, não 1.044. O único número reprodutível é 5.105, e é ele que
 * manda aqui.
 *
 * REGRA FINAL, valor a valor de `Status` (canônico; `Status` é vocabulário
 * fechado de 4 valores + vazio — contagem do CSV inteiro):
 *
 *   Em negociação   64.885 → status 'in_progress'  · lost_at NULL
 *   Novo               871 → status 'in_progress'  · lost_at NULL
 *   Negócio fechado     59 → status 'converted'    · lost_at NULL · converted_at
 *   Arquivado       36.265 → depende dos motivos, e SÓ aqui:
 *        · com Contato Inválido | Lead duplicado | Lead Teste   5.105 → 'discarded', lost_at NULL
 *        · com outro motivo                                    30.165 → 'lost',      lost_at
 *        · sem motivo aproveitável                                995 → 'lost',      lost_at
 *   (vazio)            719 → status 'discarded'    · lost_at NULL   (lote Instagram nov/2024)
 *
 *   TOTAL: in_progress 65.756 · lost 31.160 · discarded 5.824 · converted 59
 *
 * `leads_lost_consistency` (`0005:78-79`) é `(status='lost') = (lost_at is not null)`:
 * 'discarded' com `lost_at` DERRUBA o lote e 'lost' sem `lost_at` também. A guarda
 * de saída confere as 102.799 linhas ANTES da primeira requisição (§guarda).
 *
 * Por que o descarte vence quando a célula tem os dois tipos de motivo (321 leads):
 * lead duplicado/inválido não é perda de funil — contá-lo como perda infla a taxa
 * de perda em 321 linhas. O motivo de perda que veio junto continua em `lost_reason`.
 * O motivo NÃO decide o estado fora de 'Arquivado', e isso não custa nada nesta
 * base: os 5.105 leads com motivo de descarte estão TODOS sob 'Arquivado'
 * (contador `motivo:descarte_fora_de_arquivado` = 0 na rodada). Se um export
 * futuro puser motivo de descarte num lead vivo, o `Status` continua mandando, os
 * motivos ficam em `raw_payload.motivos_perda` e o contador acende.
 *
 * `Status` desconhecido ABORTA a carga (não existe hoje; um sexto valor significa
 * export novo, não dado sujo). Erro de LINHA — data ilegível nas duas colunas de
 * criação — descarta só a linha e conta (`descartados:linha_invalida`, 0 hoje).
 *
 * ─── R-10: 337.879 caracteres U+FFFD, e o coringa de UMA letra ───────────────
 *
 * Cada letra acentuada do corpo virou 1 U+FFFD. Em vocabulário FECHADO isso é
 * reconstruível: cada corrida de U+FFFD vira `.` (exatamente um caractere), o
 * resto é escapado, âncora `^…$`, e só vale se UM candidato do vocabulário casar.
 * Medido — todo casamento por coringa sai contado no relatório (`coringa:…`):
 *
 *   Status  → Em negociação 63.788 · Negócio fechado 16
 *   Motivo  → Contato Inválido 3.502 · Possui Restrição 2.027 · Produto não agradou 719
 *             · Já comprou 232 · Já foi vendido 222
 *   Atividade → Em negociação 432 · Aguardando Documentação 101 · Enviar Fotos/Vídeos 45
 *             · Em Análise de Crédito 26
 *   Fonte   → Não definido 51 · Indicação 2
 *   TOTAL 71.163 casamentos por coringa, ZERO ambiguidade (nenhum valor casou com 2).
 *
 * Sem candidato único: 67 linhas de `Atividade` (`Lote<FFFD>Reservado` 36,
 * `Prospec<FFFD><FFFD>o` 24, `Documenta<FFFD><FFFD>o Pendente` 7) → caem em 'new',
 * com o original em `raw_payload.atividade_original`.
 *
 * Em TEXTO LIVRE não há reconstrução e nada é adivinhado: `Cliente` (10.868),
 * `Mensagem` (56.700), `Observações` (9.997), `Cidade` (11.330), `Imóvel` (11.242)
 * e `Obs. atividade` (1.822) entram como vieram, com o U+FFFD dentro.
 *
 * ─── R-08: `Corretor` e `Gerente` são NOME, não id ──────────────────────────
 *
 * Índice montado sobre `Users.colaboradores` E `Users.Nome_completo` (as duas,
 * 298 pessoas → 511 chaves distintas). Igualdade exata do nome normalizado é o
 * ÚNICO critério: sem primeiro+último token, sem alias, sem coringa (nome é texto
 * livre — `Patr<FFFD>cia Cardoso` NÃO vira `Patricia Cardoso`). Medido:
 *
 *   Corretor   exato 99.679 · ambíguo 0 · sentinela 1.143 · ausente 1.977   (= 102.799)
 *   Gerente    exato 96.759 · ambíguo 0 · sentinela 1.573 · ausente 3.920   (= 102.252 ocorr.)
 *   Creator de `ligacoes`  exato 6.337 · ambíguo 0 · ausente 0  (nos 6.337 eventos)
 *
 * A única célula vazia de `Corretor` cai em `ausente` junto com os nomes que não
 * existem — é assim que `criarResolvedor` conta, e o resultado é o mesmo (NULL).
 * `ausente_com_mojibake` separa quanto o U+FFFD custou: 279 leads de `Corretor`
 * (`Patr<FFFD>cia Cardoso`, `Maur<FFFD>cio Vieira`, `S<FFFD>rgio Dias`) e 526
 * ocorrências de `Gerente`. Recuperáveis por alias manual, não por coringa.
 *
 * `sentinela` = valor que não é pessoa (`Usuário Repique`, `Em espera`,
 * `Contingência`, `faceimob`): vira NULL sem entrar na conta de "gente que
 * faltou". `ausente` = nome de pessoa que não existe no export de `Users` — os
 * maiores são `caroline farias` (618), `roberto santos mendes` (322),
 * `thabata nobre` (155), `kelvin viana` (144). Ambíguo e ausente dão o MESMO
 * resultado: `assigned_to = NULL`, o lead fica visível só a quem tem
 * `leads.view_queue` (`0044:87-88`), e nunca no colo do corretor errado.
 * A única chave ambígua do índice (`andre felipe hernandez da silva`, 2 pessoas)
 * não é usada por lead nenhum — por isso o ambíguo dá 0, não porque a trava não
 * exista. O casamento por nome inventou 18 participantes na onda 1; aqui ele é
 * exato ou é nada.
 *
 * `Gerente` só alimenta `raw_payload.gerente_original`: `leads` não tem coluna
 * de gerente e a gerência sai da hierarquia (`team_members` → `teams.manager_id`).
 * Resolvo mesmo assim para publicar o número acima — o id resolvido não é gravado,
 * porque uuid solto em jsonb não serve para nada que a tela leia.
 *
 * ─── R-06: `leads_external_id_idx` é índice PARCIAL ─────────────────────────
 *
 * `unique (external_id) where external_id is not null` (`0005:83-84`). Um
 * `on conflict (external_id) do nothing` sem repetir o predicado dá 42P10 e
 * derruba o bloco inteiro — e o parâmetro `on_conflict` do PostgREST aceita só
 * NOME DE COLUNA, então o predicado não tem como ser escrito por aqui.
 *
 * A forma usada é a mesma das cargas 03/03b, e ela funciona porque não passa
 * perto do índice parcial: o conflito é mirado na **PK**. `leads.id` é UUIDv5 do
 * `unique id` do Bubble (função pura), então reexecutar produz o MESMO id e o
 * `on conflict (id) do nothing` é inócuo. Prova de que a forma funciona:
 * `--autoteste` monta o payload das 102.799 linhas e afirma (a) 102.799 ids
 * distintos, (b) 102.799 `external_id` distintos, (c) `uuid5(uid)` estável entre
 * duas chamadas. Uma segunda rodada colide na PK, e DO NOTHING na PK nunca chega
 * a testar o índice parcial.
 * Sobra um caso, e ele é ruidoso de propósito: `external_id` já existente sob
 * OUTRO id (o `leadgen_id` da Meta, por exemplo) vira 23505 na linha, isolado
 * pelo reenvio linha a linha de `inserirEmLote`, contado e com saída 1. O prefixo
 * `bubble:leadfy:` existe justamente para esse namespace nunca colidir.
 *
 * ─── COLUNAS QUASE-DUPLICADAS: qual foi escolhida e por quê (medido) ────────
 *
 *   Criado em  102.798 preenchidas  → `created_at`/`assigned_at`.   ESCOLHIDA
 *   Criado_em  102.798 preenchidas  → DESCARTADA: hora sempre 12:00 e discorda do
 *              dia de `Criado em` em 13.403 das 102.798 (ano errado, delta −366 d).
 *   Data Criação / data_criacao / Data_atividade / Reavivado_em / Reavivar_em /
 *   Preço / Slug: 0 preenchidas. DESCARTADAS.
 *
 *   Corretor    102.798 preenchidas → `assigned_to`.                 ESCOLHIDA
 *   correto         468 preenchidas → DESCARTADA: só o lote Instagram, concorda com
 *              `Corretor` em 409/468 e não traz nome novo nenhum.
 *   Corretorszz  99.846 preenchidas → DESCARTADA: snapshot congelado, discorda de
 *              `Corretor` em 4.942/99.846 e com grafia pior.
 *
 *   Gerente     100.101 preenchidas → `raw_payload.gerente_original`. ESCOLHIDA
 *   Gerenteszz   98.215 preenchidas → DESCARTADA: discorda em 6.938/97.512 e traz
 *              `Gerente Interino`, que não é pessoa.
 *   Gerentererr     468 preenchidas → DESCARTADA: lote Instagram, discorda em 73/468.
 *
 * `full_name` é NOT NULL com `check (length(btrim) > 0)` e 635 linhas têm
 * `Cliente` vazio. NÃO descartar o lead por causa do nome: o telefone, a origem e
 * o histórico continuam valendo, e 635 leads sumidos é perda de dado real por um
 * rótulo. Escada: `Cliente` → `'Lead ' || Identificador` → `'Lead sem nome ' ||`
 * últimos 6 do `unique id`. Os dois ramos de fallback saem contados no relatório.
 *
 * ─── LIGAÇÕES → lead_events(kind='call'): a taxa de casamento é um TETO ───────
 *
 * `ligacoes` não tem `unique id` nem coluna de relação com lead. A única ponte é
 * o telefone, e a chave são os últimos 8 dígitos depois de tirar o DDI — o campo
 * tem tamanhos de 2 a 104 dígitos e o DDD não é confiável nele. Medido:
 *
 *   8.365 linhas lidas
 *     6.347 casaram com algum lead (75,9%)   → 6.337 eventos (10 duplicatas exatas)
 *     1.867 sem lead correspondente          → descartadas, contadas, NENHUM lead inventado
 *       151 número inaproveitável (< 8 díg.) → idem
 *   2.302 das 6.347 (36%) precisaram de desempate: os mesmos 8 dígitos finais
 *   batem em 2+ leads. Desempate = o lead mais recente que já existia na data da
 *   ligação; sem nenhum anterior, o mais antigo posterior.
 *
 * Ignorar o DDD faz de 75,9% um TETO, não um número exato: dois números de
 * estados diferentes com os mesmos 8 finais casam. Por isso a ligação nunca cria
 * lead nem altera dado do lead — é evento de log, e a chave usada fica em
 * `detail.chave_telefone` para auditoria.
 *
 * ─── VOLUME E CUSTO DA RODADA (medidos no `--dry-run`) ───────────────────────
 *
 *   leads          102.799   ·  lead_comments  7.432  ·  lead_events  6.337
 *   lead_sources        +5   ·  import_bubble_map  116.568 pares
 *   funil: warm 63.030 · no_response 17.205 · first_contact 12.046 · new 9.619
 *          · hot 627 · gathering_docs 153 · scheduled_visit 119 · qualified 0
 *   telefone: válido 100.342 · inválido 2.352 · vazio 105 · 75.715 chaves distintas
 *   e-mail: 462 `none` literais e 134 tortos viram NULL (o torto vai para o raw_payload)
 *   nome vazio: 635 (589 pelo `Identificador`, 46 pelos últimos 6 do uid)
 *   motivo vazado de `Atividade` removido: 1.214 ocorrências (o mapa soma 999;
 *     os itens que ele mesmo lista dão 1.214 — `Em outro Atendimento` 215 inclusive)
 *   `Atividade` fora do vocabulário: 952 leads em 192 valores → 'new'
 *
 *   12,8 s de dry-run (leitura + montagem das 111.164 linhas das duas origens) e
 *   545 MB de RSS no pico, com as 102.799 linhas de destino na memória. Não
 *   precisa de `--max-old-space-size`. Na rodada real somam-se ~230 requisições
 *   de INSERT (blocos de 500) mais o de-para.
 *
 * ─── O QUE PRECISA ESTAR DESLIGADO ANTES (o operador roda, o script confere) ──
 *
 * NENHUM gatilho de `leads` precisa ser desligado, e um deles precisa ficar
 * LIGADO. `grep "on public.leads" supabase/migrations/*.sql`: os únicos gatilhos
 * da tabela são `leads_normalize` (BEFORE INSERT OR UPDATE), `leads_set_updated_at`
 * (BEFORE UPDATE), `leads_log_changes` (AFTER UPDATE) e `leads_keep_next_action`
 * (BEFORE UPDATE). Só o primeiro dispara em INSERT — e é ele que deriva
 * `leads.phone` de `phone_raw` (`0005:104-120`). Desligá-lo deixaria os 100.342
 * telefones fora do E.164 e mataria a dedupe (`existing_lead_phones`, `0056:491`).
 * `lead_comments` e `lead_events` não têm gatilho de INSERT nenhum.
 *
 * O perigo aqui não é gatilho, é CRON. Rode como `postgres`, antes:
 *
 *   select cron.alter_job(jobid, active := false) from cron.job
 *    where jobname in ('faceimob-assign-queued','faceimob-release-expired-leads',
 *                      'faceimob-mark-no-response','faceimob-notify-dispatch');
 *   update public.automation_settings
 *      set leads_paused = true, notify_on_assign = false, notify_on_timeout = false
 *    where id;
 *
 * Depois da carga, na ordem inversa (e só depois de conferir):
 *
 *   update public.notifications set sent_at = now(), last_error = 'descartada: carga de dados legados'
 *    where channel <> 'in_app' and sent_at is null and created_at >= :inicio_da_carga;
 *   update public.automation_settings
 *      set leads_paused = false, notify_on_assign = true, notify_on_timeout = true where id;
 *   select cron.alter_job(jobid, active := true) from cron.job where jobname like 'faceimob-%';
 *
 * ALCANCE DA SONDA (o que ela prova e o que não prova): `cron.job` não é legível
 * por PostgREST — nenhuma sonda daqui consegue afirmar que os 4 jobs estão
 * parados. O que ela prova, com um lead descartável que nasce e morre antes da
 * carga: (a) `automation_settings` está com a roleta pausada e as duas
 * notificações desligadas — e ABORTA se não estiver; (b) `leads_normalize` está
 * LIGADO, porque o `phone` volta do banco normalizado; (c) nenhuma linha nasceu
 * em `lead_events` nem em `notifications` por causa do INSERT.
 *
 * O que segura os 4 crons não é a sonda, é o FORMATO DO DADO, e isso a guarda de
 * saída confere linha a linha antes de qualquer requisição:
 *   · nenhum lead sai como 'queued'    → `assign_queued_leads` (1 min) não tem o que pegar;
 *   · nenhum sai 'assigned'/'attending' e `attend_deadline` nunca é enviado
 *                                      → `release_expired_leads` (30 s) não tem o que pegar;
 *   · nenhum sai `funnel_stage='first_contact'` com status vivo
 *                                      → `mark_no_response_leads` (5 min) não tem o que pegar
 *                                        (é o que evita 17.153 notificações na 1ª varredura);
 *   · `next_action_at` nunca é enviado  → `overdue_lead_count()` não bloqueia check-in de
 *                                        ninguém, e o corretor não some de `distribution_queue`.
 * `leads_paused` é cinto; a guarda de saída é o suspensório — e é ela que segura
 * `mark_no_response_leads`, que NÃO lê `leads_paused`.
 *
 * ─── SQL QUE PROVA QUE DEU CERTO ─────────────────────────────────────────────
 *
 *   -- volume por procedência (nunca count(*) de tabela: o destino tem seed e demo, R-02)
 *   select entidade, tabela_destino, count(*) from public.import_bubble_map
 *    where entidade in ('lead','ligacao') group by 1,2 order by 1,2;
 *   -- lead|leads 102.799 · lead|lead_comments 7.432 · ligacao|lead_events 6.337
 *
 *   -- 1. nada ficou na roleta, e o desfecho bate com a regra de N-02
 *   select l.status, count(*) from public.leads l
 *     join public.import_bubble_map m on m.registro_id = l.id and m.tabela_destino = 'leads'
 *    group by 1;   -- in_progress 65.756 · lost 31.160 · discarded 5.824 · converted 59
 *                  -- e ZERO linha 'queued'/'assigned'/'attending'
 *
 *   -- 2. as duas metades da constraint de desfecho
 *   select count(*) from public.leads where status = 'lost'      and lost_at is null;      -- 0
 *   select count(*) from public.leads where status = 'discarded' and lost_at is not null;  -- 0
 *
 *   -- 3. ninguém perde o check-in por atraso importado (overdue_block_threshold = 20)
 *   select assigned_to, count(*) from public.leads
 *    where status in ('assigned','attending','in_progress') and next_action_at < now()
 *    group by 1 having count(*) >= 20;                                          -- 0 linhas
 *
 *   -- 4. o gatilho normalizou o telefone (se der > 0, leads_normalize estava desligado)
 *   select count(*) from public.leads
 *    where external_id like 'bubble:leadfy:%' and phone is not null and phone !~ '^55[0-9]{10,11}$';
 *                                                                               -- esperado: 0
 *   -- 5. a data veio do dado, não do relógio da carga
 *   select min(created_at)::date, max(created_at)::date from public.leads l
 *     join public.import_bubble_map m on m.registro_id = l.id and m.tabela_destino = 'leads';
 *                                                                    -- 2024-01-02 .. 2026-09-05
 *   -- 6. nada foi notificado nem logado por gatilho
 *   select count(*) from public.notifications where created_at >= :inicio_da_carga;   -- 0
 *   select count(*) from public.lead_events
 *    where kind <> 'call' and created_at >= :inicio_da_carga;                         -- 0
 *
 *   -- 7. as 5 origens novas existem e nenhuma desvia da roleta
 *   select code, channel, sdr_agent_id, form_id from public.lead_sources
 *    where code in ('chatbot_leadfy','tecimob','botconversa','instagram','facebot');
 *                                          -- 5 linhas, sdr_agent_id e form_id NULOS
 *
 * ─── DECISÕES QUE ESTE ARQUIVO IMPLEMENTA ────────────────────────────────────
 *
 * · N-07: entram os 102.799. Sem recorte por data (DECISOES.md).
 * · N-13: sem dedupe por telefone. 14.005 telefones em 2+ leads entram como estão.
 * · N-09: `Imóvel` vai para `leads.campaign_name` como texto. Nenhuma `ad_campaigns`
 *   é criada (`external_id` é NOT NULL e único, e a origem não tem id de campanha).
 * · `distribution_groups` FICA DE FORA desta carga (não está no destino da tarefa):
 *   `distribution_group_id` é NULL nas 102.799 e os 49 rótulos de `Grupo` ficam em
 *   `raw_payload.grupo_original`. Nada se perde e nenhuma fila nova nasce ativa;
 *   quem quiser o rótulo como grupo cria depois, a partir do próprio raw_payload.
 * · `lead_events(kind='revived')` fica de fora (só 'call' está no destino). As duas
 *   colunas do processo morto entram em `raw_payload.reavivado_em`/`reavivar_em`,
 *   cruas — 4.960 + 6.395 valores que continuam recuperáveis sem reimportar.
 * · `lead_assignments` não é importada: a origem não tem data de atribuição nem
 *   histórico de passagem, e `deadline` é NOT NULL sem default. Por isso
 *   `roulette_misses` fica 0 e o backfill de `0074:86-95` NÃO deve ser rodado.
 * · Telefone: manda-se SÓ `phone_raw` com o texto original; o gatilho deriva `phone`.
 *   Inválido (2.352) → `phone` e `phone_raw` os DOIS nulos, original em
 *   `raw_payload.telefone_invalido`. Mandar o lixo faria `normalize_phone` gravá-lo
 *   como está (`0001:139`, o `else d`) e ele entraria no índice de dedupe.
 * · `converted_deal_id` fica NULL nos 59 `Negócio fechado`: a origem não tem FK
 *   lead↔negócio (§7 L4 do mapa). É passo separado, depois do domínio Negócios.
 *
 * Nada aqui imprime telefone completo, e-mail, CPF ou trecho de `Mensagem`/
 * `Observações` — o texto do cliente pode conter dado pessoal digitado.
 */
import { createHash, randomUUID } from "node:crypto";

import {
  acharExport,
  criarResolvedor,
  dataBubble,
  ehDryRun,
  inserirEmLote,
  lerCsv,
  lerMapa,
  normalizarNome,
  registrarMapa,
  relatorio,
  supa,
} from "./lib/bubble.mjs";

const rel = relatorio("05-leads");

// ── id determinístico ────────────────────────────────────────────────────────

/**
 * UUIDv5 (RFC 4122), mesmo namespace das cargas 03/03b: o `id` do destino é
 * função pura do `unique id` do Bubble. É o que faz `on conflict (id) do nothing`
 * ser inócuo na reexecução sem encostar no índice PARCIAL de `external_id` (R-06).
 */
function uuid5(ns, nome) {
  const h = createHash("sha1")
    .update(Buffer.from(ns.replace(/-/g, ""), "hex"))
    .update(Buffer.from(nome, "utf8"))
    .digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const s = h.subarray(0, 16).toString("hex");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}
const NS = uuid5("6ba7b811-9dad-11d1-80b4-00c04fd430c8", "https://faceimob.com.br/import/bubble");
const det = (entidade, ...partes) => uuid5(NS, `${entidade}:${partes.join(":")}`);

// ── vocabulário fechado e o coringa de U+FFFD (R-10) ─────────────────────────

/** O caractere que o export deixou no lugar de cada letra acentuada. */
const CORROMPIDO = "�";

/** 4 rótulos do Bubble trazem NBSP no lugar do espaço (T-NBSP). */
const semNbsp = (v) => String(v ?? "").replace(/ /g, " ").trim();
const texto = (v) => semNbsp(v) || null;

const cacheCanon = new Map();

/**
 * Valor de vocabulário FECHADO → rótulo canônico, com U+FFFD valendo por UMA
 * letra. Só aceita candidato ÚNICO: dois candidatos é adivinhação.
 *
 * Devolve `""` para célula vazia e `null` para valor fora do vocabulário — os
 * dois casos são diferentes para todo chamador e nenhum deles pode virar o outro.
 */
function canonizar(bruto, vocabulario, rotulo) {
  const s = semNbsp(bruto);
  if (s === "") return "";
  const chave = `${rotulo}|${s}`;
  if (cacheCanon.has(chave)) {
    const r = cacheCanon.get(chave);
    if (r && r !== s) rel.conta(`coringa:${rotulo}:${r}`);
    return r;
  }
  let achado = vocabulario.includes(s) ? s : null;
  if (!achado && s.includes(CORROMPIDO)) {
    const padrao = [...s]
      .map((c) => (c === CORROMPIDO ? "." : c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
      .join("");
    const candidatos = vocabulario.filter((v) => new RegExp(`^${padrao}$`).test(v));
    achado = candidatos.length === 1 ? candidatos[0] : null;
  }
  cacheCanon.set(chave, achado);
  if (achado && achado !== s) rel.conta(`coringa:${rotulo}:${achado}`);
  return achado;
}

const STATUS = ["Em negociação", "Arquivado", "Novo", "Negócio fechado"];

/** `Atividade` → `funnel_stage`. Fora daqui (192 valores, 952 leads) vira 'new'. */
const ATIVIDADE = new Map([
  ["Em atendimento", "warm"],
  ["Primeiro contato", "first_contact"],
  ["Retornar para cliente", "warm"],
  ["Ver mensagem do interessado", "new"],
  ["Cobrar cliente", "warm"],
  ["Em negociação", "hot"],
  ["Em Proposta", "hot"],
  ["Aguardando Documentação", "gathering_docs"],
  ["Visita Agendada", "scheduled_visit"],
  ["Enviar Fotos/Vídeos", "warm"],
  ["Sem resposta", "no_response"],
  ["Em Análise de Crédito", "gathering_docs"],
]);

/** `Fonte` → `lead_sources.code`. Fora daqui → 'importacao' + original no raw_payload. */
const FONTE = new Map([
  ["Facebook Leads", "meta_ads"],
  ["Facebook", "meta_ads"],
  ["Chatbot Leadfy", "chatbot_leadfy"],
  ["Integracao Leadfy", "chatbot_leadfy"],
  ["WhatsApp", "whatsapp"],
  ["Importados da planilha", "importacao"],
  ["Não definido", "importacao"],
  ["TecImob 2", "tecimob"],
  ["BotConversa", "botconversa"],
  ["Instagram", "instagram"],
  ["Facebot", "facebot"],
  ["Site Faceimob", "organico"],
  ["Indicação", "indicacao"],
  ["VivaReal", "portal"],
]);

/** Origens que o catálogo ainda não tem. `channel` tem CHECK de 7 valores (`0003:192`). */
const ORIGENS_NOVAS = [
  { code: "chatbot_leadfy", label: "Chatbot Leadfy", channel: "other" },
  { code: "tecimob", label: "TecImob", channel: "portal" },
  { code: "botconversa", label: "BotConversa", channel: "other" },
  { code: "instagram", label: "Instagram", channel: "meta" },
  { code: "facebot", label: "Facebot", channel: "other" },
];

/** Motivo que classifica o lead como descarte, e não como perda de funil (N-02). */
const MOTIVO_DESCARTE = new Set(["Contato Inválido", "Lead duplicado", "Lead Teste"]);

/** Valor de `Atividade` vazado para o campo de motivo: sai da lista antes do `lost_reason`. */
const MOTIVO_VAZADO = new Set([
  "Em atendimento",
  "Retornar para cliente",
  "Em outro Atendimento",
  "Ver mensagem do interessado",
  "Primeiro contato",
  "Cobrar cliente",
  "Visita Agendada",
  "Em negociação",
  "Documentação Pendente",
  "Em Proposta",
]);

const ATIVIDADES = [...ATIVIDADE.keys()];
const FONTES = [...FONTE.keys()];

const MOTIVOS = [
  "Cliente sem interesse",
  "Demora no retorno",
  "Apenas pesquisando",
  "Cliente sem perfil",
  "Possui Restrição",
  "Bloqueado pelo Cliente",
  "Produto não agradou",
  "Já foi vendido",
  "Já comprou",
  "Desempregado",
  "Reprovado",
  ...MOTIVO_DESCARTE,
  ...MOTIVO_VAZADO,
];

/** Valor de campo de pessoa que NÃO é pessoa: NULL sem entrar na conta de ausentes. */
const SENTINELAS = new Set([
  "usuario repique",
  "usu rio repique", // `Usu<FFFD>rio Repique`: normalizarNome troca o U+FFFD por espaço
  "em espera",
  "contingencia",
  "conting ncia",
  "faceimob",
  "gerente interino",
  "app admin",
  "deleted thing",
]);

// ── conversões locais ────────────────────────────────────────────────────────

/** Os 67 DDDs oficiais. Fora deles não é telefone brasileiro. */
const DDD = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43,
  44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77,
  79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

/**
 * Dígitos nacionais do telefone, ou null.
 *
 * Validar ANTES é obrigatório: `normalize_phone` (`0001:125-141`) termina em
 * `else d` e grava qualquer outra coisa como está — DDI estrangeiro, DDD de 3
 * dígitos, número sem DDD entrariam no índice de dedupe como lixo.
 * Não usa `telefoneBR` da lib: aquela é para `deal_clients.phone` (devolve com
 * DDI e não olha DDD nem o 9 do celular), aqui o que se quer é o veredito.
 */
function telefoneNacional(txt) {
  let d = String(txt ?? "").replace(/\D/g, "");
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  if (!DDD.has(Number(d.slice(0, 2)))) return null;
  if (d.length === 11 && d[2] !== "9") return null;
  return d;
}

/** `citext` sem unique no destino: e-mail repetido não quebra nada; e-mail torto, sim. */
function email(txt) {
  const s = semNbsp(txt).toLowerCase();
  if (s === "" || s === "none") return { valor: null, invalido: null };
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(s)) return { valor: null, invalido: s };
  return { valor: s, invalido: null };
}

/** Primeiro candidato que parseia como timestamptz. */
function primeiraData(...candidatos) {
  for (const c of candidatos) {
    const d = dataBubble(c);
    if (d) return d;
  }
  return null;
}

/** Lista do Bubble separada por ", " (leadfies usa este, não o " , " de `Equipes`). */
const lista = (txt) =>
  semNbsp(txt)
    .split(", ")
    .map((p) => p.trim())
    .filter((p) => p !== "");

/** Adiciona um id ao índice de nomes preservando colisão — o resolvedor devolve "ambiguo". */
function indexar(mapa, chave, id) {
  if (!chave) return;
  const atual = mapa.get(chave);
  if (!atual) mapa.set(chave, [id]);
  else if (!atual.includes(id)) atual.push(id);
}

// ── leitura do destino ───────────────────────────────────────────────────────

let ONLINE = true;

/** Página o PostgREST: acima de 1.000 linhas ele trunca calado. */
async function lerTudo(tabela, colunas, ordem = ["id"]) {
  if (!ONLINE) return [];
  const cliente = supa();
  const linhas = [];
  const pagina = 1000;
  for (let de = 0; ; de += pagina) {
    let consulta = cliente.from(tabela).select(colunas);
    for (const coluna of ordem) consulta = consulta.order(coluna);
    const { data, error } = await consulta.range(de, de + pagina - 1);
    if (error) throw new Error(`ler ${tabela}: ${error.message}`);
    linhas.push(...data);
    if (data.length < pagina) return linhas;
  }
}

/** Linhas nascidas na janela da carga. É como se prova que nada mais escreveu. */
async function contarDesde(tabela, inicio, extra = (q) => q) {
  if (!ONLINE) return 0;
  const { count, error } = await extra(
    supa().from(tabela).select("id", { count: "exact", head: true }).gte("created_at", inicio),
  );
  if (error) throw new Error(`contar ${tabela}: ${error.message}`);
  return count ?? 0;
}

// ── sonda ────────────────────────────────────────────────────────────────────

/**
 * Prova, com um lead descartável, o que dá para provar por PostgREST.
 *
 * `cron.job` não é legível daqui: os 4 jobs continuam sendo responsabilidade do
 * operador (cabeçalho). O que segura os crons é o formato do dado, e disso quem
 * cuida é `conferirGuardas`. A sonda cobre o resto: a pausa da roleta, as duas
 * notificações e — invertendo a lógica das outras cargas — que `leads_normalize`
 * está LIGADO, porque sem ele os 100.342 telefones entram fora do E.164.
 */
async function sondar() {
  const cliente = supa();
  const { data: cfg, error: erroCfg } = await cliente
    .from("automation_settings")
    .select("leads_paused, notify_on_assign, notify_on_timeout, no_response_hours, overdue_block_threshold")
    .maybeSingle();
  if (erroCfg) throw new Error(`sonda: não consegui ler automation_settings (${erroCfg.message})`);
  const ligados = [
    !cfg?.leads_paused && "leads_paused = false",
    cfg?.notify_on_assign && "notify_on_assign = true",
    cfg?.notify_on_timeout && "notify_on_timeout = true",
  ].filter(Boolean);
  if (ligados.length > 0) {
    throw new Error(
      `A automação de leads está LIGADA (${ligados.join(", ")}).\n` +
        `Rode antes:\n  update public.automation_settings\n` +
        `     set leads_paused = true, notify_on_assign = false, notify_on_timeout = false where id;`,
    );
  }
  rel.conta("sonda:automacao_pausada", 1);

  const id = randomUUID();
  const marco = new Date().toISOString();
  const externo = `bubble:sonda:${Date.now()}`;
  try {
    const criado = await cliente.from("leads").insert({
      id,
      full_name: "sonda da carga 05 — apagada em seguida",
      phone_raw: "(51) 99999-0000",
      status: "discarded",
      funnel_stage: "new",
      external_id: externo,
      last_activity_at: marco,
      created_at: marco,
    });
    if (criado.error) throw new Error(`sonda: não consegui inserir o lead (${criado.error.message})`);

    const lido = await cliente.from("leads").select("phone, phone_raw").eq("id", id).single();
    if (lido.error) throw new Error(`sonda: ${lido.error.message}`);
    if (lido.data.phone !== "5551999990000") {
      throw new Error(
        `leads_normalize está DESLIGADO (phone voltou ${JSON.stringify(lido.data.phone)}).\n` +
          `Ele é o único gatilho de INSERT desta tabela e é ele que deriva phone de phone_raw.\n` +
          `Rode 'alter table public.leads enable trigger leads_normalize;' como postgres.`,
      );
    }

    const eventos = await cliente.from("lead_events").select("id").eq("lead_id", id);
    if (eventos.error) throw new Error(`sonda: ${eventos.error.message}`);
    if (eventos.data.length > 0) {
      throw new Error(
        `${eventos.data.length} lead_events nasceram de um único INSERT em leads: ` +
          `apareceu gatilho AFTER INSERT que não existia nas migrations. Investigue antes de carregar 102.799.`,
      );
    }
    const avisos = await contarDesde("notifications", marco);
    if (avisos > 0) {
      throw new Error(
        `${avisos} notificação(ões) nasceram na janela da sonda. Confira se os crons ` +
          `faceimob-* estão mesmo desativados antes de carregar 102.799 leads.`,
      );
    }
  } finally {
    const apagado = await cliente.from("leads").delete().eq("id", id);
    if (apagado.error) {
      rel.aviso(`sonda: NÃO consegui apagar o lead ${externo} — apague à mão (${apagado.error.message})`);
    }
  }
  rel.conta("sonda:leads_normalize_ligado", 1);
}

// ── resolvedores ─────────────────────────────────────────────────────────────

/**
 * Índice de NOME → `profiles.id`, montado uma vez para os três consumidores
 * (`Corretor`, `Gerente`, `ligacoes.Creator`).
 *
 * `leadfies` e `ligacoes` são os arquivos que N-05 não reexportou: aqui a coluna
 * é nome de exibição, nunca `unique id`, e o ramo do id de `criarResolvedor`
 * nunca dispara. Igualdade exata do nome normalizado é o único critério (R-08).
 *
 * `colaboradores` (o apelido curto) é a chave canônica; `Nome_completo` entra
 * como SEGUNDO índice, e só nas chaves que `colaboradores` não ocupa — senão um
 * homônimo de nome completo tornaria ambíguo um apelido que era exato.
 */
async function indicePessoas() {
  const doMapa = ONLINE ? await lerMapa("user", "profiles") : new Map();
  const porApelido = new Map();
  const porNomeCompleto = new Map();
  let semPerfil = 0;
  let lidos = 0;

  for await (const u of lerCsv(acharExport("export_All-Users"))) {
    const uid = String(u["unique id"] ?? "").trim();
    if (!uid) continue;
    lidos++;
    // Offline o uid faz de id de mentira: o que se mede sem banco é a taxa de
    // casamento do nome, não o uuid final. Online o ausente é contado e avisado.
    const id = doMapa.get(uid) ?? (ONLINE ? null : uid);
    if (!id) {
      semPerfil++;
      continue;
    }
    indexar(porApelido, normalizarNome(u.colaboradores), id);
    indexar(porNomeCompleto, normalizarNome(u.Nome_completo), id);
  }
  if (semPerfil > 0) {
    rel.conta("pessoa:sem_perfil_no_destino", semPerfil);
    rel.aviso(
      `${semPerfil} de ${lidos} usuários do Bubble ainda não têm perfil em profiles — ` +
        `rode a carga 01 antes, ou os leads deles entram sem dono e o DO NOTHING não corrige depois`,
    );
  }

  const porNome = new Map(porApelido);
  for (const [chave, ids] of porNomeCompleto) if (!porNome.has(chave)) porNome.set(chave, ids);
  rel.conta("pessoa:chaves_de_nome", porNome.size);
  const ambiguas = [...porNome.values()].filter((v) => v.length > 1).length;
  if (ambiguas) rel.conta("pessoa:chaves_ambiguas", ambiguas);
  return porNome;
}

/** Um resolvedor por coluna: contadores separados é o que faz o número de R-08 significar algo. */
function resolvedor(porNome, rotulo) {
  const bruto = criarResolvedor({ porId: new Map(), porNome, rotulo });
  const resolver = (valor) => {
    const chave = normalizarNome(valor);
    if (chave && SENTINELAS.has(chave)) {
      rel.conta(`${rotulo}:sentinela`);
      return { id: null, via: "sentinela" };
    }
    const r = bruto(valor);
    // Nome com acento corrompido não vira coringa (é texto livre): fica ausente
    // e contado à parte, para o operador saber quanto o mojibake custou.
    if (r.via === "ausente" && String(valor ?? "").includes(CORROMPIDO)) {
      rel.conta(`${rotulo}:ausente_com_mojibake`);
    }
    return r;
  };
  resolver.relatar = bruto.relatar;
  return resolver;
}

/**
 * `lead_sources.code` → id, criando as 5 origens que faltam (idempotente).
 *
 * `sdr_agent_id` e `form_id` ficam NULOS de propósito: origem com agente SDR
 * desvia da roleta e inicia conversa (`meta-ads-webhook/index.ts:307-313`), e
 * `form_id` tem unique parcial (um formulário por origem, `0003:201`).
 */
async function garantirOrigens() {
  const exigidos = new Set([...FONTE.values(), "importacao"]);
  // Sem banco não há catálogo: o próprio código faz de id, como nas cargas 02/03.
  if (!ONLINE) return new Map([...exigidos].map((c) => [c, c]));
  const antes = new Set((await lerTudo("lead_sources", "id,code", ["code"])).map((s) => s.code));
  const faltando = ORIGENS_NOVAS.filter((o) => !antes.has(o.code));
  if (faltando.length && !ehDryRun()) {
    const { erros } = await inserirEmLote("lead_sources", faltando, { onConflict: "code" });
    for (const e of erros) rel.aviso(`lead_sources ${faltando[e.indice]?.code}: ${e.mensagem}`);
    if (erros.length) throw new Error("não consegui criar as origens novas — leads ficariam sem source_id");
  }
  for (const o of faltando) rel.conta(`lead_sources:criada:${o.code}`, 1);
  if (faltando.length < ORIGENS_NOVAS.length)
    rel.conta("lead_sources:ja_existiam", ORIGENS_NOVAS.length - faltando.length);

  const catalogo = new Map(
    (await lerTudo("lead_sources", "id,code", ["code"])).map((s) => [s.code, s.id]),
  );
  for (const o of faltando) if (!catalogo.has(o.code)) catalogo.set(o.code, o.code); // dry-run
  const ausentes = [...exigidos].filter((c) => !catalogo.has(c));
  if (ausentes.length) {
    throw new Error(
      `lead_sources não tem ${ausentes.join(", ")} — os leads dessas fontes entrariam com ` +
        `source_id NULL em silêncio. Aplique supabase/seed.sql antes.`,
    );
  }
  return catalogo;
}

// ── montagem de uma linha ────────────────────────────────────────────────────

/** Valores já avisados: o aviso é por valor distinto, não por linha (o relatório corta em 50). */
const jaAvisado = new Set();

/**
 * Uma linha de `leadfies` → o lead, o comentário e a chave de telefone.
 *
 * `{fatal}` derruba a carga: só `Status` fora do vocabulário fechado, porque um
 * sexto valor significa export novo, não dado sujo, e adivinhar o desfecho de
 * 36 mil leads é o erro que não dá para desfazer. `{erro}` descarta a LINHA e
 * conta — erro de linha não derruba a carga.
 */
function montar(l, ctx) {
  const uid = String(l["unique id"] ?? "").trim();
  const status = canonizar(l.Status, STATUS, "status");
  if (status === null) return { fatal: `Status desconhecido "${semNbsp(l.Status)}"` };

  // Motivos: canonizados um a um, os vazados de `Atividade` fora da lista.
  const motivos = [];
  for (const item of lista(l["Motivos de perda"])) {
    const canon = canonizar(item, MOTIVOS, "motivo");
    if (canon === null) {
      rel.conta("motivo:desconhecido");
      if (!jaAvisado.has(item)) {
        jaAvisado.add(item);
        rel.aviso(`motivo fora do catálogo, copiado como veio: ${item}`);
      }
      motivos.push(item); // copia como veio, nunca descarta calado
      continue;
    }
    if (MOTIVO_VAZADO.has(canon)) {
      rel.conta("motivo:vazado_de_atividade_removido");
      continue;
    }
    if (!motivos.includes(canon)) motivos.push(canon);
  }
  const temDescarte = motivos.some((m) => MOTIVO_DESCARTE.has(m));

  const criadoEm = primeiraData(l["Criado em"], l["Creation Date"]);
  const atividadeEm = primeiraData(l["Data atividade"]) ?? criadoEm;
  if (!criadoEm) return { erro: "sem nenhuma data aproveitável" };

  // ── N-02: o desfecho, e as duas metades de leads_lost_consistency juntas ──
  let estado = "in_progress";
  let lostAt = null;
  let lostReason = null;
  let convertedAt = null;
  if (status === "Negócio fechado") {
    estado = "converted";
    convertedAt = atividadeEm;
  } else if (status === "") {
    estado = "discarded";
    lostReason = "Lote Instagram nov/2024 — sem dado de funil na origem";
  } else if (status === "Arquivado") {
    estado = temDescarte ? "discarded" : "lost";
    lostAt = estado === "lost" ? atividadeEm : null;
    lostReason = motivos.length
      ? motivos.join(" · ")
      : "Arquivado no Bubble sem motivo registrado";
  }
  // O motivo só decide o estado dentro de 'Arquivado'. Fora dele o `Status` manda
  // e o contador acende — hoje 0, e é isso que autoriza a regra a ser tão curta.
  if (estado !== "discarded" && temDescarte) rel.conta("motivo:descarte_fora_de_arquivado");

  // ── funil. 'first_contact' com lead vivo é o que mark_no_response varre ──
  const atividade = canonizar(l.Atividade, ATIVIDADES, "atividade");
  let etapa = atividade ? ATIVIDADE.get(atividade) : "new";
  if (atividade === null) rel.conta("atividade:fora_do_vocabulario");
  if (etapa === "first_contact" && estado === "in_progress") {
    etapa = "no_response";
    rel.conta("funil:first_contact_rebaixado_para_no_response");
  }

  // ── nome: NOT NULL com check(length(btrim) > 0) ──
  let nome = semNbsp(l.Cliente);
  if (!nome) {
    const identificador = semNbsp(l.Identificador);
    nome = identificador ? `Lead ${identificador}` : `Lead sem nome ${uid.slice(-6)}`;
    rel.conta(identificador ? "nome:vazio_usou_identificador" : "nome:vazio_usou_uid");
  }

  // ── telefone: só `phone_raw`, e só quando é telefone de verdade ──
  const bruto = semNbsp(l.Telefone);
  const whats = semNbsp(l.whatsapp);
  let phoneRaw = null;
  let telefoneInvalido = null;
  if (telefoneNacional(bruto)) {
    phoneRaw = bruto;
    rel.conta("telefone:valido");
  } else if (telefoneNacional(whats)) {
    phoneRaw = whats;
    rel.conta("telefone:valido_pelo_whatsapp");
  } else if (bruto || whats) {
    telefoneInvalido = bruto || whats;
    rel.conta("telefone:invalido");
  } else {
    rel.conta("telefone:vazio");
  }

  const correio = email(l.Email);
  if (correio.invalido) rel.conta("email:invalido");
  // 'none' literal não é e-mail nem é ausência: é o placeholder do formulário do
  // Bubble. Contado à parte para o número de e-mails úteis não mentir.
  if (semNbsp(l.Email).toLowerCase() === "none") rel.conta("email:literal_none");

  const fonteCanon = canonizar(l.Fonte, FONTES, "fonte");
  const codigo = (fonteCanon && FONTE.get(fonteCanon)) || "importacao";
  if (fonteCanon === null) rel.conta("fonte:fora_do_catalogo");
  rel.conta(`origem:${codigo}`);

  const corretor = ctx.pessoa(l.Corretor);
  const gerentes = lista(l.Gerente);
  for (const g of gerentes) ctx.gerente(g);

  const payload = {
    bubble_id: uid,
    bubble_creation_date: primeiraData(l["Creation Date"]),
    identificador: texto(l.Identificador),
    cidade: texto(l.Cidade),
    mensagem: texto(l.Mensagem),
    atividade_original: texto(l.Atividade),
    grupo_original: texto(l.Grupo),
    fonte_original: texto(l.Fonte),
    corretor_original: texto(l.Corretor),
    corretor_resolvido: corretor.via,
    gerente_original: gerentes.length ? gerentes : null,
    motivos_perda: motivos.length ? motivos : null,
    codigo_tecimob: texto(l["Código"]),
    telefone_invalido: telefoneInvalido,
    email_invalido: correio.invalido,
    whatsapp: whats || null,
    reavivado_em: texto(l["Reavivado em"]),
    reavivar_em: texto(l["Reavivar em"]),
  };
  for (const [k, v] of Object.entries(payload)) if (v === null) delete payload[k];

  const id = det("leadfies", uid);
  const lead = {
    id,
    full_name: nome,
    phone_raw: phoneRaw,
    email: correio.valor,
    source_id: ctx.origens.get(codigo) ?? null,
    external_id: `bubble:leadfy:${uid}`,
    campaign_name: texto(l["Imóvel"]),
    raw_payload: payload,
    status: estado,
    funnel_stage: etapa,
    assigned_to: corretor.id,
    // Sem dono não há data de atribuição. A origem não guarda essa data; a
    // roleta do Bubble atribuía na criação, então é a data de criação.
    assigned_at: corretor.id ? criadoEm : null,
    last_activity_at: atividadeEm,
    converted_at: convertedAt,
    lost_reason: lostReason,
    lost_at: lostAt,
    notes: texto(l["Obs. atividade"]),
    created_at: criadoEm,
    updated_at: primeiraData(l["Modified Date"]) ?? criadoEm,
    // `attend_deadline` e `next_action_at` NÃO são enviados de propósito: ver a
    // guarda de saída. Enviar null explícito daria no mesmo, mas a ausência é o
    // que `conferirGuardas` consegue afirmar sobre uma edição futura.
  };

  const corpo = semNbsp(l["Observações"]);
  const comentario = corpo
    ? {
        id: det("lead_comments", uid),
        lead_id: id,
        author_id: corretor.id,
        body: corpo,
        created_at: atividadeEm,
        updated_at: atividadeEm,
      }
    : null;

  return { uid, lead, comentario, chave: phoneRaw ? telefoneNacional(phoneRaw).slice(-8) : null };
}

// ── guarda de saída ──────────────────────────────────────────────────────────

const ESTADO_DE_FILA = new Set(["queued", "assigned", "attending"]);

/**
 * A última coisa antes da primeira requisição. Não é paranoia: cada item aqui
 * corresponde a um cron que varre `leads` sozinho, ou a uma constraint que
 * recusa o BLOCO inteiro (o reenvio linha a linha isolaria, mas a 102.799 linhas
 * isso é meia hora de round-trip para chegar no mesmo diagnóstico).
 */
function conferirGuardas(leads) {
  const falhas = new Map();
  const anotar = (motivo, lead) => {
    if (!falhas.has(motivo)) falhas.set(motivo, { n: 0, exemplo: lead.external_id });
    falhas.get(motivo).n++;
  };
  for (const l of leads) {
    if (ESTADO_DE_FILA.has(l.status)) anotar(`status '${l.status}' entra na roleta`, l);
    if (l.status === "in_progress" && l.funnel_stage === "first_contact")
      anotar("first_contact com lead vivo (mark_no_response notificaria o corretor)", l);
    if ((l.status === "lost") !== (l.lost_at != null))
      anotar("leads_lost_consistency: (status='lost') != (lost_at is not null)", l);
    if (l.next_action_at != null) anotar("next_action_at preenchido (bloqueia o check-in)", l);
    if (l.attend_deadline != null) anotar("attend_deadline preenchido (release_expired devolve à fila)", l);
    if (!l.full_name || l.full_name.trim() === "") anotar("full_name vazio (NOT NULL + check)", l);
    if (!l.last_activity_at) anotar("last_activity_at nulo (NOT NULL, o default carimbaria hoje)", l);
  }
  if (falhas.size === 0) {
    rel.conta("guarda:linhas_conferidas", leads.length);
    return;
  }
  throw new Error(
    `guarda de saída recusou a carga ANTES de escrever:\n` +
      [...falhas].map(([m, v]) => `  · ${v.n} linha(s): ${m} (ex.: ${v.exemplo})`).join("\n"),
  );
}

// ── ligações → lead_events(kind='call') ──────────────────────────────────────

/**
 * A única ponte com o lead é o telefone: `ligacoes` não tem `unique id` nem
 * coluna de relação. A chave são os últimos 8 dígitos depois de tirar o DDI —
 * o campo tem tamanhos de 2 a 104 dígitos e o DDD não é confiável nele.
 *
 * Ignorar o DDD faz da taxa de casamento um TETO, não um número exato: dois
 * números de estados diferentes com os mesmos 8 finais casam. Por isso a
 * ligação nunca cria lead e nunca vira dado do lead — é só um evento de log,
 * com a chave usada gravada em `detail` para auditoria.
 */
async function lerLigacoes({ porTelefone, pessoa }) {
  const linhas = [];
  const pares = [];
  const vistas = new Set();
  let lidas = 0;

  for await (const c of lerCsv(acharExport("export_All-ligacoes"))) {
    lidas++;
    let d = String(c.numerocliente ?? "").replace(/\D/g, "");
    if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
    if (d.length < 8) {
      rel.conta("ligacao:numero_inaproveitavel");
      continue;
    }
    const chave = d.slice(-8);
    const candidatos = porTelefone.get(chave);
    if (!candidatos) {
      rel.conta("ligacao:sem_lead_correspondente");
      continue;
    }
    const quando = dataBubble(c["Creation Date"]);
    if (!quando) {
      rel.conta("ligacao:sem_data_legivel");
      continue;
    }
    // Desempate: o lead mais recente que já existia quando a ligação aconteceu;
    // sem nenhum anterior, o mais antigo posterior. Um lead criado DEPOIS da
    // ligação não pode ser o motivo dela. Comparação de string basta: todo
    // `created_at` daqui é ISO com offset -03:00 (o dado é pós-2024).
    rel.conta("ligacao:casada");
    if (candidatos.length > 1) rel.conta("ligacao:desempate_por_data");
    const anteriores = candidatos.filter((cand) => cand.criado <= quando);
    const escolhido = anteriores.length
      ? anteriores.reduce((a, b) => (a.criado >= b.criado ? a : b))
      : candidatos.reduce((a, b) => (a.criado <= b.criado ? a : b));

    // O CSV não tem PK: a chave sintética é o que permite reexecutar sem
    // duplicar, e é a mesma que vira UUIDv5 do `id` e `bubble_id` do de-para.
    const ref = `call:${quando}:${chave}:${normalizarNome(c.Creator)}`;
    if (vistas.has(ref)) {
      rel.conta("ligacao:duplicata_exata_descartada");
      continue;
    }
    vistas.add(ref);
    const id = det("ligacoes", ref);

    linhas.push({
      id,
      lead_id: escolhido.id,
      actor_id: pessoa(c.Creator).id,
      kind: "call",
      detail: {
        origem: "bubble:ligacoes",
        bubble_ref: ref,
        chave_telefone: chave,
        nome_informado: texto(c.nomecliente),
      },
      created_at: quando,
    });
    pares.push({ bubble_id: ref, tabela_destino: "lead_events", registro_id: id });
  }
  rel.conta("ligacoes:lidas", lidas);
  return { linhas, pares };
}

// ── carga ────────────────────────────────────────────────────────────────────

async function gravar(tabela, linhas, onConflict) {
  const { inseridos, erros } = await inserirEmLote(tabela, linhas, { onConflict });
  rel.conta(`${tabela}:enviados`, linhas.length);
  rel.conta(`${tabela}:inseridos`, inseridos);
  rel.conta(`${tabela}:erros`, erros.length);
  for (const e of erros.slice(0, 20)) rel.aviso(`${tabela} linha ${e.indice}: ${e.mensagem}`);
  if (erros.length > 20) rel.aviso(`${tabela}: mais ${erros.length - 20} linhas com erro`);
  // Quem o BANCO recusou não pode entrar no de-para: a reexecução pularia uma
  // linha que nunca existiu e o aceite fecharia em cima do buraco (R-01/R-02).
  return new Set(erros.map((e) => linhas[e.indice]?.id));
}

async function principal() {
  try {
    supa();
  } catch (e) {
    if (!ehDryRun()) throw e;
    ONLINE = false;
    rel.aviso(`sem banco (${e.message.split("\n")[0]}) — dry-run offline: FK e origens não são conferidas`);
  }

  const porNome = await indicePessoas();
  if (porNome.size === 0 && ONLINE) {
    throw new Error(
      "import_bubble_map não tem nenhum ('user' → 'profiles'): TODA linha entraria sem dono, " +
        "e a reexecução não corrigiria (o insert é DO NOTHING). Rode `node scripts/import/run.mjs pessoas` antes.",
    );
  }
  const pessoa = resolvedor(porNome, "corretor");
  const gerente = resolvedor(porNome, "gerente");
  const criador = resolvedor(porNome, "ligacao_creator");
  const origens = await garantirOrigens();
  const jaImportados = ONLINE ? await lerMapa("lead", "leads") : new Map();
  const comentariosImportados = ONLINE ? await lerMapa("lead", "lead_comments") : new Map();

  if (ONLINE && !ehDryRun()) await sondar();
  const inicioCarga = new Date().toISOString();

  const ctx = { rel, pessoa, gerente, origens };
  const leads = [];
  const comentarios = [];
  const paresLeads = [];
  const paresComentarios = [];
  const porTelefone = new Map();
  let lidos = 0;
  let menor = null;
  let maior = null;

  for await (const l of lerCsv(acharExport("export_All-leadfies"))) {
    lidos++;
    const uid = String(l["unique id"] ?? "").trim();
    if (!uid) {
      rel.aviso(`linha ${lidos} sem unique id — descartada`);
      rel.conta("descartados:sem_uid");
      continue;
    }
    const m = montar(l, ctx);
    if (m.fatal) throw new Error(`${uid}: ${m.fatal}`);
    if (m.erro) {
      rel.aviso(`${uid}: ${m.erro} — linha descartada`);
      rel.conta("descartados:linha_invalida");
      continue;
    }

    rel.conta(`status:${m.lead.status}`);
    rel.conta(`funil:${m.lead.funnel_stage}`);
    if (menor === null || m.lead.created_at < menor) menor = m.lead.created_at;
    if (maior === null || m.lead.created_at > maior) maior = m.lead.created_at;

    // O índice de telefone vê TODO lead, inclusive o já importado: a ligação
    // dele continua tendo de casar, senão a reexecução perde eventos.
    if (m.chave) {
      const atual = porTelefone.get(m.chave);
      const entrada = { id: m.lead.id, criado: m.lead.created_at };
      if (atual) atual.push(entrada);
      else porTelefone.set(m.chave, [entrada]);
    }

    if (jaImportados.has(uid)) {
      rel.conta("leads:ja_importados");
    } else {
      leads.push(m.lead);
      paresLeads.push({ bubble_id: uid, tabela_destino: "leads", registro_id: m.lead.id });
    }
    if (m.comentario) {
      if (comentariosImportados.has(uid)) {
        rel.conta("lead_comments:ja_importados");
      } else {
        comentarios.push(m.comentario);
        paresComentarios.push({ bubble_id: uid, tabela_destino: "lead_comments", registro_id: m.comentario.id });
      }
    }
  }
  rel.conta("leadfies:lidos", lidos);
  rel.conta("telefone:chaves_distintas", porTelefone.size);

  const ligacoes = await lerLigacoes({ porTelefone, pessoa: criador });

  conferirGuardas(leads);

  // Ordem obrigatória: `leads` primeiro (as duas filhas têm FK NOT NULL).
  // Conflito sempre pela PK — o `id` é UUIDv5 do `unique id` do Bubble. Mirar
  // `external_id` daria 42P10: o índice é PARCIAL e o `on_conflict` do PostgREST
  // não escreve predicado (R-06).
  const recusados = {
    leads: await gravar("leads", leads, "id"),
    lead_comments: await gravar("lead_comments", comentarios, "id"),
    lead_events: await gravar("lead_events", ligacoes.linhas, "id"),
  };
  let erros = Object.values(recusados).reduce((n, s) => n + s.size, 0);

  const mapas = [
    ["lead", "leads", paresLeads],
    ["lead", "lead_comments", paresComentarios],
    ["ligacao", "lead_events", ligacoes.pares],
  ];
  let foraDoMapa = 0;
  for (const [entidade, tabela, todos] of mapas) {
    // O de-para recebe a linha que o banco ACEITOU: `registro_id` não tem FK
    // (destino polimórfico, 0096:53), então o par de uma linha recusada
    // apontaria para um uuid inexistente e a reexecução nunca mais tentaria.
    const pares = todos.filter((p) => !recusados[tabela].has(p.registro_id));
    foraDoMapa += todos.length - pares.length;
    rel.conta(`import_bubble_map:${entidade}:${tabela}`, pares.length);
    if (ehDryRun() || !ONLINE) continue;
    const { erros: falhas } = await registrarMapa(entidade, pares);
    erros += falhas.length;
    for (const e of falhas.slice(0, 20)) rel.aviso(`import_bubble_map ${tabela} linha ${e.indice}: ${e.mensagem}`);
  }
  if (foraDoMapa > 0) {
    rel.aviso(
      `${foraDoMapa} linha(s) recusadas pelo banco ficaram FORA do de-para de propósito. ` +
        `Corrija o motivo e rode de novo: o id é UUIDv5 e o insert é DO NOTHING, reexecutar é inócuo.`,
    );
  }

  pessoa.relatar(rel);
  gerente.relatar(rel);
  criador.relatar(rel);
  if (menor) rel.aviso(`faixa de created_at que vai entrar: ${menor} → ${maior}`);
  rel.conta("memoria:rss_mb", Math.round(process.memoryUsage().rss / 1048576));

  if (ONLINE && !ehDryRun()) {
    for (const [tabela, filtro] of [
      ["notifications", (q) => q],
      ["lead_events", (q) => q.neq("kind", "call")],
    ]) {
      const n = await contarDesde(tabela, inicioCarga, filtro);
      rel.conta(`gatilhos:${tabela}_na_janela`, n);
      if (n > 0) {
        rel.aviso(
          `${n} linha(s) em ${tabela} nasceram durante a carga: algum cron voltou a rodar. ` +
            `Confira antes de religar: select cron.alter_job(jobid, active := false) from cron.job where jobname like 'faceimob-%';`,
        );
      }
    }
    rel.aviso(`início da carga (para as consultas de aceite): ${inicioCarga}`);
  }

  rel.imprimir();

  if (erros > 0) {
    console.error(`\n${erros} linha(s) não entraram. Veja os avisos acima antes de reexecutar.`);
    process.exit(1);
  }
}

// ── autoteste (sem banco) ────────────────────────────────────────────────────

/**
 * As regras que decidem o desfecho e a idempotência, contra o corpus real —
 * `node scripts/import/05-leads.mjs --autoteste`.
 *
 * Os volumes são do CSV de 08/09, que é o arquivo final (N-05 não reexportou
 * `leadfies`). Se algum número mudar, este teste falha de propósito: o cabeçalho
 * é especificação, não comentário.
 */
async function autoteste() {
  const { default: assert } = await import("node:assert/strict");

  // coringa: uma letra por U+FFFD, candidato único, e nada de adivinhar fora do vocabulário
  assert.equal(canonizar(`Em negocia${CORROMPIDO}${CORROMPIDO}o`, STATUS, "t"), "Em negociação");
  assert.equal(canonizar(`Neg${CORROMPIDO}cio fechado`, STATUS, "t"), "Negócio fechado");
  assert.equal(canonizar("Arquivado", STATUS, "t"), "Arquivado");
  assert.equal(canonizar("", STATUS, "t"), "");
  assert.equal(canonizar("Reaberto", STATUS, "t"), null);
  assert.equal(canonizar(`Prospec${CORROMPIDO}${CORROMPIDO}o`, ATIVIDADES, "t"), null);
  // duas letras a menos não vira uma letra: o coringa é 1 para 1
  assert.equal(canonizar(`Em negocia${CORROMPIDO}o`, STATUS, "t"), null);

  // telefone: o veredito que `normalize_phone` não dá
  assert.equal(telefoneNacional("(51) 98989 3682"), "51989893682");
  assert.equal(telefoneNacional("5551989893682"), "51989893682");
  assert.equal(telefoneNacional("51 3333-4444"), "5133334444");
  assert.equal(telefoneNacional("(019) 98888 7777"), null); // DDD de 3 dígitos
  assert.equal(telefoneNacional("98888 7777"), null); // sem DDD
  assert.equal(telefoneNacional("+1 305 555 1234"), null); // DDI estrangeiro
  assert.equal(telefoneNacional("51 88888 7777"), null); // celular sem o 9
  assert.equal(telefoneNacional(""), null);

  assert.deepEqual(email(" NONE "), { valor: null, invalido: null });
  assert.deepEqual(email("a@gmail.c"), { valor: null, invalido: "a@gmail.c" });
  assert.deepEqual(email("A@Gmail.com"), { valor: "a@gmail.com", invalido: null });

  // a guarda de saída recusa cada uma das armadilhas, uma a uma
  const bom = {
    external_id: "x",
    status: "lost",
    funnel_stage: "warm",
    lost_at: "2024-01-01T00:00:00-03:00",
    full_name: "Fulano",
    last_activity_at: "2024-01-01T00:00:00-03:00",
  };
  conferirGuardas([bom]);
  for (const ruim of [
    { ...bom, status: "queued", lost_at: null },
    { ...bom, status: "in_progress", funnel_stage: "first_contact", lost_at: null },
    { ...bom, status: "discarded" }, // discarded com lost_at
    { ...bom, status: "lost", lost_at: null }, // lost sem lost_at
    { ...bom, next_action_at: "2024-01-01T00:00:00-03:00" },
    { ...bom, attend_deadline: "2024-01-01T00:00:00-03:00" },
    { ...bom, full_name: "   " },
  ]) {
    assert.throws(() => conferirGuardas([ruim]), /guarda de saída/);
  }

  // corpus: volume, desfecho e as duas travas de idempotência (R-06)
  const ctx = {
    rel,
    pessoa: (v) => ({ id: semNbsp(v) || null, via: semNbsp(v) ? "nome" : "ausente" }),
    gerente: () => ({ id: null, via: "ausente" }),
    origens: new Map([...FONTE.values(), "importacao"].map((c) => [c, c])),
  };
  const leads = [];
  let comentarios = 0;
  const porStatus = new Map();
  for await (const l of lerCsv(acharExport("export_All-leadfies"))) {
    const m = montar(l, ctx);
    assert.ok(!m.erro, `linha recusada: ${m.erro}`);
    leads.push(m.lead);
    if (m.comentario) comentarios++;
    porStatus.set(m.lead.status, (porStatus.get(m.lead.status) ?? 0) + 1);
  }
  assert.equal(leads.length, 102799, "volume mudou — remeça e atualize o cabeçalho");
  assert.equal(comentarios, 7432);
  assert.deepEqual(
    Object.fromEntries([...porStatus].sort()),
    { converted: 59, discarded: 5824, in_progress: 65756, lost: 31160 },
    "a regra de N-02 mudou de resultado — remeça e atualize o cabeçalho",
  );
  conferirGuardas(leads);

  // R-06: a forma que funciona. Conflito na PK, e a PK é função pura do uid.
  assert.equal(new Set(leads.map((l) => l.id)).size, leads.length);
  assert.equal(new Set(leads.map((l) => l.external_id)).size, leads.length);
  assert.equal(det("leadfies", "1715658950499x132032603743673650"), det("leadfies", "1715658950499x132032603743673650"));

  console.log("autoteste: OK");
}

const rodar = process.argv.includes("--autoteste") ? autoteste : principal;
rodar().catch((e) => {
  if (rodar === principal) rel.imprimir();
  console.error(`\n[05-leads] ABORTADO: ${e.message}`);
  process.exit(1);
});
