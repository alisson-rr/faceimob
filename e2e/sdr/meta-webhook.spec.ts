/**
 * Webhook do Meta Lead Ads — o contrato do POST, sem navegador.
 *
 * Nenhum teste automatizado tocava a function: `e2e/admin/meta-ads.spec.ts`
 * testa só a tela.
 *
 * São DOIS contratos, com provas de origem diferentes, e o teste exercita os
 * dois:
 *   · payload da Meta (`entry[].changes[]`) → assinatura X-Hub-Signature-256.
 *     Sem assinatura válida, 401 — inclusive quando o app secret ainda não
 *     está cadastrado (antes esse caso era ACEITO, e a URL é pública);
 *   · POST direto (Zapier/N8N, `{name, phone, source}`) → é entrada pública e
 *     continua gravando o lead, mas só aciona a IA quando a chamada prova
 *     origem com a chave de serviço. Sem prova, o lead vai para a roleta: o
 *     `source` é um slug legível, então um anônimo escolheria o número que a
 *     WABA do cliente iria mensagear e abriria conversa que gasta OpenAI.
 *
 * O que este arquivo defende:
 *   · lead de origem com agente abre `sdr_conversations` e fica fora da roleta;
 *   · lead SEM telefone não entra na IA — o robô casa a resposta por telefone,
 *     então abrir conversa aqui deixaria o lead sem robô e fora da fila de todo
 *     corretor (buraco silencioso corrigido em 02/09);
 *   · origem sem agente segue para `assign_lead` como sempre;
 *   · POST sem prova de origem não faz o robô falar com número de fora.
 */
import { test, expect, db, runTag } from "../support/fixtures";
import { resolveTarget } from "../support/target";

const tag = runTag();
const alvo = resolveTarget();
const slug = tag.replace(/[^a-z0-9]/gi, "_").toLowerCase();
const COM_AGENTE = `e2e_sdr_${slug}`;
const SEM_AGENTE = `e2e_roleta_${slug}`;

type LeadRow = {
  id: string; status: string; source_id: string | null;
  phone: string | null; full_name: string; notes: string | null;
};

const URL_WEBHOOK = `${alvo.supabaseUrl}/functions/v1/meta-ads-webhook`;

/**
 * `provado: false` manda o mesmo POST sem a chave de serviço — é o que um
 * estranho que descobrisse a URL conseguiria montar.
 */
const postarLead = async (corpo: Record<string, string>, opcoes: { provado?: boolean } = {}) => {
  const provado = opcoes.provado !== false;
  const res = await fetch(URL_WEBHOOK, {
    method: "POST",
    headers: {
      apikey: alvo.anonKey,
      "Content-Type": "application/json",
      // Prova de origem do POST direto: a mesma chave que o pg_cron manda aos
      // workers. Se este cabeçalho falhar no alvo remoto, confira se
      // `supabase/service_role_key` no cofre é o MESMO valor do ambiente.
      ...(provado ? { Authorization: `Bearer ${alvo.serviceRoleKey}` } : {}),
    },
    body: JSON.stringify(corpo),
  });
  // A Meta reenviaria em qualquer resposta que não fosse 200 — e replay duplica lead.
  expect(res.status, "o webhook precisa sempre confirmar com 200").toBe(200);
  return res.json() as Promise<{ success: boolean; leads_processed?: number; origem_verificada?: boolean }>;
};

const leadPorOrigem = (code: string) =>
  db.select<LeadRow>(`leads?utm_source=eq.${code}&select=id,status,source_id,phone,full_name,notes`);

const conversasDoLead = (leadId: string) =>
  db.select<{ id: string }>(`sdr_conversations?lead_id=eq.${leadId}&select=id`);

test.beforeAll(async () => {
  const [agente] = await db.select<{ id: string }>("sdr_agents?active=eq.true&select=id&limit=1");
  expect(agente, "cenário precisa de um agente ativo").toBeTruthy();
  await db.insert("lead_sources", [
    { code: COM_AGENTE, label: `Origem IA ${tag}`, channel: "meta", sdr_agent_id: agente.id, active: true },
    { code: SEM_AGENTE, label: `Origem roleta ${tag}`, channel: "meta", sdr_agent_id: null, active: true },
  ]);
});

test.afterAll(async () => {
  // Conversas e mensagens caem por cascade com o lead.
  await db.remove(`leads?utm_source=in.(${COM_AGENTE},${SEM_AGENTE})`);
  // Rede de segurança: se o caso do 401 falhar, o lead entra com utm_source
  // 'meta' e não sairia pela limpeza acima.
  await db.remove(`leads?full_name=like.${encodeURIComponent(`*${tag}*`)}`);
  await db.remove(`lead_sources?code=in.(${COM_AGENTE},${SEM_AGENTE})`);
});

test("origem com agente abre conversa de SDR e não vai para a roleta", async () => {
  const [regras] = await db.select<{ leads_paused: boolean }>(
    "automation_settings?id=eq.true&select=leads_paused",
  );
  test.skip(regras.leads_paused, "chegada de leads pausada no admin: o webhook ignora tudo de propósito");

  const resposta = await postarLead({
    name: `Lead IA ${tag}`,
    phone: "11922220001",
    email: `lead.ia.${slug}@faceimob.test`,
    source: COM_AGENTE,
  });
  expect(resposta.leads_processed).toBe(1);

  const [lead] = await leadPorOrigem(COM_AGENTE);
  expect(lead, "o POST direto precisa gravar o lead").toBeTruthy();
  expect(lead.source_id, "o lead tem de ficar ligado à origem, para relatório por canal").toBeTruthy();
  expect(
    await conversasDoLead(lead.id),
    "origem com agente entra na IA — é a decisão da ata de 14/07",
  ).toHaveLength(1);
  // Fora da roleta: quem devolve o lead à fila é o sdr_handoff, depois.
  expect(lead.status).toBe("queued");
});

test("lead sem telefone não entra na IA e segue para a roleta", async () => {
  const [regras] = await db.select<{ leads_paused: boolean }>(
    "automation_settings?id=eq.true&select=leads_paused",
  );
  test.skip(regras.leads_paused, "chegada de leads pausada no admin");

  await postarLead({
    name: `Lead sem fone ${tag}`,
    email: `lead.semfone.${slug}@faceimob.test`,
    source: COM_AGENTE,
  });

  const semFone = (await leadPorOrigem(COM_AGENTE)).find((l) => !l.phone);
  expect(semFone, "o lead sem telefone precisa existir mesmo assim").toBeTruthy();
  expect(
    await conversasDoLead(semFone?.id ?? ""),
    "sem número o robô nunca falaria com ele: abrir conversa o deixaria sem robô E fora da fila",
  ).toHaveLength(0);
});

test("origem sem agente continua caindo na roleta", async () => {
  const [regras] = await db.select<{ leads_paused: boolean }>(
    "automation_settings?id=eq.true&select=leads_paused",
  );
  test.skip(regras.leads_paused, "chegada de leads pausada no admin");

  await postarLead({
    name: `Lead roleta ${tag}`,
    phone: "11922220002",
    email: `lead.roleta.${slug}@faceimob.test`,
    source: SEM_AGENTE,
  });

  const [lead] = await leadPorOrigem(SEM_AGENTE);
  expect(lead, "o POST direto precisa gravar o lead").toBeTruthy();
  expect(await conversasDoLead(lead.id), "origem sem agente não abre conversa").toHaveLength(0);
  // `assign_lead` roda: com corretor em fila vira 'assigned', sem ninguém fica
  // 'queued' para o cron varrer. Os dois são desfechos da roleta.
  expect(["queued", "assigned"]).toContain(lead.status);
});

/**
 * A trava que motivou a separação dos dois contratos: com a URL pública e o
 * `source` sendo um slug legível ('portal_zap'), um POST anônimo faria a WABA
 * do cliente disparar template para o número escrito no corpo da requisição e
 * abriria conversa que consome crédito da OpenAI a cada resposta.
 *
 * O lead continua sendo gravado — é uma entrada pública, como formulário de
 * site — e continua ligado à origem (relatório por canal). O que não pode é
 * acionar a IA.
 */
test("POST sem prova de origem grava o lead, mas não faz o robô falar com o número enviado", async () => {
  const [regras] = await db.select<{ leads_paused: boolean }>(
    "automation_settings?id=eq.true&select=leads_paused",
  );
  test.skip(regras.leads_paused, "chegada de leads pausada no admin");

  const nome = `Lead anonimo ${tag}`;
  const resposta = await postarLead(
    { name: nome, phone: "11922220003", source: COM_AGENTE },
    { provado: false },
  );
  expect(resposta.leads_processed).toBe(1);
  expect(resposta.origem_verificada, "a resposta precisa dizer que a origem não foi provada").toBe(false);

  const lead = (await leadPorOrigem(COM_AGENTE)).find((l) => l.full_name === nome);
  expect(lead, "lead de entrada pública continua sendo gravado").toBeTruthy();
  expect(lead!.source_id, "o vínculo com a origem vale mesmo sem IA — é o relatório por canal").toBeTruthy();
  expect(
    await conversasDoLead(lead!.id),
    "sem prova de origem o webhook não pode abrir conversa nem mandar template",
  ).toHaveLength(0);
  // O corretor que atender precisa saber por que a IA não falou antes.
  expect(lead!.notes ?? "").toContain("origem não verificada");
});

/**
 * Payload no formato da Meta sem assinatura: 401 nos DOIS estados do ambiente
 * — com `meta/app_secret` cadastrado (assinatura ausente/errada) e sem ele
 * (não há como verificar nada). Antes, o segundo caso era aceito e a única
 * pista era uma linha de log; é o mesmo buraco que o whatsapp-inbound-webhook
 * fechou.
 */
test("payload da Meta sem assinatura válida é recusado com 401", async () => {
  const nome = `Meta falso ${tag}`;
  const res = await fetch(URL_WEBHOOK, {
    method: "POST",
    headers: { apikey: alvo.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      entry: [{
        changes: [{
          field: "leadgen",
          value: { leadgen_id: `e2e-${slug}`, form_id: "0", field_data: [{ name: "full_name", values: [nome] }] },
        }],
      }],
    }),
  });
  expect(res.status, "sem assinatura da Meta o evento não pode entrar").toBe(401);
  expect(
    await db.select<{ id: string }>(`leads?full_name=eq.${encodeURIComponent(nome)}&select=id`),
    "evento recusado não pode ter gravado lead",
  ).toHaveLength(0);
});
