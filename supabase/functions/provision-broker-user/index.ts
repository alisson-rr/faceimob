import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** Mesma regra do cliente, repetida no servidor: entrada externa não é confiável. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_NAME = 120;

/**
 * Bloqueio de entrada, não exclusão.
 *
 * `ban_duration` do GoTrue aceita uma duração; 100 anos é o "para sempre" que
 * a API oferece, e `"none"` é a volta. Apagar a conta seria irreversível e
 * ainda levaria junto a auditoria (`access_provision_log.profile_id` é
 * `on delete set null`) — exatamente no momento em que alguém vai perguntar
 * quem saiu e quando.
 */
const BAN_PARA_SEMPRE = "876000h";

/** Limites da senha definida pelo administrador.
 *
 *  O teto é do bcrypt que o GoTrue usa: ele IGNORA o que passa de 72 bytes, e
 *  uma senha silenciosamente truncada é pior do que uma recusada — o cofre
 *  guardaria um valor que o Auth não confere por inteiro. O piso é decisão
 *  nossa: 8 caracteres num sistema com dado de cliente dentro. */
const SENHA_MIN_BYTES = 8;
const SENHA_MAX_BYTES = 72;

/**
 * Provisiona o acesso de um colaborador.
 *
 * `email_confirm: true` mantém o usuário apto a receber o OTP sem precisar
 * clicar em link de confirmação.
 *
 * SOBRE SENHA (pedido do cliente em 10/09/2026, com o risco avisado por escrito
 * e o pedido reafirmado). Esta function NÃO devolve senha nenhuma no corpo da
 * resposta, e continua não tendo como LER a senha que alguém já usa: o Auth
 * guarda hash, e isso não se contorna. O que o ramo `password` faz é o outro
 * caminho — o administrador DEFINE uma senha nova, ela é aplicada no Auth e
 * gravada no cofre (`store_broker_password`, migration 0105) na mesma chamada,
 * e a partir daí ele a consulta pela aba do cofre em Equipes, com auditoria de
 * quem revelou. A tela diz isso em uma frase para ninguém achar que está vendo
 * a senha antiga.
 *
 * Quatro ramos:
 *  · `access: "revoke" | "restore"` — bloqueia ou devolve a ENTRADA de quem já
 *    tem conta. É o que o desligamento na ficha chama: sem ele, marcar
 *    `status = 'terminated'` tirava a pessoa das listas e a deixava entrando.
 *  · `password` + `profile_id` — define a senha de acesso e a guarda no cofre.
 *  · sem `profile_id` — cria a conta ("Novo colaborador"). O trigger
 *    `on_auth_user_created` grava perfil e papel 'broker' na mesma transação.
 *  · com `profile_id`/`broker_id` — troca o e-mail de acesso de quem já existe.
 *
 * TRÊS COISAS QUE ESTA FUNÇÃO PASSOU A FAZER (e por quê):
 *
 * 1. O ramo de troca atualiza TAMBÉM `profiles.email`. Antes só o Auth mudava e
 *    a ficha continuava mostrando o endereço antigo — um login que existe e um
 *    e-mail exibido que não entra. Se o `profiles` recusar, o e-mail do Auth
 *    volta ao anterior: melhor nada mudar do que mudar metade. E atualiza o
 *    LOGIN guardado no cofre (`sync_broker_login`, 0108): o cofre guarda o par
 *    login/senha e mostrava o endereço de antes da troca.
 * 2. E-mail duplicado devolve 409 com o perfil que JÁ tem aquele endereço. Sem
 *    isso, uma resposta 200 perdida por timeout deixava a conta criada, a
 *    segunda tentativa dizia "já existe" e o admin não tinha caminho nenhum
 *    para a ficha da pessoa que ele acabou de criar.
 * 3. Toda operação deixa linha em `access_provision_log` (0061): quem provisionou
 *    o acesso de quem e quando. A auditoria falha não derruba o provisionamento —
 *    o acesso já existe no Auth e mentir sobre isso seria pior.
 *
 * LIMITE CONHECIDO, e é do ambiente, não do código: sem o SMTP do Brevo
 * configurado em Authentication → Emails e sem o template
 * `supabase/templates/magic_link.html` aplicado no projeto remoto, a conta
 * criada aqui recebe um e-mail SEM o código de 6 dígitos que a tela de login
 * pede — ou seja, existe e não entra. A resposta carrega `login_ready: false`
 * para a tela poder dizer isso em vez de fingir sucesso.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(
      url,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return json({ error: "unauthorized" }, 401);
    const actorId = authData.user.id;
    const actorEmail = authData.user.email ?? null;

    const body = await req.json().catch(() => ({}));
    const profileId = body.profile_id || body.broker_id || null;
    const requestedEmail = String(body.email || "").trim().toLowerCase();

    /**
     * Auditoria: uma linha por provisionamento. Nunca derruba a operação.
     *
     * `actor_email` vai como TEXTO porque `actor_id` é `on delete set null`
     * (0079): sem ele, apagar a conta de quem provisionou apagava o "quem".
     */
    const registrar = async (
      target: string | null,
      action: "create" | "reset" | "denied" | "revoked" | "restored" | "password",
      email: string,
    ) => {
      const { error } = await admin.from("access_provision_log")
        .insert({ actor_id: actorId, actor_email: actorEmail, profile_id: target, action, email });
      if (error) console.error("access_provision_log falhou:", error.message);
    };

    const { data: roleRows, error: roleError } = await admin
      .from("user_roles")
      .select("role")
      .eq("profile_id", actorId);
    if (roleError) throw roleError;
    // "Administrador" inclui o SÓCIO (decisão do cliente em 10/09/2026, a mesma
    // da 0097/0099 no banco). Aqui a checagem é na mão — esta função roda com
    // `service_role` e não passa por RLS nenhuma —, então ela precisa repetir a
    // regra. Sem isto o desligamento feito pelo sócio gravava a ficha como
    // desligada e o `access_provision_log` registrava "denied": a pessoa saía
    // das listas e continuava entrando no sistema.
    if (!(roleRows || []).some((row) => row.role === "admin" || row.role === "partner")) {
      // A tentativa recusada é a que mais interessa auditar — alguém sem papel
      // batendo no endpoint que cria acesso — e era a única que não deixava
      // rastro nenhum. `profile_id` fica nulo: ninguém foi provisionado.
      await registrar(null, "denied", requestedEmail || "(sem e-mail)");
      return json(
        { error: "Somente administradores podem provisionar acessos." },
        403,
      );
    }

    // Sem SMTP próprio o e-mail sai sem o código de 6 dígitos: a tela precisa
    // saber disso para não prometer um acesso que não entra.
    //
    // `Boolean(...)` era verdadeiro para QUALQUER string, inclusive "false" e
    // "0" — justamente o que se escreve para dizer "ainda não". A tela então
    // afirmava "ele entra em /login e recebe o código" sem código nenhum sair.
    // Só "true"/"1" ligam o aviso; ausente ou qualquer outra coisa = não
    // configurado, que é o lado seguro. Ver README.md desta função.
    const loginReady = ["true", "1"].includes(
      (Deno.env.get("SMTP_CONFIGURED") ?? "").trim().toLowerCase(),
    );

    if (requestedEmail && !EMAIL_RE.test(requestedEmail)) {
      return json({ error: "E-mail em formato inválido." }, 400);
    }

    /**
     * O perfil que JÁ usa este endereço, quando existe.
     *
     * É o caminho de recuperação dos dois ramos: a tela abre a ficha dessa
     * pessoa em vez de deixar o admin sem saída depois de um "já existe".
     */
    const perfilComEmail = async (email: string) => {
      const { data } = await admin
        .from("profiles").select("id,full_name").eq("email", email).maybeSingle();
      return data;
    };

    /** A recusa do GoTrue por e-mail duplicado, em qualquer das redações dela. */
    const emailDuplicado = (message: string) =>
      /already (been )?registered|already exists|email_exists|duplicate key/i.test(message);

    // ── Ramo 0: bloquear ou liberar a ENTRADA de quem já tem conta ───────────
    //
    // O buraco que faltava fechar: desligar alguém marcava
    // `profiles.status = 'terminated'` e a CONTA continuava entrando — a pessoa
    // saía da empresa e seguia lendo os próprios leads, negócios e o diário da
    // equipe. Bloquear era "tarefa do painel do Supabase", ou seja, de ninguém.
    //
    // Bloqueio, não exclusão: `ban_duration` é reversível ("none" devolve o
    // acesso) e preserva a trilha de auditoria, que o delete apagaria.
    const acesso = String(body.access || "").trim();
    if (acesso) {
      if (acesso !== "revoke" && acesso !== "restore") {
        return json({ error: "access aceita apenas 'revoke' ou 'restore'." }, 400);
      }
      if (!profileId) return json({ error: "profile_id obrigatório." }, 400);
      // Sem esta guarda o administrador se tranca para fora com um clique, e a
      // volta exige service role — o painel do Supabase, de novo.
      if (profileId === actorId) {
        return json({ error: "Você não pode bloquear o seu próprio acesso." }, 409);
      }

      const { data: alvo, error: alvoError } = await admin
        .from("profiles").select("id,email").eq("id", profileId).maybeSingle();
      if (alvoError || !alvo) return json({ error: "Perfil não encontrado." }, 404);

      const { error } = await admin.auth.admin.updateUserById(profileId, {
        ban_duration: acesso === "revoke" ? BAN_PARA_SEMPRE : "none",
      });
      if (error) throw error;

      await registrar(profileId, acesso === "revoke" ? "revoked" : "restored", alvo.email ?? "");
      // `login_ready` viaja também aqui: devolver a entrada NÃO faz o código de
      // 6 dígitos sair enquanto o SMTP não existir, e a ficha prometia que sim.
      return json({ success: true, access: acesso, email: alvo.email, user_id: profileId, login_ready: loginReady });
    }

    // ── Ramo 0b: definir a senha de acesso e guardá-la no cofre ─────────────
    //
    // Vem ANTES do ramo 1, que dispara só por `profile_id` existir.
    //
    // Os dois efeitos são um pedido só: aplicar no Auth e gravar no cofre. Se o
    // cofre recusar, a senha JÁ mudou no Auth — dizer "não deu" faria o admin
    // repetir com outro valor e ninguém saberia qual está valendo. Por isso a
    // resposta é de sucesso com `stored_in_vault: false`, e a tela mostra a
    // senha uma última vez em vez de fingir que nada aconteceu.
    const novaSenha = typeof body.password === "string" ? body.password : "";
    if (novaSenha) {
      if (!profileId) return json({ error: "profile_id obrigatório." }, 400);
      // Bytes, não caracteres: o limite do bcrypt é em bytes e um acento ocupa
      // dois. Medir em `length` deixaria passar senha que o GoTrue trunca.
      const bytes = new TextEncoder().encode(novaSenha).length;
      if (bytes < SENHA_MIN_BYTES || bytes > SENHA_MAX_BYTES) {
        return json(
          { error: `A senha precisa ter de ${SENHA_MIN_BYTES} a ${SENHA_MAX_BYTES} caracteres.` },
          400,
        );
      }

      const { data: alvo, error: alvoError } = await admin
        .from("profiles").select("id,email").eq("id", profileId).maybeSingle();
      if (alvoError || !alvo) return json({ error: "Perfil não encontrado." }, 404);
      if (!alvo.email) return json({ error: "Perfil sem e-mail de acesso." }, 400);

      const { error } = await admin.auth.admin.updateUserById(profileId, {
        password: novaSenha,
      });
      if (error) throw error;

      // `store_broker_password` (0105) é exclusiva da service role: o schema
      // `private` não é exposto pelo PostgREST, então nem o browser do admin
      // alcança o cofre direto. Nunca logar o valor — só o erro.
      const { error: cofreError } = await admin.rpc("store_broker_password", {
        p_profile_id: profileId,
        p_login: alvo.email,
        p_secret: novaSenha,
        p_actor_id: actorId,
        p_actor_email: actorEmail,
      });
      if (cofreError) {
        console.error("store_broker_password falhou:", cofreError.message);
      }

      await registrar(profileId, "password", alvo.email);
      return json({
        success: true,
        email: alvo.email,
        user_id: profileId,
        stored_in_vault: !cofreError,
      });
    }

    // ── Ramo 1: trocar o e-mail de acesso de quem já existe ──────────────────
    if (profileId) {
      const { data: profile, error: profileError } = await admin
        .from("profiles")
        .select("id,full_name,email")
        .eq("id", profileId)
        .maybeSingle();
      if (profileError || !profile) {
        return json({ error: "Perfil não encontrado." }, 404);
      }
      const email = requestedEmail || profile.email;
      if (!email) return json({ error: "Perfil sem e-mail de acesso." }, 400);
      if (!EMAIL_RE.test(email)) {
        return json({ error: "E-mail em formato inválido." }, 400);
      }

      /**
       * O endereço já é de OUTRA pessoa? Isto é medido ANTES de chamar o
       * GoTrue, e não pela recusa dele.
       *
       * Medido na homologação: quando o e-mail pertence a outra conta,
       * `updateUserById` volta `AuthRetryableFetchError: Error updating user`
       * com `status: 500` e `code: undefined` — nenhuma palavra distingue isso
       * de uma falha de servidor de verdade, então o `emailDuplicado` abaixo
       * nunca casava e o admin levava 500 com a mensagem crua e nenhuma saída.
       * O espelho em `profiles` é a mesma fonte que o ramo de CRIAÇÃO já usa
       * para devolver `existing_profile_id`, que é o que a tela abre.
       *
       * Nada foi gravado ainda quando esta recusa sai: o Auth e o espelho
       * continuam onde estavam.
       *
       * ponytail: o espelho pode ficar velho se alguém trocar o e-mail pelo
       * painel do Supabase — aí a recusa volta a ser o 500 honesto do GoTrue.
       * Evoluir quando houver um caso real; consultar o Auth por e-mail exige
       * chamar a API admin na mão, fora do supabase-js.
       */
      const jaEmUso = await perfilComEmail(email);
      if (jaEmUso && jaEmUso.id !== profile.id) {
        return json({
          error: "Já existe um acesso com esse e-mail.",
          existing_profile_id: jaEmUso.id,
          existing_full_name: jaEmUso.full_name,
          email,
        }, 409);
      }

      const anterior = profile.email;
      const { error } = await admin.auth.admin.updateUserById(profile.id, {
        email,
        email_confirm: true,
        user_metadata: { full_name: profile.full_name },
      });
      if (error) {
        // E-mail já em uso é erro de USUÁRIO, não falha do servidor: o `throw`
        // caía no catch geral e devolvia 500 com a mensagem crua do GoTrue,
        // sem linha de auditoria e sem caminho de saída. O ramo de criação já
        // respondia 409 com `existing_profile_id` para a MESMA condição — aqui
        // passa a responder igual.
        if (emailDuplicado(error.message)) {
          const existente = await perfilComEmail(email);
          return json({
            error: "Já existe um acesso com esse e-mail.",
            existing_profile_id: existente?.id,
            existing_full_name: existente?.full_name,
            email,
          }, 409);
        }
        throw error;
      }

      // `profiles.email` é o espelho do e-mail do Auth. A 0061 abre esta coluna
      // ao service_role justamente aqui — os dois mudam juntos ou nenhum muda.
      const espelho = await admin.from("profiles")
        .update({ email }).eq("id", profile.id).select("id");
      if (espelho.error || !espelho.data?.length) {
        await admin.auth.admin.updateUserById(profile.id, {
          email: anterior,
          email_confirm: true,
        });
        return json({
          error:
            "O e-mail do login foi revertido: o perfil não aceitou o novo endereço. Tente de novo.",
        }, 409);
      }

      // O cofre (0105) guarda o PAR login/senha, e o login é o e-mail que valia
      // na hora em que a senha foi definida. Sem esta linha, trocar o e-mail
      // deixava o cofre entregando um login que o Auth já não conhece — e é
      // exatamente daí que o administrador copia para entrar. Só o `login` muda:
      // o `secret` continua sendo o que o Auth tem.
      //
      // Falhar aqui não desfaz a troca, pela mesma razão do ramo da senha: o
      // e-mail JÁ mudou no Auth e no espelho, e mentir sobre isso é pior. Quem
      // não tem linha no cofre volta `false` sem erro.
      const { error: cofreError } = await admin.rpc("sync_broker_login", {
        p_profile_id: profile.id,
        p_login: email,
      });
      if (cofreError) console.error("sync_broker_login falhou:", cofreError.message);

      await registrar(profile.id, "reset", email);
      return json({
        success: true,
        email,
        user_id: profile.id,
        login_ready: loginReady,
        vault_login_synced: !cofreError,
      });
    }

    // ── Ramo 2: criar a conta ────────────────────────────────────────────────
    if (!requestedEmail) return json({ error: "email obrigatório" }, 400);
    const fullName = String(body.full_name || requestedEmail.split("@")[0]).trim().slice(0, MAX_NAME);
    if (!fullName) return json({ error: "Informe o nome completo." }, 400);

    const { data, error } = await admin.auth.admin.createUser({
      email: requestedEmail,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    if (error) {
      // Já existe conta com esse e-mail. Pode ser homônimo de verdade OU a
      // retentativa de uma chamada cuja resposta se perdeu: devolvemos o perfil
      // para a tela abrir a ficha em vez de deixar o admin sem saída.
      const existente = await perfilComEmail(requestedEmail);
      if (existente) {
        return json({
          error: "Já existe um acesso com esse e-mail.",
          existing_profile_id: existente.id,
          existing_full_name: existente.full_name,
          email: requestedEmail,
        }, 409);
      }
      throw error;
    }

    if (data.user?.id) await registrar(data.user.id, "create", requestedEmail);
    return json({
      success: true,
      email: requestedEmail,
      user_id: data.user?.id,
      login_ready: loginReady,
    });
  } catch (error) {
    console.error("provision-broker-user error:", error);
    return json(
      { error: error instanceof Error ? error.message : "unknown" },
      500,
    );
  }
});
