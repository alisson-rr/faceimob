import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Users, Pencil, Link2, Search, Crown, Shield, UserCog, User, Loader2, KeyRound, UserPlus, AlertTriangle, IdCard } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn, slugify } from "@/lib/utils";
import { brl } from "@/lib/format";
import { dbError, describeError } from "@/lib/supabaseError";
import { listPeople } from "@/integrations/supabase/newSchema";
import { activeTeamIdOfManager, createTeamForManager, deactivateTeam, leadsProfile, listTeamLeaderNames } from "@/integrations/supabase/people";

import { EmptyState, LoadingState, PageHeader, StatusBadge } from "@/components/shared";

import { BrokerEditModal, type EditableBroker } from "@/components/BrokerEditModal";
import { GlobalGoalCard } from "@/components/equipes/GlobalGoalCard";
import { NewPersonDialog } from "@/components/equipes/NewPersonDialog";
import { TrilhaAcesso } from "@/components/equipes/TrilhaAcesso";
import { goalPeriods, goalsByProfile, otherMetricsByProfile, parseGoal } from "@/components/equipes/metas";

interface BrokerRow {
  id: string;
  name: string;
  role: string;
  manager_id: string | null;
  director_id: string | null;
  active: boolean;
  /** `profiles.status` cru — `active` não separa suspenso de desligado. */
  status: string;
  user_id: string | null;
  email?: string | null;
  avatar_url?: string | null;
  monthly_goal?: number | null;
  yearly_goal?: number | null;
  /** Metas do mês que NÃO são de VGV, já formatadas ("Vendas 3 · Visitas 10"). */
  other_goals?: string | null;
  /** O conjunto INTEIRO de papéis. `role` é só o principal (primaryRole). */
  roles: string[];
}

const ROTULO_STATUS: Record<string, string> = {
  suspended: "Suspenso",
  terminated: "Desligado",
};

/** Selo de situação. Só aparece para quem não está ativo — o normal não precisa de selo. */
function StatusPessoa({ status }: { status: string }) {
  const rotulo = ROTULO_STATUS[status];
  if (!rotulo) return null;
  return (
    <StatusBadge tone={status === "terminated" ? "danger" : "warning"} className="shrink-0">
      {rotulo}
    </StatusBadge>
  );
}

/**
 * Os papéis ALÉM do principal.
 *
 * Papel é N:N (`user_roles`) e a autorização usa a união, mas o organograma
 * mostrava só o principal: não havia tela nenhuma onde se lesse "quem tem qual
 * papel". O caso da ata de 23/07 — diretor que também atende como corretor —
 * ficava invisível, e o par {corretor, SDR} que o gatilho de cadastro cria
 * sozinho também.
 */
function PapeisExtras({ roles, principal }: { roles: string[]; principal: string }) {
  const extras = roles.filter(r => r !== principal);
  if (!extras.length) return null;
  return (
    <p className="text-xs text-muted-foreground truncate">
      também: {extras.map(r => ROTULO_PAPEL[r] ?? r).join(", ")}
    </p>
  );
}

const initials = (n: string) => n.split(" ").filter(Boolean).slice(0, 2).map(s => s[0]).join("").toUpperCase();

/** As quatro colunas do organograma. Quem não cai em nenhuma vai para "Outros". */
const COLUNAS = new Set(["director", "manager", "broker", "cca"]);

const ROTULO_PAPEL: Record<string, string> = {
  admin: "Administrador",
  partner: "Sócio",
  sdr: "SDR",
  marketing: "Marketing",
  director: "Diretor",
  manager: "Gerente",
  broker: "Corretor",
  cca: "CCA",
};

function GoalRow({ broker, onSaved }: { broker: BrokerRow; onSaved: () => void }) {
  const errorId = useId();
  const [monthly, setMonthly] = useState(String(broker.monthly_goal ?? 0));
  const [yearly, setYearly] = useState(String(broker.yearly_goal ?? 0));
  const [saving, setSaving] = useState(false);
  const parsedMonthly = parseGoal(monthly);
  const parsedYearly = parseGoal(yearly);
  const invalid = parsedMonthly === null || parsedYearly === null;
  const dirty = parsedMonthly !== (broker.monthly_goal ?? 0) || parsedYearly !== (broker.yearly_goal ?? 0);

  const save = async () => {
    if (invalid) return;
    setSaving(true);
    const periods = goalPeriods();
    const targets = [
      { period_type: "month", period: periods.month, target: parsedMonthly },
      { period_type: "year", period: periods.year, target: parsedYearly },
    ];
    let failure: { code?: string; message?: string } | null = null;
    for (const goal of targets) {
      const existing = await supabase
        .from("goals")
        .select("id")
        .eq("scope", "profile")
        .eq("profile_id", broker.id)
        .eq("period_type", goal.period_type)
        .eq("period", goal.period)
        .eq("metric", "vgv")
        .maybeSingle();
      if (existing.error) {
        failure = existing.error;
        break;
      }
      const result = existing.data
        ? await supabase.from("goals").update({ target: goal.target }).eq("id", existing.data.id).select("id")
        : await supabase.from("goals").insert({
            scope: "profile",
            profile_id: broker.id,
            period_type: goal.period_type,
            period: goal.period,
            metric: "vgv",
            target: goal.target,
          }).select("id");
      if (result.error) {
        failure = result.error;
        break;
      }
      // Update que não casa linha nenhuma volta sem erro (a RLS `goals_write`
      // só aceita admin e diretor). Sem esta conferência o toast verde apareceria
      // para quem não gravou nada.
      if (!result.data?.length) {
        failure = { code: "42501", message: "sem permissão para gravar meta" };
        break;
      }
    }
    setSaving(false);
    if (failure) return toast({ title: "Erro ao salvar meta", description: describeError(failure, "Não foi possível salvar a meta."), variant: "destructive" });
    toast({ title: "Meta salva" });
    onSaved();
  };

  return (
    <div className="space-y-1">
      {/* `flex-wrap` + `min-w-0` porque a linha tem rótulo, dois campos numéricos
          e um botão: a 375 px ela estourava a lateral do card. */}
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-eyebrow shrink-0" title="Meta de VGV (R$) para o mês e para o ano correntes">Meta VGV R$</span>
        <Input
          type="number"
          min={0}
          value={monthly}
          onChange={e => setMonthly(e.target.value)}
          placeholder="mês"
          className="h-6 text-xs px-2 min-w-0 flex-1 basis-16"
          aria-label={`Meta mensal de ${broker.name}`}
          aria-invalid={parsedMonthly === null}
          aria-describedby={invalid ? errorId : undefined}
        />
        <Input
          type="number"
          min={0}
          value={yearly}
          onChange={e => setYearly(e.target.value)}
          placeholder="ano"
          className="h-6 text-xs px-2 min-w-0 flex-1 basis-16"
          aria-label={`Meta anual de ${broker.name}`}
          aria-invalid={parsedYearly === null}
          aria-describedby={invalid ? errorId : undefined}
        />
        <Button
          size="sm"
          variant={dirty ? "default" : "ghost"}
          className="h-6 px-2 text-xs"
          aria-label={`Salvar metas de ${broker.name}`}
          onClick={save}
          disabled={saving || !dirty || invalid}
        >
          {saving ? "..." : "Salvar"}
        </Button>
      </div>
      {invalid && <p id={errorId} className="text-xs text-destructive">Use um número maior ou igual a zero</p>}
      {/* As metas de vendas e visitas existem no banco e não apareciam em tela
          nenhuma. Aqui são só leitura: editá-las é de outra tela, e um campo
          que não grava seria a mentira de novo. */}
      {broker.other_goals && (
        <p className="text-xs text-muted-foreground">Meta do mês, fora VGV: {broker.other_goals}</p>
      )}
    </div>
  );
}

export default function Equipes() {
  // `role` é o papel REAL; quem manda na tela são os papéis EFETIVOS, senão a
  // prévia do RoleSwitcher mostra ao admin botão que o papel previsto não tem.
  const { roles, previewRole, isAdmin, user, can } = useAuth();
  const effectiveRoles = previewRole ? [previewRole] : roles;
  const canEdit = isAdmin || effectiveRoles.includes("director");
  /**
   * Quem pode mexer em `team_members`.
   *
   * `team_members_manage` (0044) é `is_admin() or (has_permission('teams.manage')
   * and team_id in auth_led_team_ids())`. NÃO há ramo de diretor: `has_permission`
   * só curto-circuita para admin. Passar o diretor por `canEdit` (que não confere
   * nada) funcionava só porque o seed concede `teams.manage` a director — no
   * instante em que o admin desliga esse switch em /admin/permissions, o botão
   * continuava na tela e todo insert em `team_members` era recusado. Meta, nome
   * de equipe e vínculo com diretoria seguem em `canEdit` (RLS de `goals` e
   * `teams` é admin/diretor).
   */
  const canManageMembers = isAdmin
    || ((effectiveRoles.includes("director") || effectiveRoles.includes("manager")) && can("teams.manage"));

  const [rows, setRows] = useState<BrokerRow[]>([]);
  const [loading, setLoading] = useState(true);
  /** Falha de carga é diferente de "não há ninguém visível" — a tela dizia a segunda. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [teamsByMgr, setTeamsByMgr] = useState<Record<string, { id: string; display_name: string | null }>>({});
  const [teamNameDrafts, setTeamNameDrafts] = useState<Record<string, string>>({});
  /** id → nome de quem lidera equipe ativa (view `team_leader_names`, 0079). */
  const [leaderNames, setLeaderNames] = useState<Map<string, string>>(new Map());
  /** Equipe marcada para desativação, à espera da confirmação. */
  const [desativar, setDesativar] = useState<{ teamId: string; managerName: string; membros: number } | null>(null);

  // individual edit — full profile modal
  const [profileEdit, setProfileEdit] = useState<EditableBroker | null>(null);
  const [creating, setCreating] = useState(false);

  // bulk assign
  const [bulk, setBulk] = useState<{ column: "manager" | "broker" } | null>(null);
  const [bulkTarget, setBulkTarget] = useState("");
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkFilter, setBulkFilter] = useState("");
  /** Confirmação nominal do desligamento — a única parte irreversível do diálogo. */
  const [confirmarSaida, setConfirmarSaida] = useState(false);
  const [saving, setSaving] = useState(false);

  // Admin-only: credentials of each broker/manager/director
  /**
   * O e-mail de acesso no card, para o admin.
   *
   * Não há senha para mostrar nem copiar: o login é por código enviado a cada
   * entrada. A versão anterior montava `password: null` para todo mundo e
   * renderizava botões de "mostrar" e "copiar senha" que nunca apareciam —
   * código morto prometendo credencial e entregando só o endereço.
   */
  const CredLine = ({ id }: { id: string }) => {
    if (!isAdmin) return null;
    const email = rows.find(r => r.id === id)?.email;
    if (!email) return null;
    return (
      <div className="flex items-center gap-1 mt-1 rounded-md bg-background/60 border border-border/30 px-1.5 py-1">
        <KeyRound className="h-3 w-3 text-primary shrink-0" />
        <code className="text-xs truncate flex-1" title={email}>{email}</code>
      </div>
    );
  };

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const periods = goalPeriods();
      // Uma consulta para todas as metas do mês e do ano — a alternativa seria
      // uma por pessoa. A RLS `goals_select` já recorta pelos perfis visíveis.
      // Sem filtro de métrica: filtrar em `vgv` escondia as metas de vendas e
      // visitas que existem de verdade, e a tela escrevia R$ 0,00 por cima.
      const [people, goalsRes, teamsRes] = await Promise.all([
        listPeople(),
        supabase
          .from("goals")
          .select("profile_id,period_type,period,target,metric")
          .eq("scope", "profile")
          .in("period", [periods.month, periods.year]),
        // Ordem explícita: `teams` só tem índice NÃO único por `manager_id`, e
        // o mapa abaixo guarda UMA equipe por gerente. Sem ordenar, o campo
        // "Equipe" renomeava a última linha que o PostgREST devolvesse — sem
        // critério nenhum. Ativa primeiro, mais antiga primeiro, primeira vence.
        // ponytail: gerente com duas equipes ativas edita só o nome da primeira
        // aqui (o vínculo em massa recusa e diz o motivo); evoluir para uma
        // lista por gerente quando o banco passar a permitir isso de propósito.
        supabase.from("teams").select("id,manager_id,name,active")
          .order("active", { ascending: false }).order("created_at", { ascending: true }),
      ]);
      if (goalsRes.error) throw dbError("goals", goalsRes.error);
      if (teamsRes.error) throw dbError("teams", teamsRes.error);

      const goalByProfile = goalsByProfile(goalsRes.data ?? [], periods);
      const outrasMetas = otherMetricsByProfile(goalsRes.data ?? [], periods);

      setRows(people.map((person) => ({
        id: person.id,
        name: person.name,
        role: person.role,
        manager_id: person.manager_id,
        director_id: person.director_id,
        active: person.active,
        status: person.status,
        roles: person.roles,
        user_id: person.user_id,
        email: person.email,
        avatar_url: person.avatar_url,
        monthly_goal: goalByProfile.get(person.id)?.monthly ?? 0,
        yearly_goal: goalByProfile.get(person.id)?.yearly ?? 0,
        other_goals: outrasMetas.get(person.id) ?? null,
      })));

      // Nome de quem lidera, para a hierarquia parar de mentir.
      //
      // `auth_visible_profiles()` NÃO sobe: o corretor lê `teams` (policy
      // aberta) e conhece o id do gerente, mas não a linha de `profiles` dele —
      // e o card dele escrevia "Sem gerente", que é falso. A view
      // `team_leader_names` (0079) entrega só id, nome e avatar de quem lidera.
      //
      // Falha aqui NÃO derruba a tela: a view pode ainda não estar aplicada no
      // alvo, e nesse caso o rótulo volta a ser o de antes em vez de a página
      // inteira sumir.
      try {
        const leaders = await listTeamLeaderNames();
        setLeaderNames(new Map(leaders.map((l) => [l.id, l.full_name])));
      } catch (error: unknown) {
        console.warn("team_leader_names indisponível; nomes de gerente/diretor podem faltar", error);
        setLeaderNames(new Map());
      }

      const map: Record<string, { id: string; display_name: string | null }> = {};
      const drafts: Record<string, string> = {};
      (teamsRes.data ?? []).forEach((t) => {
        // Só equipe ATIVA entra no mapa. A inativa não pode aparecer no campo
        // "Equipe" (renomeá-la não devolve ninguém à hierarquia, porque
        // `auth_led_team_ids()` exige `active`) nem ganhar o botão "Desativar",
        // que a desativaria de novo. Gerente sem equipe ativa vê o campo vazio,
        // e digitar um nome ali CRIA a equipe nova — que é a recuperação certa.
        if (t.manager_id && t.active && !map[t.manager_id]) {
          map[t.manager_id] = { id: t.id, display_name: t.name };
          drafts[t.manager_id] = t.name ?? "";
        }
      });
      setTeamsByMgr(map);
      setTeamNameDrafts(drafts);
    } catch (error: unknown) {
      const motivo = describeError(error, "Não foi possível carregar a equipe.");
      setLoadError(motivo);
      toast({ title: "Erro ao carregar equipe", description: motivo, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const saveTeamName = async (manager: BrokerRow) => {
    const managerId = manager.id;
    const managerName = manager.name;
    const name = (teamNameDrafts[managerId] ?? "").trim();
    const existing = teamsByMgr[managerId];
    if (existing) {
      // `teams_admin_write` deixou de ser "qualquer diretor" e passou a exigir
      // diretor DA equipe (ou equipe órfã), então recusa por RLS virou caminho
      // real: equipe transferida de diretoria, equipe desativada, lista velha.
      // Sem pedir a linha de volta o update casa 0 linhas, volta 204 sem erro,
      // e o toast verde deixaria o nome novo na tela até o F5.
      const { data, error } = await supabase
        .from("teams")
        .update({ name: name || managerName })
        .eq("id", existing.id)
        .select("id");
      if (error || !data?.length) {
        return toast({
          title: "Falha ao salvar",
          description: error
            ? describeError(error, "Não foi possível salvar o nome da equipe.")
            : "Nenhuma linha foi alterada — a equipe pode pertencer a outra diretoria.",
          variant: "destructive",
        });
      }
      setTeamsByMgr(p => ({ ...p, [managerId]: { ...existing, display_name: name || null } }));
    } else {
      // `createTeamForManager` insere o gerente em `team_members` junto com a
      // equipe: sem essa segunda linha `auth_visible_profiles()` não alcança o
      // gerente e o DIRETOR deixa de enxergá-lo — sem nenhum aviso.
      const teamName = name || managerName;
      // A equipe nasce COM diretoria. Para o admin `meuPerfilId` é null, então
      // toda equipe criada por ele nascia órfã — e equipe órfã é adotável por
      // um diretor (`teams_admin_write`). O diretor certo é o que a hierarquia
      // do gerente já diz; quando ele ainda não tem nenhum, o aviso abaixo diz
      // o que falta em vez de deixar a equipe à espera de quem chegar antes.
      const directorId = isAdmin ? manager.director_id ?? null : meuPerfilId;
      try {
        const id = await createTeamForManager(managerId, teamName, slugify(teamName), directorId);
        setTeamsByMgr(p => ({ ...p, [managerId]: { id, display_name: name || null } }));
      } catch (error: unknown) {
        return toast({ title: "Falha ao criar equipe", description: describeError(error, "Não foi possível criar a equipe."), variant: "destructive" });
      }
      if (!directorId) {
        return toast({
          title: "Equipe criada sem diretoria",
          description: `Vincule ${managerName} a um diretor em "Vincular em massa" na coluna Gerentes — sem isso a equipe fica fora de qualquer diretoria.`,
        });
      }
    }
    toast({ title: "Nome da equipe salvo" });
  };

  useEffect(() => { load(); }, []);


  const directors = useMemo(() => rows.filter(r => r.role === "director"), [rows]);
  const managers = useMemo(() => rows.filter(r => r.role === "manager"), [rows]);
  const brokers = useMemo(() => rows.filter(r => r.role === "broker"), [rows]);
  const ccas = useMemo(() => rows.filter(r => r.role === "cca"), [rows]);
  /**
   * Administrador, SDR, Marketing e Sócio não cabem em nenhuma das quatro
   * colunas e SUMIAM da tela: o admin não achava o próprio card e, pior, marcar
   * "SDR" e desmarcar "Corretor" na ficha fazia a pessoa desaparecer — sem
   * caminho nenhum para reabrir a ficha dela.
   */
  const outros = useMemo(() => rows.filter(r => !COLUNAS.has(r.role)), [rows]);

  // "meu perfil": broker vinculado ao user logado
  const myBroker = useMemo(() => rows.find(r => r.user_id === user?.id) || null, [rows, user]);
  const myBrokerId = myBroker?.id ?? null;

  /**
   * Nome de alguém da hierarquia, esteja ele na lista ou não.
   *
   * `rows` é recortada por `auth_visible_profiles()`, que NÃO sobe a hierarquia:
   * para o corretor ela devolve uma linha só. Era por isso que TODO card de
   * corretor escrevia "Sem gerente" e "Meu Perfil" mostrava "Gerente —" com o
   * vínculo existindo no banco. A view `team_leader_names` (0079) completa o
   * que falta com nome e nada mais.
   */
  const nomeDe = useCallback(
    (id: string | null | undefined): string | null =>
      id ? rows.find(r => r.id === id)?.name ?? leaderNames.get(id) ?? null : null,
    [rows, leaderNames],
  );

  /**
   * Quem LIDERA a equipe do alvo administra os membros abertos dela — o gerente
   * e também o DIRETOR, porque `auth_led_team_ids()` casa `manager_id` ou
   * `director_id`.
   *
   * É o que `manages_profile()` diz, e é o predicado de `profiles_manager_update`
   * e do ramo intermediário de `profiles_guard_admin_columns` (pode mudar
   * situação; não pode mexer em e-mail de acesso nem em bypass de IP). A regra
   * mora em `people.ts` para ter teste — aqui era JSX sem verificação nenhuma.
   */
  const gestorDoAlvo = (person: { id: string; manager_id?: string | null; director_id?: string | null }) =>
    leadsProfile(myBrokerId, effectiveRoles, person);

  const podeEditarFicha = (person: BrokerRow) =>
    canEdit || gestorDoAlvo(person);

  /** Rótulo do superior: sem vínculo, com vínculo e nome, ou vínculo sem nome. */
  const rotuloSuperior = (id: string | null, semVinculo: string) => {
    if (!id) return { texto: semVinculo, temSuperior: false };
    const nome = nomeDe(id);
    return nome
      ? { texto: `↑ ${nome}`, temSuperior: true }
      : { texto: "↑ vínculo fora do seu acesso", temSuperior: true };
  };

  /** Diretor que cria equipe entra como diretor dela — `teams_admin_write` (0061) exige. */
  const meuPerfilId = effectiveRoles.includes("director") && !isAdmin ? myBroker?.id ?? null : null;

  // Director "scope": diretor vê só a própria subárvore. Admin não é recortado;
  // sob prévia de "diretor" ele passa a ser, que é o efeito que a prévia existe
  // para mostrar. Booleano, e não o array, para o useMemo abaixo ter dependência
  // estável entre renders.
  const scopedToOwnSubtree = !isAdmin && effectiveRoles.includes("director");
  const myScopeDirectorId = useMemo(
    () => (scopedToOwnSubtree ? myBroker?.id ?? null : null),
    [scopedToOwnSubtree, myBroker],
  );

  /**
   * Recorte da subárvore do diretor — e só dele.
   *
   * Para os demais papéis o recorte já veio do banco: `profiles_select` é
   * `id in (select auth_visible_profiles())`, então gerente vê a equipe,
   * corretor vê a si mesmo e parceiro vê todo mundo por decisão da própria
   * função (0002). Repetir a regra aqui devolvia `false` para todos eles e a
   * hierarquia abria em branco — sem dado a mais e sem explicação a menos.
   */
  const inScope = useCallback((b: BrokerRow) => {
    if (!myScopeDirectorId) return true;
    if (b.role === "director") return b.id === myScopeDirectorId;
    return b.director_id === myScopeDirectorId;
  }, [myScopeDirectorId]);

  const filter = (list: BrokerRow[]) =>
    list.filter(b => (search ? b.name.toLowerCase().includes(search.toLowerCase()) : true));

  const visibleDirectors = filter(directors).filter(inScope);
  const visibleManagers = filter(managers).filter(inScope);
  const visibleBrokers = filter(brokers).filter(inScope);
  // CCA não pertence à subárvore de um diretor (não tem equipe); quem recorta a
  // lista é só a RLS, como já era antes do recorte por escopo existir.
  const visibleCcas = filter(ccas);

  /** Coluna vazia precisa dizer por quê: busca sem resultado é diferente de escopo vazio. */
  const emptyLabel = (papel: string) =>
    search ? `Nenhum ${papel} com esse nome.` : `Nenhum ${papel} visível para o seu acesso.`;

  const openEdit = async (_type: "manager" | "broker", m: BrokerRow) => {
    const { data } = await supabase.from("profiles")
      .select("id,full_name,email,phone,avatar_url,status")
      .eq("id", m.id).maybeSingle();
    const merged: EditableBroker = {
      id: data?.id ?? m.id,
      full_name: data?.full_name,
      email: data?.email,
      avatar_url: data?.avatar_url,
      name: data?.full_name ?? m.name,
      celular: data?.phone,
      role: m.role,
      manager_id: m.manager_id,
      director_id: m.director_id,
      active: data?.status === "active",
      status: (data?.status ?? m.status) as EditableBroker["status"],
      user_id: m.user_id,
      login_email: data?.email,
      // `true` aqui nascia com "Atualizar e-mail de acesso" já liberado, e o
      // gate de confirmação só valia para quem tinha acabado de ser criado.
      // Trocar o e-mail do login é uma ação de um clique e sem volta fácil.
      login_email_confirmed: false,
    };
    setProfileEdit(merged);
  };

  const openBulk = (column: "manager" | "broker") => {
    setBulk({ column }); setBulkTarget(""); setBulkSelected(new Set()); setBulkFilter("");
    setConfirmarSaida(false);
  };

  useEffect(() => {
    if (!bulk || !bulkTarget) { setBulkSelected(new Set()); return; }
    const preSelected = bulk.column === "broker"
      ? brokers.filter(b => b.manager_id === bulkTarget).map(b => b.id)
      : managers.filter(m => m.director_id === bulkTarget).map(m => m.id);
    setBulkSelected(new Set(preSelected));
  }, [bulk, bulkTarget, brokers, managers]);

  const applyBulk = async () => {
    // Seleção vazia continua valendo para corretores: significa "esta equipe
    // fica sem ninguém". Para diretoria não há o que aplicar sem alvo marcado.
    if (!bulk || !bulkTarget) return;
    if (bulk.column === "manager" && bulkSelected.size === 0) return;
    setSaving(true);
    const ids = Array.from(bulkSelected);
    /**
     * Sair do diálogo depois de uma falha PARCIAL.
     *
     * Os três `return toast(...)` do laço abaixo saíam sem `setBulk(null)` e sem
     * `load()` — depois de já terem gravado `left_at` e/ou inserido linhas. A
     * tela continuava mostrando a seleção velha, e aplicar de novo repetia a
     * parte que já tinha passado. Toda saída de erro recarrega, como o ramo de
     * desligamento já fazia.
     */
    const falha = (title: string, description: string) => {
      setSaving(false);
      setBulk(null);
      load();
      return toast({ title, description, variant: "destructive" as const });
    };
    if (bulk.column === "broker") {
      // Mesma resolução da ficha (`setTeamByManager`): um gerente pode ter mais
      // de uma equipe ativa pelo schema, e `maybeSingle()` transformava isso em
      // "Não foi possível carregar a equipe do gerente" — erro sem instrução.
      let targetTeamId: string;
      try {
        targetTeamId = await activeTeamIdOfManager(bulkTarget);
      } catch (error: unknown) {
        setSaving(false);
        return toast({ title: "Falha ao vincular", description: describeError(error, "Não foi possível carregar a equipe do gerente."), variant: "destructive" });
      }
      // Desligar é parte do "marque quem deve pertencer a ele": quem estava na
      // equipe e foi DESMARCADO sai. Antes o diálogo só inseria, então tirar
      // alguém de uma equipe não tinha caminho em tela nenhuma.
      const hoje = new Date().toISOString().slice(0, 10);
      const membrosAtuais = brokers.filter(b => b.manager_id === bulkTarget).map(b => b.id);
      const desligar = membrosAtuais.filter(id => !bulkSelected.has(id));

      // Quantos o BANCO confirmou. `team_members_manage` exige
      // `has_permission('teams.manage')`: revogar a permissão vale na hora e a
      // sessão do gerente só relê no F5 — sem contar a linha devolvida o toast
      // anunciaria desligamentos que não aconteceram.
      let saiu = 0;
      if (desligar.length) {
        const saida = await supabase
          .from("team_members")
          .update({ left_at: hoje })
          .in("profile_id", desligar)
          .eq("team_id", targetTeamId)
          .is("left_at", null)
          .select("id");
        if (saida.error) {
          return falha("Falha ao desligar", describeError(saida.error, "Não foi possível desligar o corretor da equipe."));
        }
        saiu = saida.data?.length ?? 0;
        if (saiu < desligar.length) {
          return falha(
            `${saiu} de ${desligar.length} desligamento(s) aplicados`,
            "O banco recusou o restante — a permissão \"Gerenciar equipes\" pode ter sido revogada, ou o corretor já saiu por outra tela.",
          );
        }
      }

      for (const profileId of ids) {
        if (membrosAtuais.includes(profileId)) continue; // já está nesta equipe
        // Fecha o vínculo anterior em QUALQUER equipe, inclusive uma que este
        // gerente não lidera. Nesse caso a RLS casa 0 linhas em silêncio e o
        // insert seguinte estoura `team_members_one_active` (23505), que vira
        // "Já existe um registro com esses dados." — frase que não diz nada.
        const fecha = await supabase
          .from("team_members")
          .update({ left_at: hoje })
          .eq("profile_id", profileId)
          .is("left_at", null)
          .select("id");
        if (fecha.error) {
          return falha("Falha ao vincular", describeError(fecha.error, "Não foi possível encerrar o vínculo anterior."));
        }
        const jaTinhaEquipe = brokers.some(b => b.id === profileId && b.manager_id);
        if (jaTinhaEquipe && !fecha.data?.length) {
          return falha(
            "Falha ao vincular",
            `${brokers.find(b => b.id === profileId)?.name ?? "O corretor"} pertence a uma equipe que você não administra — peça ao administrador para transferi-lo.`,
          );
        }
        const { error } = await supabase
          .from("team_members")
          .insert({ team_id: targetTeamId, profile_id: profileId });
        if (error) {
          return falha("Falha ao vincular", describeError(error, "Não foi possível vincular o corretor à equipe."));
        }
      }

      setSaving(false);
      toast({
        title: saiu
          ? `${ids.length} vínculo(s) e ${saiu} desligamento(s) aplicados`
          : `${ids.length} vínculo(s) atualizados`,
      });
      setBulk(null);
      load();
      return;
    } else {
      // O diretor mora na equipe do gerente: quem ainda não tem equipe não casa
      // linha nenhuma e o update volta 204 sem erro. Sem pedir a linha de volta
      // o toast verde mentiria — mesmo defeito já fechado no GoalRow.
      const { data, error } = await supabase
        .from("teams")
        .update({ director_id: bulkTarget })
        .in("manager_id", ids)
        // Só a equipe ATIVA conta: `auth_led_team_ids()` exige `active`, então
        // gravar diretoria numa equipe desativada casaria a linha e a
        // hierarquia continuaria sem diretor — o mesmo defeito que
        // `setDirectorOfManagedTeams` já fechou na ficha.
        .eq("active", true)
        .select("manager_id");
      if (error) { setSaving(false); return toast({ title: "Falha ao vincular", description: describeError(error, "Não foi possível vincular o gerente à diretoria."), variant: "destructive" }); }
      const updated = new Set((data ?? []).map(row => row.manager_id));
      const missing = ids.filter(id => !updated.has(id));
      if (missing.length) {
        const names = missing.map(id => managers.find(m => m.id === id)?.name ?? id).join(", ");
        setSaving(false);
        setBulk(null);
        load();
        return toast({
          title: missing.length === ids.length
            ? "Nenhum vínculo gravado"
            : `${ids.length - missing.length} de ${ids.length} vínculo(s) atualizados`,
          description: `Não gravou para: ${names}. Ou o gerente ainda não tem equipe — preencha o campo "Equipe" dele na coluna Gerentes — ou a equipe já pertence a outra diretoria, e só o administrador a transfere.`,
          variant: "destructive",
        });
      }
    }
    setSaving(false);
    toast({ title: `${ids.length} vínculo(s) atualizados` });
    setBulk(null);
    load();
  };

  // O gerente só administra a PRÓPRIA equipe (`auth_led_team_ids` na policy),
  // então o seletor de superior mostra só ele — oferecer outro gerente seria
  // um botão que o banco recusa.
  const bulkOptions = bulk?.column === "broker"
    ? (canEdit ? managers : managers.filter(m => m.id === myBroker?.id))
    : directors;
  const bulkList = filter(bulk?.column === "broker" ? brokers : managers).filter(b => inScope(b));
  const bulkFiltered = bulkList.filter(b => b.name.toLowerCase().includes(bulkFilter.toLowerCase()));

  /**
   * Quem SAI da equipe se o diálogo for aplicado assim.
   *
   * `applyBulk` desliga todo membro atual que não estiver marcado, e a lista de
   * membros é a COMPLETA — não a filtrada. Sem esta conta na tela, filtrar por
   * "jo", clicar em "Todos" e aplicar tirava os outros oito da equipe, e o
   * único aviso era o toast depois do fato.
   */
  const saindoDaEquipe = bulk?.column === "broker" && bulkTarget
    ? brokers.filter(b => b.manager_id === bulkTarget && !bulkSelected.has(b.id))
    : [];

  // Team performance
  const teamStats = useMemo(() => {
    return managers.filter(inScope).map(m => {
      const team = brokers.filter(b => b.manager_id === m.id);
      return { manager: m, director: nomeDe(m.director_id), size: team.length, brokers: team };
    }).sort((a, b) => b.size - a.size);
  }, [managers, brokers, inScope, nomeDe]);

  return (
    <div className="space-y-6">
      {/* O <h1> sai do kit (regra 2 de docs/design-system.md): escrito à mão
          aqui, ele ficava em `text-xl` contra o `text-2xl sm:text-3xl` das
          outras 17 telas. */}
      <PageHeader
        title="Equipes"
        icon={Users}
        description="Perfil, hierarquia e performance — tudo em uma tela"
        className="mb-0"
        actions={
          <>
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
              <Input
                placeholder="Buscar pessoa..."
                aria-label="Buscar pessoa"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8 h-8 text-xs w-64 max-w-full"
              />
            </div>
            {/* Criar usuário exige service role: quem cria é a edge function, e
                ela recusa quem não é admin. O botão segue a mesma regra em vez
                de aparecer para falhar depois. */}
            {isAdmin && (
              <Button size="sm" className="h-8 text-xs" onClick={() => setCreating(true)}>
                <UserPlus className="h-3.5 w-3.5 mr-1" /> Novo colaborador
              </Button>
            )}
          </>
        }
      />

      {/* Meta global: mesma regra de escrita da RLS (admin e diretor) */}
      {canEdit && <GlobalGoalCard />}

      {/* Meu Perfil */}
      <Card className="glass border-primary/30" role="region" aria-label="Meu Perfil">
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <User className="h-4 w-4 text-primary" /> Meu Perfil
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {loading ? (
            <LoadingState variant="list" rows={1} label="Carregando seu perfil…" />
          ) : loadError ? (
            // Sem este ramo, falha de carga virava "Seu usuário não está
            // vinculado a um corretor cadastrado" — a mesma acusação falsa já
            // corrigida nas quatro colunas do organograma logo abaixo.
            <p className="text-xs text-destructive">Não foi possível carregar seu perfil. Use "Tentar de novo" abaixo.</p>
          ) : myBroker ? (
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-primary/20 flex items-center justify-center text-lg font-bold text-primary">
                {initials(myBroker.name)}
              </div>
              <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div><span className="text-muted-foreground">Nome</span><p className="font-medium">{myBroker.name}</p></div>
                <div><span className="text-muted-foreground">Função</span><p className="font-medium">{ROTULO_PAPEL[myBroker.role] ?? myBroker.role}</p></div>
                <div><span className="text-muted-foreground">Gerente</span><p className="font-medium">{nomeDe(myBroker.manager_id) ?? "—"}</p></div>
                <div><span className="text-muted-foreground">Diretor</span><p className="font-medium">{nomeDe(myBroker.director_id) ?? "—"}</p></div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Seu usuário não está vinculado a um corretor cadastrado.</p>
          )}
        </CardContent>
      </Card>

      {/* Hierarquia */}
      {/* Um gate só. Fora dele, "Nenhum … visível para o seu acesso" apareceria
          no primeiro paint, antes de qualquer consulta voltar. */}
      {loading ? (
        <LoadingState variant="list" rows={4} label="Carregando equipes…" />
      ) : loadError ? (
        // Sem isto, falha de rede virava "Nenhum diretor visível para o seu
        // acesso" nas quatro colunas — a tela culpava a permissão do usuário
        // por um erro que não era dele, e o único sinal já tinha sumido no toast.
        <EmptyState
          icon={AlertTriangle}
          tone="danger"
          title="Não foi possível carregar as equipes"
          description={`${loadError} As colunas abaixo ficariam vazias por engano, então não são mostradas.`}
          action={<Button size="sm" onClick={load}>Tentar de novo</Button>}
        />
      ) : (
        <>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Diretores */}
          <Card className="border-info/30" role="region" aria-label="Diretores">
            <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
              <CardTitle className="text-sm text-info flex items-center gap-2">
                <Crown className="h-4 w-4" /> Diretores ({visibleDirectors.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-2 max-h-[520px] overflow-y-auto">
              {visibleDirectors.length === 0 && (
                <p className="text-xs text-muted-foreground">{emptyLabel("diretor")}</p>
              )}
              {visibleDirectors.map(d => {
                const dirManagers = managers.filter(m => m.director_id === d.id);
                const sumMonthly = dirManagers.reduce((s, m) => s + Number(m.monthly_goal || 0), 0);
                const sumYearly = dirManagers.reduce((s, m) => s + Number(m.yearly_goal || 0), 0);
                const monthsLeft = 12 - new Date().getMonth();
                const perMonthLeft = sumYearly > 0 ? sumYearly / 12 : 0;
                return (
                  <div key={d.id} className="p-2 rounded-lg border border-border/30 bg-info/5 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-info/20 flex items-center justify-center text-xs font-bold text-info">{initials(d.name)}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{d.name}</p>
                        <PapeisExtras roles={d.roles} principal={d.role} />
                      </div>
                      <StatusPessoa status={d.status} />
                      <Badge variant="outline" className="border-info/30 text-info">{dirManagers.length} ger.</Badge>
                      {podeEditarFicha(d) && (
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" aria-label={`Editar ficha de ${d.name}`} onClick={() => openEdit("manager", d)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-xs">
                      <div className="p-1.5 rounded bg-background/60 border border-border/30">
                        <p className="text-eyebrow">Meta mês (Σ ger.)</p>
                        <p className="font-bold text-info">{brl(sumMonthly)}</p>
                      </div>
                      <div className="p-1.5 rounded bg-background/60 border border-border/30">
                        <p className="text-eyebrow">Meta ano (Σ ger.)</p>
                        <p className="font-bold text-info">{brl(sumYearly)}</p>
                      </div>
                    </div>
                    {sumYearly > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Meses restantes: <strong className="text-foreground">{monthsLeft}</strong> · Ritmo/mês: <strong className="text-foreground">{brl(perMonthLeft)}</strong>
                      </p>
                    )}
                    <CredLine id={d.id} />

                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Gerentes */}
          <Card className="border-info/30" role="region" aria-label="Gerentes">
            <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
              <CardTitle className="text-sm text-info flex items-center gap-2">
                <UserCog className="h-4 w-4" /> Gerentes ({visibleManagers.length})
              </CardTitle>
              {canEdit && (
                <Button size="sm" variant="outline" className="h-7 text-xs border-info/40 text-info" onClick={() => openBulk("manager")}>
                  <Link2 className="h-3 w-3 mr-1" /> Vincular em massa
                </Button>
              )}
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-2 max-h-[520px] overflow-y-auto">
              {visibleManagers.length === 0 && (
                <p className="text-xs text-muted-foreground">{emptyLabel("gerente")}</p>
              )}
              {visibleManagers.map(m => {
                const superior = rotuloSuperior(m.director_id, "Sem diretor");
                const equipe = teamsByMgr[m.id];
                return (
                  <div key={m.id} className="p-2 rounded-lg border border-border/30 bg-info/5 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-info/20 flex items-center justify-center text-xs font-bold text-info">{initials(m.name)}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{m.name}</p>
                        <p className={cn("text-xs truncate", superior.temSuperior ? "text-info" : "text-muted-foreground")}>
                          {superior.texto}
                        </p>
                        <PapeisExtras roles={m.roles} principal={m.role} />
                      </div>
                      <StatusPessoa status={m.status} />
                      <Badge variant="outline" className="border-info/30 text-info">
                        {brokers.filter(b => b.manager_id === m.id).length}
                      </Badge>
                      {podeEditarFicha(m) && (
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" aria-label={`Editar ficha de ${m.name}`} onClick={() => openEdit("manager", m)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                    {canEdit && (
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="text-eyebrow shrink-0">Equipe</span>
                        <Input
                          aria-label={`Nome da equipe de ${m.name}`}
                          value={teamNameDrafts[m.id] ?? ""}
                          onChange={(e) => setTeamNameDrafts(p => ({ ...p, [m.id]: e.target.value }))}
                          onBlur={() => {
                            const current = teamsByMgr[m.id]?.display_name ?? "";
                            if ((teamNameDrafts[m.id] ?? "") !== current) void saveTeamName(m);
                          }}
                          placeholder={`Equipe ${m.name.split(" ")[0]}`}
                          className="h-6 text-xs px-2 min-w-0 flex-1 basis-24"
                        />
                        {/* A saída que faltava. `activeTeamIdOfManager` manda
                            "desative as que sobram" quando o gerente tem mais de
                            uma equipe ativa, e não havia NENHUM caminho na
                            interface para desativar equipe — o vínculo em massa
                            ficava travado sem solução. */}
                        {/* `canManageMembers` e não `canEdit`: desativar precisa
                            das DUAS escritas — `teams` (diretor da equipe) e
                            `team_members` (`has_permission('teams.manage')`).
                            Para o diretor com a permissão revogada o botão some
                            em vez de fechar meio caminho. */}
                        {equipe && canManageMembers && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-xs text-destructive"
                            aria-label={`Desativar a equipe de ${m.name}`}
                            onClick={() => setDesativar({
                              teamId: equipe.id,
                              managerName: m.name,
                              membros: brokers.filter(b => b.manager_id === m.id).length,
                            })}
                          >
                            Desativar
                          </Button>
                        )}
                      </div>
                    )}
                    {canEdit && <GoalRow broker={m} onSaved={load} />}
                    <CredLine id={m.id} />
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Corretores */}
          <Card className="border-success/30" role="region" aria-label="Corretores">
            <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
              <CardTitle className="text-sm text-success flex items-center gap-2">
                <Users className="h-4 w-4" /> Corretores ({visibleBrokers.length})
              </CardTitle>
              {canManageMembers && (
                <Button size="sm" variant="outline" className="h-7 text-xs border-success/40 text-success" onClick={() => openBulk("broker")}>
                  <Link2 className="h-3 w-3 mr-1" /> Vincular em massa
                </Button>
              )}
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-2 max-h-[520px] overflow-y-auto">
              {visibleBrokers.length === 0 && (
                <p className="text-xs text-muted-foreground">{emptyLabel("corretor")}</p>
              )}
              {visibleBrokers.map(b => {
                const superior = rotuloSuperior(b.manager_id, "Sem gerente");
                return (
                  <div key={b.id} className="p-2 rounded-lg border border-border/30 bg-success/5 space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-success/20 flex items-center justify-center text-xs font-bold text-success">{initials(b.name)}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{b.name}</p>
                        <p className={cn("text-xs truncate", superior.temSuperior ? "text-info" : "text-muted-foreground")}>
                          {superior.texto}
                        </p>
                        <PapeisExtras roles={b.roles} principal={b.role} />
                      </div>
                      <StatusPessoa status={b.status} />
                      {podeEditarFicha(b) && (
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" aria-label={`Editar ficha de ${b.name}`} onClick={() => openEdit("broker", b)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                    {/* Meta de VGV do corretor: `goals_write` é admin e diretor,
                        a mesma regra de `canEdit` que já vale para o gerente. */}
                    {canEdit && <GoalRow broker={b} onSaved={load} />}
                    <CredLine id={b.id} />
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>

      {/* CCAs */}
      <Card className="border-warning/30" role="region" aria-label="CCAs">
        <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
          <CardTitle className="text-sm text-warning flex items-center gap-2">
            <Shield className="h-4 w-4" /> CCAs ({visibleCcas.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {visibleCcas.map(c => (
            <div key={c.id} className="p-2 rounded-lg border border-border/30 bg-warning/5 space-y-1">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-warning/20 flex items-center justify-center text-xs font-bold text-warning">{initials(c.name)}</div>
                <p className="text-xs font-medium flex-1 truncate">{c.name}</p>
                <StatusPessoa status={c.status} />
                {podeEditarFicha(c) && (
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" aria-label={`Editar ficha de ${c.name}`} onClick={() => openEdit("broker", c)}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                )}
              </div>
              <CredLine id={c.id} />
            </div>
          ))}
          {visibleCcas.length === 0 && (
            <p className="text-xs text-muted-foreground col-span-full">
              {emptyLabel("CCA")}
              {!search && isAdmin && " Cadastre a pessoa em \"Novo colaborador\" e marque a função CCA na ficha."}
            </p>
          )}
        </CardContent>
      </Card>


      {/* Outros papéis — quem não entra no organograma continua alcançável.
          Uma pessoa sumia da tela pelo próprio ato de receber o papel certo
          (marcar SDR e desmarcar Corretor) e não havia como reabrir a ficha. */}
      <Card className="border-border/50" role="region" aria-label="Outros papéis">
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <IdCard className="h-4 w-4 text-muted-foreground" /> Outros papéis ({filter(outros).length})
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {filter(outros).map(o => (
            <div key={o.id} className="p-2 rounded-lg border border-border/30 bg-secondary/20 space-y-1">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-xs font-bold">{initials(o.name)}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{o.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {o.roles.map(r => ROTULO_PAPEL[r] ?? r).join(", ")}
                  </p>
                </div>
                <StatusPessoa status={o.status} />
                {podeEditarFicha(o) && (
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" aria-label={`Editar ficha de ${o.name}`} onClick={() => openEdit("broker", o)}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                )}
              </div>
              <CredLine id={o.id} />
            </div>
          ))}
          {filter(outros).length === 0 && (
            <p className="text-xs text-muted-foreground col-span-full">
              {search ? "Ninguém com esse nome fora do organograma." : "Administrador, SDR, Marketing e Sócio aparecem aqui quando existirem."}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Auditoria: as duas tabelas existiam, com policy de leitura só para
          admin, e nenhuma tela as mostrava. */}
      {isAdmin && <TrilhaAcesso />}

      {/* Performance por Equipe */}
      <Card className="glass">
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" /> Performance por Equipe
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
            {teamStats.map(t => (
              <div key={t.manager.id} className="shrink-0 w-[280px] snap-start p-3 rounded-lg border border-border/30 bg-secondary/20">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-full bg-info/20 flex items-center justify-center text-xs font-bold text-info">{initials(t.manager.name)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate">{t.manager.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{t.director ?? "—"}</p>
                  </div>
                  <Badge className="bg-success/20 text-success border-success/30 shrink-0">{t.size}</Badge>
                </div>
                <div className="flex flex-wrap gap-1">
                  {t.brokers.map(b => (
                    <span key={b.id} className="text-xs px-2 py-0.5 rounded-full bg-secondary/40 border border-border/30">{b.name.split(" ")[0]}</span>
                  ))}
                  {t.brokers.length === 0 && <span className="text-xs text-muted-foreground">Sem corretores</span>}
                </div>
              </div>
            ))}
            {teamStats.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma equipe visível para o seu acesso.</p>}
          </div>
        </CardContent>
      </Card>
      </>
      )}

      {/* Cadastro de colaborador — abre a ficha em seguida para o admin definir
          função e equipe, que o provisionamento não decide. */}
      <NewPersonDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(person) => {
          setCreating(false);
          load();
          // Só o que a função devolveu. Papel, equipe, diretor e status a ficha
          // relê do banco (`getPersonDetails`): este mesmo callback atende o
          // 409 de e-mail já em uso, onde a pessoa JÁ existe — chutar
          // `active: true` abria o Switch ligado para quem estava suspenso e
          // deixava a reativação sem caminho.
          setProfileEdit({
            id: person.id,
            name: person.full_name,
            full_name: person.full_name,
            email: person.email,
            login_email: person.email,
            // Quem acabou de nascer teve o endereço digitado e conferido agora;
            // ficha de gente que já existia volta ao gate de confirmação.
            login_email_confirmed: !person.existing,
            user_id: person.id,
          });
        }}
      />

      {/* Ficha do colaborador. `provision()` troca o e-mail sem fechar o modal
          (o admin precisa ver o endereço), então recarregar no fechamento é o
          que impede o card de ficar com o e-mail antigo até um F5. */}
      <BrokerEditModal
        open={!!profileEdit}
        broker={profileEdit}
        managers={managers.map(m => ({ id: m.id, name: m.name }))}
        directors={directors.map(d => ({ id: d.id, name: d.name }))}
        isAdmin={isAdmin}
        // Suspender/desligar é do admin e de quem LIDERA a equipe do alvo —
        // gerente OU diretor dela (`profiles_guard_admin_columns` deixa o ramo
        // `manages_profile` mexer em `status`, e `auth_led_team_ids()` casa os
        // dois). Para os demais o Switch ficava na tela e o banco devolvia
        // 42501 — inclusive para o diretor editando a PRÓPRIA ficha, que segue
        // de fora.
        podeMudarSituacao={isAdmin || (!!profileEdit && gestorDoAlvo({ id: profileEdit.id, manager_id: profileEdit.manager_id, director_id: profileEdit.director_id }))}
        onClose={() => { setProfileEdit(null); load(); }}
        onSaved={() => { setProfileEdit(null); load(); }}
      />


      {/* Bulk assign dialog */}
      <Dialog open={!!bulk} onOpenChange={(o) => !o && setBulk(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <Link2 className="h-4 w-4" />
              {bulk?.column === "broker" ? "Vincular corretores a um gerente" : "Vincular gerentes a um diretor"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              1) Escolha o superior. 2) Marque quem deve pertencer a ele. 3) Aplique.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Select value={bulkTarget} onValueChange={setBulkTarget}>
              <SelectTrigger className="text-xs">
                <SelectValue placeholder={bulk?.column === "broker" ? "Escolher gerente..." : "Escolher diretor..."} />
              </SelectTrigger>
              <SelectContent>
                {bulkOptions.filter(inScope).map(o => (
                  <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {bulkTarget && (
              <>
                <div className="relative">
                  <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                  <Input placeholder="Filtrar..." value={bulkFilter} onChange={e => setBulkFilter(e.target.value)} className="pl-8 h-8 text-xs" />
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{bulkSelected.size} selecionado(s) de {bulkFiltered.length}</span>
                  <div className="flex gap-2">
                    {/* SOMA à seleção. Substituir era inofensivo enquanto o
                        diálogo só inseria; com o desligamento de quem fica
                        desmarcado, "Todos" com filtro digitado tirava da equipe
                        justamente quem o filtro escondeu. */}
                    <button
                      type="button"
                      className="hover:text-primary"
                      onClick={() => setBulkSelected(prev => new Set([...prev, ...bulkFiltered.map(b => b.id)]))}
                    >
                      Todos
                    </button>
                    <button type="button" className="hover:text-primary" onClick={() => setBulkSelected(new Set())}>Nenhum</button>
                  </div>
                </div>

                {saindoDaEquipe.length > 0 && (
                  <p role="status" className="rounded-md border border-warning/30 bg-warning/5 px-2 py-1.5 text-xs text-warning">
                    Ao aplicar, {saindoDaEquipe.length === 1 ? "sai da equipe" : "saem da equipe"}:{" "}
                    {saindoDaEquipe.map(b => b.name).join(", ")}.
                  </p>
                )}
                <ScrollArea className="h-72 rounded-md border border-border/40">
                  <div className="divide-y divide-border/30">
                    {bulkFiltered.map(m => {
                      const checked = bulkSelected.has(m.id);
                      return (
                        // O Checkbox do Radix é um `button` VAZIO: envolvê-lo num
                        // `<label>` não lhe dá nome nenhum, e o leitor de tela
                        // ouvia "caixa de seleção" sem saber de quem —
                        // justamente onde desmarcar DESLIGA a pessoa da equipe.
                        // Mesmo remédio de ConvertLeadDialog: id + Label htmlFor.
                        <div key={m.id} className="flex items-center gap-2 p-2 hover:bg-secondary/40 text-xs">
                          <Checkbox
                            id={`bulk-${m.id}`}
                            aria-label={m.name}
                            checked={checked}
                            onCheckedChange={(v) => {
                              setBulkSelected(prev => {
                                const next = new Set(prev);
                                if (v) next.add(m.id);
                                else next.delete(m.id);
                                return next;
                              });
                            }}
                          />
                          <div className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center text-xs font-bold" aria-hidden>{initials(m.name)}</div>
                          <Label htmlFor={`bulk-${m.id}`} className="flex-1 truncate cursor-pointer text-xs font-normal">
                            {m.name}
                          </Label>
                          {bulk?.column === "broker" && m.manager_id && m.manager_id !== bulkTarget && (
                            <span className="text-xs text-warning">
                              já em {managers.find(x => x.id === m.manager_id)?.name.split(" ")[0]}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setBulk(null)}>Cancelar</Button>
            {/* Desligamento é a única parte irreversível deste diálogo (grava
                `left_at`): quando houver algum, o clique passa pela confirmação
                nominal em vez de aplicar direto. */}
            <Button
              size="sm"
              onClick={() => (saindoDaEquipe.length ? setConfirmarSaida(true) : void applyBulk())}
              disabled={saving || !bulkTarget || (bulk?.column === "manager" && bulkSelected.size === 0)}
            >
              {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Aplicar ({bulkSelected.size})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmarSaida} onOpenChange={setConfirmarSaida}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm">
              {saindoDaEquipe.length === 1 ? "1 corretor sai da equipe" : `${saindoDaEquipe.length} corretores saem da equipe`}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              Quem não está marcado é desligado da equipe hoje: {saindoDaEquipe.map(b => b.name).join(", ")}.
              Os leads e negócios continuam com cada um; o que muda é o vínculo com o gerente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs">Voltar e revisar</AlertDialogCancel>
            <AlertDialogAction className="text-xs" onClick={() => { setConfirmarSaida(false); void applyBulk(); }}>
              Aplicar e desligar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Desativar equipe. `auth_led_team_ids()` exige `t.active`, então isto
          CEGA o gerente e o diretor para os membros dela na hora — a frase
          abaixo diz isso antes do clique, e os vínculos abertos são fechados
          junto para ninguém ficar preso a uma equipe que não existe mais. */}
      <AlertDialog open={!!desativar} onOpenChange={(o) => !o && setDesativar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm">
              Desativar a equipe de {desativar?.managerName}?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              {desativar?.membros
                ? `Os ${desativar.membros} corretor(es) saem da equipe hoje e ficam sem gerente até serem vinculados a outra`
                : "A equipe não tem corretores"}
              {` — e ${desativar?.managerName} também deixa a equipe que liderava. `}
              Depois de desativada, ela some da hierarquia e o gerente e o diretor deixam de
              enxergar quem estava nela. Leads e negócios continuam com cada pessoa.
              É reversível só pelo banco — a tela não reativa equipe.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs">Voltar</AlertDialogCancel>
            <AlertDialogAction
              className="text-xs"
              onClick={() => {
                const alvo = desativar;
                setDesativar(null);
                if (!alvo) return;
                void (async () => {
                  try {
                    const saiu = await deactivateTeam(alvo.teamId);
                    toast({
                      title: "Equipe desativada",
                      description: saiu ? `${saiu} vínculo(s) encerrado(s).` : undefined,
                    });
                  } catch (error: unknown) {
                    toast({
                      title: "Falha ao desativar",
                      description: describeError(error, "Não foi possível desativar a equipe."),
                      variant: "destructive",
                    });
                  } finally {
                    load();
                  }
                })();
              }}
            >
              Desativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
