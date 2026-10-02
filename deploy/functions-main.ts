// O runtime self-hosted não lê verify_jwt do config.toml automaticamente.
import { jwtVerify } from "https://esm.sh/jose@6.1.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

export async function authorize(req: Request, functions: Record<string, boolean>, secret: string) {
  if (req.method === "GET" && new URL(req.url).pathname === "/_health") return new Response("ok");
  const name = new URL(req.url).pathname.split("/")[1];
  if (!Object.hasOwn(functions, name)) return new Response("Not found", { status: 404, headers: cors });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (functions[name]) {
    const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
    try {
      if (!token || !secret) throw new Error("missing credentials");
      await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ["HS256"] });
    } catch {
      return new Response("Unauthorized", { status: 401, headers: cors });
    }
  }
  return name;
}

if (import.meta.main) {
  const functions = JSON.parse(await Deno.readTextFile("/home/deno/functions/functions.json"));
  const secret = Deno.env.get("JWT_SECRET") ?? "";
  if (!secret) throw new Error("JWT_SECRET obrigatório");
  Deno.serve(async (req: Request) => {
    const result = await authorize(req, functions, secret);
    if (result instanceof Response) return result;
    try {
      // As funções continuam validando usuário/permissão ou assinatura do webhook.
      const worker = await EdgeRuntime.userWorkers.create({
        servicePath: `/home/deno/functions/${result}`,
        memoryLimitMb: 150,
        // 150 s: a sincronização da Meta lê a janela em fatias e passava de 60 s
        // na primeira vez de uma conta grande (02/10/2026).
        workerTimeoutMs: 150_000,
        noModuleCache: false,
        envVars: Object.entries({ ...Deno.env.toObject(), SUPABASE_FUNCTION_SLUG: result }),
      });
      return await worker.fetch(req);
    } catch (error) {
      console.error(`Falha na função ${result}:`, error instanceof Error ? error.name : "runtime error");
      return new Response("Function unavailable", { status: 503, headers: cors });
    }
  });
}
