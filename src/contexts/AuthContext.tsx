import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentProfile } from "@/integrations/supabase/newSchema";
import type { User, Session } from "@supabase/supabase-js";

export type AppRole = 'broker' | 'manager' | 'director' | 'partner' | 'admin' | 'cca' | 'sdr' | 'marketing';

interface RolePermissions {
  view_deals: boolean;
  edit_deals: boolean;
  move_deals: boolean;
  see_financial: boolean;
  see_conversion: boolean;
  access_dashboard: boolean;
}

interface StagePermission {
  stage: string;
  can_view: boolean;
  can_edit: boolean;
  can_move: boolean;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: { name: string; email: string | null; avatar_url: string | null } | null;
  role: AppRole;
  permissions: RolePermissions;
  stagePermissions: StagePermission[];
  loading: boolean;
  // For demo: allows switching role without real auth
  setDemoRole: (role: AppRole) => void;
  hasPermission: (key: keyof RolePermissions) => boolean;
  canViewStage: (stage: string) => boolean;
  canEditStage: (stage: string) => boolean;
  canMoveToStage: (stage: string) => boolean;
  signOut: () => Promise<void>;
}

const defaultPermissions: RolePermissions = {
  view_deals: true, edit_deals: false, move_deals: false,
  see_financial: false, see_conversion: false, access_dashboard: true,
};

const AuthContext = createContext<AuthContextType>({
  user: null, session: null, profile: null,
  role: 'admin', permissions: defaultPermissions,
  stagePermissions: [], loading: true,
  setDemoRole: () => {}, hasPermission: () => false,
  canViewStage: () => true, canEditStage: () => false, canMoveToStage: () => false,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

// Default permissions by role for demo mode
const demoPermissions: Record<AppRole, RolePermissions> = {
  admin: { view_deals: true, edit_deals: true, move_deals: true, see_financial: true, see_conversion: true, access_dashboard: true },
  partner: { view_deals: true, edit_deals: true, move_deals: true, see_financial: true, see_conversion: true, access_dashboard: true },
  director: { view_deals: true, edit_deals: true, move_deals: true, see_financial: true, see_conversion: true, access_dashboard: true },
  manager: { view_deals: true, edit_deals: true, move_deals: true, see_financial: false, see_conversion: true, access_dashboard: true },
  broker: { view_deals: true, edit_deals: false, move_deals: false, see_financial: false, see_conversion: false, access_dashboard: true },
  cca: { view_deals: true, edit_deals: false, move_deals: false, see_financial: false, see_conversion: false, access_dashboard: false },
  sdr: { view_deals: false, edit_deals: false, move_deals: false, see_financial: false, see_conversion: false, access_dashboard: false },
  marketing: { view_deals: false, edit_deals: false, move_deals: false, see_financial: true, see_conversion: true, access_dashboard: true },
};

const demoStagePermissions: Record<AppRole, StagePermission[]> = {
  broker: [
    { stage: 'lead', can_view: true, can_edit: true, can_move: true },
    { stage: 'proposal', can_view: true, can_edit: true, can_move: true },
    { stage: 'visit_scheduled', can_view: true, can_edit: true, can_move: false },
    { stage: 'under_analysis', can_view: true, can_edit: false, can_move: false },
    { stage: 'approved', can_view: true, can_edit: false, can_move: false },
    { stage: 'contract', can_view: true, can_edit: false, can_move: false },
    { stage: 'closed', can_view: true, can_edit: false, can_move: false },
  ],
  manager: [
    { stage: 'lead', can_view: true, can_edit: true, can_move: true },
    { stage: 'proposal', can_view: true, can_edit: true, can_move: true },
    { stage: 'visit_scheduled', can_view: true, can_edit: true, can_move: true },
    { stage: 'under_analysis', can_view: true, can_edit: true, can_move: true },
    { stage: 'approved', can_view: true, can_edit: true, can_move: true },
    { stage: 'contract', can_view: true, can_edit: true, can_move: false },
    { stage: 'closed', can_view: true, can_edit: false, can_move: false },
  ],
  director: [
    { stage: 'lead', can_view: true, can_edit: true, can_move: true },
    { stage: 'proposal', can_view: true, can_edit: true, can_move: true },
    { stage: 'visit_scheduled', can_view: true, can_edit: true, can_move: true },
    { stage: 'under_analysis', can_view: true, can_edit: true, can_move: true },
    { stage: 'approved', can_view: true, can_edit: true, can_move: true },
    { stage: 'contract', can_view: true, can_edit: true, can_move: true },
    { stage: 'closed', can_view: true, can_edit: true, can_move: true },
  ],
  partner: [
    { stage: 'lead', can_view: true, can_edit: true, can_move: true },
    { stage: 'proposal', can_view: true, can_edit: true, can_move: true },
    { stage: 'visit_scheduled', can_view: true, can_edit: true, can_move: true },
    { stage: 'under_analysis', can_view: true, can_edit: true, can_move: true },
    { stage: 'approved', can_view: true, can_edit: true, can_move: true },
    { stage: 'contract', can_view: true, can_edit: true, can_move: true },
    { stage: 'closed', can_view: true, can_edit: true, can_move: true },
  ],
  admin: [
    { stage: 'lead', can_view: true, can_edit: true, can_move: true },
    { stage: 'proposal', can_view: true, can_edit: true, can_move: true },
    { stage: 'visit_scheduled', can_view: true, can_edit: true, can_move: true },
    { stage: 'under_analysis', can_view: true, can_edit: true, can_move: true },
    { stage: 'approved', can_view: true, can_edit: true, can_move: true },
    { stage: 'contract', can_view: true, can_edit: true, can_move: true },
    { stage: 'closed', can_view: true, can_edit: true, can_move: true },
  ],
  cca: [
    { stage: 'lead', can_view: false, can_edit: false, can_move: false },
    { stage: 'proposal', can_view: false, can_edit: false, can_move: false },
    { stage: 'visit_scheduled', can_view: false, can_edit: false, can_move: false },
    { stage: 'under_analysis', can_view: true, can_edit: true, can_move: true },
    { stage: 'approved', can_view: true, can_edit: true, can_move: true },
    { stage: 'contract', can_view: false, can_edit: false, can_move: false },
    { stage: 'closed', can_view: false, can_edit: false, can_move: false },
  ],
  sdr: [],
  marketing: [],
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<AppRole>('broker');
  const [profile, setProfile] = useState<{ name: string; email: string | null; avatar_url: string | null } | null>(null);
  const [permissions, setPermissions] = useState<RolePermissions>(demoPermissions.broker);
  const [stagePermissions, setStagePermissions] = useState<StagePermission[]>(demoStagePermissions.broker);

  // Demo mode: switch role
  const setDemoRole = useCallback((newRole: AppRole) => {
    setRole(newRole);
    setPermissions(demoPermissions[newRole]);
    setStagePermissions(demoStagePermissions[newRole]);
  }, []);

  const applySession = useCallback(async (nextSession: Session | null) => {
    setSession(nextSession);
    setUser(nextSession?.user ?? null);

    if (!nextSession?.user) {
      setProfile(null);
      setRole("broker");
      setPermissions(demoPermissions.broker);
      setStagePermissions(demoStagePermissions.broker);
      setLoading(false);
      return;
    }

    try {
      const current = await getCurrentProfile(nextSession.user.id);
      const currentRole = current.role as AppRole;
      setProfile({
        name: current.profile?.full_name || nextSession.user.email || "Usuário",
        email: current.profile?.email || nextSession.user.email || null,
        avatar_url: current.profile?.avatar_url || null,
      });
      setRole(currentRole);
      setPermissions(demoPermissions[currentRole] || defaultPermissions);
      setStagePermissions(demoStagePermissions[currentRole] || []);
    } catch (error) {
      console.error("Falha ao carregar perfil autenticado:", error);
      const metadata = nextSession.user.user_metadata || {};
      setProfile({
        name: metadata.full_name || metadata.name || nextSession.user.email || "Usuário",
        email: nextSession.user.email || null,
        avatar_url: metadata.avatar_url || null,
      });
    } finally {
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

  const hasPermission = useCallback((key: keyof RolePermissions) => permissions[key], [permissions]);
  const canViewStage = useCallback((stage: string) => {
    const sp = stagePermissions.find(s => s.stage === stage);
    return sp ? sp.can_view : true;
  }, [stagePermissions]);
  const canEditStage = useCallback((stage: string) => {
    const sp = stagePermissions.find(s => s.stage === stage);
    return sp ? sp.can_edit : false;
  }, [stagePermissions]);
  const canMoveToStage = useCallback((stage: string) => {
    const sp = stagePermissions.find(s => s.stage === stage);
    return sp ? sp.can_move : false;
  }, [stagePermissions]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
  };

  return (
    <AuthContext.Provider value={{
      user, session, profile, role, permissions, stagePermissions, loading,
      setDemoRole, hasPermission, canViewStage, canEditStage, canMoveToStage, signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
