/**
 * Os usuários da suíte E2E — um por visão de usuário.
 *
 * Por que não reaproveitar o seed: as contas `seed.*@example.invalid` são
 * **banidas de propósito** (`banned_until` em 2126, ver `seeds/010`) justamente
 * para não servirem de login. Tentar logar com elas devolve `user_banned`.
 * Estes usuários são separados, nascem só no ambiente de teste e carregam o
 * sufixo `@faceimob.test`, que nunca é entregável.
 *
 * A matriz cobre a hierarquia da ata de 23/07 — inclusive o caso do diretor que
 * também é corretor, que é o motivo de `user_roles` ser N:N.
 */
import { resolveTarget } from "./target";

export type AppRole =
  | "admin" | "director" | "manager" | "broker"
  | "cca" | "sdr" | "marketing" | "partner";

export type RoleKey =
  | "admin" | "director" | "manager" | "broker" | "brokerRival" | "brokerThird"
  | "cca" | "sdr" | "marketing" | "dual";

export type E2EUser = {
  key: RoleKey;
  email: string;
  fullName: string;
  roles: AppRole[];
  /** Equipe a que pertence: "alfa" é a do diretor/gerente E2E; "beta" existe só para provar isolamento. */
  team: "alfa" | "beta" | null;
  /** Papel na equipe — quem lidera não entra como membro. */
  leads: "manager" | "director" | null;
};

export const E2E_USERS: E2EUser[] = [
  { key: "admin",       email: "e2e.admin@faceimob.test",       fullName: "E2E Admin",             roles: ["admin"],               team: null,   leads: null },
  { key: "director",    email: "e2e.director@faceimob.test",    fullName: "E2E Diretor",           roles: ["director"],            team: null,   leads: "director" },
  { key: "manager",     email: "e2e.manager@faceimob.test",     fullName: "E2E Gerente",           roles: ["manager"],             team: null,   leads: "manager" },
  { key: "broker",      email: "e2e.broker@faceimob.test",      fullName: "E2E Corretor",          roles: ["broker"],              team: "alfa", leads: null },
  { key: "brokerRival", email: "e2e.broker2@faceimob.test",     fullName: "E2E Corretor Rival",    roles: ["broker"],              team: "beta", leads: null },
  { key: "brokerThird", email: "e2e.broker3@faceimob.test",     fullName: "E2E Corretor 3",        roles: ["broker"],              team: "alfa", leads: null },
  { key: "cca",         email: "e2e.cca@faceimob.test",         fullName: "E2E Analista CCA",      roles: ["cca"],                 team: null,   leads: null },
  { key: "sdr",         email: "e2e.sdr@faceimob.test",         fullName: "E2E SDR",               roles: ["sdr"],                 team: null,   leads: null },
  { key: "marketing",   email: "e2e.marketing@faceimob.test",   fullName: "E2E Marketing",         roles: ["marketing"],           team: null,   leads: null },
  // Ata 23/07: "os Diretores possuem a capacidade de atuar em múltiplos papéis".
  { key: "dual",        email: "e2e.dual@faceimob.test",        fullName: "E2E Diretor Corretor",  roles: ["director", "broker"],  team: "alfa", leads: null },
];

export const userFor = (key: RoleKey): E2EUser => {
  const found = E2E_USERS.find((u) => u.key === key);
  if (!found) throw new Error(`Papel E2E desconhecido: ${key}`);
  return found;
};

const TEAMS = {
  alfa: { name: "Equipe E2E Alfa", slug: "equipe-e2e-alfa" },
  beta: { name: "Equipe E2E Beta", slug: "equipe-e2e-beta" },
} as const;

// ── Acesso administrativo (fora do navegador, com service_role) ──────────────

const admin = async (path: string, init: RequestInit = {}) => {
  const t = resolveTarget();
  const res = await fetch(`${t.supabaseUrl}${path}`, {
    ...init,
    headers: {
      apikey: t.serviceRoleKey,
      Authorization: `Bearer ${t.serviceRoleKey}`,
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  return res;
};

/** PostgREST com service_role: ignora RLS de propósito, só no preparo do cenário. */
const rest = async (path: string, init: RequestInit = {}) => {
  const res = await admin(`/rest/v1/${path}`, init);
  const corpo = await res.text();
  if (!res.ok) {
    throw new Error(`REST ${path} → ${res.status}: ${corpo.slice(0, 300)}`);
  }
  // Sem `Prefer: return=representation` o PostgREST responde 201/204 sem corpo.
  return corpo ? JSON.parse(corpo) : null;
};

async function findUserId(email: string): Promise<string | null> {
  const res = await admin(`/auth/v1/admin/users?filter=${encodeURIComponent(email)}`);
  if (!res.ok) return null;
  const body = await res.json();
  return (body.users ?? []).find((u: { email?: string }) => u.email === email)?.id ?? null;
}

async function ensureAuthUser(user: E2EUser): Promise<string> {
  const existing = await findUserId(user.email);
  if (existing) return existing;

  const res = await admin("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email: user.email,
      email_confirm: true,
      user_metadata: { full_name: user.fullName, e2e: true },
    }),
  });
  const body = await res.json();
  if (!res.ok || !body.id) {
    // Corrida entre workers: se outro já criou, aproveita.
    const retry = await findUserId(user.email);
    if (retry) return retry;
    throw new Error(`Falha ao criar ${user.email}: ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  }
  return body.id as string;
}

async function ensureTeam(kind: keyof typeof TEAMS, managerId: string, directorId: string) {
  const meta = TEAMS[kind];
  const found = (await rest(`teams?slug=eq.${meta.slug}&select=id`)) as { id: string }[];
  if (found.length) {
    await rest(`teams?id=eq.${found[0].id}`, {
      method: "PATCH",
      body: JSON.stringify({ manager_id: managerId, director_id: directorId, active: true }),
    });
    return found[0].id;
  }
  const created = (await rest("teams", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ name: meta.name, slug: meta.slug, manager_id: managerId, director_id: directorId }),
  })) as { id: string }[];
  return created[0].id;
}

export type ProvisionedUser = E2EUser & { id: string };

/**
 * Garante que os dez usuários existem com papéis e equipes. Idempotente: pode
 * rodar em toda execução da suíte sem duplicar nada.
 */
export async function provisionE2EUsers(): Promise<Map<RoleKey, ProvisionedUser>> {
  const byKey = new Map<RoleKey, ProvisionedUser>();

  for (const user of E2E_USERS) {
    const id = await ensureAuthUser(user);
    byKey.set(user.key, { ...user, id });
  }

  // O perfil nasce por trigger (`handle_new_auth_user`); o nome é reforçado
  // aqui porque um usuário criado antes de uma troca de nome ficaria defasado.
  for (const user of byKey.values()) {
    await rest(`profiles?id=eq.${user.id}`, {
      method: "PATCH",
      body: JSON.stringify({ full_name: user.fullName, status: "active" }),
    });
    await rest("user_roles", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates" },
      body: JSON.stringify(user.roles.map((role) => ({ profile_id: user.id, role }))),
    });
  }

  const alfa = await ensureTeam("alfa", byKey.get("manager")!.id, byKey.get("director")!.id);
  const beta = await ensureTeam("beta", byKey.get("manager")!.id, byKey.get("director")!.id);
  const teamId = { alfa, beta } as const;

  for (const user of byKey.values()) {
    if (!user.team) continue;
    const already = (await rest(
      `team_members?team_id=eq.${teamId[user.team]}&profile_id=eq.${user.id}&select=team_id`,
    )) as unknown[];
    if (already.length) continue;
    await rest("team_members", {
      method: "POST",
      body: JSON.stringify({ team_id: teamId[user.team], profile_id: user.id }),
    });
  }

  return byKey;
}

/**
 * Desfaz exatamente o que `provisionE2EUsers()` criou — nem um registro a mais.
 *
 * Sem isto, rodar a suíte contra a homologação deixava as dez contas
 * `e2e.*@faceimob.test` e as duas equipes no banco da demonstração: "E2E
 * Corretor" entrava nas listas de equipe e cinco corretores de teste entravam
 * na contagem de staff que o cliente vê.
 *
 * **O marcador é explícito, nunca "criado recentemente".** Só saem daqui os dez
 * e-mails literais de `E2E_USERS` e as duas equipes pelo `slug`. Uma varredura
 * por data apagaria dado real da demonstração no primeiro fuso horário errado.
 *
 * As quatro tabelas com `on delete restrict` (`deal_participants`,
 * `daily_entries`, `game_events`, `game_season_results`) precisam sair antes: o
 * `DELETE` do usuário cascateia até `profiles` e para ali. O `removeE2EUsers()`
 * anterior não conferia a resposta da Admin API, então falhava em silêncio
 * justamente quando havia o que limpar.
 */
export async function deprovisionE2EUsers(): Promise<{ usuarios: number; equipes: number }> {
  const ids: string[] = [];
  for (const user of E2E_USERS) {
    const id = await findUserId(user.email);
    if (id) ids.push(id);
  }

  // 1) As equipes primeiro: `team_members`, `daily_reports`, `funnel_targets`,
  //    `public_links`, `goals` e `allowed_ips` das duas caem por cascade.
  const slugs = Object.values(TEAMS).map((t) => t.slug);
  const equipes = (await rest(`teams?slug=in.(${slugs.join(",")})&select=id`)) as { id: string }[];
  if (equipes.length) {
    await rest(`teams?id=in.(${equipes.map((t) => t.id).join(",")})`, { method: "DELETE" });
  }

  if (ids.length) {
    const lista = ids.join(",");

    // 2) O que trava o cascade. São dados destes perfis e de mais ninguém.
    const negociosTocados = (await rest(
      `deal_participants?profile_id=in.(${lista})&select=deal_id`,
    )) as { deal_id: string }[];

    for (const tabela of ["game_events", "game_season_results", "daily_entries", "deal_participants"]) {
      await rest(`${tabela}?profile_id=in.(${lista})`, { method: "DELETE" });
    }

    // 3) Negócio que ficou sem NENHUM participante só pode ter sido criado pela
    //    suíte — negócio do seed sempre tem corretor do seed. Sem isto a limpeza
    //    trocaria "corretor de teste na lista" por "negócio órfão na contagem".
    const orfaos = [...new Set(negociosTocados.map((p) => p.deal_id))];
    if (orfaos.length) {
      const restantes = (await rest(
        `deal_participants?deal_id=in.(${orfaos.join(",")})&select=deal_id`,
      )) as { deal_id: string }[];
      const comDono = new Set(restantes.map((p) => p.deal_id));
      const apagar = orfaos.filter((id) => !comDono.has(id));
      if (apagar.length) await rest(`deals?id=in.(${apagar.join(",")})`, { method: "DELETE" });
    }

    // 4) As contas. `profiles` cai por cascade a partir de `auth.users`.
    for (const id of ids) {
      const res = await admin(`/auth/v1/admin/users/${id}`, { method: "DELETE" });
      if (!res.ok) {
        throw new Error(
          `[e2e] não consegui remover o usuário ${id}: ${res.status} ${(await res.text()).slice(0, 200)}`,
        );
      }
    }
  }

  return { usuarios: ids.length, equipes: equipes.length };
}
