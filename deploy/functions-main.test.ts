import { SignJWT } from "https://esm.sh/jose@6.1.0";
import { authorize } from "./functions-main.ts";

Deno.test("gateway preserva JWT, webhooks, preflight e recusa caminhos desconhecidos", async () => {
  const secret = "a-test-secret-with-at-least-32-characters";
  const key = new TextEncoder().encode(secret);
  const functions = { private: true, webhook: false };
  const token = await new SignJWT({ role: "authenticated" }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(key);
  const request = (name: string, token?: string, method = "POST") => new Request(`http://localhost/${name}`, {
    method, headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const assert = (ok: boolean) => { if (!ok) throw new Error("Autorização incorreta"); };
  assert(await authorize(request("private", token), functions, secret) === "private");
  assert(await authorize(request("webhook"), functions, secret) === "webhook");
  for (const bad of [undefined, "forged", token.slice(0, -10) + "xxxxxxxxxx"]) {
    const result = await authorize(request("private", bad), functions, secret);
    assert(result instanceof Response && result.status === 401);
  }
  const expired = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setExpirationTime(1).sign(key);
  const rejected = await authorize(request("private", expired), functions, secret);
  assert(rejected instanceof Response && rejected.status === 401);
  for (const name of ["main", "_shared", "unknown", "constructor", "%2e%2e"]) {
    const result = await authorize(request(name, token), functions, secret);
    assert(result instanceof Response && result.status === 404);
  }
  const options = await authorize(request("private", undefined, "OPTIONS"), functions, secret);
  assert(options instanceof Response && options.status === 200);
  const health = await authorize(request("_health", undefined, "GET"), functions, secret);
  assert(health instanceof Response && health.status === 200);
});
