import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Users, Link2, Search, Crown, Shield, UserCog, User, Loader2, UserPlus, AlertTriangle, IdCard } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { slugify } from "@/lib/utils";
import { dbError, describeError } from "@/lib/supabaseError";
import { listPeople } from "@/integrations/supabase/newSchema";
import { activeTeamIdOfManager, createTeamForManager, deactivateTeam, leadsProfile, listTeamLeaderNames } from "@/integrations/supabase/people";

import { EmptyState, LoadingState, PageHeader } from "@/components/shared";

import { BrokerEditModal, type EditableBroker } from "@/components/BrokerEditModal";
import { GlobalGoalCard } from "@/components/equipes/GlobalGoalCard";
import { MetaVgv } from "@/components/equipes/MetaVgv";
import { PessoaCard, ListaPessoas, ContagemPessoas, iniciais } from "@/components/equipes/PessoaCard";
import { TrilhaAcesso } from "@/components/equipes/TrilhaAcesso";
import { CofreCredenciais } from "@/components/equipes/CofreCredenciais";
import { goalPeriods, goalsByProfile, otherMetricsByProfile } from "@/components/equipes/metas";

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

/** Equipe ATIVA de cada gerente — a primeira pela ordem da consulta. */
type EquipesPorGerente = Record<string, { id: string; display_name: string | null }>;

/** O que a carga da tela devolve, guardado no cache do TanStack Query. */
type Quadro = {
  rows: BrokerRow[];
  teamsByMgr: EquipesPorGerente;
  /** Quem lidera equipe ativa (view `team_leader_names`, 0079). */
  leaders: Awaited<ReturnType<typeof listTeamLeaderNames>>;
};

const EQUIPES_KEY = ["equipes", "quadro"] as const;
const QUADRO_VAZIO: Quadro = { rows: [], teamsByMgr: {}, leaders: [] };

/**
 * O cartão de pessoa mostra só nome e foto (`PessoaCard`), por pedido do
 * cliente em 10/09/2026. O que estava nele — selo de situação, papéis extras,
 * superior, e-mail de acesso, metas — foi para dentro da ficha, que abre no
 * clique. Quem quiser o histórico do que saía daqui: `git log` deste arquivo.
 */

/** As quatro colunas do organograma. Quem não cai em nenhuma vai para "Outros". */
const COLUNAS = new Set(["director", "manager", "broker", "cca"]);

/**
 * Como a pessoa se chama, e não o papel de maior poder dela: um sócio com
 * poderes de administrador carrega {admin, partner} e `primaryRole` devolve
 * "admin" — o que é certo para decidir o que ela PODE e errado para escrever
 * quem ela É.
 */
const rotuloDaPessoa = (roles: readonly string[], principal: string) =>
  roles.includes("partner") ? ROTULO_PAPEL.partner : (ROTULO_PAPEL[principal] ?? principal);

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

export default function Equipes() {
  // `role` é o papel REAL; quem manda na tela são os papéis EFETIVOS, senão a
  // prévia do RoleSwitcher mostra ao admin botão que o papel previsto não tem.
  const { roles, isAdmin, user, can } = useAuth();
  const canEdit = isAdmin || roles.includes("director");
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
    || ((roles.includes("director") || roles.includes("manager")) && can("teams.manage"));

  const [search, setSearch] = useState("");
  /**
   * Só o que a pessoa DIGITOU no nome de cada equipe; sem rascunho o campo
   * mostra o nome gravado. `load()` limpa, como a carga manual fazia.
   */
  const [teamNameDrafts, setTeamNameDrafts] = useState<Record<string, string>>({});
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

  const lerQuadro = async (): Promise<Quadro> => {
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

    const rows: BrokerRow[] = people.map((person) => ({
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
    }));

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
    let leaders: Quadro["leaders"] = [];
    try {
      leaders = await listTeamLeaderNames();
    } catch (error: unknown) {
      console.warn("team_leader_names indisponível; nomes de gerente/diretor podem faltar", error);
    }

    const teamsByMgr: EquipesPorGerente = {};
    (teamsRes.data ?? []).forEach((t) => {
      // Só equipe ATIVA entra no mapa. A inativa não pode aparecer no campo
      // "Equipe" (renomeá-la não devolve ninguém à hierarquia, porque
      // `auth_led_team_ids()` exige `active`) nem ganhar o botão "Desativar",
      // que a desativaria de novo. Gerente sem equipe ativa vê o campo vazio,
      // e digitar um nome ali CRIA a equipe nova — que é a recuperação certa.
      if (t.manager_id && t.active && !teamsByMgr[t.manager_id]) {
        teamsByMgr[t.manager_id] = { id: t.id, display_name: t.name };
      }
    });
    return { rows, teamsByMgr, leaders };
  };

  const queryClient = useQueryClient();
  // Cache do TanStack Query: voltar à tela mostra o quadro que já estava aqui e
  // relê por trás, em vez de repetir "Carregando equipes…" a cada entrada. Sem
  // releitura ao focar a aba — a carga manual nunca releu assim.
  // O usuário entra na chave: o quadro sai recortado pela RLS, e sem ele quem
  // entrasse depois no mesmo navegador veria o quadro de quem saiu.
  const quadroKey = [...EQUIPES_KEY, user?.id ?? null] as const;
  const quadro = useQuery({
    queryKey: quadroKey,
    // O aviso sai da leitura, uma vez por carga, como na carga manual — e sem
    // `retry`, que o repetiria.
    queryFn: () => lerQuadro().catch((error: unknown) => {
      toast({ title: "Não foi possível carregar a equipe", description: describeError(error, "Verifique a conexão e tente de novo."), variant: "destructive" });
      throw error;
    }),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const { rows, teamsByMgr, leaders } = quadro.data ?? QUADRO_VAZIO;
  const loading = quadro.data === undefined && quadro.isFetching;
  // Falha de carga é diferente de "não há ninguém visível" — a tela dizia a segunda.
  const loadError = quadro.error ? describeError(quadro.error, "Não foi possível carregar a equipe.") : null;
  /** id → nome de quem lidera equipe ativa. */
  const leaderNames = useMemo(() => new Map<string, string>(leaders.map((l) => [l.id, l.full_name])), [leaders]);
  const load = () => {
    setTeamNameDrafts({});
    return queryClient.invalidateQueries({ queryKey: EQUIPES_KEY });
  };
  /**
   * Ajuste local depois de uma gravação que o banco já confirmou. Uma leitura
   * ainda em voo saiu antes da gravação e, ao chegar, apagaria a equipe recém
   * criada — e o próximo blur criaria outra: ela recomeça (o `invalidate`
   * cancela a velha).
   */
  const setTeamsByMgr = (atualizar: (prev: EquipesPorGerente) => EquipesPorGerente) => {
    queryClient.setQueryData<Quadro>(quadroKey, (d) => d && { ...d, teamsByMgr: atualizar(d.teamsByMgr) });
    if (queryClient.isFetching({ queryKey: quadroKey })) void queryClient.invalidateQueries({ queryKey: quadroKey });
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
          title: "Não foi possível salvar o nome da equipe",
          description: error
            ? describeError(error, "Tente de novo em instantes.")
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
        return toast({ title: "Não foi possível criar a equipe", description: describeError(error, "Tente de novo em instantes."), variant: "destructive" });
      }
      if (!directorId) {
        return toast({
          title: "Equipe criada sem diretoria",
          description: `Vincule ${managerName} a um diretor em "Vincular em massa" na coluna Gerentes — sem isso a equipe fica fora de qualquer diretoria.`,
        });
      }
      return toast({ title: "Equipe criada", variant: "success" });
    }
    toast({ title: "Nome da equipe salvo", variant: "success" });
  };


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
    leadsProfile(myBrokerId, roles, person);

  const podeEditarFicha = (person: BrokerRow) =>
    canEdit || gestorDoAlvo(person);

  /** Diretor que cria equipe entra como diretor dela — `teams_admin_write` (0061) exige. */
  const meuPerfilId = roles.includes("director") && !isAdmin ? myBroker?.id ?? null : null;

  // Director "scope": diretor vê só a própria subárvore. Admin não é recortado;
  // sob prévia de "diretor" ele passa a ser, que é o efeito que a prévia existe
  // para mostrar. Booleano, e não o array, para o useMemo abaixo ter dependência
  // estável entre renders.
  const scopedToOwnSubtree = !isAdmin && roles.includes("director");
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
        return toast({ title: "Não foi possível vincular os corretores", description: describeError(error, "Não foi possível carregar a equipe do gerente."), variant: "destructive" });
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
          return falha("Não foi possível desligar os corretores da equipe", describeError(saida.error, "Tente de novo em instantes."));
        }
        saiu = saida.data?.length ?? 0;
        if (saiu < desligar.length) {
          return falha(
            `${saiu} de ${desligar.length} desligamento(s) aplicados`,
            "O banco recusou o restante — a permissão \"Gerenciar equipes\" pode ter sido revogada, ou o corretor já saiu por outra tela.",
          );
        }
      }

      // Conta só quem entrou de fato: `ids` inclui quem já era da equipe e é pulado.
      let vinculou = 0;
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
          return falha("Não foi possível vincular os corretores", describeError(fecha.error, "Não foi possível encerrar o vínculo anterior."));
        }
        const jaTinhaEquipe = brokers.some(b => b.id === profileId && b.manager_id);
        if (jaTinhaEquipe && !fecha.data?.length) {
          return falha(
            "Não foi possível vincular os corretores",
            `${brokers.find(b => b.id === profileId)?.name ?? "O corretor"} pertence a uma equipe que você não administra — peça ao administrador para transferi-lo.`,
          );
        }
        const { error } = await supabase
          .from("team_members")
          .insert({ team_id: targetTeamId, profile_id: profileId });
        if (error) {
          return falha("Não foi possível vincular os corretores", describeError(error, "Tente de novo em instantes."));
        }
        vinculou++;
      }

      setSaving(false);
      toast(vinculou || saiu
        ? {
            title: "Vínculos atualizados",
            description: saiu
              ? `${vinculou} vínculo(s) e ${saiu} desligamento(s) aplicados`
              : `${vinculou} vínculo(s) aplicados`,
            variant: "success",
          }
        : { title: "Nenhum vínculo alterado", description: "A equipe já estava com essa seleção." });
      setBulk(null);
      load();
      return;
    } else {
      // O diretor mora na equipe do gerente: quem ainda não tem equipe não casa
      // linha nenhuma e o update volta 204 sem erro. Sem pedir a linha de volta
      // o toast verde mentiria — mesmo defeito já fechado em `MetaVgv`.
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
      if (error) { setSaving(false); return toast({ title: "Não foi possível vincular os gerentes à diretoria", description: describeError(error, "Tente de novo em instantes."), variant: "destructive" }); }
      const updated = new Set((data ?? []).map(row => row.manager_id));
      const missing = ids.filter(id => !updated.has(id));
      if (missing.length) {
        const names = missing.map(id => managers.find(m => m.id === id)?.name ?? id).join(", ");
        setSaving(false);
        setBulk(null);
        load();
        return toast({
          title: missing.length === ids.length
            ? "Não foi possível vincular os gerentes à diretoria"
            : `${ids.length - missing.length} de ${ids.length} vínculo(s) atualizados`,
          description: `Não gravou para: ${names}. Ou o gerente ainda não tem equipe — preencha o campo "Equipe" dele na coluna Gerentes — ou a equipe já pertence a outra diretoria, e só o administrador a transfere.`,
          variant: "destructive",
        });
      }
    }
    setSaving(false);
    toast({ title: "Vínculos atualizados", description: `${ids.length} gerente(s) vinculado(s) à diretoria`, variant: "success" });
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

      {/* Cofre da operação (0105) em ABA, e não empilhado no fim da tela: pedido
          do cliente. O gate continua sendo `isAdmin` — que já inclui o sócio —,
          e o componente também se autoprotege.

          A lista de abas aparece para todo mundo, mesmo com uma aba só: um
          `TabsContent` sem `TabsTrigger` deixa o `aria-labelledby` do painel
          apontando para um id que não existe. */}
      <Tabs defaultValue="equipe" className="space-y-6">
        <TabsList>
          <TabsTrigger value="equipe">Equipe</TabsTrigger>
          {isAdmin && <TabsTrigger value="cofre">Cofre de credenciais</TabsTrigger>}
        </TabsList>

        <TabsContent value="equipe" className="mt-0 space-y-6">
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
                    {iniciais(myBroker.name)}
                  </div>
                  <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div><span className="text-muted-foreground">Nome</span><p className="font-medium">{myBroker.name}</p></div>
                    <div><span className="text-muted-foreground">Função</span><p className="font-medium">{rotuloDaPessoa(myBroker.roles ?? [], myBroker.role)}</p></div>
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
                <CardHeader className="py-3 px-4 flex flex-row flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-sm text-info flex flex-wrap items-center gap-2">
                    <Crown className="h-4 w-4" /> Diretores <ContagemPessoas pessoas={visibleDirectors} />
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-2 max-h-[520px] overflow-y-auto">
                  {visibleDirectors.length === 0 && (
                    <p className="text-xs text-muted-foreground">{emptyLabel("diretor")}</p>
                  )}
                  <ListaPessoas pessoas={visibleDirectors}>{d => (
                    <PessoaCard
                      key={d.id}
                      pessoa={d}
                      tom="info"
                      onAbrir={podeEditarFicha(d) ? () => openEdit("manager", d) : undefined}
                    />
                  )}</ListaPessoas>
                </CardContent>
              </Card>

              {/* Gerentes */}
              <Card className="border-info/30" role="region" aria-label="Gerentes">
                <CardHeader className="py-3 px-4 flex flex-row flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-sm text-info flex flex-wrap items-center gap-2">
                    <UserCog className="h-4 w-4" /> Gerentes <ContagemPessoas pessoas={visibleManagers} />
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
                  {/* Nome da equipe e "Desativar" saíram daqui para o bloco
                      "Performance por Equipe": são da EQUIPE, não da pessoa, e o
                      cartão de pessoa agora é só nome e foto. */}
                  <ListaPessoas pessoas={visibleManagers}>{m => (
                    <PessoaCard
                      key={m.id}
                      pessoa={m}
                      tom="info"
                      onAbrir={podeEditarFicha(m) ? () => openEdit("manager", m) : undefined}
                    />
                  )}</ListaPessoas>
                </CardContent>
              </Card>

              {/* Corretores */}
              <Card className="border-success/30" role="region" aria-label="Corretores">
                <CardHeader className="py-3 px-4 flex flex-row flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-sm text-success flex flex-wrap items-center gap-2">
                    <Users className="h-4 w-4" /> Corretores <ContagemPessoas pessoas={visibleBrokers} />
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
                  <ListaPessoas pessoas={visibleBrokers}>{b => (
                    <PessoaCard
                      key={b.id}
                      pessoa={b}
                      tom="success"
                      onAbrir={podeEditarFicha(b) ? () => openEdit("broker", b) : undefined}
                    />
                  )}</ListaPessoas>
                </CardContent>
              </Card>
            </div>

          {/* CCAs */}
          <Card className="border-warning/30" role="region" aria-label="CCAs">
            <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
              <CardTitle className="text-sm text-warning flex items-center gap-2">
                <Shield className="h-4 w-4" /> CCAs <ContagemPessoas pessoas={visibleCcas} />
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              <ListaPessoas pessoas={visibleCcas}>{c => (
                <PessoaCard
                  key={c.id}
                  pessoa={c}
                  tom="warning"
                  onAbrir={podeEditarFicha(c) ? () => openEdit("broker", c) : undefined}
                />
              )}</ListaPessoas>
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
                <IdCard className="h-4 w-4 text-muted-foreground" /> Outros papéis <ContagemPessoas pessoas={filter(outros)} />
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              <ListaPessoas pessoas={filter(outros)}>{o => (
                <PessoaCard
                  key={o.id}
                  pessoa={o}
                  onAbrir={podeEditarFicha(o) ? () => openEdit("broker", o) : undefined}
                />
              )}</ListaPessoas>
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
                {teamStats.map(t => {
                  const equipe = teamsByMgr[t.manager.id];
                  return (
                  <div key={t.manager.id} className="shrink-0 w-[280px] snap-start p-3 rounded-lg border border-border/30 bg-secondary/20">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-8 h-8 rounded-full bg-info/20 flex items-center justify-center text-xs font-bold text-info">{iniciais(t.manager.name)}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold truncate">{t.manager.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{t.director ?? "—"}</p>
                      </div>
                      <ContagemPessoas pessoas={t.brokers} />
                    </div>
                    {/* Nome da equipe e desativação vieram do cartão do gerente: são
                        da EQUIPE, e o cartão de pessoa agora é só nome e foto.
                        Gerente sem equipe ativa vê o campo vazio, e digitar um nome
                        ali CRIA a equipe — que é a recuperação certa. */}
                    {canEdit && (
                      <div className="mb-2 flex flex-wrap items-center gap-1">
                        <span className="text-eyebrow shrink-0">Equipe</span>
                        <Input
                          aria-label={`Nome da equipe de ${t.manager.name}`}
                          value={teamNameDrafts[t.manager.id] ?? equipe?.display_name ?? ""}
                          onChange={(e) => setTeamNameDrafts(p => ({ ...p, [t.manager.id]: e.target.value }))}
                          onBlur={() => {
                            const current = equipe?.display_name ?? "";
                            if ((teamNameDrafts[t.manager.id] ?? current) !== current) void saveTeamName(t.manager);
                          }}
                          placeholder={`Equipe ${t.manager.name.split(" ")[0]}`}
                          className="h-6 text-xs px-2 min-w-0 flex-1 basis-24"
                        />
                        {/* A saída que faltava. `activeTeamIdOfManager` manda
                            "desative as que sobram" quando o gerente tem mais de uma
                            equipe ativa, e não havia NENHUM caminho na interface
                            para desativar equipe — o vínculo em massa ficava travado
                            sem solução. */}
                        {/* `canManageMembers` e não `canEdit`: desativar precisa das
                            DUAS escritas — `teams` (diretor da equipe) e
                            `team_members` (`has_permission('teams.manage')`). Para o
                            diretor com a permissão revogada o botão some em vez de
                            fechar meio caminho. */}
                        {equipe && canManageMembers && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-xs text-destructive"
                            aria-label={`Desativar a equipe de ${t.manager.name}`}
                            onClick={() => setDesativar({
                              teamId: equipe.id,
                              managerName: t.manager.name,
                              membros: t.size,
                            })}
                          >
                            Desativar
                          </Button>
                        )}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1">
                      <ListaPessoas pessoas={t.brokers}>{b => (
                        <span key={b.id} className="text-xs px-2 py-0.5 rounded-md bg-secondary/40 border border-border/30">{b.name.split(" ")[0]}</span>
                      )}</ListaPessoas>
                      {t.brokers.length === 0 && <span className="text-xs text-muted-foreground">Sem corretores</span>}
                    </div>
                  </div>
                  );
                })}
                {teamStats.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma equipe visível para o seu acesso.</p>}
              </div>
            </CardContent>
          </Card>
          </>
          )}
        </TabsContent>

        {isAdmin && (
          <TabsContent value="cofre" className="mt-0">
            <CofreCredenciais />
          </TabsContent>
        )}
      </Tabs>

      {/* Cadastro de colaborador — a MESMA ficha, vazia. O diálogo de dois
          campos que existia aqui empurrava CPF, CRECI, função e equipe para uma
          segunda etapa; o cliente pediu tudo de uma vez (10/09/2026). */}
      <BrokerEditModal
        open={creating}
        broker={null}
        criando
        managers={managers.map(m => ({ id: m.id, name: m.name }))}
        directors={directors.map(d => ({ id: d.id, name: d.name }))}
        isAdmin={isAdmin}
        onClose={() => setCreating(false)}
        onSaved={() => { setCreating(false); load(); }}
        // E-mail já em uso: em vez de "já existe" sem saída, a ficha de quem já
        // usa o endereço abre. Só id e nome — status, equipe e função a ficha
        // relê do banco (`getPersonDetails`); chutar `active: true` abria o
        // Switch ligado para quem estava suspenso e deixava a reativação sem
        // caminho. E `login_email_confirmed` fica falso: o endereço é de outra
        // pessoa, não do cadastro que acabou de ser digitado.
        onDuplicado={(id, nome) => {
          setCreating(false);
          load();
          setProfileEdit({ id, name: nome, full_name: nome, login_email_confirmed: false });
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
        // A meta de VGV saiu do cartão junto com o resto e passou a morar aqui.
        // `goals_write` é admin e diretor — a mesma regra de `canEdit`.
        metas={canEdit && profileEdit
          ? (() => {
              const pessoa = rows.find(r => r.id === profileEdit.id);
              // `key`: os campos da meta guardam estado local a partir do valor
              // inicial. Sem trocar a identidade do elemento, a meta de quem foi
              // aberto antes ficaria em tela para a próxima pessoa.
              return pessoa ? <MetaVgv key={pessoa.id} pessoa={pessoa} onSaved={load} /> : null;
            })()
          : null}
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
                          <div className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center text-xs font-bold" aria-hidden>{iniciais(m.name)}</div>
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
                      variant: "success",
                    });
                  } catch (error: unknown) {
                    toast({
                      title: "Não foi possível desativar a equipe",
                      description: describeError(error, "Tente de novo em instantes."),
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
