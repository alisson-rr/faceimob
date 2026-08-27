import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentProfile } from "@/integrations/supabase/newSchema";
import {
  listRolePermissions,
  listStagePermissions,
  type RolePermissionRecord,
  type StagePermissionRecord,
} from "@/integrations/supabase/permissions";
import type { User, Session } from "@supabase/supabase-js";

export type AppRole = 'broker' | 'manager' | 'director' | 'partner' | 'admin' | 'cca' | 'sdr' | 'marketing';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: { name: string; email: string | null; avatar_url: string | null } | null;
  /** Papel de maior precedência — só para rótulo. Autorização usa `can`. */
  role: AppRole;
  /** Todos os papéis do usuário: papel é N:N (`user_roles`). */
  roles: AppRole[];
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
  role: 'broker', roles: [], isAdmin: false, loading: true,
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
  const [profile, setProfile] = useState<{ name: string; email: string | null; avatar_url: string | null } | null>(null);
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
   */
  const setPreviewRole = useCallback((next: AppRole | null) => {
    if (!realIsAdmin) return;
    setPreviewRoleState(next);
  }, [realIsAdmin]);

  const applySession = useCallback(async (nextSession: Session | null) => {
    setSession(nextSession);
    setUser(nextSession?.user ?? null);

    if (!nextSession?.user) {
      setProfile(null);
      setRole('broker');
      setRoles([]);
      setRolePerms([]);
      setStagePerms([]);
      setPreviewRoleState(null);
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
        avatar_url: current.profile?.avatar_url || null,
      });
      setRole(current.role as AppRole);
      setRoles(current.roles as AppRole[]);
      setRolePerms(rp);
      setStagePerms(sp);
    } catch (error) {
      console.error("Falha ao carregar perfil autenticado:", error);
      const metadata = nextSession.user.user_metadata || {};
      setProfile({
        name: metadata.full_name || metadata.name || nextSession.user.email || "Usuário",
        email: nextSession.user.email || null,
        avatar_url: metadata.avatar_url || null,
      });
      // Sem matriz carregada, `can()` nega tudo. Falha fechada é o certo aqui:
      // menu vazio é recuperável, menu aberto por engano não é.
      setRoles([]);
      setRolePerms([]);
      setStagePerms([]);
    } finally {
      loadedForUser.current = nextSession.user.id;
      setLoading(false);
    }
  }, []);

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

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
  };

  return (
    <AuthContext.Provider value={{
      user, session, profile, role, roles, isAdmin, loading,
      previewRole: previewRoleState, setPreviewRole,
      can, canEnterStage, signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
