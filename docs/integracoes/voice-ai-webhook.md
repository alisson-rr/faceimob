# Contrato do webhook da IA de voz

**Este documento é o que se entrega ao fornecedor.** Ele descreve o único
endpoint que a plataforma de voz precisa chamar para que um lead qualificado por
telefone entre na roleta do FACEIMOB.

Origem: ata de 23/07/2026, item 11. Prazo registrado: ~12/09/2026.

---

## Endpoint

```
POST https://<projeto>.supabase.co/functions/v1/voice-ai-webhook
Content-Type: application/json
Authorization: Bearer <SEGREDO_COMPARTILHADO>
```

Homologação: `https://mcmqgxvtwegtptfseqvw.supabase.co/functions/v1/voice-ai-webhook`

O `<SEGREDO_COMPARTILHADO>` é combinado entre as duas partes e cadastrado do
nosso lado em **Admin → Integrações**, no slot `voice_ai / webhook_secret`. Não
é o token do Supabase e não é usado para mais nada: se vazar, trocamos só ele.

---

## Corpo da requisição

```json
{
  "event_id":    "evt_123",
  "type":        "lead_qualified",
  "external_id": "chamada-987",
  "full_name":   "Maria Silva",
  "phone":       "+5511999998888",
  "source_code": "whatsapp"
}
```

| Campo | Obrigatório | O que é |
|---|---|---|
| `type` | não (padrão `lead_qualified`) | `lead_qualified`, `transcript` ou `status` |
| `external_id` | **sim** | O identificador da chamada **no sistema de vocês**. É a chave de idempotência. |
| `full_name` | não | Nome do lead. Sem ele o lead nasce como "Lead da IA de voz". |
| `phone` | não | Telefone em qualquer formato; normalizamos para DDI 55. |
| `source_code` | não | Código de origem. Ver abaixo. |
| `event_id` | não | Só para rastreio nos seus logs; não usamos para deduplicar. |

Campos extras são aceitos e guardados inteiros junto do lead. Não os inventem
por conta: se um dado precisa virar comportamento, ele entra nesta tabela antes
de virar código.

### `source_code`

É o **código da origem** no nosso catálogo, não um texto livre. Hoje os códigos
válidos são:

`meta_ads` · `whatsapp` · `organico` · `indicacao` · `portal` · `importacao`

Código desconhecido **não derruba o lead**: ele entra sem etiqueta de origem e o
payload inteiro fica guardado. Perder a etiqueta é aceitável; perder o lead não.

> Nota para quem for editar este documento: `source_code` é o nome do campo **do
> payload**. Na nossa tabela `leads` a coluna é `source_id uuid`, resolvida
> contra `lead_sources.code`. A versão anterior deste contrato — que vivia num
> comentário do `index.ts` — dizia que `source_code` era coluna, e por isso a
> function respondia 500 mesmo com o payload correto.

### Eventos de acompanhamento

```json
{ "type": "transcript", "external_id": "chamada-987", "transcript": "..." }
```

```json
{ "type": "status", "external_id": "chamada-987", "status": "qualified" }
```

Os dois exigem que o lead **já exista** (isto é, que um `lead_qualified` com o
mesmo `external_id` tenha chegado antes). Eles não criam lead nem redistribuem
nada — ficam no histórico do lead.

---

## Idempotência: reenviem à vontade

`external_id` tem índice único no nosso banco. Reenviar o mesmo evento **não
cria um segundo lead**: a resposta traz `"duplicate": true` e o mesmo
`lead_id`. Dois envios simultâneos do mesmo evento também são tratados — um
ganha, o outro devolve o lead que o primeiro criou.

Isso é deliberado, porque plataforma de terceiro retenta por padrão quando não
recebe 200 rápido. Retentem.

---

## Respostas

| Status | Significado | O que fazer |
|---|---|---|
| `200` | Aceito. Corpo traz `lead_id` e `assigned` (se entrou na roleta). | Nada. |
| `400` | Payload inválido (falta `external_id`, `type` desconhecido). | Corrigir o envio; retentar não resolve. |
| `401` | `Authorization` ausente ou errado. | Conferir o segredo compartilhado. |
| `404` | `transcript`/`status` para um `external_id` que não conhecemos. | Mandar o `lead_qualified` primeiro. |
| `503` | Integração ainda não configurada do nosso lado. | Avisar-nos; retentar depois. |
| `500` | Erro nosso. | Retentar com espera crescente. |

Exemplo de resposta de sucesso:

```json
{ "ok": true, "lead_id": "8f0c...", "assigned": true }
```

`assigned: false` significa que o lead foi criado mas ainda não tinha corretor
elegível na hora — uma varredura nossa o distribui em até um minuto. Não é erro
e não precisa de reenvio.

---

## O que acontece do nosso lado

1. O lead é criado com `status = queued`.
2. `assign_lead` escolhe o corretor pela **roleta** — ordem de fila entre quem
   fez check-in, com trava de atendimento. O webhook não escolhe corretor, e não
   há como pedir um corretor específico pelo payload.
3. O corretor recebe aviso no sino e, quando a credencial da Cloud API existir,
   também no WhatsApp.

---

## O que falta para isto funcionar

Nosso lado está pronto e coberto por teste. Faltam três coisas, todas do
fornecedor:

1. **O segredo compartilhado**, para cadastrarmos em `voice_ai/webhook_secret`.
   Enquanto não existir, o endpoint responde `503` com o motivo escrito — não
   `500`, e nunca fingindo sucesso.
2. **A confirmação do formato do evento** que vocês mandam. Se ele for diferente
   do descrito aqui, é aqui que a diferença se registra, antes de escrever
   código dos dois lados.
3. **Um ambiente de homologação de vocês**, para dispararmos um evento assinado
   de verdade. Sem isso não há como provar o caminho ponta a ponta — nenhum
   evento jamais chegou.

Com os três, a integração fecha em horas.

## Teste rápido (quando o segredo existir)

```bash
curl -sS -X POST "$SUPABASE_URL/functions/v1/voice-ai-webhook" \
  -H "Authorization: Bearer $VOICE_AI_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"type":"lead_qualified","external_id":"teste-001","full_name":"Lead de Teste","phone":"11999998888","source_code":"whatsapp"}'
```

Esperado: `200` com `lead_id`. Repetir o mesmo comando deve devolver
`"duplicate": true` e o **mesmo** `lead_id`.
