#!/usr/bin/env node
/**
 * Kit de demonstração ao vivo da fila de leads.
 *
 *   node scripts/demo.mjs preparar   → deixa o cenário pronto e diz como entrar
 *   node scripts/demo.mjs lead       → solta um lead na roleta AGORA
 *   node scripts/demo.mjs limpar     → apaga o que a demonstração criou
 *
 * Alvos:
 *   (padrão)   Supabase LOCAL — o Mailpit captura o e-mail com o código.
 *   --remote   homologação (URL do .env) — exige SUPABASE_SERVICE_ROLE_KEY no
 *              ambiente, igual ao `npm run e2e:remote`. O corretor da demo vira
 *              o usuário real (--email=..., padrão dev.alisson.rosa@gmail.com).
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const REMOTO = process.argv.includes("--remote");
const emailFlag = process.argv.find((a) => a.startsWith("--email="))?.slice(8);

// ── alvo ─────────────────────────────────────────────────────────────────────
function statusLocal() {
  const proc = spawnSync("npx", ["supabase", "status", "-o", "env"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const saida = proc.stdout || "";
  const pegar = (chave) => saida.match(new RegExp(`${chave}="([^"]+)"`))?.[1];
  const url = pegar("API_URL");
  const service = pegar("SERVICE_ROLE_KEY");
  if (!url || !service) {
    console.error("Stack local não respondeu. Rode `npm run db:start` e tente de novo.");
    process.exit(1);
  }
  return { url, service, mailpit: pegar("MAILPIT_URL") || "http://127.0.0.1:54324" };
}

function statusRemoto() {
  let env = "";
  try {
    env = readFileSync(".env", "utf8");
  } catch {
    console.error("Sem .env na raiz — não sei qual é a URL da homologação.");
    process.exit(1);
  }
  const url = env.match(/^VITE_SUPABASE_URL="?([^"\r\n]+)"?/m)?.[1];
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) {
    console.error("VITE_SUPABASE_URL não está no .env.");
    process.exit(1);
  }
  if (!service) {
    console.error(
      [
        "SUPABASE_SERVICE_ROLE_KEY não está no ambiente.",
        "Pegue em Supabase → Project Settings → API → service_role e rode:",
        '  $env:SUPABASE_SERVICE_ROLE_KEY = "..."     # PowerShell',
      ].join("\n"),
    );
    process.exit(1);
  }
  return { url, service, mailpit: null };
}

const alvo = REMOTO ? statusRemoto() : statusLocal();
console.log(`[demo] alvo: ${REMOTO ? "HOMOLOGAÇÃO" : "local"} (${alvo.url})\n`);
const cab = {
  apikey: alvo.service,
  Authorization: `Bearer ${alvo.service}`,
  "Content-Type": "application/json",
};

async function rest(caminho, init = {}) {
  const res = await fetch(`${alvo.url}/rest/v1/${caminho}`, {
    ...init,
    headers: { ...cab, ...(init.headers || {}) },
  });
  const corpo = await res.text();
  if (!res.ok) throw new Error(`${caminho} → ${res.status}: ${corpo.slice(0, 200)}`);
  return corpo ? JSON.parse(corpo) : null;
}

const rpc = (fn, args = {}) =>
  fetch(`${alvo.url}/rest/v1/rpc/${fn}`, { method: "POST", headers: cab, body: JSON.stringify(args) })
    .then((r) => r.text())
    .then((t) => (t ? JSON.parse(t) : null));

const EMAIL = emailFlag || (REMOTO ? "dev.alisson.rosa@gmail.com" : "e2e.broker@faceimob.test");
const MARCA = "demo-ao-vivo";
const FIGURANTES = 2;

const hojeSP = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const horaSP = () => new Date().toLocaleTimeString("en-GB", { timeZone: "America/Sao_Paulo", hour12: false });

/**
 * Corretores de teste que entram na fila como figurantes. A ordem da roleta
 * favorece quem está há mais tempo sem receber lead, então contas de seed
 * (histórico antigo) ficam na frente de quem testou hoje — é o que deixa o
 * corretor da demo em 3º e mostra a fila girando de verdade.
 */
async function candidatosFigurantes(corretorId) {
  const filtro = REMOTO ? "seed.*" : "e2e.*";
  const linhas = await rest(
    `profiles?select=id,full_name,user_roles!user_roles_profile_id_fkey!inner(role)&user_roles.role=eq.broker&email=like.${filtro}&order=email`,
  );
  return linhas.filter((p) => p.id !== corretorId);
}

async function perfilDoCorretor() {
  const [p] = await rest(`profiles?email=eq.${encodeURIComponent(EMAIL)}&select=id,full_name`);
  if (!p) {
    console.error(
      REMOTO
        ? `Usuário ${EMAIL} não existe na homologação. Confira o --email=.`
        : `Usuário ${EMAIL} não existe no banco local. Rode \`npm run e2e -- --project=anonimo\` uma vez para criá-lo.`,
    );
    process.exit(1);
  }
  return p;
}

async function grupoGeral() {
  const [g] = await rest("distribution_groups?kind=eq.general&active=eq.true&select=id,name&limit=1");
  if (!g) throw new Error("catálogo sem grupo de distribuição geral");
  return g;
}

// ── comandos ─────────────────────────────────────────────────────────────────

async function preparar() {
  const corretor = await perfilDoCorretor();
  const grupo = await grupoGeral();

  const membro = await rest(
    `distribution_group_members?group_id=eq.${grupo.id}&profile_id=eq.${corretor.id}&select=active`,
  );
  if (!membro.length) {
    await rest("distribution_group_members", {
      method: "POST",
      body: JSON.stringify({ group_id: grupo.id, profile_id: corretor.id, active: true }),
    });
  } else if (!membro[0].active) {
    await rest(`distribution_group_members?group_id=eq.${grupo.id}&profile_id=eq.${corretor.id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: true }),
    });
  }

  // Nunca apagar a presença do corretor: check-in é estado que ELE criou na
  // tela, e o perform_checkin reabre registro fechado sozinho. Se ele quiser
  // mostrar o clique na gravação, faz check-out na própria tela antes.
  const presenca = await rest(
    `checkins?profile_id=eq.${corretor.id}&checked_out_at=is.null&select=id&limit=1`,
  );
  if (presenca.length) {
    console.log("• você já está em check-in — mantive. Para gravar o clique, faça check-out na tela antes.");
  }

  // Fora de janela de turno o botão de check-in fica desabilitado.
  let turno = await rpc("current_shift");
  if (!turno) {
    const existe = await rest(`work_shifts?code=eq.${MARCA}&select=id`);
    if (!existe.length) {
      await rest("work_shifts", {
        method: "POST",
        body: JSON.stringify({
          code: MARCA, label: "Demonstração",
          checkin_start: "00:00", distribution_start: "00:00", checkout_time: "23:59",
          position: 99, active: true,
        }),
      });
    }
    console.log("• fora do horário comercial → abri uma janela 'Demonstração' (o `limpar` remove)");
    turno = await rpc("current_shift");
  }

  // Figurantes na fila: presença aberta para corretores de teste.
  const candidatos = await candidatosFigurantes(corretor.id);
  const escalados = candidatos.slice(0, FIGURANTES);
  if (candidatos.length) {
    await rest(`checkins?profile_id=in.(${candidatos.map((c) => c.id).join(",")})`, { method: "DELETE" });
  }
  if (escalados.length && turno) {
    await rest("checkins", {
      method: "POST",
      body: JSON.stringify(
        escalados.map((c) => ({ profile_id: c.id, shift_id: turno, work_date: hojeSP(), ip_address: "127.0.0.1" })),
      ),
    });
    console.log(`• figurantes na fila: ${escalados.map((c) => c.full_name).join(", ")}`);
  }

  // Avisos de relógio: fora da janela de distribuição a roleta não entrega,
  // e o auto-checkout esvazia a fila quando o turno fecha.
  if (turno) {
    const [t] = await rest(`work_shifts?id=eq.${turno}&select=label,distribution_start,checkout_time`);
    if (t && horaSP() < t.distribution_start) {
      console.log(`• ATENÇÃO: o turno ${t.label} só distribui leads a partir de ${t.distribution_start.slice(0, 5)} — grave depois disso.`);
    }
    if (t && horaSP() > t.checkout_time) {
      console.log(`• ATENÇÃO: o turno ${t.label} já passou de ${t.checkout_time.slice(0, 5)} — o auto-checkout pode esvaziar a fila.`);
    }
  }

  try {
    const fila = await rpc("distribution_queue", { p_group_id: grupo.id });
    if (Array.isArray(fila) && fila.length) {
      console.log(`• fila agora: ${fila.map((f) => `${f.queue_position}. ${f.full_name}`).join(" · ")}`);
      console.log(`  (${corretor.full_name} entra em ${fila.length + 1}º ao fazer o check-in)`);
    }
  } catch {
    /* só informativo — a fila aparece na tela de qualquer forma */
  }

  if (REMOTO) {
    console.log(`
Cenário pronto na HOMOLOGAÇÃO (corretor: ${EMAIL}).

  1. Em outro terminal:      npm run dev
  2. Abra                    http://localhost:8080/login
     (se já estiver logado como ${EMAIL}, siga direto)
  3. Grave a tela e siga:    Check-in → "Bora atender"
                             a posição na fila aparece sozinha
  4. No terminal, solte o lead ao vivo:

       npm run demo:lead -- --remote

     O aviso cai na tela sem recarregar, com a trava de 5 minutos correndo.

  5. No fim:                 npm run demo:limpar -- --remote
`);
    return;
  }
  console.log(`
Cenário pronto.

  1. Em outro terminal:      npm run demo:app
  2. Abra                    http://localhost:5200/login
  3. Entre com               ${EMAIL}
  4. Pegue o código em       ${alvo.mailpit}
  5. Grave a tela e siga:    Check-in → "Bora atender"
                             a posição na fila aparece sozinha
  6. No terminal, solte o lead ao vivo:

       npm run demo:lead

     O aviso cai na tela sem recarregar, com a trava de 5 minutos correndo.

  7. No fim:                 npm run demo:limpar
`);
}

async function lead() {
  const corretor = await perfilDoCorretor();
  const grupo = await grupoGeral();

  const presenca = await rest(
    `checkins?profile_id=eq.${corretor.id}&checked_out_at=is.null&select=id`,
  );
  if (!presenca.length) {
    console.error("O corretor não está com check-in aberto — faça o check-in na tela antes de soltar o lead.");
    process.exit(1);
  }

  const [origem] = await rest("lead_sources?select=id&order=label&limit=1");
  const nome = `Cliente da Demonstração ${new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" })}`;
  const [novo] = await rest("leads", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      full_name: nome,
      phone: "11987654321",
      source_id: origem?.id ?? null,
      campaign_name: "Demonstração",
      notes: MARCA,
      distribution_group_id: grupo.id,
    }),
  });

  const escolhido = await rpc("assign_lead", { p_lead_id: novo.id });
  if (!escolhido) {
    console.log(`Lead "${nome}" criado, mas a roleta não achou corretor elegível (fila vazia ou fora da janela de distribuição).`);
    return;
  }
  const [quem] = await rest(`profiles?id=eq.${escolhido}&select=full_name`);
  console.log(`Lead "${nome}" → ${quem?.full_name ?? escolhido}. Olhe a tela.`);
}

async function limpar() {
  const corretor = await perfilDoCorretor();
  await rest(`notifications?title=ilike.${encodeURIComponent("*Cliente da Demonstração*")}`, { method: "DELETE" });
  await rest(`leads?notes=eq.${MARCA}`, { method: "DELETE" });
  await rest(`checkins?profile_id=eq.${corretor.id}`, { method: "DELETE" });
  const candidatos = await candidatosFigurantes(corretor.id);
  if (candidatos.length) {
    await rest(`checkins?profile_id=in.(${candidatos.map((c) => c.id).join(",")})`, { method: "DELETE" });
  }
  await rest(`work_shifts?code=eq.${MARCA}`, { method: "DELETE" });
  console.log("Limpo: leads da demonstração, notificações, presença (sua e dos figurantes) e a janela temporária.");
}

const comandos = { preparar, lead, limpar };
const alvoCmd = process.argv[2];
if (!comandos[alvoCmd]) {
  console.error(`Uso: node scripts/demo.mjs <${Object.keys(comandos).join("|")}>`);
  process.exit(1);
}
comandos[alvoCmd]().catch((e) => {
  console.error(String(e.message || e));
  process.exit(1);
});
