# Roteiro de validação da roleta de leads (Sprint 1 — S1.5)

Prova de que a distribuição funciona ponta a ponta depois da migration `0013`.
Executado em **30/07/2026** contra o Postgres local (`supabase_db_*`, pg_cron
1.6.4) com as 13 migrations aplicadas e o seed carregado. Os resultados abaixo
são os medidos, não os esperados.

Reexecutar este roteiro em staging antes do `db push` em produção.

---

## 1. Os jobs existem e estão ativos

```sql
select jobid, jobname, schedule, active, database, username
from cron.job where jobname like 'faceimob-%' order by jobname;
```

Resultado:

| jobname | schedule | active |
|---|---|---|
| `faceimob-auto-checkout-expired` | `* * * * *` | t |
| `faceimob-purge-cron-history` | `10 3 * * *` | t |
| `faceimob-release-expired-leads` | `30 seconds` | t |

pg_cron 1.6 aceitou o intervalo em segundos — o fallback de 1 minuto embutido na
`0013` não foi acionado.

## 2. Os jobs realmente executam

```sql
select j.jobname, d.status, d.return_message, d.start_time,
       d.end_time - d.start_time as duracao
from cron.job_run_details d join cron.job j on j.jobid = d.jobid
order by d.start_time desc limit 8;
```

Resultado: 8 execuções, todas `succeeded`, duração entre 3 e 27 ms.

```
faceimob-release-expired-leads | succeeded | 12:23:08.699
faceimob-auto-checkout-expired | succeeded | 12:24:00.016
faceimob-release-expired-leads | succeeded | 12:24:08.735
faceimob-release-expired-leads | succeeded | 12:24:38.749
faceimob-auto-checkout-expired | succeeded | 12:25:00.018
faceimob-release-expired-leads | succeeded | 12:25:08.784
```

Cadência conferida no dado: 30,0 s entre execuções da varredura; 60,0 s entre as
do check-out.

## 3. Check-out automático fecha turno esquecido

Sem nenhuma intervenção, o job fechou às **12:23:00** os três check-ins que
estavam abertos desde **28/07** (`work_date < current_date`), gravando
`auto_checkout = true`. É o cenário do corretor que sai da loja sem encerrar o
turno e continuaria elegível na fila.

## 4. Ciclo completo da trava de 5 minutos

O teste que importa: o lead vencido tem de sair do corretor **pelo cron**, sem
ninguém chamar a função.

### Preparação

```sql
-- dois corretores do grupo geral com check-in de hoje no turno da manhã
insert into public.checkins (profile_id, shift_id, work_date, ip_address)
select p.id, s.id, current_date, '203.0.113.10'::inet
from public.profiles p cross join public.work_shifts s
where p.id in ('...09','...10') and s.code = 'manha'
on conflict (profile_id, work_date, shift_id) do update
  set checked_out_at = null, auto_checkout = false;

select * from public.distribution_queue('<grupo-geral>');
```

Fila: `Felipe Martins` (1), `Elisa Rocha` (2).

### Atribuição

```sql
insert into public.leads (id, full_name, phone)
values ('...e2', 'E2E Cron Teste', '11999990001');
select public.assign_lead('...e2');
```

Lead foi para **Felipe Martins** (posição 1) com `attend_deadline` = atribuição
+ **5 minutos** (`timeout_seconds: 300` no evento) — a regra da ata confirmada no
dado, não na documentação.

### Expiração

```sql
update public.leads set attend_deadline = now() - interval '10 seconds'
where id = '...e2';
update public.lead_assignments set deadline = now() - interval '10 seconds'
where lead_id = '...e2' and released_at is null;
-- marcado em 12:25:57, prazo forçado para 12:25:47
select pg_sleep(40);   -- e nada mais: nenhuma chamada manual à função
```

### Resultado

| evento | horário |
|---|---|
| execução do cron | **12:26:08.855154** |
| `lead_assignments.released_at` (seq 1, `timeout`) | **12:26:08.855213** |
| nova atribuição (seq 2, Elisa Rocha) | **12:26:08.855213** |

A diferença entre a execução do job e a liberação é de 59 µs: mesma transação. O
lead saiu de Felipe, voltou para `queued` e foi redistribuído numa só passada,
**11 segundos** depois do vencimento — dentro da janela de 30 s.

Trilha de auditoria gravada em `lead_events`, na ordem:

```
status_changed  queued   -> assigned
assigned                 -> Felipe    {"timeout_seconds": 300}
released        Felipe   ->           {"reason": "timeout"}
status_changed  assigned -> queued
status_changed  queued   -> assigned
assigned                 -> Elisa     {"sequence": 2}
```

### Limpeza

```sql
delete from public.leads where full_name like 'E2E%';
delete from public.checkins where work_date = current_date and profile_id in (...);
```

Conferido no fim: 12 leads (o mesmo de antes), zero check-ins de hoje, zero
leads de teste.

---

## 5. Achado: o lead voltava para quem o ignorou — corrigido na `0014`

**Decisão do cliente em 30/07:** o lead pode voltar para o mesmo corretor, desde
que **passe por toda a fila de novo**. Corrigido na migration `0014`.

### A correção

`distribution_queue` passou a ordenar por `last_turn_at` — o **fim** da última vez
na roleta — em vez de `last_assigned_at`, o começo. Para uma atribuição encerrada
por `timeout`, o fim da vez é o `released_at`. Efeito: quem perde o lead no prazo
vai para o fim da fila no mesmo instante da liberação, e só recebe de novo depois
que todos tiverem a vez.

Só `timeout` conta como vez consumida. `manual`, `reassigned`, `checkout` e
`sdr_handoff` não são falha do corretor — penalizá-los seria punir o corretor por
decisão de terceiro.

`last_assigned_at` continua no retorno com o significado original (último lead
recebido), para a tela do corretor. Quem ordena é `last_turn_at`.

### Verificação em banco real

Reproduzido o mesmo cenário que falhava, agora com a `0014` aplicada:

```
Felipe recebe lead A  (13:00:50.043)  -> fila: Felipe (1), Elisa (2)
Elisa  recebe lead B  (13:00:50.058)
prazo do lead A estoura, com Felipe na POSIÇÃO 1 (a condição do ping-pong)
```

| sequence | corretor | release_reason |
|---|---|---|
| 1 | Felipe Martins | timeout |
| 2 | **Elisa Rocha** | — |

O lead foi para a Elisa. Fila depois da liberação: Elisa (1), **Felipe (2)** — o
corretor que ignorou foi para o fim.

Comparar com a tabela da versão anterior deste roteiro, em que a terceira
atribuição voltava para a mesma pessoa.

### Empate conhecido

No instante da liberação, quem perdeu o lead e quem o recebeu ficam com o mesmo
`last_turn_at`: `now()` é constante dentro da transação, e a liberação e a nova
atribuição acontecem na mesma. O desempate cai no `profile_id`, então o próximo
lead pode ir para qualquer um dos dois antes do outro.

O desvio é de no máximo um lead e se corrige sozinho na atribuição seguinte —
quem receber passa a ter o `last_turn_at` mais recente e cai para trás. Os dois
consumiram a vez no mesmo instante, então a regra "passou pela fila" continua
valendo.

### Regressão automatizada

5 asserts em `supabase/tests/02_business_rules.sql` (seções 4 e 4b): o lead
vencido vai para outro corretor; quem estourou o prazo fica atrás de quem está
atendendo e no fim da fila; `last_assigned_at` e `last_turn_at` mantêm
significados distintos; liberação por realocação não consome a vez.

Os timestamps do teste 4b são explícitos, e não `now()`, justamente por causa do
empate descrito acima — dentro da transação o desempate cairia no `profile_id` e o
teste seria não-determinístico.

---

## 5b. Como era antes da `0014` (registro do achado)

Mantido para referência do que a `0014` corrigiu.

`distribution_queue` ordenava por `max(lead_assignments.assigned_at)` do corretor.
Quando o prazo estoura, `release_expired_leads()` chama `assign_lead()` na hora,
e o corretor que ignorou o lead continuava com o `assigned_at` daquele mesmo lead —
5 minutos atrás. Se todos os outros elegíveis receberam algo **mais recente**, ele
seguia na frente da fila e recebia o mesmo lead de volta.

Cenário reproduzido, com dois corretores em fila:

```
1. lead E2E fica com Elisa   (assigned_at 12:26:08)
2. lead novo vai para Felipe (assigned_at 12:27:21)  -> Felipe passa a ser o mais recente
3. fila: Elisa (1), Felipe (2)
4. prazo do lead da Elisa estoura
```

Histórico resultante do lead:

| sequence | corretor | release_reason |
|---|---|---|
| 1 | Felipe Martins | timeout |
| 2 | Elisa Rocha | timeout |
| 3 | **Elisa Rocha** | — |

A ata de 14/07 diz "respeitando a regra de cinco minutos para atendimento antes
do lead ser repassado **ao próximo da fila**", e a de 23/07 "caso o corretor não
realize uma ação em 5 minutos, o lead deve **retornar para a fila**". Devolver ao
mesmo corretor contraria as duas leituras.

O efeito é maior justamente quando dói mais: fila curta (poucos em check-in) ou
volume alto de leads — os dois casos em que os outros elegíveis têm recebimento
recente.

O efeito era maior justamente quando dói mais: fila curta (poucos em check-in) ou
volume alto de leads — os dois casos em que os outros elegíveis têm recebimento
recente.

Resolvido na `0014` tratando o timeout como vez consumida, conforme a seção 5.
A alternativa considerada — `assign_lead` aceitar um corretor a excluir — foi
descartada: ela evitaria só o retorno imediato, deixando o corretor em segundo
lugar em vez de no fim da fila, o que não é o que o cliente pediu.

---

## 6. Regressão automatizada

O que este roteiro faz à mão, o harness passou a afirmar sozinho:

```bash
./scripts/validate-schema.sh --all
```

`supabase/tests/04_cron_scheduling.sql` — 12 asserts — cobre: os três jobs
existem, estão ativos, chamam as funções certas, a cadência da varredura é
sub-minuto ou de 1 minuto, reagendar não duplica job, e `cron_jobs_health()`
retorna vazio para quem não é admin.

`supabase/tests/02_business_rules.sql` — 5 asserts novos (seções 4 e 4b) — cobre
a regra de ordenação da `0014`.

Era o assert que faltava: `02_business_rules.sql` já provava que
`release_expired_leads()` funciona quando chamada, e o sistema passou 12
migrations com a função correta e ninguém a chamando. Teste de comportamento
verde não detecta código morto.
