
-- SDR Agents
CREATE TABLE public.sdr_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  role text NOT NULL DEFAULT 'qualifier',
  is_orchestrator boolean NOT NULL DEFAULT false,
  system_prompt text,
  model text DEFAULT 'gpt-4o-mini',
  temperature numeric DEFAULT 0.7,
  provider text DEFAULT 'openai',
  active boolean NOT NULL DEFAULT true,
  handoff_to_agent_id uuid REFERENCES public.sdr_agents(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sdr_agents TO authenticated;
GRANT ALL ON public.sdr_agents TO service_role;
ALTER TABLE public.sdr_agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read sdr_agents" ON public.sdr_agents FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin write sdr_agents" ON public.sdr_agents FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'director'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'director'));
CREATE TRIGGER trg_sdr_agents_updated BEFORE UPDATE ON public.sdr_agents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Lead sources routed to SDR
CREATE TABLE public.sdr_lead_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  form_id text,
  source_match text,
  agent_id uuid REFERENCES public.sdr_agents(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sdr_lead_sources TO authenticated;
GRANT ALL ON public.sdr_lead_sources TO service_role;
ALTER TABLE public.sdr_lead_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read sdr_lead_sources" ON public.sdr_lead_sources FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin write sdr_lead_sources" ON public.sdr_lead_sources FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'director'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'director'));

-- Conversations
CREATE TABLE public.sdr_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid,
  contact_id uuid,
  agent_id uuid REFERENCES public.sdr_agents(id) ON DELETE SET NULL,
  channel text DEFAULT 'whatsapp',
  status text NOT NULL DEFAULT 'active',
  temperature text DEFAULT 'cold',
  handed_off_to_broker_id uuid,
  meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sdr_conversations TO authenticated;
GRANT ALL ON public.sdr_conversations TO service_role;
ALTER TABLE public.sdr_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read sdr_conversations" ON public.sdr_conversations FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin write sdr_conversations" ON public.sdr_conversations FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'director') OR public.has_role(auth.uid(),'manager'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'director') OR public.has_role(auth.uid(),'manager'));
CREATE TRIGGER trg_sdr_conversations_updated BEFORE UPDATE ON public.sdr_conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Messages
CREATE TABLE public.sdr_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.sdr_conversations(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  agent_id uuid REFERENCES public.sdr_agents(id) ON DELETE SET NULL,
  tokens_in integer,
  tokens_out integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sdr_messages_conv ON public.sdr_messages(conversation_id, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sdr_messages TO authenticated;
GRANT ALL ON public.sdr_messages TO service_role;
ALTER TABLE public.sdr_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read sdr_messages" ON public.sdr_messages FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin write sdr_messages" ON public.sdr_messages FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'director') OR public.has_role(auth.uid(),'manager'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'director') OR public.has_role(auth.uid(),'manager'));

-- Remarketing lists
CREATE TABLE public.sdr_remarketing_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  template_name text,
  template_language text DEFAULT 'pt_BR',
  agent_id uuid REFERENCES public.sdr_agents(id) ON DELETE SET NULL,
  total_contacts integer DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sdr_remarketing_lists TO authenticated;
GRANT ALL ON public.sdr_remarketing_lists TO service_role;
ALTER TABLE public.sdr_remarketing_lists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read sdr_remarketing_lists" ON public.sdr_remarketing_lists FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin write sdr_remarketing_lists" ON public.sdr_remarketing_lists FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'director'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'director'));
CREATE TRIGGER trg_sdr_remk_lists_updated BEFORE UPDATE ON public.sdr_remarketing_lists
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Remarketing contacts
CREATE TABLE public.sdr_remarketing_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES public.sdr_remarketing_lists(id) ON DELETE CASCADE,
  name text,
  phone text NOT NULL,
  campaign text,
  extra jsonb DEFAULT '{}'::jsonb,
  send_status text NOT NULL DEFAULT 'pending',
  sent_at timestamptz,
  replied_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sdr_remk_contacts_list ON public.sdr_remarketing_contacts(list_id, send_status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sdr_remarketing_contacts TO authenticated;
GRANT ALL ON public.sdr_remarketing_contacts TO service_role;
ALTER TABLE public.sdr_remarketing_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read sdr_remk_contacts" ON public.sdr_remarketing_contacts FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin write sdr_remk_contacts" ON public.sdr_remarketing_contacts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'director'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'director'));

-- WhatsApp config (single row per project)
CREATE TABLE public.sdr_whatsapp_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  phone_number_id text,
  business_account_id text,
  default_template_name text,
  default_template_language text DEFAULT 'pt_BR',
  webhook_verify_token text,
  active boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sdr_whatsapp_config TO authenticated;
GRANT ALL ON public.sdr_whatsapp_config TO service_role;
ALTER TABLE public.sdr_whatsapp_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read wa_config" ON public.sdr_whatsapp_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin write wa_config" ON public.sdr_whatsapp_config FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'director'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'director'));

INSERT INTO public.sdr_whatsapp_config (id) VALUES (true) ON CONFLICT DO NOTHING;
