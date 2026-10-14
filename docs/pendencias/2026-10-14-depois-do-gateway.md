# Pendências de 14/10/2026 — fazer depois do pedido "Avisos de sucesso" do gateway

Anotado a pedido. Os dois itens abaixo já estão mapeados no código (nada foi alterado);
cada um tem o comando pronto para mandar no gateway com `/ajuste`, um de cada vez.

---

## 1. Travamento do check-in ao meio-dia

**Pedido:** ao meio-dia o check-out de todo mundo trava o servidor. Aumentar o intervalo
entre sair e entrar (ex.: sair às 11:55 e entrar às 12:00), porque na indisponibilidade
alguns perdem o lugar na fila.

**Mapa do que existe**
- `public.work_shifts` guarda cada turno com `checkin_start`, `distribution_start` e
  `checkout_time` (0004). O seed de exemplo é Manhã 08:00–12:00, Tarde 13:00–18:00, Noite
  18:30–21:30; **os valores de produção precisam ser lidos na VPS**.
- `public.auto_checkout_expired()` (0057) fecha **toda** presença do turno cujo
  `checkout_time` passou, de uma vez, no mesmo `UPDATE`. Roda por `pg_cron` **a cada
  minuto** (`faceimob-auto-checkout-expired`, 0013).
- Se o turno da manhã termina às 12:00 e o da tarde abre às 12:00, no mesmo minuto há um
  `UPDATE` em massa (com todos os gatilhos de fila/notificação/realtime) e uma enxurrada de
  novos check-ins.
- A fila é por ordem de chegada (0200): quem não consegue entrar por causa da lentidão
  perde a posição.

**Duas frentes (a primeira não precisa de deploy)**
1. **Dado:** ajustar `work_shifts` em produção: `checkout_time` da manhã para `11:55` e
   `checkin_start` da tarde para `12:00` (ou o que a operação confirmar).
2. **Código (reduzir o pico):** fazer `auto_checkout_expired` fechar em **lotes** por
   execução (`for update skip locked`, ex. 25 por minuto) e/ou espalhar o horário de saída,
   para o fechamento não ser um único `UPDATE` com todo mundo.

**Consulta de leitura (VPS), para ver os horários reais**
```
docker exec faceimob-db psql -U postgres -c "select code, checkin_start, distribution_start, checkout_time, active from work_shifts order by position"
```

**Comando para o gateway** (depois que eu confirmar os horários):
```
/ajuste travamento do check-in ao meio-dia: o auto_checkout_expired fecha todas as presenças do turno no mesmo UPDATE a cada minuto, e no mesmo minuto o turno seguinte abre. Quero fechar em lotes (for update skip locked) para espalhar o pico, sem mudar a regra de quem está dentro do horário, e manter a ordem de chegada da fila. Faça migration nova, teste SQL, rode os testes e NÃO publique.
```

---

## 2. Negócio que volta ao INCOMPLETO deve oferecer a Esteira Ágil, não "virar negócio"

**Pedido:** quando o negócio volta ao Incompleto, mesmo que já estivesse aprovado ou em
qualquer outro status, o próximo passo na aba Negócio é a **Esteira Ágil**. Hoje oferece
"virar negócio" porque antes estava aprovado.

**Causa (confirmada no código)**
- A tela decide a esteira pelo **caso da CCA**, não pelo Status 2:
  `DealDocumentUpload.tsx` — `reenvioIncompleto = INCOMPLETO && casoAberto`, e com
  `caseStatus === "approved"` a Ágil fica bloqueada
  ("A documentação já foi aprovada…") e `virarBlockReason` libera o "virar".
- Quem reativa um negócio **não cancela o caso aprovado**: tanto `reactivate_deal` (0236)
  quanto `reativar_negocio` (0277) cancelam só casos `not in ('approved','rejected','cancelled')`.
  O caso aprovado fica, e o negócio volta ao Incompleto "ainda aprovado" na CCA.
- Efeito colateral: um caso aprovado antigo ainda conta como aprovado no mês novo.
- O reenvio a partir do INCOMPLETO (0253) também só cancela caso **aberto**.

**Correção proposta**
1. **Banco:** na reativação (`reativar_negocio` e `reactivate_deal`) e no reenvio a partir de
   INCOMPLETO (`submit_deal_for_manager_review`), cancelar **qualquer** caso não cancelado,
   inclusive aprovado e reprovado, com o motivo no histórico.
2. **Tela:** com o Status 2 em INCOMPLETO, a Esteira Ágil é sempre o próximo passo e o
   "virar" fica fechado, **independente do caso** (`reenvioIncompleto` deixa de depender de
   `casoAberto`).
3. **Dados já existentes:** achar os negócios hoje em INCOMPLETO com caso aprovado e
   cancelar o caso (SQL de uma linha, com antes e depois, só com autorização).

**Consulta de leitura (VPS), para ver quantos já estão assim**
```
docker exec faceimob-db psql -U postgres -c "select count(*) from deals d join cca_cases c on c.deal_id=d.id where public.deal_status_bare(d.status_detail)='INCOMPLETO' and c.status in ('approved','rejected')"
```

**Comando para o gateway:**
```
/ajuste negócio que volta ao INCOMPLETO (reativado ou reenviado) mantém o caso aprovado da CCA e por isso a aba Negócio oferece "virar negócio" em vez da Esteira Ágil. Quero: (1) no banco, reativar_negocio, reactivate_deal e o reenvio a partir de INCOMPLETO em submit_deal_for_manager_review cancelam qualquer caso não cancelado (aprovado e reprovado também), com o motivo no histórico; (2) na tela (DealDocumentUpload), com o Status 2 em INCOMPLETO a Esteira Ágil é sempre o próximo passo e o "virar" fica fechado, sem depender do caso. Migration nova, teste SQL e de tela, rode os testes e NÃO publique.
```

---

**Ordem sugerida:** primeiro o item 2 (corrige o caminho comercial, risco baixo), depois o
item 1 (depende dos horários reais da produção).
