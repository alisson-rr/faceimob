/**
 * Ficha do colaborador — perfil, papéis (N:N em `user_roles`) e vínculo de
 * equipe num só lugar. Quem grava pessoa é aqui; a tela só monta o formulário.
 *
 * Papel é trocado pela RPC `set_profile_roles` (0046): recebe o conjunto
 * inteiro, insere o que falta, apaga o que sobrou, recusa conjunto vazio e o
 * admin tirar o próprio admin. Antes o front fazia `upsert(profile_id, role)`,
 * que só acumulava — rebaixar nunca removia o papel antigo.
 *
 * Equipe segue o mesmo desenho do "Vincular em massa" de Equipes: fecha a
 * filiação aberta (`left_at`) e abre outra na equipe ativa do gerente. Como
 * são dois requests sem transação, a filiação fechada é reaberta se a nova for
 * recusada — senão a pessoa ficaria sem equipe nenhuma.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./client";
import type { NewAppRole } from "./newSchema";
import { dbError, describeError } from "@/lib/supabaseError";

/**
 * As colunas da 0046 (cpf, creci, …) e a RPC `set_profile_roles` ainda não
 * estão em `types.ts` — o arquivo é gerado por `supabase gen types` e não se
 * edita à mão. O cast local morre no próximo `gen types`.
 */
const untyped = supabase as unknown as SupabaseClient;

export type ProfileDetails = {
  cpf: string | null;
  creci: string | null;
  habilitation: string | null;
  birth_date: string | null;
  hired_at: string | null;
  address: string | null;
  division: string | null;
  indication: string | null;
  badge_requested_at: string | null;
  badge_delivered_at: string | null;
  /** Dispensa a checagem de IP no check-in. Só admin grava (trigger da 0012). */
  bypass_ip_check: boolean;
};

export const EMPTY_DETAILS: ProfileDetails = {
  cpf: null, creci: null, habilitation: null, birth_date: null, hired_at: null,
  address: null, division: null, indication: null, badge_requested_at: null, badge_delivered_at: null,
  bypass_ip_check: false,
};

const DETAIL_COLUMNS = Object.keys(EMPTY_DETAILS).join(",");

/**
 * O que a ficha PRECISA reler do banco antes de deixar salvar.
 *
 * A lista de Equipes passa esses valores ao abrir pelo lápis, mas o caminho de
 * recuperação do e-mail duplicado (409 com `existing_profile_id`) não tem de
 * onde tirá-los: ele só conhece id, nome e e-mail. Sem reler, `buildSave`
 * gravava `phone: null` e `avatar_url: null` por cima de uma pessoa que JÁ
 * existia, e o Switch "Ativo" abria LIGADO para quem estava suspenso — como o
 * botão só grava `status` quando o valor MUDA, desligar e religar não escrevia
 * nada e não havia caminho de reativação por ali.
 */
export type ProfileIdentity = {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  /** `profiles.status === "active"`. Palpite aqui é o que travava a reativação. */
  active: boolean;
  /** O status CRU. `active` não distingue "suspenso" de "desligado", e a ficha
   *  precisa da diferença: desligar é definitivo e reativar é outro caminho. */
  status: ProfileStatus;
  /** Gerente e diretor saem da equipe ATIVA da pessoa, como em `listPeople()`. */
  manager_id: string | null;
  director_id: string | null;
};

export type ProfileStatus = "active" | "suspended" | "terminated";

const IDENTITY_COLUMNS = "full_name,email,phone,avatar_url,status";

export type ProfileFields = ProfileDetails & {
  full_name: string;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  /** Omitir = não mexer. Mandar sempre quebrava perfil `terminated` (check da 0002). */
  status?: ProfileStatus;
  /** Anda SEMPRE junto de `status`: o check `profiles_terminated_consistency`
   *  exige `(status = 'terminated') = (terminated_at is not null)`. Mandar um
   *  sem o outro é 23514 garantido. */
  terminated_at?: string | null;
};

export type PersonSave = {
  id: string;
  profile: ProfileFields;
  /** Conjunto completo de papéis. Omitir = não mexer (quem não é admin). */
  roles?: NewAppRole[];
  /** Gerente da equipe; `null` só encerra a filiação. Omitir = vínculo não mudou. */
  managerId?: string | null;
  /** A pessoa já tinha equipe quando a ficha abriu — muda a mensagem de recusa. */
  hadTeam?: boolean;
  /** Diretor da(s) equipe(s) que a pessoa gerencia. Omitir = não mudou. */
  directorId?: string | null;
};

/** Regra nossa, mensagem nossa: mesmo código das `raise exception` do banco,
 *  então `describeError` mostra o texto como está em vez do fallback. */
const ruleError = (message: string) => dbError("pessoa", { code: "P0001", message });

const today = () => new Date().toISOString().slice(0, 10);

/** A coluna guarda só os 11 dígitos (check da 0046); a tela aceita pontuação. */
export const cpfDigits = (raw: string | null | undefined) => (raw ?? "").replace(/\D/g, "");

const slug = (s: string) =>
  (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** primeiro.ultimo@faceimob.com.br a partir do nome completo (ou do apelido). */
export function suggestEmail(full: string | null | undefined, fallback?: string | null) {
  const src = (full || fallback || "").trim();
  if (!src) return "";
  const parts = src.split(/\s+/).filter(Boolean);
  const first = slug(parts[0] || "");
  const last = slug(parts[parts.length - 1] || "");
  const local = first && last && first !== last ? `${first}.${last}` : first || last;
  return local ? `${local}@faceimob.com.br` : "";
}

export async function getPersonDetails(
  profileId: string,
): Promise<{ details: ProfileDetails; roles: NewAppRole[]; identity: ProfileIdentity }> {
  const [detailsRes, rolesRes, teamRes] = await Promise.all([
    untyped.from("profiles").select(`${DETAIL_COLUMNS},${IDENTITY_COLUMNS}`).eq("id", profileId).single(),
    supabase.from("user_roles").select("role").eq("profile_id", profileId),
    // `team_members_one_active` é UNIQUE(profile_id) WHERE left_at is null:
    // no máximo uma filiação aberta, então `maybeSingle` é seguro aqui.
    untyped.from("team_members")
      .select("team:teams(manager_id,director_id)")
      .eq("profile_id", profileId).is("left_at", null).maybeSingle(),
  ]);
  if (detailsRes.error) throw dbError("profiles", detailsRes.error);
  if (rolesRes.error) throw dbError("user_roles", rolesRes.error);
  if (teamRes.error) throw dbError("team_members", teamRes.error);

  const perfil = (detailsRes.data ?? {}) as Record<string, unknown>;
  // O embed volta objeto; versão antiga do PostgREST devolve array. Ler as duas
  // formas evita a ficha dizer "sem gerente" por causa do formato da resposta.
  const embutido = (teamRes.data as { team?: unknown } | null)?.team;
  const equipe = (Array.isArray(embutido) ? embutido[0] : embutido) as
    { manager_id?: string | null; director_id?: string | null } | undefined;

  return {
    details: detailsRes.data as unknown as ProfileDetails,
    roles: (rolesRes.data ?? []).map((row) => row.role as NewAppRole),
    identity: {
      full_name: (perfil.full_name as string | null) ?? null,
      email: (perfil.email as string | null) ?? null,
      phone: (perfil.phone as string | null) ?? null,
      avatar_url: (perfil.avatar_url as string | null) ?? null,
      active: perfil.status === "active",
      status: (perfil.status as ProfileStatus) ?? "active",
      manager_id: equipe?.manager_id ?? null,
      director_id: equipe?.director_id ?? null,
    },
  };
}

/**
 * Equipe ativa do gerente — uma só, ou o motivo explícito.
 *
 * `maybeSingle()` aqui estourava PGRST116 num caso que o SCHEMA permite: existe
 * apenas índice NÃO único por `manager_id` (0002:127), e o próprio cenário de
 * E2E cria duas equipes com o mesmo gerente. A tela mostrava "Não foi possível
 * carregar a equipe do gerente", que não diz nada. Ambiguidade não vira escolha
 * silenciosa: quem chama recebe o nome das equipes e desativa a que sobra.
 */
export async function activeTeamIdOfManager(managerId: string): Promise<string> {
  const { data, error } = await supabase
    .from("teams").select("id,name")
    .eq("manager_id", managerId).eq("active", true)
    .order("created_at", { ascending: true });
  if (error) throw dbError("teams", error);
  if (!data?.length) throw ruleError("O gerente não possui uma equipe ativa.");
  if (data.length > 1) {
    const nomes = data.map((t) => t.name).join(", ");
    throw ruleError(
      `Este gerente tem ${data.length} equipes ativas (${nomes}). Desative as que sobram antes de vincular — não dá para adivinhar em qual a pessoa entra.`,
    );
  }
  return data[0].id;
}

export async function updateProfile(profileId: string, fields: ProfileFields): Promise<void> {
  // `.select()` não é enfeite: update que não casa linha nenhuma (RLS de quem
  // não alcança o perfil) volta 204 SEM erro, e a tela dizia "Dados atualizados"
  // sem ter gravado nada — a mesma mentira que GoalRow e applyBulk já fecharam.
  const { data, error } = await untyped
    .from("profiles").update(fields).eq("id", profileId).select("id");
  if (error) throw dbError("profiles", error);
  if (!data?.length) {
    throw dbError("profiles", { code: "42501", message: "nenhuma linha do perfil foi atualizada" });
  }
}

export async function setRoles(profileId: string, roles: NewAppRole[]): Promise<void> {
  const { error } = await untyped.rpc("set_profile_roles", { p_profile_id: profileId, p_roles: roles });
  if (error) throw dbError("set_profile_roles", error);
}

export async function setTeamByManager(
  profileId: string,
  managerId: string | null,
  /**
   * A pessoa JÁ tinha equipe quando a ficha abriu? Quem chama sabe (é o
   * `baseline` lido do banco) e essa informação não custa um request a mais.
   */
  tinhaEquipe = false,
): Promise<void> {
  let teamId: string | null = null;
  if (managerId) teamId = await activeTeamIdOfManager(managerId);
  // Fechar e abrir são dois requests: sem transação, o insert recusado (RLS de
  // quem não é admin, por exemplo) deixaria a pessoa sem equipe nenhuma. Por
  // isso guardamos os ids fechados aqui e reabrimos abaixo se o insert falhar.
  const closed = await supabase
    .from("team_members").update({ left_at: today() }).eq("profile_id", profileId).is("left_at", null).select("id");
  if (closed.error) throw dbError("team_members", closed.error);
  // Fechamento recortado pela `team_members_manage`: quando a pessoa pertence a
  // uma equipe que quem edita NÃO administra, o update casa 0 linhas e volta
  // 204 sem erro — e o insert seguinte estourava `team_members_one_active`
  // (23505), que vira "Já existe um registro com esses dados.", frase que não
  // diz nada. O vínculo em massa já tratava isso; a ficha, não.
  if (tinhaEquipe && !closed.data?.length) {
    throw ruleError(
      "Este colaborador pertence a uma equipe que você não administra — peça ao administrador para transferi-lo.",
    );
  }
  if (!teamId) return;
  const opened = await supabase.from("team_members").insert({ team_id: teamId, profile_id: profileId });
  if (opened.error) {
    const ids = (closed.data ?? []).map((row) => row.id);
    if (ids.length) {
      const reopened = await supabase.from("team_members").update({ left_at: null }).in("id", ids);
      if (reopened.error) {
        throw ruleError("A nova equipe foi recusada e a anterior não pôde ser restaurada. Revise o vínculo em Equipes.");
      }
    }
    throw dbError("team_members", opened.error);
  }
}

export async function setDirectorOfManagedTeams(managerId: string, directorId: string | null): Promise<void> {
  // `active` é obrigatório: equipe desativada casava a linha, o update dizia
  // "1 linha" e a hierarquia continuava sem diretor nenhum na tela.
  const { data, error } = await supabase
    .from("teams").update({ director_id: directorId })
    .eq("manager_id", managerId).eq("active", true).select("id");
  if (error) throw dbError("teams", error);
  if (!data?.length) {
    // DUAS causas, e a mensagem antiga só conhecia uma. Para um diretor mexendo
    // em equipe de OUTRA diretoria o `using` de `teams_admin_write` não casa e a
    // equipe EXISTE — mandá-lo "criar a equipe" era instrução errada. A frase
    // cobre as duas, como o vínculo em massa já faz em Equipes.tsx: perguntar
    // ao banco qual das duas é custaria um request só para escolher a redação.
    throw ruleError(
      "Nenhuma equipe foi atualizada. Ou este colaborador ainda não tem equipe ativa — crie a equipe dele em Equipes —, ou a equipe dele pertence a outra diretoria, e só o administrador a transfere.",
    );
  }
}

/**
 * Reabre filiações que este módulo acabou de fechar. `false` quando alguma não
 * voltou — a frase de erro de quem chama muda por causa disso.
 */
async function reopenMemberships(ids: string[]): Promise<boolean> {
  if (!ids.length) return true;
  const { data, error } = await supabase
    .from("team_members").update({ left_at: null }).in("id", ids).select("id");
  return !error && (data?.length ?? 0) === ids.length;
}

/**
 * Desativa a equipe do gerente — a saída que a mensagem de `activeTeamIdOfManager`
 * mandava procurar e que não existia em tela nenhuma (nenhum
 * `from("teams").update({ active })` no fonte).
 *
 * `auth_led_team_ids()` exige `t.active`: desativar CEGA o gerente e o diretor
 * para os membros dela na hora. Por isso quem chama tem de avisar antes, e por
 * isso os vínculos abertos são fechados junto — membro preso a uma equipe
 * inativa fica sem gerente e sem caminho de volta.
 *
 * A ORDEM não é escolha de estilo: `team_members_manage` é
 * `is_admin() or (has_permission('teams.manage') and team_id in
 * auth_led_team_ids())`, e `auth_led_team_ids()` exige `t.active`. Desativar
 * primeiro tiraria do diretor, no mesmo request, o direito de fechar os
 * vínculos — todo membro ficaria preso. Fecha-se ANTES, com o direito ainda de
 * pé, e cada etapa é conferida pela linha devolvida:
 *
 *   · fechou menos vínculos do que havia abertos (a permissão `teams.manage`
 *     foi revogada e o update casou 0 linhas, 204 SEM erro) → reabre e recusa,
 *     com a equipe ainda ativa;
 *   · `teams` recusado depois disso (`teams_admin_write` exige o diretor DA
 *     equipe) → reabre e recusa, em vez do antigo "Nenhuma equipe foi
 *     desativada" com todo mundo já desvinculado.
 */
export async function deactivateTeam(teamId: string): Promise<number> {
  // A conta contra a qual o fechamento é conferido sai do BANCO, não da tela: o
  // diálogo anuncia só os CORRETORES, e a equipe tem também o gerente aberto.
  const abertos = await supabase
    .from("team_members").select("id").eq("team_id", teamId).is("left_at", null);
  if (abertos.error) throw dbError("team_members", abertos.error);
  const esperado = abertos.data?.length ?? 0;

  const membros = await supabase
    .from("team_members").update({ left_at: today() })
    .eq("team_id", teamId).is("left_at", null).select("id");
  if (membros.error) throw dbError("team_members", membros.error);
  const fechados = (membros.data ?? []).map((row) => row.id);

  if (fechados.length < esperado) {
    const restaurou = await reopenMemberships(fechados);
    throw ruleError(
      `Só ${fechados.length} de ${esperado} vínculo(s) puderam ser encerrados — a permissão "Gerenciar equipes" pode ter sido revogada. A equipe NÃO foi desativada.`
      + (restaurou ? "" : " ATENÇÃO: os vínculos já encerrados não puderam ser restaurados — revise a equipe."),
    );
  }

  const { data, error } = await supabase
    .from("teams").update({ active: false }).eq("id", teamId).select("id");
  if (error || !data?.length) {
    const restaurou = await reopenMemberships(fechados);
    // O motivo E o estado, na mesma frase: sem o segundo, quem lê "sem
    // permissão" não sabe se os vínculos ficaram encerrados ou voltaram.
    throw ruleError(
      (error
        ? describeError(dbError("teams", error), "A equipe não pôde ser desativada.")
        : "Nenhuma equipe foi desativada — ela pode pertencer a outra diretoria.")
      + (restaurou
        ? " Os vínculos encerrados foram restaurados."
        : " ATENÇÃO: os vínculos encerrados não puderam ser restaurados — revise a equipe."),
    );
  }
  return fechados.length;
}

/**
 * Espelho de `manages_profile()` para a TELA, sem o ramo de admin (quem chama
 * já o trata).
 *
 * No banco: `has_any_role('admin') or exists(team_members tm where
 * tm.profile_id = alvo and tm.left_at is null and tm.team_id in
 * auth_led_team_ids())`, com `auth_led_team_ids()` = equipes ATIVAS em que
 * `manager_id = auth.uid()` **ou** `director_id = auth.uid()`.
 *
 * O ramo do diretor faltava na tela: ele é gestor direto de quem está numa
 * equipe que dirige — `profiles_manager_update` e o ramo `manages_profile` de
 * `profiles_guard_admin_columns` deixam-no gravar `status` —, mas a ficha
 * abria o Switch "Ativo" desabilitado e afirmava que ele não era o gestor.
 * Suspender/reativar corretor ficava sem caminho para o papel em torno do qual
 * a tela foi construída.
 *
 * `manager_id`/`director_id` vêm de `listPeople()`, que os deriva da equipe da
 * filiação ABERTA — o mesmo `team_members` do predicado.
 *
 * ponytail: `listPeople()` não expõe `teams.active`, então uma filiação aberta
 * numa equipe INATIVA (estado que `deactivateTeam` deixou de produzir) casaria
 * aqui e não no banco — o erro seria dito, não silencioso. Evoluir quando
 * `PersonRecord` carregar o `active` da equipe.
 */
export function leadsProfile(
  viewerProfileId: string | null | undefined,
  viewerRoles: readonly string[],
  person: { id: string; manager_id?: string | null; director_id?: string | null },
): boolean {
  // A própria ficha fica de fora de propósito: o banco deixaria o gerente
  // suspender a si mesmo (ele é membro da equipe que lidera) e isso é só um
  // jeito de se trancar para fora sem ninguém para desfazer.
  if (!viewerProfileId || person.id === viewerProfileId) return false;
  return (viewerRoles.includes("manager") && person.manager_id === viewerProfileId)
    || (viewerRoles.includes("director") && person.director_id === viewerProfileId);
}

/** Nome de quem lidera equipe ativa, para a tela resolver "↑ Fulano". */
export type TeamLeaderName = { id: string; full_name: string };

/**
 * Nome do gerente e do diretor SEM abrir a ficha deles.
 *
 * `auth_visible_profiles()` não sobe a hierarquia: o corretor lê `teams`
 * (policy aberta) e conhece o id do gerente, mas não a linha de `profiles`
 * dele — e por isso todo card de corretor escrevia "Sem gerente", que é falso.
 * A view `team_leader_names` (0079) entrega id, nome e avatar de quem lidera
 * equipe ativa, e nada além disso.
 */
export async function listTeamLeaderNames(): Promise<TeamLeaderName[]> {
  const { data, error } = await untyped
    .from("team_leader_names").select("id,full_name");
  if (error) throw dbError("team_leader_names", error);
  return (data ?? []) as TeamLeaderName[];
}

/**
 * Cria a equipe do gerente E o inclui como membro dela.
 *
 * As duas coisas juntas, sempre: `auth_visible_profiles()` só enxerga quem está
 * em `team_members` das equipes lideradas, então equipe criada sem esta segunda
 * linha deixa o próprio gerente INVISÍVEL para o diretor — e nada avisa. O seed
 * já inseria os gerentes; a tela não inseria.
 *
 * `directorId` entra no insert porque `teams_admin_write` (0061) só aceita o
 * diretor criando equipe para si; para o admin é indiferente.
 */
export async function createTeamForManager(
  managerId: string,
  name: string,
  slug: string,
  directorId: string | null,
): Promise<string> {
  const { data, error } = await supabase
    .from("teams")
    .insert({ manager_id: managerId, name, slug, director_id: directorId })
    .select("id")
    .single();
  if (error) throw dbError("teams", error);

  const member = await supabase
    .from("team_members")
    .insert({ team_id: data.id, profile_id: managerId })
    .select("id");
  // Filiação já aberta em outra equipe (`team_members_one_active`) é o único
  // caso esperado aqui; a equipe existe e o erro é dito, não engolido.
  if (member.error) throw dbError("team_members", member.error);
  return data.id;
}

/** Erro de uma etapa de `savePerson`, carregando o que já ficou gravado. */
export class SavePersonError extends Error {
  constructor(readonly etapa: string, readonly gravadas: string[], readonly causa: unknown) {
    const detalhe = describeError(causa, `Não foi possível salvar ${etapa}.`);
    super(gravadas.length
      ? `${detalhe} Já foi gravado: ${gravadas.join(", ")}. Corrija e salve de novo.`
      : detalhe);
    this.name = "SavePersonError";
  }
}

/**
 * Grava na ordem perfil → papéis → equipe → diretor.
 *
 * São quatro requests, não uma transação: o primeiro erro para tudo e o que já
 * passou fica gravado. Como o usuário não tem como adivinhar o que passou, o
 * erro sobe dizendo QUAL etapa falhou e QUAIS já estavam gravadas — sem isso a
 * tela mostrava "Erro ao salvar" sobre uma ficha metade nova, metade antiga.
 *
 * ponytail: sem transação; virar RPC única quando alguma etapa precisar desfazer
 * a anterior (hoje cada uma é idempotente e salvar de novo corrige).
 */
export async function savePerson(input: PersonSave): Promise<void> {
  const gravadas: string[] = [];
  const etapa = async (nome: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (error) {
      throw new SavePersonError(nome, gravadas, error);
    }
    gravadas.push(nome);
  };

  await etapa("dados do perfil", () => updateProfile(input.id, input.profile));
  if (input.roles) {
    const roles = input.roles;
    await etapa("funções", () => setRoles(input.id, roles));
  }
  if (input.managerId !== undefined) {
    const managerId = input.managerId;
    await etapa("equipe", () => setTeamByManager(input.id, managerId, !!input.hadTeam));
  }
  if (input.directorId !== undefined) {
    const directorId = input.directorId;
    await etapa("diretor", () => setDirectorOfManagedTeams(input.id, directorId));
  }
}

/** Uma linha das duas trilhas de auditoria, já normalizada para a tela. */
export type TrailEntry = {
  kind: "acesso" | "papel";
  at: string;
  actor: string | null;
  target: string | null;
  detail: string;
};

const ACTION_LABEL: Record<string, string> = {
  create: "criou o acesso",
  reset: "trocou o e-mail de acesso",
  denied: "TENTOU provisionar sem ser administrador",
  revoked: "BLOQUEOU a entrada",
  restored: "devolveu a entrada",
};

/**
 * As duas trilhas de auditoria do domínio de gente, juntas e em ordem.
 *
 * `access_provision_log` (0061) e `role_change_log` (0079) existem, têm policy
 * de leitura só para admin — e nenhuma tela as mostrava: a auditoria existia e
 * ninguém a lia. Os e-mails vêm como TEXTO das próprias tabelas porque as fks
 * são `on delete set null`: perguntar "quem provisionou o acesso de quem"
 * costuma acontecer depois de a pessoa sair da empresa.
 */
export async function listAccessTrail(limit = 20): Promise<TrailEntry[]> {
  const [acessos, papeis] = await Promise.all([
    untyped.from("access_provision_log")
      .select("actor_email,email,action,created_at")
      .order("created_at", { ascending: false }).limit(limit),
    untyped.from("role_change_log")
      .select("actor_email,profile_email,roles_before,roles_after,created_at")
      .order("created_at", { ascending: false }).limit(limit),
  ]);
  if (acessos.error) throw dbError("access_provision_log", acessos.error);
  if (papeis.error) throw dbError("role_change_log", papeis.error);

  const deAcesso: TrailEntry[] = ((acessos.data ?? []) as Record<string, string>[]).map((row) => ({
    kind: "acesso",
    at: row.created_at,
    actor: row.actor_email ?? null,
    target: row.email ?? null,
    detail: ACTION_LABEL[row.action] ?? row.action,
  }));

  const dePapel: TrailEntry[] = ((papeis.data ?? []) as Record<string, unknown>[]).map((row) => {
    const antes = (row.roles_before as string[] | null) ?? [];
    const depois = (row.roles_after as string[] | null) ?? [];
    return {
      kind: "papel",
      at: row.created_at as string,
      actor: (row.actor_email as string | null) ?? null,
      target: (row.profile_email as string | null) ?? null,
      detail: `funções: ${antes.join(", ") || "—"} → ${depois.join(", ") || "—"}`,
    };
  });

  return [...deAcesso, ...dePapel]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, limit);
}

/** O formulário da ficha, na forma em que `buildPersonSave` precisa dele. */
export type PersonFormValues = ProfileDetails & {
  id: string;
  full_name?: string | null;
  name?: string | null;
  celular?: string | null;
  avatar_url?: string | null;
  active?: boolean | null;
  manager_id?: string | null;
  director_id?: string | null;
  roles: NewAppRole[];
};

/** O que o BANCO devolveu quando a ficha abriu — nunca o palpite da lista. */
export type PersonBaseline = {
  active?: boolean | null;
  status?: ProfileStatus;
  manager_id?: string | null;
  director_id?: string | null;
} | null;

export type BuildPersonSaveOptions = {
  baseline: PersonBaseline;
  isAdmin: boolean;
  /** A pessoa gerencia equipe: só aí o campo "Diretor" vale alguma coisa. */
  managesTeam: boolean;
  /** Desligamento definitivo (`profile_status = 'terminated'`). Só admin. */
  desligar?: boolean;
};

/**
 * Monta o que vai para o banco a partir do formulário da ficha.
 *
 * Vive AQUI, e não dentro do componente, por dois motivos: é a única lógica não
 * trivial do modal (validação, o que mudou, status) e dentro do JSX ela não
 * tinha teste nenhum — o arquivo de teste da ficha não monta o componente.
 * Devolve `string` com a frase de validação quando não dá para salvar.
 */
export function buildPersonSave(
  form: PersonFormValues,
  email: string | null | undefined,
  { baseline, isAdmin, managesTeam, desligar = false }: BuildPersonSaveOptions,
): PersonSave | string {
  const full_name = (form.full_name || form.name || "").trim();
  if (!full_name) return "Informe o nome completo.";
  if (!(email || "").trim()) return "Informe o e-mail.";
  const cpf = cpfDigits(form.cpf);
  if (cpf && cpf.length !== 11) return "CPF precisa ter 11 dígitos.";
  // `set_profile_roles` recusa conjunto vazio — mas só DEPOIS de o perfil já ter
  // sido gravado (etapa 1 de `savePerson`). Barrar aqui é a diferença entre um
  // aviso e uma ficha meio salva.
  if (isAdmin && form.roles.length === 0) return "Escolha ao menos uma função para o colaborador.";

  const profile: ProfileFields = {
    full_name,
    email: (email || "").trim(),
    phone: form.celular || null,
    avatar_url: form.avatar_url ?? null,
    cpf: cpf || null,
    creci: form.creci?.trim() || null,
    habilitation: form.habilitation || null,
    birth_date: form.birth_date || null,
    hired_at: form.hired_at || null,
    address: form.address?.trim() || null,
    division: form.division?.trim() || null,
    indication: form.indication?.trim() || null,
    badge_requested_at: form.badge_requested_at || null,
    badge_delivered_at: form.badge_delivered_at || null,
    bypass_ip_check: !!form.bypass_ip_check,
  };

  // `status` e `terminated_at` andam juntos por causa do check
  // `profiles_terminated_consistency`. Contra o BANCO, não contra o palpite da
  // lista: comparar com um `active` chutado deixava a pessoa suspensa sem
  // caminho de reativação.
  if (desligar) {
    profile.status = "terminated";
    profile.terminated_at = today();
  } else if (baseline && form.active !== baseline.active) {
    // Ligar o Switch de quem foi DESLIGADO é a reativação: `terminated_at`
    // precisa voltar a nulo junto, senão o check recusa a linha inteira.
    profile.status = form.active === false ? "suspended" : "active";
    profile.terminated_at = null;
  }

  const managerChanged = (form.manager_id ?? null) !== (baseline?.manager_id ?? null);
  const directorChanged = managesTeam && (form.director_id ?? null) !== (baseline?.director_id ?? null);

  return {
    id: form.id,
    profile,
    roles: isAdmin ? form.roles : undefined,
    managerId: managerChanged ? form.manager_id ?? null : undefined,
    hadTeam: !!baseline?.manager_id,
    directorId: directorChanged ? form.director_id ?? null : undefined,
  };
}

/**
 * Recusa do GoTrue em pt-BR.
 *
 * O provedor responde em inglês ("A user with this email address has already
 * been registered"). O texto cru chegava ao modal da ficha enquanto o diálogo
 * de cadastro já traduzia a MESMA recusa — duas versões do mesmo erro. Uma só,
 * aqui, para os dois chamarem.
 */
export function authErrorMessage(message: string): string {
  if (/already (been )?registered|already exists|email_exists/i.test(message)) {
    return "Já existe um acesso com esse e-mail.";
  }
  if (/invalid.*email|email_address_invalid/i.test(message)) {
    return "E-mail em formato inválido.";
  }
  if (/rate limit|too many/i.test(message)) {
    return "Muitas tentativas seguidas. Espere um minuto e tente de novo.";
  }
  return message;
}
