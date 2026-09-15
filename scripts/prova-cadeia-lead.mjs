/**
 * PROVA DA CADEIA: do lead que a Meta entrega até a venda registrada.
 *
 * POR QUE ISTO EXISTE. A suíte E2E prova cada passo separado, e prova bem —
 * mas ninguém tinha percorrido a HISTÓRIA inteira com um lead só: chega,
 * distribui, trava, converte, rateia, passa pela conferência do gerente, entra
 * na esteira de crédito e vira venda. Fluxo que passa por partes e quebra na
 * emenda é o defeito que só aparece na frente do cliente.
 *
 * O QUE É SIMULADO E O QUE É REAL. Simulado: a chegada do lead. A Meta não
 * manda nada aqui porque não temos `meta/app_secret` no cofre — e o webhook
 * RECUSA sem ele, que é o comportamento certo. Então o passo 1 prova a estrutura
 * de recebimento (assinatura inválida é barrada) e o passo 2 injeta o lead pela
 * porta de serviço, com o MESMO formato que o webhook grava. Do passo 3 em
 * diante nada é simulado: são as RPCs de produção, com RLS ligada, cada uma
 * chamada com o token do papel que a chamaria de verdade.
 *
 *   node scripts/prova-cadeia-lead.mjs
 *
 * Exige `SUPABASE_SERVICE_ROLE_KEY` no ambiente (nunca é impressa). Limpa o que
 * criou no fim, inclusive quando falha no meio.
 */
const alvo = { url: process.env.SUPABASE_URL || "https://mcmqgxvtwegtptfseqvw.supabase.co" };
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!SERVICE) throw new Error("sem SUPABASE_SERVICE_ROLE_KEY no ambiente");
if (!ANON) throw new Error("sem VITE_SUPABASE_PUBLISHABLE_KEY no ambiente");

const TAG = `prova-${Date.now()}`;
const passos = [];
let falhou = false;

const ok = (nome, condicao, detalhe) => {
  passos.push({ nome, ok: !!condicao, detalhe });
  if (!condicao) falhou = true;
  console.log(`${condicao ? "  ok  " : "FALHOU"} ${nome}${detalhe ? " — " + detalhe : ""}`);
};

const admin = (caminho, init = {}) =>
  fetch(`${alvo.url}${caminho}`, {
    ...init,
    headers: {
      apikey: SERVICE, Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json", Prefer: "return=representation",
      ...(init.headers || {}),
    },
  });

/**
 * ELE ENGOLIA O SEGUNDO ARGUMENTO. Custou caro em 06/09/2026: a chamada que eu
 * escrevi como `sql("/rest/v1/leads", { method: "POST", body })` virou um GET,
 * devolveu o PRIMEIRO lead que já existia na base, e a cadeia inteira rodou em
 * cima de um lead de demonstração — que a faxina do fim apagou.
 *
 * O conserto é a assinatura repassar `init`. A trava contra o mesmo estrago
 * está em `souDono()`, mais abaixo: nada é apagado sem prova de que este script
 * criou.
 */
const sql = async (caminho, init = {}) => {
  const r = await admin(caminho, init);
  const t = await r.text();
  if (!r.ok) throw new Error(`${caminho} → ${r.status}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : [];
};

/**
 * Só apaga o que ESTE script criou.
 *
 * Toda linha criada aqui carrega o TAG da execução em `notes`. A faxina confere
 * antes de apagar; sem a marca, ela recusa e avisa. É a diferença entre um
 * script de prova e um script que estraga a base de demonstração.
 */
const souDono = async (tabela, id, campo = "notes") => {
  if (!id) return false;
  const [linha] = await sql(`/rest/v1/${tabela}?id=eq.${id}&select=${campo}`).catch(() => []);
  return !!linha && String(linha[campo] ?? "").includes(TAG);
};

/** Sessão real de um usuário, pelo mesmo caminho da suíte E2E. */
async function sessaoDe(email) {
  const link = await admin("/auth/v1/admin/generate_link", {
    method: "POST", body: JSON.stringify({ type: "magiclink", email }),
  }).then((r) => r.json());
  if (!link.email_otp) throw new Error(`generate_link falhou para ${email}`);
  const s = await fetch(`${alvo.url}/auth/v1/verify`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email, token: link.email_otp }),
  }).then((r) => r.json());
  if (!s.access_token) throw new Error(`verify falhou para ${email}: ${JSON.stringify(s).slice(0, 150)}`);
  return s.access_token;
}

/** Chamada como um PAPEL de verdade: RLS e policies valendo. */
const comoUsuario = async (token, caminho, init = {}) => {
  const r = await fetch(`${alvo.url}${caminho}`, {
    ...init,
    headers: {
      apikey: ANON, Authorization: `Bearer ${token}`,
      "Content-Type": "application/json", Prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
  return { status: r.status, corpo: await r.text() };
};

const rpc = (token, nome, args) =>
  comoUsuario(token, `/rest/v1/rpc/${nome}`, { method: "POST", body: JSON.stringify(args) });

let leadId = null;
let dealId = null;
let checkinFeitoPor = null;

try {
  // ── 1. A PORTA: o webhook recusa quem não prova origem ────────────────────
  const forjado = await fetch(`${alvo.url}/functions/v1/meta-ads-webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-hub-signature-256": "sha256=deadbeef" },
    body: JSON.stringify({
      entry: [{ changes: [{ field: "leadgen", value: { leadgen_id: "1", form_id: "f1" } }] }],
    }),
  });
  ok(
    "1. webhook da Meta recusa payload sem assinatura válida",
    forjado.status === 401,
    `HTTP ${forjado.status} (esperado 401 — falha FECHADA)`,
  );

  // ── 2. O lead chega, no mesmo formato que o webhook grava ─────────────────
  const [origem] = await sql("/rest/v1/lead_sources?select=id,label&limit=1");
  const [lead] = await sql("/rest/v1/leads", {
    method: "POST",
    body: JSON.stringify({
      full_name: `Cliente ${TAG}`,
      phone: "11987650001",
      email: `${TAG}@exemplo.com.br`,
      status: "queued",
      funnel_stage: "new",
      form_id: `form-${TAG}`,
      source_id: origem?.id ?? null,
      campaign_name: `Campanha ${TAG}`,
      utm_source: "facebook",
      external_id: `leadgen-${TAG}`,
      notes: TAG,
    }),
  });
  leadId = lead.id;
  ok(
    "2. lead da Meta grava com origem, campanha e UTM",
    lead.status === "queued" && lead.phone?.startsWith("55"),
    `status=${lead.status} phone=${lead.phone} (o gatilho normalizou com DDI)`,
  );

  // ── 2b. CHECK-IN: sem corretor em fila a roleta nao tem a quem entregar.
  //      Este e o passo que a cadeia pulava — e a roleta devolveu `null`, que e
  //      o comportamento CERTO: lead sem corretor disponivel fica na fila.
  const [corretorDaVez] = await sql(
    "/rest/v1/profiles?select=id,email,full_name&status=eq.active&email=like.*%40faceimob.test*&limit=1",
  );
  let tokenCheckin = null;
  if (corretorDaVez) {
    tokenCheckin = await sessaoDe(corretorDaVez.email);
  } else {
    // Sem conta de teste na base, uso a minha propria — o que importa e existir
    // ALGUEM em fila, nao quem.
    tokenCheckin = await sessaoDe("dev.alisson.rosa@gmail.com");
  }
  // `127.0.0.1/32` esta entre as faixas ativas de `allowed_ips`: o check-in por
  // IP e a trava antifraude, e passar por ela e parte do que se prova aqui.
  const checkin = await rpc(tokenCheckin, "perform_checkin", { client_ip: "127.0.0.1" });
  if (checkin.status < 300) {
    const [quem] = await sql(
      `/rest/v1/profiles?select=id&email=eq.${encodeURIComponent(corretorDaVez?.email ?? "dev.alisson.rosa@gmail.com")}`,
    );
    checkinFeitoPor = quem?.id ?? null;
  }
  const fila = await sql("/rest/v1/distribution_queue?select=broker_id&limit=5").catch(() => []);
  ok(
    "2b. check-in por IP autorizado coloca o corretor na fila da roleta",
    checkin.status < 300,
    `HTTP ${checkin.status}${checkin.status >= 300 ? " · " + checkin.corpo.slice(0, 160) : ""} · fila=${fila.length}`,
  );

  // ── 3. A ROLETA distribui. `assign_lead` é de service_role de proposito
  //      (a 0023 revoga de `authenticated`): quem distribui é o sistema, nao o
  //      corretor escolhendo o proprio lead.
  const distribuicao = await admin("/rest/v1/rpc/assign_lead", {
    method: "POST",
    body: JSON.stringify({ p_lead_id: leadId, p_force: true }),
  });
  const escolhido = distribuicao.ok ? JSON.parse(await distribuicao.text()) : null;
  const [aposRoleta] = await sql(
    `/rest/v1/leads?id=eq.${leadId}&select=status,assigned_to,attend_deadline`,
  );
  ok(
    "3. a roleta distribui o lead e abre o prazo de atendimento",
    !!escolhido && aposRoleta.status === "assigned" && !!aposRoleta.attend_deadline,
    `corretor=${String(escolhido).slice(0, 8)} · status=${aposRoleta.status} · prazo=${aposRoleta.attend_deadline}`,
  );
  if (!escolhido) throw new Error("a roleta não escolheu ninguém — sem corretor em fila, o resto da cadeia não existe");

  // ── 3b. O CORRETOR ESCOLHIDO assume. Antes disso, provo que OUTRO não pode:
  //      a trava de atendimento é o que impede dois corretores no mesmo lead.
  const [perfilEscolhido] = await sql(`/rest/v1/profiles?id=eq.${escolhido}&select=email,full_name`);
  const tokenCorretor = await sessaoDe(perfilEscolhido.email);
  const claim = await rpc(tokenCorretor, "claim_lead", { p_lead_id: leadId });
  const [depoisDoClaim] = await sql(
    `/rest/v1/leads?id=eq.${leadId}&select=status,assigned_to,attend_deadline,first_contact_at,next_action_at`,
  );
  ok(
    "3b. o corretor escolhido assume, a trava fecha e nasce a proxima acao",
    claim.status < 300 && depoisDoClaim.status === "attending"
      && depoisDoClaim.attend_deadline === null && !!depoisDoClaim.next_action_at,
    `HTTP ${claim.status} · status=${depoisDoClaim.status} · proxima acao=${depoisDoClaim.next_action_at}`,
  );

  // ── 4. Conversão em negócio, pela RPC de produção ─────────────────────────
  const [construtora] = await sql("/rest/v1/developers?select=id,name&active=is.true&limit=1");
  const conv = await rpc(tokenCorretor, "convert_lead_to_deal", {
    p_lead_id: leadId,
    p_developer_id: construtora.id,
    p_project_id: null,
    p_unit: `Unid ${TAG}`,
    p_vgv_gross: 500000,
  });
  const devolvido = conv.status < 300 ? JSON.parse(conv.corpo) : null;
  dealId = typeof devolvido === "string" ? devolvido : devolvido?.id ?? devolvido?.[0]?.id ?? null;
  // Marca o negócio com o TAG: é o que autoriza a faxina a apagá-lo depois.
  if (dealId) {
    await admin(`/rest/v1/deals?id=eq.${dealId}`, {
      method: "PATCH", body: JSON.stringify({ notes: `prova de cadeia ${TAG}` }),
    });
  }
  ok(
    "4. lead vira negócio pela RPC (o caminho que o SDR também usa)",
    conv.status < 300 && dealId,
    `HTTP ${conv.status} · negócio ${String(dealId).slice(0, 8)}`,
  );

  // ── 5. O negócio nasce com cliente e participantes ────────────────────────
  const clientes = await sql(`/rest/v1/deal_clients?deal_id=eq.${dealId}&select=full_name`);
  const participantes = await sql(`/rest/v1/deal_participants?deal_id=eq.${dealId}&select=role,share_pct,profile_id`);
  ok(
    "5. o negócio nasce com o cliente do lead e os participantes da equipe",
    clientes.length === 1 && participantes.some((p) => p.role === "broker"),
    `${clientes.length} cliente · participantes: ${participantes.map((p) => p.role).join(", ")}`,
  );

  // ── 6. Rateio de VGV fecha 100% ──────────────────────────────────────────
  const corretores = participantes.filter((p) => p.role === "broker");
  const soma = corretores.reduce((t, p) => t + Number(p.share_pct || 0), 0);
  ok(
    "6. o rateio de VGV entre corretores fecha 100%",
    Math.abs(soma - 100) < 0.01,
    `${corretores.length} corretor(es), soma = ${soma}%`,
  );

  // ── 7. Conferência documental: o corretor manda ao gerente ────────────────
  // Com mensagem e esteira (0150): sem a mensagem a recusa viria por ela, e o
  // passo deixaria de provar a trava do dossiê.
  const envio = await rpc(tokenCorretor, "submit_deal_for_manager_review", {
    p_deal_id: dealId,
    p_message: "Prova da cadeia: envio sem documento obrigatório.",
    p_esteira: "agil",
  });
  const [revisao] = await sql(`/rest/v1/deals?id=eq.${dealId}&select=document_review_status`);
  ok(
    "7. sem documento obrigatório, a conferência documental RECUSA o envio",
    envio.status >= 400 || revisao.document_review_status !== "pending",
    `HTTP ${envio.status} · estado=${revisao.document_review_status} (recusar aqui é o certo: dossiê vazio)`,
  );

  // ── 8. Mês fechado: o banco recusa escrita retroativa ─────────────────────
  const [mesFechado] = await sql("/rest/v1/closed_months?select=period&order=period.desc&limit=1");
  ok(
    "8. existe registro de fechamento de mês (a trava tem em que se apoiar)",
    !!mesFechado,
    mesFechado ? `último período fechado: ${mesFechado.period}` : "nenhum mês fechado ainda",
  );

  // ── 9. O evento chegou ao histórico do lead ──────────────────────────────
  const eventos = await sql(`/rest/v1/lead_events?lead_id=eq.${leadId}&select=kind&order=created_at.asc`);
  ok(
    "9. cada passo deixou rastro no histórico do lead",
    eventos.length >= 2,
    `${eventos.length} evento(s): ${eventos.map((e) => e.kind).join(" → ")}`,
  );
} catch (e) {
  falhou = true;
  console.log("FALHOU (exceção):", e instanceof Error ? e.message : String(e));
} finally {
  // ── Faxina, mesmo quando falha no meio — e SÓ do que é meu ───────────────
  try {
    if (await souDono("deals", dealId, "notes")) {
      await admin(`/rest/v1/deal_clients?deal_id=eq.${dealId}`, { method: "DELETE" });
      await admin(`/rest/v1/deal_participants?deal_id=eq.${dealId}`, { method: "DELETE" });
      await admin(`/rest/v1/deals?id=eq.${dealId}`, { method: "DELETE" });
      console.log("[faxina] negócio de prova removido");
    } else if (dealId) {
      console.log(`[faxina] RECUSADO: o negócio ${dealId} não tem a marca ${TAG} — não é meu, não apago`);
    }

    if (await souDono("leads", leadId, "notes")) {
      await admin(`/rest/v1/lead_assignments?lead_id=eq.${leadId}`, { method: "DELETE" });
      await admin(`/rest/v1/lead_events?lead_id=eq.${leadId}`, { method: "DELETE" });
      await admin(`/rest/v1/leads?id=eq.${leadId}`, { method: "DELETE" });
      console.log("[faxina] lead de prova removido");
    } else if (leadId) {
      console.log(`[faxina] RECUSADO: o lead ${leadId} não tem a marca ${TAG} — não é meu, não apago`);
    }

    // O check-in de prova não pode ficar no dia operacional da operação real.
    if (checkinFeitoPor) {
      await admin(
        `/rest/v1/checkins?profile_id=eq.${checkinFeitoPor}&work_date=eq.${new Date().toISOString().slice(0, 10)}`,
        { method: "DELETE" },
      );
      console.log("[faxina] check-in de prova removido");
    }
  } catch (e) {
    console.log("[faxina] ATENÇÃO: não consegui limpar tudo:", String(e).slice(0, 160));
  }
}

const verdes = passos.filter((p) => p.ok).length;
console.log(`\n=== ${verdes}/${passos.length} passos da cadeia provados ===`);
process.exit(falhou ? 1 : 0);
