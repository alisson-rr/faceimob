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

/**
 * Provisiona o acesso de um colaborador.
 *
 * Não define nem devolve senha: o login é por código no e-mail (`signInWithOtp`).
 * A versão anterior gerava senha aleatória e a devolvia no corpo da resposta —
 * ou seja, a credencial passava pelo navegador do admin e ia parar em print,
 * planilha ou mensagem. Aqui o e-mail é a credencial e o código é efêmero.
 *
 * `email_confirm: true` mantém o usuário apto a receber o OTP sem precisar
 * clicar em link de confirmação.
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

    const { data: roleRows, error: roleError } = await admin
      .from("user_roles")
      .select("role")
      .eq("profile_id", authData.user.id);
    if (roleError) throw roleError;
    if (!(roleRows || []).some((row) => row.role === "admin")) {
      return json(
        { error: "Somente administradores podem provisionar acessos." },
        403,
      );
    }

    const body = await req.json();
    const profileId = body.profile_id || body.broker_id || null;
    const requestedEmail = String(body.email || "").trim().toLowerCase();

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

      const { error } = await admin.auth.admin.updateUserById(profile.id, {
        email,
        email_confirm: true,
        user_metadata: { full_name: profile.full_name },
      });
      if (error) throw error;
      return json({ success: true, email, user_id: profile.id });
    }

    if (!requestedEmail) return json({ error: "email obrigatório" }, 400);
    const fullName = String(body.full_name || requestedEmail.split("@")[0]);
    const { data, error } = await admin.auth.admin.createUser({
      email: requestedEmail,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error) throw error;
    return json({
      success: true,
      email: requestedEmail,
      user_id: data.user?.id,
    });
  } catch (error) {
    console.error("provision-broker-user error:", error);
    return json(
      { error: error instanceof Error ? error.message : "unknown" },
      500,
    );
  }
});
