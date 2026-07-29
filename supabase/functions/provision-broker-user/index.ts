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

function randomPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return `Face!${Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("")}`;
}

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
    const password = randomPassword();

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
      const { error } = await admin.auth.admin.updateUserById(profile.id, {
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: profile.full_name },
      });
      if (error) throw error;
      return json({ success: true, email, password, user_id: profile.id });
    }

    if (!requestedEmail) return json({ error: "email obrigatório" }, 400);
    const fullName = String(body.full_name || requestedEmail.split("@")[0]);
    const { data, error } = await admin.auth.admin.createUser({
      email: requestedEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error) throw error;
    return json({
      success: true,
      email: requestedEmail,
      password,
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
