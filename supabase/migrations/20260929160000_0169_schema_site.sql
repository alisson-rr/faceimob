-- =============================================================================
-- 0169 — schema `site`: o banco do site faceimob.com.br dentro do CRM
--
-- Decisão de 29/09/2026: o site sai do Lovable Cloud e passa a usar este
-- banco (docs/migracao-site.md). Esta migration cria a ESTRUTURA vazia; os
-- dados chegam depois pela importação, conferidos tabela a tabela.
--
-- Gerado a partir das 50 migrations do repositório do site (aplicadas num
-- banco de ensaio e exportadas com pg_dump), com três trocas:
--   · `public.` → `site.`: nada colide com as tabelas do CRM;
--   · perfis, papéis e senhas do site NÃO vêm: o login é o do CRM, e
--     `site.has_role` responde pelo papel do CRM;
--   · as políticas de Storage ganham o prefixo "site: " no nome.
-- Uma migration do site (20260917185421_cca_melnick) falha até no Lovable —
-- ON CONFLICT sem índice único compatível — e ficou de fora: a linha dela,
-- se existir lá, chega pela importação.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS site;
GRANT USAGE ON SCHEMA site TO anon, authenticated, service_role;

\restrict x3Vmwt9hORf0QgHeeyCV2u162LVTNrkY6ahaGHseUUdFuO7BAdoE6BULNXOMFId

CREATE TYPE site.app_role AS ENUM (
    'admin',
    'user',
    'corretor'
);

CREATE TYPE site.image_kind AS ENUM (
    'photo',
    'floorplan',
    'cover'
);

CREATE TYPE site.property_status AS ENUM (
    'lancamento',
    'em_obras',
    'pronto_para_morar',
    'entregue'
);

CREATE TYPE site.snippet_location AS ENUM (
    'head',
    'body_end'
);

-- O site perguntava a `private.has_role`. Aqui a resposta vem do CRM: um login
-- só, e inativar no CRM fecha a área de membros junto.
CREATE FUNCTION site.has_role(_user_id uuid, _role site.app_role) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select case _role
    when 'admin' then exists (
      select 1 from public.profiles p
        join public.user_roles ur on ur.profile_id = p.id
       where p.id = _user_id and p.status = 'active' and ur.role in ('admin', 'partner'))
    when 'corretor' then exists (
      select 1 from public.profiles p where p.id = _user_id and p.status = 'active')
    else false
  end;
$$;

CREATE FUNCTION site.can_manage_support_docs(_user_id uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'site', 'public', 'pg_temp'
    AS $$
begin
  return site.has_role(_user_id, 'admin')
      or exists (select 1 from site.support_doc_editors e where e.user_id = _user_id);
end;
$$;

REVOKE ALL ON FUNCTION site.has_role(uuid, site.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION site.has_role(uuid, site.app_role) TO authenticated, service_role;
REVOKE ALL ON FUNCTION site.can_manage_support_docs(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION site.can_manage_support_docs(uuid) TO authenticated, service_role;

CREATE FUNCTION site.credit_apps_rate_limit() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  recent_1h integer;
  recent_1d integer;
BEGIN
  SELECT count(*) INTO recent_1h FROM site.credit_applications
   WHERE phone = NEW.phone AND created_at > now() - interval '1 hour';
  IF recent_1h >= 2 THEN
    RAISE EXCEPTION 'rate_limit_exceeded' USING ERRCODE = 'check_violation';
  END IF;
  SELECT count(*) INTO recent_1d FROM site.credit_applications
   WHERE phone = NEW.phone AND created_at > now() - interval '1 day';
  IF recent_1d >= 4 THEN
    RAISE EXCEPTION 'rate_limit_exceeded' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION site.leads_rate_limit() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  recent_10m integer;
  recent_1h integer;
BEGIN
  SELECT count(*) INTO recent_10m FROM site.leads
   WHERE phone = NEW.phone AND created_at > now() - interval '10 minutes';
  IF recent_10m >= 3 THEN
    RAISE EXCEPTION 'rate_limit_exceeded' USING ERRCODE = 'check_violation';
  END IF;
  SELECT count(*) INTO recent_1h FROM site.leads
   WHERE phone = NEW.phone AND created_at > now() - interval '1 hour';
  IF recent_1h >= 8 THEN
    RAISE EXCEPTION 'rate_limit_exceeded' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION site.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE site.announcements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    body text,
    image_url text,
    cta_label text,
    cta_url text,
    starts_at timestamp with time zone DEFAULT now() NOT NULL,
    ends_at timestamp with time zone,
    active boolean DEFAULT true NOT NULL,
    show_as_banner boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE site.broker_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    label text NOT NULL,
    url text DEFAULT ''::text NOT NULL,
    icon text,
    description text,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE site.cca_developers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    developer text NOT NULL,
    label text DEFAULT 'CCA Próprio'::text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE site.credit_applications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    phone text NOT NULL,
    email text,
    doc_type text NOT NULL,
    address text NOT NULL,
    drive_folder_id text,
    drive_folder_url text,
    files jsonb DEFAULT '[]'::jsonb NOT NULL,
    consent_lgpd boolean DEFAULT false NOT NULL,
    status text DEFAULT 'novo'::text NOT NULL,
    page_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT credit_apps_name_nourl_chk CHECK ((name !~* '(https?://|www\.)'::text)),
    CONSTRAINT credit_apps_phone_format_chk CHECK ((phone ~ '[0-9]{8,}'::text))
);

CREATE TABLE site.developer_folders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    developer text NOT NULL,
    drive_url text NOT NULL,
    logo_url text,
    description text,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    links jsonb DEFAULT '[]'::jsonb NOT NULL
);

CREATE TABLE site.evolucao_universidade (
    user_id uuid NOT NULL,
    nivel integer DEFAULT 1 NOT NULL,
    experiencia integer DEFAULT 0 NOT NULL,
    dados jsonb DEFAULT '{}'::jsonb NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE site.facebook_campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    form_title text NOT NULL,
    copy_text text,
    image_url text,
    image_path text,
    target_url text,
    meta_ad_id text,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    media_kind text DEFAULT 'static'::text NOT NULL,
    media jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT facebook_campaigns_media_kind_check CHECK ((media_kind = ANY (ARRAY['static'::text, 'carousel'::text, 'video'::text])))
);

CREATE TABLE site.leads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    phone text NOT NULL,
    email text,
    message text,
    property_id uuid,
    source text DEFAULT 'whatsapp_button'::text NOT NULL,
    page_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT leads_name_nourl_chk CHECK ((name !~* '(https?://|www\.)'::text)),
    CONSTRAINT leads_phone_format_chk CHECK ((phone ~ '[0-9]{5,}'::text))
);

CREATE TABLE site.lote_imagens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lote_id uuid NOT NULL,
    url text NOT NULL,
    storage_path text,
    alt_text text,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE site.lotes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    slug text NOT NULL,
    title text NOT NULL,
    subtitle text,
    description text,
    city text NOT NULL,
    neighborhood text,
    state text DEFAULT 'RS'::text NOT NULL,
    address text,
    latitude numeric,
    longitude numeric,
    area_sqm numeric,
    front_m numeric,
    depth_m numeric,
    price numeric,
    down_payment numeric,
    installments_count integer,
    installment_value numeric,
    developer text,
    infrastructure text[] DEFAULT '{}'::text[] NOT NULL,
    differentials text[] DEFAULT '{}'::text[] NOT NULL,
    units_total integer,
    units_left integer,
    valorization_text text,
    featured boolean DEFAULT false NOT NULL,
    highlight_text text,
    active boolean DEFAULT true NOT NULL,
    seo_title text,
    seo_description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE site.popups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    kind text DEFAULT 'exit_or_timer'::text NOT NULL,
    title text NOT NULL,
    body text,
    image_url text,
    cta_label text DEFAULT 'Falar no WhatsApp'::text NOT NULL,
    cta_target text DEFAULT 'internal_route'::text NOT NULL,
    cta_url text DEFAULT '/analise-credito'::text NOT NULL,
    delay_seconds integer DEFAULT 20 NOT NULL,
    show_once_per_session boolean DEFAULT true NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE site.posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    title text NOT NULL,
    excerpt text,
    content text,
    cover_url text,
    published boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE site.properties (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    slug text NOT NULL,
    title text NOT NULL,
    subtitle text,
    description text,
    city text NOT NULL,
    neighborhood text,
    state text DEFAULT 'RS'::text NOT NULL,
    address text,
    latitude numeric(10,7),
    longitude numeric(10,7),
    price numeric(12,2),
    price_from numeric(12,2),
    bedrooms integer,
    bathrooms integer,
    parking_spots integer,
    area_sqm numeric(8,2),
    status site.property_status DEFAULT 'lancamento'::site.property_status NOT NULL,
    delivery_date date,
    developer text,
    is_mcmv boolean DEFAULT true NOT NULL,
    down_payment numeric(12,2),
    subsidy_estimate numeric(12,2),
    monthly_installment numeric(12,2),
    amenities text[] DEFAULT ARRAY[]::text[],
    differentials text[] DEFAULT ARRAY[]::text[],
    video_url text,
    tour_url text,
    featured boolean DEFAULT false NOT NULL,
    active boolean DEFAULT true NOT NULL,
    seo_title text,
    seo_description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    book_url text,
    book_path text,
    highlight_text text,
    source_url text,
    last_scraped_at timestamp with time zone
);

CREATE TABLE site.property_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    property_id uuid NOT NULL,
    url text NOT NULL,
    storage_path text,
    alt_text text,
    kind site.image_kind DEFAULT 'photo'::site.image_kind NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE site.property_owners (
    property_id uuid NOT NULL,
    owner_name text,
    owner_phone text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE site.scrapers_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    developer_name text NOT NULL,
    base_url text NOT NULL,
    list_url text,
    item_selector text,
    active boolean DEFAULT true,
    last_run_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE site.settings (
    id integer DEFAULT 1 NOT NULL,
    company_name text DEFAULT 'FaceImob'::text NOT NULL,
    whatsapp_number text DEFAULT '5551990079445'::text NOT NULL,
    contact_email text,
    tagline text,
    about_text text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    theme_primary text DEFAULT '#2a4a7d'::text NOT NULL,
    theme_accent text DEFAULT '#8bc4a9'::text NOT NULL,
    theme_highlight text DEFAULT '#e8c547'::text NOT NULL,
    instagram_url text,
    facebook_url text,
    youtube_url text,
    contact_phone text,
    CONSTRAINT single_row CHECK ((id = 1))
);

CREATE TABLE site.settings_private (
    id integer DEFAULT 1 NOT NULL,
    notify_email text,
    notify_whatsapp text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT settings_private_singleton CHECK ((id = 1))
);

CREATE TABLE site.snippets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    code text NOT NULL,
    location site.snippet_location DEFAULT 'head'::site.snippet_location NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE site.support_doc_editors (
    user_id uuid NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE site.support_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text,
    file_url text,
    file_path text,
    file_type text,
    file_size bigint,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    file_name text
);

CREATE TABLE site.university_sections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text,
    cover_url text,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE site.university_videos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    section_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    cover_url text,
    video_url text,
    duration_label text,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    views_count integer DEFAULT 0 NOT NULL,
    materials jsonb DEFAULT '[]'::jsonb NOT NULL
);

CREATE TABLE site.university_watched (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    video_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    progress_seconds integer DEFAULT 0 NOT NULL,
    last_position_seconds integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY site.announcements
    ADD CONSTRAINT announcements_pkey PRIMARY KEY (id);

ALTER TABLE ONLY site.broker_links
    ADD CONSTRAINT broker_links_key_key UNIQUE (key);

ALTER TABLE ONLY site.broker_links
    ADD CONSTRAINT broker_links_pkey PRIMARY KEY (id);

ALTER TABLE ONLY site.cca_developers
    ADD CONSTRAINT cca_developers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY site.credit_applications
    ADD CONSTRAINT credit_applications_pkey PRIMARY KEY (id);

ALTER TABLE ONLY site.developer_folders
    ADD CONSTRAINT developer_folders_pkey PRIMARY KEY (id);

ALTER TABLE ONLY site.evolucao_universidade
    ADD CONSTRAINT evolucao_universidade_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY site.facebook_campaigns
    ADD CONSTRAINT facebook_campaigns_pkey PRIMARY KEY (id);

ALTER TABLE ONLY site.leads
    ADD CONSTRAINT leads_pkey PRIMARY KEY (id);

ALTER TABLE ONLY site.lote_imagens
    ADD CONSTRAINT lote_imagens_pkey PRIMARY KEY (id);

ALTER TABLE ONLY site.lotes
    ADD CONSTRAINT lotes_code_key UNIQUE (code);

ALTER TABLE ONLY site.lotes
    ADD CONSTRAINT lotes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY site.lotes
    ADD CONSTRAINT lotes_slug_key UNIQUE (slug);

ALTER TABLE ONLY site.popups
    ADD CONSTRAINT popups_pkey PRIMARY KEY (id);

ALTER TABLE ONLY site.posts
    ADD CONSTRAINT posts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY site.posts
    ADD CONSTRAINT posts_slug_key UNIQUE (slug);

ALTER TABLE ONLY site.properties
    ADD CONSTRAINT properties_code_key UNIQUE (code);

ALTER TABLE ONLY site.properties
    ADD CONSTRAINT properties_pkey PRIMARY KEY (id);

ALTER TABLE ONLY site.properties
    ADD CONSTRAINT properties_slug_key UNIQUE (slug);

ALTER TABLE ONLY site.property_images
    ADD CONSTRAINT property_images_pkey PRIMARY KEY (id);

ALTER TABLE ONLY site.property_owners
    ADD CONSTRAINT property_owners_pkey PRIMARY KEY (property_id);

ALTER TABLE ONLY site.scrapers_config
    ADD CONSTRAINT scrapers_config_developer_name_key UNIQUE (developer_name);

ALTER TABLE ONLY site.scrapers_config
    ADD CONSTRAINT scrapers_config_pkey PRIMARY KEY (id);

ALTER TABLE ONLY site.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY site.settings_private
    ADD CONSTRAINT settings_private_pkey PRIMARY KEY (id);

ALTER TABLE ONLY site.snippets
    ADD CONSTRAINT snippets_pkey PRIMARY KEY (id);

ALTER TABLE ONLY site.support_doc_editors
    ADD CONSTRAINT support_doc_editors_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY site.support_documents
    ADD CONSTRAINT support_documents_pkey PRIMARY KEY (id);

ALTER TABLE ONLY site.university_sections
    ADD CONSTRAINT university_sections_pkey PRIMARY KEY (id);

ALTER TABLE ONLY site.university_videos
    ADD CONSTRAINT university_videos_pkey PRIMARY KEY (id);

ALTER TABLE ONLY site.university_watched
    ADD CONSTRAINT university_watched_pkey PRIMARY KEY (id);

ALTER TABLE ONLY site.university_watched
    ADD CONSTRAINT university_watched_user_id_video_id_key UNIQUE (user_id, video_id);

CREATE UNIQUE INDEX cca_developers_developer_key ON site.cca_developers USING btree (lower(developer));

CREATE INDEX credit_apps_phone_created_idx ON site.credit_applications USING btree (phone, created_at DESC);

CREATE INDEX idx_leads_created ON site.leads USING btree (created_at DESC);

CREATE INDEX idx_leads_property ON site.leads USING btree (property_id);

CREATE INDEX idx_lote_imagens_lote_id ON site.lote_imagens USING btree (lote_id);

CREATE INDEX idx_lotes_active ON site.lotes USING btree (active);

CREATE INDEX idx_properties_active ON site.properties USING btree (active);

CREATE INDEX idx_properties_city ON site.properties USING btree (city);

CREATE INDEX idx_properties_featured ON site.properties USING btree (featured) WHERE (featured = true);

CREATE INDEX idx_properties_slug ON site.properties USING btree (slug);

CREATE INDEX idx_property_images_property ON site.property_images USING btree (property_id, sort_order);

CREATE INDEX leads_phone_created_idx ON site.leads USING btree (phone, created_at DESC);

CREATE INDEX university_watched_user_id_idx ON site.university_watched USING btree (user_id);

CREATE INDEX university_watched_video_id_idx ON site.university_watched USING btree (video_id);

CREATE TRIGGER credit_apps_rate_limit_trg BEFORE INSERT ON site.credit_applications FOR EACH ROW EXECUTE FUNCTION site.credit_apps_rate_limit();

CREATE TRIGGER leads_rate_limit_trg BEFORE INSERT ON site.leads FOR EACH ROW EXECUTE FUNCTION site.leads_rate_limit();

CREATE TRIGGER popups_updated_at BEFORE UPDATE ON site.popups FOR EACH ROW EXECUTE FUNCTION site.update_updated_at_column();

CREATE TRIGGER trg_broker_links_updated BEFORE UPDATE ON site.broker_links FOR EACH ROW EXECUTE FUNCTION site.update_updated_at_column();

CREATE TRIGGER trg_developer_folders_updated BEFORE UPDATE ON site.developer_folders FOR EACH ROW EXECUTE FUNCTION site.update_updated_at_column();

CREATE TRIGGER trg_facebook_campaigns_updated BEFORE UPDATE ON site.facebook_campaigns FOR EACH ROW EXECUTE FUNCTION site.update_updated_at_column();

CREATE TRIGGER trg_lotes_updated BEFORE UPDATE ON site.lotes FOR EACH ROW EXECUTE FUNCTION site.update_updated_at_column();

CREATE TRIGGER trg_property_owners_updated_at BEFORE UPDATE ON site.property_owners FOR EACH ROW EXECUTE FUNCTION site.update_updated_at_column();

CREATE TRIGGER trg_support_documents_updated BEFORE UPDATE ON site.support_documents FOR EACH ROW EXECUTE FUNCTION site.update_updated_at_column();

CREATE TRIGGER trg_university_sections_updated BEFORE UPDATE ON site.university_sections FOR EACH ROW EXECUTE FUNCTION site.update_updated_at_column();

CREATE TRIGGER trg_university_videos_updated BEFORE UPDATE ON site.university_videos FOR EACH ROW EXECUTE FUNCTION site.update_updated_at_column();

CREATE TRIGGER update_announcements_updated_at BEFORE UPDATE ON site.announcements FOR EACH ROW EXECUTE FUNCTION site.update_updated_at_column();

CREATE TRIGGER update_evolucao_universidade_updated_at BEFORE UPDATE ON site.evolucao_universidade FOR EACH ROW EXECUTE FUNCTION site.update_updated_at_column();

CREATE TRIGGER update_posts_updated_at BEFORE UPDATE ON site.posts FOR EACH ROW EXECUTE FUNCTION site.update_updated_at_column();

CREATE TRIGGER update_properties_updated_at BEFORE UPDATE ON site.properties FOR EACH ROW EXECUTE FUNCTION site.update_updated_at_column();

CREATE TRIGGER update_settings_private_updated_at BEFORE UPDATE ON site.settings_private FOR EACH ROW EXECUTE FUNCTION site.update_updated_at_column();

CREATE TRIGGER update_settings_updated_at BEFORE UPDATE ON site.settings FOR EACH ROW EXECUTE FUNCTION site.update_updated_at_column();

CREATE TRIGGER update_snippets_updated_at BEFORE UPDATE ON site.snippets FOR EACH ROW EXECUTE FUNCTION site.update_updated_at_column();

CREATE TRIGGER update_university_watched_updated_at BEFORE UPDATE ON site.university_watched FOR EACH ROW EXECUTE FUNCTION site.update_updated_at_column();

ALTER TABLE ONLY site.evolucao_universidade
    ADD CONSTRAINT evolucao_universidade_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY site.leads
    ADD CONSTRAINT leads_property_id_fkey FOREIGN KEY (property_id) REFERENCES site.properties(id) ON DELETE SET NULL;

ALTER TABLE ONLY site.lote_imagens
    ADD CONSTRAINT lote_imagens_lote_id_fkey FOREIGN KEY (lote_id) REFERENCES site.lotes(id) ON DELETE CASCADE;

ALTER TABLE ONLY site.property_images
    ADD CONSTRAINT property_images_property_id_fkey FOREIGN KEY (property_id) REFERENCES site.properties(id) ON DELETE CASCADE;

ALTER TABLE ONLY site.property_owners
    ADD CONSTRAINT property_owners_property_id_fkey FOREIGN KEY (property_id) REFERENCES site.properties(id) ON DELETE CASCADE;

ALTER TABLE ONLY site.support_doc_editors
    ADD CONSTRAINT support_doc_editors_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY site.university_videos
    ADD CONSTRAINT university_videos_section_id_fkey FOREIGN KEY (section_id) REFERENCES site.university_sections(id) ON DELETE CASCADE;

ALTER TABLE ONLY site.university_watched
    ADD CONSTRAINT university_watched_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY site.university_watched
    ADD CONSTRAINT university_watched_video_id_fkey FOREIGN KEY (video_id) REFERENCES site.university_videos(id) ON DELETE CASCADE;

CREATE POLICY "Admins can delete leads" ON site.leads FOR DELETE TO authenticated USING (site.has_role(auth.uid(), 'admin'::site.app_role));

CREATE POLICY "Admins can delete lotes" ON site.lotes FOR DELETE TO authenticated USING (site.has_role(auth.uid(), 'admin'::site.app_role));

CREATE POLICY "Admins can delete properties" ON site.properties FOR DELETE TO authenticated USING (site.has_role(auth.uid(), 'admin'::site.app_role));

CREATE POLICY "Admins can insert lotes" ON site.lotes FOR INSERT TO authenticated WITH CHECK (site.has_role(auth.uid(), 'admin'::site.app_role));

CREATE POLICY "Admins can insert properties" ON site.properties FOR INSERT TO authenticated WITH CHECK (site.has_role(auth.uid(), 'admin'::site.app_role));

CREATE POLICY "Admins can manage all images" ON site.property_images TO authenticated USING (site.has_role(auth.uid(), 'admin'::site.app_role)) WITH CHECK (site.has_role(auth.uid(), 'admin'::site.app_role));

CREATE POLICY "Admins can manage announcements" ON site.announcements TO authenticated USING (site.has_role(auth.uid(), 'admin'::site.app_role)) WITH CHECK (site.has_role(auth.uid(), 'admin'::site.app_role));

CREATE POLICY "Admins can manage lote images" ON site.lote_imagens TO authenticated USING (site.has_role(auth.uid(), 'admin'::site.app_role)) WITH CHECK (site.has_role(auth.uid(), 'admin'::site.app_role));

CREATE POLICY "Admins can manage scrapers_config" ON site.scrapers_config TO authenticated USING (site.has_role(auth.uid(), 'admin'::site.app_role));

CREATE POLICY "Admins can manage snippets" ON site.snippets TO authenticated USING (site.has_role(auth.uid(), 'admin'::site.app_role)) WITH CHECK (site.has_role(auth.uid(), 'admin'::site.app_role));

CREATE POLICY "Admins can update leads" ON site.leads FOR UPDATE TO authenticated USING (site.has_role(auth.uid(), 'admin'::site.app_role)) WITH CHECK (site.has_role(auth.uid(), 'admin'::site.app_role));

CREATE POLICY "Admins can update lotes" ON site.lotes FOR UPDATE TO authenticated USING (site.has_role(auth.uid(), 'admin'::site.app_role)) WITH CHECK (site.has_role(auth.uid(), 'admin'::site.app_role));

CREATE POLICY "Admins can update properties" ON site.properties FOR UPDATE TO authenticated USING (site.has_role(auth.uid(), 'admin'::site.app_role)) WITH CHECK (site.has_role(auth.uid(), 'admin'::site.app_role));

CREATE POLICY "Admins can update settings" ON site.settings FOR UPDATE TO authenticated USING (site.has_role(auth.uid(), 'admin'::site.app_role)) WITH CHECK (site.has_role(auth.uid(), 'admin'::site.app_role));

CREATE POLICY "Admins can view all leads" ON site.leads FOR SELECT TO authenticated USING (site.has_role(auth.uid(), 'admin'::site.app_role));

CREATE POLICY "Admins can view all lotes" ON site.lotes FOR SELECT TO authenticated USING (site.has_role(auth.uid(), 'admin'::site.app_role));

CREATE POLICY "Admins can view all properties" ON site.properties FOR SELECT TO authenticated USING (site.has_role(auth.uid(), 'admin'::site.app_role));

CREATE POLICY "Admins delete credit applications" ON site.credit_applications FOR DELETE TO authenticated USING (site.has_role(auth.uid(), 'admin'::site.app_role));

CREATE POLICY "Admins manage broker_links" ON site.broker_links TO authenticated USING (site.has_role(auth.uid(), 'admin'::site.app_role)) WITH CHECK (site.has_role(auth.uid(), 'admin'::site.app_role));

CREATE POLICY "Admins manage cca developers" ON site.cca_developers TO authenticated USING (site.has_role(auth.uid(), 'admin'::site.app_role)) WITH CHECK (site.has_role(auth.uid(), 'admin'::site.app_role));

CREATE POLICY "Admins manage developer_folders" ON site.developer_folders TO authenticated USING (site.has_role(auth.uid(), 'admin'::site.app_role)) WITH CHECK (site.has_role(auth.uid(), 'admin'::site.app_role));

CREATE POLICY "Admins manage facebook_campaigns" ON site.facebook_campaigns TO authenticated USING (site.has_role(auth.uid(), 'admin'::site.app_role)) WITH CHECK (site.has_role(auth.uid(), 'admin'::site.app_role));

CREATE POLICY "Admins manage popups" ON site.popups TO authenticated USING (site.has_role(auth.uid(), 'admin'::site.app_role)) WITH CHECK (site.has_role(auth.uid(), 'admin'::site.app_role));

CREATE POLICY "Admins manage posts" ON site.posts TO authenticated USING (site.has_role(auth.uid(), 'admin'::site.app_role)) WITH CHECK (site.has_role(auth.uid(), 'admin'::site.app_role));

CREATE POLICY "Admins manage property_owners" ON site.property_owners TO authenticated USING (site.has_role(auth.uid(), 'admin'::site.app_role)) WITH CHECK (site.has_role(auth.uid(), 'admin'::site.app_role));

CREATE POLICY "Admins manage sections" ON site.university_sections TO authenticated USING (site.has_role(auth.uid(), 'admin'::site.app_role)) WITH CHECK (site.has_role(auth.uid(), 'admin'::site.app_role));

CREATE POLICY "Admins manage settings_private" ON site.settings_private TO authenticated USING (site.has_role(auth.uid(), 'admin'::site.app_role)) WITH CHECK (site.has_role(auth.uid(), 'admin'::site.app_role));

CREATE POLICY "Admins manage videos" ON site.university_videos TO authenticated USING (site.has_role(auth.uid(), 'admin'::site.app_role)) WITH CHECK (site.has_role(auth.uid(), 'admin'::site.app_role));

CREATE POLICY "Admins update credit applications" ON site.credit_applications FOR UPDATE TO authenticated USING (site.has_role(auth.uid(), 'admin'::site.app_role)) WITH CHECK (site.has_role(auth.uid(), 'admin'::site.app_role));

CREATE POLICY "Admins veem toda a evolucao" ON site.evolucao_universidade FOR SELECT TO authenticated USING (site.has_role(auth.uid(), 'admin'::site.app_role));

CREATE POLICY "Admins veem todo o progresso" ON site.university_watched FOR SELECT TO authenticated USING (site.has_role(auth.uid(), 'admin'::site.app_role));

CREATE POLICY "Admins view credit applications" ON site.credit_applications FOR SELECT TO authenticated USING (site.has_role(auth.uid(), 'admin'::site.app_role));

CREATE POLICY "Anyone can create a lead" ON site.leads FOR INSERT TO anon, authenticated WITH CHECK ((((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 200)) AND ((char_length(btrim(phone)) >= 5) AND (char_length(btrim(phone)) <= 40)) AND ((email IS NULL) OR (char_length(email) <= 200)) AND ((message IS NULL) OR (char_length(message) <= 2000)) AND ((source IS NULL) OR (char_length(source) <= 60)) AND ((page_url IS NULL) OR (char_length(page_url) <= 2048))));

CREATE POLICY "Anyone can submit credit application" ON site.credit_applications FOR INSERT TO anon, authenticated WITH CHECK ((((char_length(btrim(name)) >= 2) AND (char_length(btrim(name)) <= 150)) AND ((char_length(btrim(phone)) >= 6) AND (char_length(btrim(phone)) <= 30)) AND ((char_length(btrim(address)) >= 5) AND (char_length(btrim(address)) <= 400)) AND (doc_type = ANY (ARRAY['rg'::text, 'cnh'::text])) AND (consent_lgpd = true)));

CREATE POLICY "Anyone can view active announcements" ON site.announcements FOR SELECT TO anon, authenticated USING (((active = true) AND (starts_at <= now()) AND ((ends_at IS NULL) OR (ends_at >= now()))));

CREATE POLICY "Anyone can view active cca developers" ON site.cca_developers FOR SELECT TO anon, authenticated USING ((active = true));

CREATE POLICY "Anyone can view active lotes" ON site.lotes FOR SELECT USING ((active = true));

CREATE POLICY "Anyone can view active popups" ON site.popups FOR SELECT TO anon, authenticated USING ((active = true));

CREATE POLICY "Anyone can view active properties" ON site.properties FOR SELECT TO anon, authenticated USING ((active = true));

CREATE POLICY "Anyone can view active snippets" ON site.snippets FOR SELECT TO anon, authenticated USING ((active = true));

CREATE POLICY "Anyone can view images of active lotes" ON site.lote_imagens FOR SELECT USING ((EXISTS ( SELECT 1
   FROM site.lotes l
  WHERE ((l.id = lote_imagens.lote_id) AND (l.active = true)))));

CREATE POLICY "Anyone can view images of active properties" ON site.property_images FOR SELECT TO anon, authenticated USING ((EXISTS ( SELECT 1
   FROM site.properties p
  WHERE ((p.id = property_images.property_id) AND (p.active = true)))));

CREATE POLICY "Anyone can view published posts" ON site.posts FOR SELECT TO anon, authenticated USING ((published = true));

CREATE POLICY "Anyone can view settings" ON site.settings FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Broker or admin view broker_links" ON site.broker_links FOR SELECT TO authenticated USING ((site.has_role(auth.uid(), 'admin'::site.app_role) OR site.has_role(auth.uid(), 'corretor'::site.app_role)));

CREATE POLICY "Broker or admin view developer_folders" ON site.developer_folders FOR SELECT TO authenticated USING ((site.has_role(auth.uid(), 'admin'::site.app_role) OR site.has_role(auth.uid(), 'corretor'::site.app_role)));

CREATE POLICY "Broker or admin view facebook_campaigns" ON site.facebook_campaigns FOR SELECT TO authenticated USING (((site.has_role(auth.uid(), 'admin'::site.app_role) OR site.has_role(auth.uid(), 'corretor'::site.app_role)) AND ((active = true) OR site.has_role(auth.uid(), 'admin'::site.app_role))));

CREATE POLICY "Brokers and admins can read sections" ON site.university_sections FOR SELECT TO authenticated USING ((site.has_role(auth.uid(), 'corretor'::site.app_role) OR site.has_role(auth.uid(), 'admin'::site.app_role)));

CREATE POLICY "Brokers and admins can read videos" ON site.university_videos FOR SELECT TO authenticated USING ((site.has_role(auth.uid(), 'corretor'::site.app_role) OR site.has_role(auth.uid(), 'admin'::site.app_role)));

CREATE POLICY "Corretor gerencia seu proprio progresso" ON site.university_watched TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "Corretor gerencia sua propria evolucao" ON site.evolucao_universidade TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "Own editor row or admin can read" ON site.support_doc_editors FOR SELECT TO authenticated USING (((auth.uid() = user_id) OR site.has_role(auth.uid(), 'admin'::site.app_role)));

CREATE POLICY "Users can insert their own watched videos" ON site.university_watched FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "Users can remove their own watched history" ON site.university_watched FOR DELETE TO authenticated USING ((auth.uid() = user_id));

CREATE POLICY "Users can view their own watched videos" ON site.university_watched FOR SELECT TO authenticated USING ((auth.uid() = user_id));

CREATE POLICY "admins manage editors" ON site.support_doc_editors TO authenticated USING (site.has_role(auth.uid(), 'admin'::site.app_role)) WITH CHECK (site.has_role(auth.uid(), 'admin'::site.app_role));

ALTER TABLE site.announcements ENABLE ROW LEVEL SECURITY;

ALTER TABLE site.broker_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brokers read support docs" ON site.support_documents FOR SELECT TO authenticated USING ((site.has_role(auth.uid(), 'corretor'::site.app_role) OR site.can_manage_support_docs(auth.uid())));

ALTER TABLE site.cca_developers ENABLE ROW LEVEL SECURITY;

ALTER TABLE site.credit_applications ENABLE ROW LEVEL SECURITY;

ALTER TABLE site.developer_folders ENABLE ROW LEVEL SECURITY;

ALTER TABLE site.evolucao_universidade ENABLE ROW LEVEL SECURITY;

ALTER TABLE site.facebook_campaigns ENABLE ROW LEVEL SECURITY;

ALTER TABLE site.leads ENABLE ROW LEVEL SECURITY;

ALTER TABLE site.lote_imagens ENABLE ROW LEVEL SECURITY;

ALTER TABLE site.lotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "managers write support docs" ON site.support_documents TO authenticated USING (site.can_manage_support_docs(auth.uid())) WITH CHECK (site.can_manage_support_docs(auth.uid()));

ALTER TABLE site.popups ENABLE ROW LEVEL SECURITY;

ALTER TABLE site.posts ENABLE ROW LEVEL SECURITY;

ALTER TABLE site.properties ENABLE ROW LEVEL SECURITY;

ALTER TABLE site.property_images ENABLE ROW LEVEL SECURITY;

ALTER TABLE site.property_owners ENABLE ROW LEVEL SECURITY;

ALTER TABLE site.scrapers_config ENABLE ROW LEVEL SECURITY;

ALTER TABLE site.settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE site.settings_private ENABLE ROW LEVEL SECURITY;

ALTER TABLE site.snippets ENABLE ROW LEVEL SECURITY;

ALTER TABLE site.support_doc_editors ENABLE ROW LEVEL SECURITY;

ALTER TABLE site.support_documents ENABLE ROW LEVEL SECURITY;

ALTER TABLE site.university_sections ENABLE ROW LEVEL SECURITY;

ALTER TABLE site.university_videos ENABLE ROW LEVEL SECURITY;

ALTER TABLE site.university_watched ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON FUNCTION site.credit_apps_rate_limit() FROM PUBLIC;

REVOKE ALL ON FUNCTION site.leads_rate_limit() FROM PUBLIC;

REVOKE ALL ON FUNCTION site.update_updated_at_column() FROM PUBLIC;

GRANT SELECT ON TABLE site.announcements TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE site.announcements TO authenticated;
GRANT ALL ON TABLE site.announcements TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE site.broker_links TO authenticated;
GRANT ALL ON TABLE site.broker_links TO service_role;

GRANT SELECT ON TABLE site.cca_developers TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE site.cca_developers TO authenticated;
GRANT ALL ON TABLE site.cca_developers TO service_role;

GRANT INSERT ON TABLE site.credit_applications TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE site.credit_applications TO authenticated;
GRANT ALL ON TABLE site.credit_applications TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE site.developer_folders TO authenticated;
GRANT ALL ON TABLE site.developer_folders TO service_role;

GRANT SELECT,INSERT,UPDATE ON TABLE site.evolucao_universidade TO authenticated;
GRANT ALL ON TABLE site.evolucao_universidade TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE site.facebook_campaigns TO authenticated;
GRANT ALL ON TABLE site.facebook_campaigns TO service_role;

GRANT INSERT ON TABLE site.leads TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE site.leads TO authenticated;
GRANT ALL ON TABLE site.leads TO service_role;

GRANT SELECT ON TABLE site.lote_imagens TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE site.lote_imagens TO authenticated;
GRANT ALL ON TABLE site.lote_imagens TO service_role;

GRANT SELECT ON TABLE site.lotes TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE site.lotes TO authenticated;
GRANT ALL ON TABLE site.lotes TO service_role;

GRANT SELECT ON TABLE site.popups TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE site.popups TO authenticated;
GRANT ALL ON TABLE site.popups TO service_role;

GRANT SELECT ON TABLE site.posts TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE site.posts TO authenticated;
GRANT ALL ON TABLE site.posts TO service_role;

GRANT SELECT ON TABLE site.properties TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE site.properties TO authenticated;
GRANT ALL ON TABLE site.properties TO service_role;

GRANT SELECT ON TABLE site.property_images TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE site.property_images TO authenticated;
GRANT ALL ON TABLE site.property_images TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE site.property_owners TO authenticated;
GRANT ALL ON TABLE site.property_owners TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE site.scrapers_config TO authenticated;
GRANT ALL ON TABLE site.scrapers_config TO service_role;

GRANT SELECT ON TABLE site.settings TO anon;
GRANT SELECT,UPDATE ON TABLE site.settings TO authenticated;
GRANT ALL ON TABLE site.settings TO service_role;

GRANT SELECT,INSERT,UPDATE ON TABLE site.settings_private TO authenticated;
GRANT ALL ON TABLE site.settings_private TO service_role;

GRANT SELECT ON TABLE site.snippets TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE site.snippets TO authenticated;
GRANT ALL ON TABLE site.snippets TO service_role;

GRANT SELECT ON TABLE site.support_doc_editors TO authenticated;
GRANT ALL ON TABLE site.support_doc_editors TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE site.support_documents TO authenticated;
GRANT ALL ON TABLE site.support_documents TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE site.university_sections TO authenticated;
GRANT ALL ON TABLE site.university_sections TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE site.university_videos TO authenticated;
GRANT ALL ON TABLE site.university_videos TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE site.university_watched TO authenticated;
GRANT ALL ON TABLE site.university_watched TO service_role;

\unrestrict x3Vmwt9hORf0QgHeeyCV2u162LVTNrkY6ahaGHseUUdFuO7BAdoE6BULNXOMFId

-- -----------------------------------------------------------------------------
-- Storage: as cinco pastas do site. `public` fica falso aqui; a importação
-- copia o valor real de cada pasta no Lovable.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('property-images', 'property-images', false),
       ('property-docs', 'property-docs', false),
       ('campaign-images', 'campaign-images', false),
       ('blog-images', 'blog-images', false),
       ('support-docs', 'support-docs', false)
on conflict (id) do nothing;

create policy "site: Admins can delete property images" on storage.objects for delete to authenticated using (((bucket_id = 'property-images'::text) AND site.has_role(auth.uid(), 'admin'::site.app_role)));
create policy "site: Admins can update property images" on storage.objects for update to authenticated using (((bucket_id = 'property-images'::text) AND site.has_role(auth.uid(), 'admin'::site.app_role))) with check (((bucket_id = 'property-images'::text) AND site.has_role(auth.uid(), 'admin'::site.app_role)));
create policy "site: Admins can upload property images" on storage.objects for insert to authenticated with check (((bucket_id = 'property-images'::text) AND site.has_role(auth.uid(), 'admin'::site.app_role)));
create policy "site: Admins delete campaign images" on storage.objects for delete to authenticated using (((bucket_id = 'campaign-images'::text) AND site.has_role(auth.uid(), 'admin'::site.app_role)));
create policy "site: Admins manage blog images" on storage.objects to authenticated using (((bucket_id = 'blog-images'::text) AND site.has_role(auth.uid(), 'admin'::site.app_role))) with check (((bucket_id = 'blog-images'::text) AND site.has_role(auth.uid(), 'admin'::site.app_role)));
create policy "site: Admins manage property docs" on storage.objects to authenticated using (((bucket_id = 'property-docs'::text) AND site.has_role(auth.uid(), 'admin'::site.app_role))) with check (((bucket_id = 'property-docs'::text) AND site.has_role(auth.uid(), 'admin'::site.app_role)));
create policy "site: Admins update campaign images" on storage.objects for update to authenticated using (((bucket_id = 'campaign-images'::text) AND site.has_role(auth.uid(), 'admin'::site.app_role)));
create policy "site: Admins upload campaign images" on storage.objects for insert to authenticated with check (((bucket_id = 'campaign-images'::text) AND site.has_role(auth.uid(), 'admin'::site.app_role)));
create policy "site: Broker or admin read campaign images" on storage.objects for select to authenticated using (((bucket_id = 'campaign-images'::text) AND (site.has_role(auth.uid(), 'admin'::site.app_role) OR site.has_role(auth.uid(), 'corretor'::site.app_role))));
create policy "site: Public can read active property images" on storage.objects for select to anon, authenticated using (((bucket_id = 'property-images'::text) AND (EXISTS ( SELECT 1
   FROM (site.property_images pi
     JOIN site.properties p ON ((p.id = pi.property_id)))
  WHERE ((pi.storage_path = objects.name) AND (p.active = true))))));
create policy "site: support docs delete" on storage.objects for delete to authenticated using (((bucket_id = 'support-docs'::text) AND site.can_manage_support_docs(auth.uid())));
create policy "site: support docs insert" on storage.objects for insert to authenticated with check (((bucket_id = 'support-docs'::text) AND site.can_manage_support_docs(auth.uid())));
create policy "site: support docs read" on storage.objects for select to authenticated using (((bucket_id = 'support-docs'::text) AND (site.has_role(auth.uid(), 'corretor'::site.app_role) OR site.can_manage_support_docs(auth.uid()))));
create policy "site: support docs update" on storage.objects for update to authenticated using (((bucket_id = 'support-docs'::text) AND site.can_manage_support_docs(auth.uid()))) with check (((bucket_id = 'support-docs'::text) AND site.can_manage_support_docs(auth.uid())));

-- =============================================================================
-- Importação (etapa 2 da migração). Só a service role grava: a edge function
-- `site-import` puxa as páginas da rota de exportação do site e chama estas
-- funções. Repetir não duplica (upsert pela chave primária).
-- =============================================================================

-- Usuário do site → perfil do CRM, casado pelo e-mail. Quem fica sem par é a
-- lista de pendências da virada: nada é criado sozinho.
create table site.mapa_usuarios (
  site_user_id   uuid primary key,
  email          text not null,
  full_name      text,
  papeis         text[] not null default '{}',
  crm_profile_id uuid references public.profiles(id) on delete set null,
  importado_em   timestamptz not null default now()
);
alter table site.mapa_usuarios enable row level security;
grant select on site.mapa_usuarios to authenticated;
grant all on site.mapa_usuarios to service_role;
create policy mapa_usuarios_admin on site.mapa_usuarios for select to authenticated using (public.is_admin());

create or replace function public.site_import_usuarios(p_usuarios jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total int;
  v_casados int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Somente a service role importa usuários do site.' using errcode = '42501';
  end if;

  insert into site.mapa_usuarios as m (site_user_id, email, full_name, papeis, crm_profile_id, importado_em)
  select u.id, lower(btrim(u.email)), u.full_name, coalesce(u.papeis, '{}'),
         (select p.id from public.profiles p where lower(p.email) = lower(btrim(u.email)) limit 1),
         now()
    from jsonb_to_recordset(p_usuarios) as u(id uuid, email text, full_name text, papeis text[])
   where u.id is not null and coalesce(btrim(u.email), '') <> ''
  on conflict (site_user_id) do update
     set email = excluded.email, full_name = excluded.full_name, papeis = excluded.papeis,
         crm_profile_id = excluded.crm_profile_id, importado_em = excluded.importado_em;

  select count(*), count(crm_profile_id) into v_total, v_casados from site.mapa_usuarios;
  return jsonb_build_object('usuarios', v_total, 'casados', v_casados, 'sem_par', v_total - v_casados);
end;
$$;

-- Tabelas que a importação aceita, na ordem das chaves estrangeiras.
create or replace function public.site_import_tabelas()
returns text[]
language sql
immutable
as $$
  select array[
    'settings', 'settings_private', 'snippets', 'popups', 'announcements', 'cca_developers',
    'developer_folders', 'broker_links', 'scrapers_config', 'posts',
    'property_owners', 'properties', 'property_images', 'lotes', 'lote_imagens',
    'facebook_campaigns', 'credit_applications', 'leads',
    'university_sections', 'university_videos', 'university_watched', 'evolucao_universidade',
    'support_doc_editors', 'support_documents'
  ]::text[];
$$;

create or replace function public.site_import_linhas(p_tabela text, p_linhas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rel      regclass;
  v_pk       text;
  v_cols     text;
  v_set      text;
  v_linhas   jsonb := coalesce(p_linhas, '[]'::jsonb);
  v_recebidas int := jsonb_array_length(coalesce(p_linhas, '[]'::jsonb));
  v_gravadas int := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Somente a service role importa dados do site.' using errcode = '42501';
  end if;
  if not (p_tabela = any (public.site_import_tabelas())) then
    raise exception 'Tabela fora da importação do site: %', p_tabela using errcode = 'P0001';
  end if;
  v_rel := format('site.%I', p_tabela)::regclass;

  -- O id do usuário do site vira o do perfil do CRM. Linha de quem ainda não
  -- tem par fica de fora e é contada: a origem continua intacta no Lovable, e
  -- repetir a importação depois de resolver o par a traz.
  if p_tabela in ('university_watched', 'evolucao_universidade', 'support_doc_editors') then
    select coalesce(jsonb_agg(l || jsonb_build_object('user_id', m.crm_profile_id)), '[]'::jsonb)
      into v_linhas
      from jsonb_array_elements(v_linhas) l
      join site.mapa_usuarios m on m.site_user_id = (l->>'user_id')::uuid
     where m.crm_profile_id is not null;
  end if;

  select string_agg(quote_ident(a.attname), ', ' order by array_position(i.indkey::int[], a.attnum::int))
    into v_pk
    from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
   where i.indrelid = v_rel and i.indisprimary;

  if jsonb_array_length(v_linhas) = 0 then
    return jsonb_build_object('tabela', p_tabela, 'recebidas', v_recebidas, 'gravadas', 0,
                              'sem_usuario', v_recebidas);
  end if;

  -- Só as colunas que vieram na página: coluna ausente fica com o default da
  -- tabela, e não com nulo.
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum),
         string_agg(format('%1$I = excluded.%1$I', a.attname), ', ' order by a.attnum)
           filter (where not a.attnum = any (coalesce(
             (select i.indkey::int2[] from pg_index i where i.indrelid = v_rel and i.indisprimary), '{}')))
    into v_cols, v_set
    from pg_attribute a
   where a.attrelid = v_rel and a.attnum > 0 and not a.attisdropped
     and v_linhas->0 ? a.attname;

  -- Sem gatilhos: `updated_at` fica o da origem e a trava de spam dos
  -- formulários não recusa o histórico.
  execute format('alter table %s disable trigger user', v_rel);
  execute format(
    'insert into %1$s (%2$s) select %2$s from jsonb_populate_recordset(null::%1$s, $1) on conflict (%3$s) do %4$s',
    v_rel, v_cols, v_pk, case when v_set is null then 'nothing' else 'update set ' || v_set end)
    using v_linhas;
  get diagnostics v_gravadas = row_count;
  execute format('alter table %s enable trigger user', v_rel);

  return jsonb_build_object('tabela', p_tabela, 'recebidas', v_recebidas, 'gravadas', v_gravadas,
                            'sem_usuario', v_recebidas - jsonb_array_length(v_linhas));
end;
$$;

create or replace function public.site_import_contagem()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tabela text;
  v_n bigint;
  v_out jsonb := '{}'::jsonb;
begin
  if not (coalesce(auth.role(), '') = 'service_role' or public.is_admin()) then
    raise exception 'Somente o administrador confere a importação do site.' using errcode = '42501';
  end if;
  foreach v_tabela in array public.site_import_tabelas() loop
    execute format('select count(*) from site.%I', v_tabela) into v_n;
    v_out := v_out || jsonb_build_object(v_tabela, v_n);
  end loop;
  return v_out;
end;
$$;

-- Usuários do site sem par no CRM: a lista que o admin resolve antes da virada.
create or replace function public.site_import_sem_par()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not (coalesce(auth.role(), '') = 'service_role' or public.is_admin()) then
    raise exception 'Somente o administrador confere a importação do site.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('email', m.email, 'full_name', m.full_name, 'papeis', m.papeis)
                                    order by m.email)
                     from site.mapa_usuarios m where m.crm_profile_id is null), '[]'::jsonb);
end;
$$;

revoke all on function public.site_import_sem_par() from public, anon;
grant execute on function public.site_import_sem_par() to authenticated, service_role;
revoke all on function public.site_import_usuarios(jsonb) from public, anon, authenticated;
revoke all on function public.site_import_tabelas() from public, anon;
revoke all on function public.site_import_linhas(text, jsonb) from public, anon, authenticated;
revoke all on function public.site_import_contagem() from public, anon;
grant execute on function public.site_import_usuarios(jsonb) to service_role;
grant execute on function public.site_import_tabelas() to authenticated, service_role;
grant execute on function public.site_import_linhas(text, jsonb) to service_role;
grant execute on function public.site_import_contagem() to authenticated, service_role;
