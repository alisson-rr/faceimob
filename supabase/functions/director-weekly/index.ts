/**
 * Aposentada em 08/08/2026.
 *
 * O frontend chama a RPC pública `public_director_checkpoint` direto
 * (PublicDirectorCheckpoint.tsx) e esta function nunca teve chamador. Stub 410
 * até a remoção definitiva do projeto.
 */
Deno.serve(() =>
  new Response(
    JSON.stringify({ error: "Endpoint aposentado. Use a RPC public_director_checkpoint." }),
    { status: 410, headers: { "Content-Type": "application/json" } },
  ));
