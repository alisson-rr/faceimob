/**
 * Aposentada em 08/08/2026.
 *
 * O frontend chama a RPC pública `public_daily_team` direto (DailyReport.tsx) e
 * esta function nunca teve chamador. Pior: com verify_jwt=false, ela convertia
 * team_id (UUID visível a qualquer autenticado) em slug com a service role —
 * vazava a capability do link público do Diário. O stub responde 410 para
 * qualquer requisição até a function ser removida do projeto.
 */
Deno.serve(() =>
  new Response(
    JSON.stringify({ error: "Endpoint aposentado. Use a RPC public_daily_team." }),
    { status: 410, headers: { "Content-Type": "application/json" } },
  ));
