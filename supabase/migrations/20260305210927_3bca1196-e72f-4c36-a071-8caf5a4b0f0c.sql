
-- Create enum for user roles
CREATE TYPE public.app_role AS ENUM ('broker', 'manager', 'director', 'partner', 'admin', 'cca');

-- Profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  email TEXT,
  avatar_url TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view all profiles" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- User roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL DEFAULT 'broker',
  UNIQUE(user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;

CREATE OR REPLACE FUNCTION public.get_user_role(_user_id UUID)
RETURNS app_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT role FROM public.user_roles WHERE user_id = _user_id LIMIT 1 $$;

CREATE POLICY "Users can view roles" ON public.user_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert roles" ON public.user_roles FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update roles" ON public.user_roles FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete roles" ON public.user_roles FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Teams table
CREATE TABLE public.teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view teams" ON public.teams FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert teams" ON public.teams FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update teams" ON public.teams FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete teams" ON public.teams FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Team assignments hierarchy
CREATE TABLE public.team_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  manager_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  director_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.team_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view assignments" ON public.team_assignments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert assignments" ON public.team_assignments FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update assignments" ON public.team_assignments FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete assignments" ON public.team_assignments FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Role permissions
CREATE TABLE public.role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role app_role NOT NULL,
  permission_key TEXT NOT NULL,
  allowed BOOLEAN NOT NULL DEFAULT false,
  UNIQUE(role, permission_key)
);
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view permissions" ON public.role_permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert permissions" ON public.role_permissions FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update permissions" ON public.role_permissions FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete permissions" ON public.role_permissions FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Stage permissions
CREATE TABLE public.stage_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role app_role NOT NULL,
  stage TEXT NOT NULL,
  can_view BOOLEAN NOT NULL DEFAULT true,
  can_edit BOOLEAN NOT NULL DEFAULT false,
  can_move BOOLEAN NOT NULL DEFAULT false,
  UNIQUE(role, stage)
);
ALTER TABLE public.stage_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view stage perms" ON public.stage_permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert stage perms" ON public.stage_permissions FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update stage perms" ON public.stage_permissions FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete stage perms" ON public.stage_permissions FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- CCA developer config
CREATE TABLE public.cca_developers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_name TEXT NOT NULL UNIQUE,
  uses_internal_cca BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.cca_developers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view cca config" ON public.cca_developers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert cca config" ON public.cca_developers FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update cca config" ON public.cca_developers FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete cca config" ON public.cca_developers FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- CCA deals
CREATE TYPE public.cca_status AS ENUM ('credit_analysis', 'pending_documents', 'approved', 'rejected', 'sent_to_agency');

CREATE TABLE public.cca_deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id TEXT NOT NULL,
  cca_user_id UUID REFERENCES auth.users(id),
  status public.cca_status NOT NULL DEFAULT 'credit_analysis',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.cca_deals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "CCA and admins can view" ON public.cca_deals FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'cca') OR public.has_role(auth.uid(), 'partner')
);
CREATE POLICY "CCA can insert" ON public.cca_deals FOR INSERT TO authenticated WITH CHECK (
  public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'cca')
);
CREATE POLICY "CCA can update" ON public.cca_deals FOR UPDATE TO authenticated USING (
  public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'cca')
);

-- Default data
INSERT INTO public.role_permissions (role, permission_key, allowed) VALUES
  ('admin', 'view_deals', true), ('admin', 'edit_deals', true), ('admin', 'move_deals', true),
  ('admin', 'see_financial', true), ('admin', 'see_conversion', true), ('admin', 'access_dashboard', true),
  ('partner', 'view_deals', true), ('partner', 'edit_deals', true), ('partner', 'move_deals', true),
  ('partner', 'see_financial', true), ('partner', 'see_conversion', true), ('partner', 'access_dashboard', true),
  ('director', 'view_deals', true), ('director', 'edit_deals', true), ('director', 'move_deals', true),
  ('director', 'see_financial', true), ('director', 'see_conversion', true), ('director', 'access_dashboard', true),
  ('manager', 'view_deals', true), ('manager', 'edit_deals', true), ('manager', 'move_deals', true),
  ('manager', 'see_financial', false), ('manager', 'see_conversion', true), ('manager', 'access_dashboard', true),
  ('broker', 'view_deals', true), ('broker', 'edit_deals', false), ('broker', 'move_deals', false),
  ('broker', 'see_financial', false), ('broker', 'see_conversion', false), ('broker', 'access_dashboard', true),
  ('cca', 'view_deals', true), ('cca', 'edit_deals', false), ('cca', 'move_deals', false),
  ('cca', 'see_financial', false), ('cca', 'see_conversion', false), ('cca', 'access_dashboard', false);

INSERT INTO public.cca_developers (developer_name, uses_internal_cca) VALUES
  ('MRV', true), ('Tenda', true), ('Direcional', true),
  ('Cyrela', false), ('Eztec', false), ('Even', false);

INSERT INTO public.stage_permissions (role, stage, can_view, can_edit, can_move) VALUES
  ('broker', 'lead', true, true, true), ('broker', 'proposal', true, true, true),
  ('broker', 'visit_scheduled', true, true, false), ('broker', 'under_analysis', true, false, false),
  ('broker', 'approved', true, false, false), ('broker', 'contract', true, false, false), ('broker', 'closed', true, false, false),
  ('manager', 'lead', true, true, true), ('manager', 'proposal', true, true, true),
  ('manager', 'visit_scheduled', true, true, true), ('manager', 'under_analysis', true, true, true),
  ('manager', 'approved', true, true, true), ('manager', 'contract', true, true, false), ('manager', 'closed', true, false, false),
  ('director', 'lead', true, true, true), ('director', 'proposal', true, true, true),
  ('director', 'visit_scheduled', true, true, true), ('director', 'under_analysis', true, true, true),
  ('director', 'approved', true, true, true), ('director', 'contract', true, true, true), ('director', 'closed', true, true, true),
  ('cca', 'lead', false, false, false), ('cca', 'proposal', false, false, false),
  ('cca', 'visit_scheduled', false, false, false), ('cca', 'under_analysis', true, true, true),
  ('cca', 'approved', true, true, true), ('cca', 'contract', false, false, false), ('cca', 'closed', false, false, false);

INSERT INTO public.teams (name) VALUES ('Alpha'), ('Beta'), ('Gamma');

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), NEW.email);
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'broker');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Updated at triggers
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_cca_deals_updated_at BEFORE UPDATE ON public.cca_deals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
