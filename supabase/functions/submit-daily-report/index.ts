/**
 * Aposentada em 08/08/2026.
 *
 * O frontend chama a RPC pública `public_daily_submit` direto (DailyReport.tsx)
 * e esta function nunca teve chamador. Com verify_jwt=false ela enfraquecia a
 * capability do link público (team_id → slug com service role). Stub 410 até a
 * remoção definitiva do projeto.
 */
Deno.serve(() =>
  new Response(
    JSON.stringify({ error: "Endpoint aposentado. Use a RPC public_daily_submit." }),
    { status: 410, headers: { "Content-Type": "application/json" } },
  ));
