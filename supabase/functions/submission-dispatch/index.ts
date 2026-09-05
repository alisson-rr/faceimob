import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSecret } from "../_shared/secrets.ts";
import { listSenders, sendEmail, senderEmailProblem } from "../_shared/brevo.ts";
import { requireServiceRole, requireUserPermission } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/**
 * Consome a fila `developer_submissions` e envia o dossiê pelo Brevo.
 *
 * A separação entre montar e enviar é o que permite reprocessar uma falha sem
 * remontar o envio: a tela grava `queued`, esta function tenta e registra o
 * resultado. `attempts` e `last_error` ficam na linha, então o CCA vê por que
 * não saiu em vez de descobrir pelo silêncio.
 *
 * Anexo vai por URL assinada de 2 h, não por base64: o Brevo baixa o arquivo, e
 * um dossiê com 9 documentos estouraria o limite de corpo da API.
 *
 * Duas portas, porque há dois chamadores:
 *   - `action: 'probe'` — "Testar conexão" da tela de Integrações, com o JWT do
 *     admin. Leitura pura na Brevo, sem enviar e-mail para ninguém.
 *   - qualquer outra chamada — o pg_cron (0020) com a chave de serviço.
 */
const BATCH_LIMIT = 10;

// 2 h, não 24 h (achado S10 da auditoria). O anexo é RG/CPF do cliente e a URL
// assinada é um link SEM login: quem tiver o e-mail encaminhado abre o
// documento. O Brevo baixa o arquivo ao processar a chamada — segundos, não
// horas —, então 2 h é folga para uma fila lenta do provedor e corta a janela
// de exposição em 12×.
// ponytail: TTL fixo; virar link com expiração por download quando o Storage
// oferecer, ou quando o CCA pedir reenvio de dossiê antigo sem regerar.
const SIGNED_URL_TTL = 60 * 60 * 2;

const MAX_ATTEMPTS = 5;

// `sending` é marca de "estou tentando agora". Se a function morrer no meio
// (deploy, timeout, OOM), a linha fica presa nesse status e NENHUM caminho a
// tira de lá: nem cron, nem tela, nem função. Passado este prazo a linha é
// repescada — a tentativa que a marcou já não existe.
const STUCK_AFTER_MS = 10 * 60 * 1000;

type SubmissionRow = {
  id: string;
  deal_id: string;
  to_email: string;
  cc_emails: string[] | null;
  subject: string;
  body: string | null;
  document_ids: string[];
  attempts: number;
  status: string;
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * "Testar conexão" do Brevo.
 *
 * Existe por um caso medido: em 02/09/2026 `brevo/sender_email` no cofre da
 * homologação guardava a MESMA chave de API de 89 caracteres começando com
 * `xkeysib` que está em `brevo/api_key`. O cofre aceitou (não valida forma), a
 * tela de Integrações mostrou "no cofre" e nada em lugar nenhum contradisse —
 * todo envio real morreria na Brevo com remetente inválido. `validarCredencial`
 * passou a barrar gravação NOVA, mas o valor errado continua lá: só uma leitura
 * no provedor responde "o que está gravado funciona?".
 *
 * `/v3/senders` responde as duas perguntas de uma vez: chave inválida devolve
 * 401, e a lista diz se o remetente está verificado. Nenhum e-mail é enviado.
 *
 * A LISTA VOLTA para a tela junto do veredito, e essa é a metade que faltava:
 * dizer "remetente inválido" sem dizer qual serve deixa o admin sem caminho —
 * a Brevo só aceita endereço verificado na conta e essa lista só existe lá.
 * Só endereços de remetente saem daqui; a chave de API, nunca.
 */
async function probeBrevo(): Promise<Response> {
  const apiKey = await getSecret("BREVO_API_KEY");
  if (!apiKey) {
    return json({ ok: false, error: "Falta a chave brevo/api_key no cofre." }, 502);
  }

  // A consulta vem ANTES do veredito do remetente de propósito: é justamente
  // quando o valor gravado não presta que o admin precisa da lista.
  const lista = await listSenders(apiKey);
  // 401 é veredito sobre a chave — sem chave aceita não há lista nem sentido em
  // julgar o remetente. Qualquer outra falha é indisponibilidade do provedor e
  // não pode derrubar a sonda: ela segue e responde o que responderia sem ela.
  if (!lista.ok && lista.status === 401) {
    return json({ ok: false, error: lista.error }, 502);
  }
  const remetentes = lista.ok ? lista.senders : [];

  const senderEmail = await getSecret("BREVO_SENDER_EMAIL");
  const problema = senderEmailProblem(senderEmail);
  // O valor gravado NÃO é ecoado aqui: quando ele não passa por
  // `senderEmailProblem` pode ser qualquer coisa — em 02/09/2026 era a própria
  // chave de API —, e devolvê-lo seria vazar credencial para a tela.
  if (problema) return json({ ok: false, error: problema, remetentes }, 502);

  if (!lista.ok) return json({ ok: false, error: lista.error }, 502);

  // `senderEmailProblem` já garantiu que não é nulo nem vazio.
  const alvo = (senderEmail ?? "").trim().toLowerCase();
  if (!remetentes.some((s) => s.email === alvo)) {
    return json({
      ok: false,
      error:
        `A chave funciona, mas ${alvo} não está entre os ${remetentes.length} remetentes verificados da conta. ` +
        "Verifique o endereço no painel da Brevo antes do primeiro envio.",
      remetentes,
    }, 502);
  }

  return json({ ok: true, remetente: alvo, verificados: remetentes.length, remetentes });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // O corpo é lido antes das portas porque é ele que diz qual porta usar.
    // Chamada do cron vem com corpo vazio, e `catch` cobre isso.
    const payload = await req.json().catch(() => ({})) as { action?: string };

    if (payload.action === "probe") {
      // Mesma permissão que guarda `list_integrations` e a própria tela: quem
      // pode cadastrar a credencial pode testá-la.
      const { denied } = await requireUserPermission(req, "settings.integrations", corsHeaders);
      if (denied) return denied;
      return await probeBrevo();
    }

    // Mesma porta do notify-dispatch: só o pg_cron (0020) chama. Aberto, o
    // endpoint mandava dossiê de cliente por e-mail a pedido de qualquer um
    // com a chave publicável (achado S04).
    const denied = await requireServiceRole(req, corsHeaders);
    if (denied) return denied;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // `queued` sai na hora. `failed` e `sending` só depois do prazo de repesca:
    // sem isso um dossiê que falhou dependia de alguém apertar Reenviar, e um
    // preso em `sending` não voltava nunca. O prazo evita que duas instâncias
    // do worker disputem a mesma linha na mesma passada.
    const staleBefore = new Date(Date.now() - STUCK_AFTER_MS).toISOString();
    const { data, error } = await supabase
      .from("developer_submissions")
      .select("id,deal_id,to_email,cc_emails,subject,body,document_ids,attempts,status")
      .or(`status.eq.queued,and(status.in.(failed,sending),updated_at.lt.${staleBefore})`)
      .lt("attempts", MAX_ATTEMPTS)
      .order("created_at", { ascending: true })
      .limit(BATCH_LIMIT);
    if (error) throw error;

    const pending = (data ?? []) as SubmissionRow[];
    if (pending.length === 0) return json({ processed: 0, sent: 0, failed: 0 });

    // Fora do laço de propósito — e por isso não pode ser `requireSecret`: o
    // throw sairia como 500 sem marcar linha nenhuma, e o CCA veria a fila
    // parada sem motivo escrito. Mesmo defeito que travava a fila de WhatsApp.
    //
    // A checagem é de FORMA, não só de presença: o valor gravado no cofre da
    // homologação era uma chave de API, e "presente" não é o mesmo que
    // "utilizável". Sem isto o motivo escrito na linha seria "Brevo respondeu
    // 400", que não diz a ninguém o que consertar.
    //
    // A CHAVE ENTRA PELO MESMO PORTÃO, e por isso ela é lida aqui e não dentro
    // do laço: `sendEmail` abria com `requireSecret("BREVO_API_KEY")`, que
    // LANÇA, e a chamada está dentro do `try` por linha — o `catch` gravava
    // `status='failed'` E `attempts + 1`. Com a chave ausente ou rotacionada,
    // cada passada do cron queimava uma tentativa de CADA dossiê: em ~50 min
    // (a repesca é de 10 min) todo dossiê chegava a `attempts = 5`, saía do
    // `.lt("attempts", MAX_ATTEMPTS)` para sempre e disparava
    // `notify_submission_gave_up`. Quando a chave voltasse, nada drenaria
    // sozinho — alguém com `cca.review` teria de clicar Reenviar linha a linha.
    //
    // Credencial ausente não é tentativa: a mensagem não falhou, ela nem foi
    // tentada. Mesmo tratamento que o `notify-dispatch` dá à fila de WhatsApp.
    const apiKey = await getSecret("BREVO_API_KEY");
    const senderEmail = await getSecret("BREVO_SENDER_EMAIL");
    const problemaCredencial = !apiKey
      ? "chave da Brevo ausente no cofre (brevo/api_key). Cadastre em Admin → Integrações."
      : senderEmailProblem(senderEmail);
    if (problemaCredencial) {
      // `attempts` NÃO é tocado de propósito: ver o bloco acima.
      const { data: marcados, error: markError } = await supabase
        .from("developer_submissions")
        .update({ status: "failed", last_error: problemaCredencial })
        .in("id", pending.map((r) => r.id))
        .select("id");
      if (markError) {
        console.error("submission-dispatch: falha ao marcar a fila bloqueada —", markError.message);
      }
      console.error(`submission-dispatch: ${problemaCredencial}; ${pending.length} dossiês aguardando`);
      return json(
        {
          error: problemaCredencial,
          pending: pending.length,
          marked: marcados?.length ?? 0,
          processed: 0,
          sent: 0,
          failed: 0,
        },
        503,
      );
    }

    // Depois do portão acima, o remetente é uma string válida.
    const remetente = (senderEmail ?? "").trim();

    let sent = 0, failed = 0;

    for (const row of pending) {
      // Marca `sending` antes de tentar: se a function morrer no meio, a linha
      // não fica presa em `queued` sendo repescada por outra instância junto.
      await supabase.from("developer_submissions").update({ status: "sending" }).eq("id", row.id);

      try {
        const { data: docs, error: docError } = await supabase
          .from("deal_documents")
          .select("id,storage_path,stored_name")
          .in("id", row.document_ids.length > 0 ? row.document_ids : ["00000000-0000-0000-0000-000000000000"]);
        if (docError) throw docError;

        // Dossiê incompleto NÃO sai. O laço montava os anexos a partir do que a
        // consulta devolvesse e enviava o que houvesse: documento apagado do
        // negócio depois de enfileirado saía do e-mail sem uma palavra, e a
        // construtora recebia um dossiê a menos achando que era o dossiê
        // inteiro. Falhar aqui é recuperável (o CCA reanexa e reenvia);
        // mandar incompleto, não.
        const encontrados = (docs ?? []) as { id: string; storage_path: string; stored_name: string }[];
        if (encontrados.length !== row.document_ids.length) {
          const faltando = row.document_ids.length - encontrados.length;
          throw new Error(
            `${faltando} de ${row.document_ids.length} documento(s) do dossiê não existem mais. ` +
              "Reanexe na tela do negócio e reenvie.",
          );
        }

        const attachments = [];
        for (const doc of encontrados) {
          const { data: signed, error: signError } = await supabase.storage
            .from("deal-documents")
            .createSignedUrl(doc.storage_path, SIGNED_URL_TTL);
          if (signError) throw signError;
          attachments.push({ name: doc.stored_name, url: signed.signedUrl });
        }

        const html = `<p>${escapeHtml(row.body ?? "").replace(/\n/g, "<br>")}</p>`;
        const result = await sendEmail({
          to: row.to_email,
          cc: row.cc_emails ?? undefined,
          subject: row.subject,
          html,
          attachments,
          senderEmail: remetente,
        });

        if (!result.ok) throw new Error(result.error);

        // `attempts` conta FALHA, não passagem: incrementá-lo no sucesso fazia
        // o limite de 5 contar envios que deram certo — e, com o botão
        // Reenviar zerando o contador, o teto virava decorativo.
        await supabase
          .from("developer_submissions")
          .update({ status: "sent", sent_at: new Date().toISOString(), last_error: null })
          .eq("id", row.id);
        sent++;
      } catch (e) {
        const message = e instanceof Error ? e.message : "erro desconhecido";
        // Ao chegar em MAX_ATTEMPTS o gatilho `notify_submission_gave_up`
        // (migration 0083) avisa quem pediu o envio e o admin: antes disso, o
        // dossiê morria calado dentro do diálogo do /cca.
        await supabase
          .from("developer_submissions")
          .update({ status: "failed", last_error: message.slice(0, 500), attempts: row.attempts + 1 })
          .eq("id", row.id);
        console.error(`submission-dispatch: falha no envio ${row.id}`);
        failed++;
      }
    }

    return json({ processed: pending.length, sent, failed });
  } catch (error) {
    console.error("submission-dispatch error:", error);
    return json({ error: error instanceof Error ? error.message : "unknown" }, 500);
  }
});
