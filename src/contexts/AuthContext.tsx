import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { getCurrentProfile } from "@/integrations/supabase/newSchema";
import {
  listRolePermissions,
  listStagePermissions,
  type RolePermissionRecord,
  type StagePermissionRecord,
} from "@/integrations/supabase/permissions";
import type { User, Session } from "@supabase/supabase-js";

export type AppRole = 'broker' | 'manager' | 'director' | 'partner' | 'admin' | 'cca' | 'sdr' | 'marketing';

/** Prévia de papel guardada por ABA (some ao fechar), nunca entre sessões. */
const PREVIEW_KEY = 'faceimob-preview-role';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: { name: string; email: string | null; phone: string | null; avatar_url: string | null } | null;
  /** Relê o perfil do banco — a tela de Configurações edita nome, telefone e foto. */
  refreshProfile: () => Promise<void>;
  /** Papel de maior precedência — só para rótulo. Autorização usa `can`. */
  role: AppRole;
  /** Todos os papéis do usuário: papel é N:N (`user_roles`). */
  roles: AppRole[];
  /**
   * `true` quando a leitura do perfil/matriz falhou. Distingue "esta conta não
   * tem papel nenhum" de "não conseguimos ler os papéis" — `roles` fica vazio
   * nos DOIS casos (falha fechada), e uma tela que só olha `roles.length`
   * afirma a primeira coisa quando a verdadeira é a segunda.
   */
  perfilFalhou: boolean;
  isAdmin: boolean;
  loading: boolean;
  /** Papel sendo pré-visualizado por um admin, ou null. */
  previewRole: AppRole | null;
  setPreviewRole: (role: AppRole | null) => void;
  /** `true` se algum papel efetivo concede o código. Admin concede tudo. */
  can: (code: string) => boolean;
  /** `true` se algum papel efetivo pode mover um negócio para a etapa. */
  canEnterStage: (stageId: string) => boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null, session: null, profile: null,
  role: 'broker', roles: [], perfilFalhou: false, isAdmin: false, loading: true,
  refreshProfile: async () => {},
  previewRole: null, setPreviewRole: () => {},
  can: () => false, canEnterStage: () => false,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<AppRole>('broker');
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [perfilFalhou, setPerfilFalhou] = useState(false);
  const [profile, setProfile] = useState<{ name: string; email: string | null; phone: string | null; avatar_url: string | null } | null>(null);
  const [rolePerms, setRolePerms] = useState<RolePermissionRecord[]>([]);
  const [stagePerms, setStagePerms] = useState<StagePermissionRecord[]>([]);
  const [previewRoleState, setPreviewRoleState] = useState<AppRole | null>(null);
  /** Último usuário cuja matriz de permissões já foi carregada. */
  const loadedForUser = useRef<string | null>(null);

  const realIsAdmin = roles.includes('admin');

  /**
   * Pré-visualizar outro papel é ferramenta de admin. A trava fica aqui, e não
   * só em quem renderiza o seletor: sem ela qualquer usuário poderia escolher
   * "admin" e revelar o menu inteiro no client. O dado continuaria protegido
   * pelo RLS, mas a tela mentiria sobre o que ele pode fazer.
   *
   * `sessionStorage` (não `localStorage`): a prévia é de uma conferência, não
   * uma preferência. Antes ela morria em qualquer recarga — quem estava
   * conferindo uma tela voltava ao papel real sem aviso e concluía que o menu
   * tinha mudado sozinho. Agora dura a aba e some quando ela fecha.
   */
  const setPreviewRole = useCallback((next: AppRole | null) => {
    if (!realIsAdmin) return;
    setPreviewRoleState(next);
    try {
      if (next) sessionStorage.setItem(PREVIEW_KEY, next);
      else sessionStorage.removeItem(PREVIEW_KEY);
    } catch {
      // Navegador com storage bloqueado: a prévia continua valendo em memória.
    }
  }, [realIsAdmin]);

  /**
   * Retoma a prévia guardada — e só depois de saber que o usuário é admin DE
   * VERDADE. Restaurar antes disso deixaria um valor plantado à mão no
   * `sessionStorage` trocar o menu de quem não é admin.
   */
  useEffect(() => {
    if (!realIsAdmin) {
      setPreviewRoleState(null);
      return;
    }
    try {
      const salvo = sessionStorage.getItem(PREVIEW_KEY);
      if (salvo && salvo !== 'admin') setPreviewRoleState(salvo as AppRole);
    } catch {
      // idem: sem storage, a prévia simplesmente não é retomada.
    }
  }, [realIsAdmin]);

  const applySession = useCallback(async (nextSession: Session | null) => {
    setSession(nextSession);
    setUser(nextSession?.user ?? null);

    if (!nextSession?.user) {
      setProfile(null);
      setRole('broker');
      setRoles([]);
      setPerfilFalhou(false);
      setRolePerms([]);
      setStagePerms([]);
      setPreviewRoleState(null);
      // Sem isto, o próximo admin a entrar NESTA aba herdaria a prévia do
      // anterior e veria o menu de outro papel sem ter escolhido nada.
      try { sessionStorage.removeItem(PREVIEW_KEY); } catch { /* storage bloqueado */ }
      loadedForUser.current = null;
      setLoading(false);
      return;
    }

    // Sem voltar a `true` aqui, `can()` nega tudo entre o login e o fim do
    // `Promise.all`: a tela pisca "Acesso não liberado" com a sidebar vazia.
    // A comparação com o usuário já carregado evita remontar a rota a cada
    // TOKEN_REFRESHED/USER_UPDATED do mesmo usuário, o que derrubaria filtro,
    // modal e formulário abertos sem motivo.
    if (loadedForUser.current !== nextSession.user.id) setLoading(true);

    try {
      const [current, rp, sp] = await Promise.all([
        getCurrentProfile(nextSession.user.id),
        listRolePermissions(),
        listStagePermissions(),
      ]);
      setProfile({
        name: current.profile?.full_name || nextSession.user.email || "Usuário",
        email: current.profile?.email || nextSession.user.email || null,
        phone: current.profile?.phone || null,
        avatar_url: current.profile?.avatar_url || null,
      });
      setRole(current.role as AppRole);
      setRoles(current.roles as AppRole[]);
      setPerfilFalhou(false);
      setRolePerms(rp);
      setStagePerms(sp);
    } catch (error) {
      console.error("Falha ao carregar perfil autenticado:", error);
      const metadata = nextSession.user.user_metadata || {};
      setProfile({
        name: metadata.full_name || metadata.name || nextSession.user.email || "Usuário",
        email: nextSession.user.email || null,
        phone: null,
        avatar_url: metadata.avatar_url || null,
      });
      // Sem matriz carregada, `can()` nega tudo. Falha fechada é o certo aqui:
      // menu vazio é recuperável, menu aberto por engano não é.
      //
      // `perfilFalhou` existe porque essa mesma falha manda a pessoa para a
      // ÚNICA rota sem guard (`firstAllowedRoute` → /settings). Sem o sinal, a
      // primeira tela do sistema afirmaria "nenhum papel atribuído" quando o
      // que houve foi um erro de leitura.
      setRoles([]);
      setPerfilFalhou(true);
      setRolePerms([]);
      setStagePerms([]);
    } finally {
      loadedForUser.current = nextSession.user.id;
      setLoading(false);
    }
  }, []);

  /**
   * Relê só o perfil. `applySession` recarregaria também a matriz de permissões
   * e voltaria `loading` a true na troca de usuário — para um "salvei meu
   * telefone" isso derrubaria a tela aberta. O erro sobe para quem chamou: a
   * tela de Configurações precisa dizer que não conseguiu reler.
   */
  const refreshProfile = useCallback(async () => {
    const id = user?.id;
    if (!id) return;
    const current = await getCurrentProfile(id);
    setProfile({
      name: current.profile?.full_name || user.email || "Usuário",
      email: current.profile?.email || user.email || null,
      phone: current.profile?.phone || null,
      avatar_url: current.profile?.avatar_url || null,
    });
  }, [user]);

  useEffect(() => {
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (active) void applySession(nextSession);
    });

    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      if (active) void applySession(initialSession);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [applySession]);

  // Papéis que valem para autorização agora: os reais, ou o previsualizado.
  const effectiveRoles = useMemo<AppRole[]>(
    () => (previewRoleState ? [previewRoleState] : roles),
    [previewRoleState, roles],
  );
  const isAdmin = effectiveRoles.includes('admin');

  const allowedCodes = useMemo(() => {
    const set = new Set<string>();
    for (const row of rolePerms) {
      if (row.allowed && effectiveRoles.includes(row.role as AppRole)) set.add(row.permission);
    }
    return set;
  }, [rolePerms, effectiveRoles]);

  const enterableStages = useMemo(() => {
    const set = new Set<string>();
    for (const row of stagePerms) {
      if (row.can_enter && effectiveRoles.includes(row.role as AppRole)) set.add(row.stage_id);
    }
    return set;
  }, [stagePerms, effectiveRoles]);

  // Espelha `has_permission()` / `can_enter_stage()`, que curto-circuitam em
  // `is_admin()`. Se divergir daqui, a tela some com botão que o banco aceita.
  const can = useCallback(
    (code: string) => isAdmin || allowedCodes.has(code),
    [isAdmin, allowedCodes],
  );
  const canEnterStage = useCallback(
    (stageId: string) => isAdmin || enterableStages.has(stageId),
    [isAdmin, enterableStages],
  );

  /**
   * Sair — o estado só cai quando o servidor confirma.
   *
   * Zerar `user`/`session` antes de olhar o erro fingia um logout que não
   * acontece. No `@supabase/auth-js` 2.110, `_signOut` devolve o erro ANTES de
   * chamar `_removeSession()` sempre que a revogação falha por algo que não
   * seja 401/403/404 — ou seja, exatamente em queda de rede e 5xx, que é o
   * cenário deste ramo. Nessa falha a sessão continua no `localStorage` E em
   * memória, com `autoRefreshToken` (client.ts) renovando o token e
   * `_recoverAndRefresh` relendo a storage quando a aba volta ao foco: a tela
   * ia para /login e a sessão voltava sozinha.
   *
   * Então a falha é DITA e a pessoa continua dentro, que é a verdade — não há
   * caminho local honesto para derrubar só este aparelho (`scope: 'local'`
   * também chama `admin.signOut` primeiro e falha igual).
   *
   * No sucesso não é preciso limpar nada aqui: o `SIGNED_OUT` do
   * `onAuthStateChange` chama `applySession(null)`, que zera também perfil,
   * papéis, matriz e a prévia de papel.
   *
   * O erro não sobe: o chamador (`AppSidebar`) não trata rejeição.
   */
  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (!error) return;
    console.error("Falha ao encerrar a sessão no servidor:", error);
    toast({
      variant: "destructive",
      title: "Não conseguimos sair",
      description:
        "A sessão continua aberta neste aparelho. Verifique a conexão e tente de novo.",
    });
  };

  return (
    <AuthContext.Provider value={{
      user, session, profile, role, roles, perfilFalhou, isAdmin, loading, refreshProfile,
      previewRole: previewRoleState, setPreviewRole,
      can, canEnterStage, signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
