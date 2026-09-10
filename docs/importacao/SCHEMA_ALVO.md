# Schema alvo (Supabase `public`) — snapshot 09/09/2026

Extraído do banco remoto (`mcmqgxvtwegtptfseqvw`). `!` = NOT NULL.
Fonte de verdade continua sendo `supabase/migrations/`.

## Enums

```
app_role            = admin | director | manager | broker | cca | sdr | marketing | partner
broadcast_status    = draft | scheduled | running | paused | done | failed
cca_status          = pending_documents | under_review | sent_to_developer | sent_to_agency | approved | rejected | cancelled
deal_outcome        = open | won | lost | cancelled
developer_flow      = internal | external
lead_funnel_stage   = new | first_contact | no_response | warm | hot | gathering_docs | scheduled_visit | qualified
lead_release_reason = timeout | manual | reassigned | checkout | sdr_handoff
lead_status         = queued | assigned | attending | in_progress | converted | lost | discarded
message_author      = lead | agent | broker | system
notification_channel= in_app | whatsapp | email | push
profile_status      = active | suspended | terminated
task_status         = open | done | cancelled
visit_result        = scheduled | completed | no_show | cancelled
```

## Tabelas

```
access_provision_log: id uuid!, actor_id uuid, profile_id uuid, action text!, email text!, created_at timestamptz!, actor_email text
ad_campaigns: id uuid!, external_id text!, platform text!, name text!, developer_id uuid, status text, daily_budget numeric, total_spend numeric!, synced_at timestamptz, created_at timestamptz!, updated_at timestamptz!, lifetime_budget numeric, starts_on date, ends_on date, lead_source_id uuid
allowed_ips: id uuid!, label text!, ip_range cidr!, team_id uuid, active boolean!, created_by uuid, created_at timestamptz!, updated_at timestamptz!
annual_results: id uuid!, year integer!, month integer!, sales_count integer!, vgv numeric!, notes text, updated_by uuid, created_at timestamptz!, updated_at timestamptz!
automation_settings: id boolean!, attend_timeout_seconds integer!, overdue_block_threshold integer!, no_response_hours integer!, inactivity_alert_hours integer!, auto_first_contact boolean!, leads_paused boolean!, notify_on_assign boolean!, notify_on_timeout boolean!, updated_by uuid, updated_at timestamptz!, roulette_max_rounds integer!
cca_case_events: id uuid!, case_id uuid!, actor_id uuid, kind text!, from_value text, to_value text, detail jsonb, created_at timestamptz!
cca_cases: id uuid!, deal_id uuid!, status cca_status!, analyst_id uuid, agency_name text, submitted_at timestamptz, decided_at timestamptz, decision_notes text, pending_items jsonb!, created_at timestamptz!, updated_at timestamptz!, stage_id uuid, analysis jsonb!
cca_stages: id uuid!, name text!, color text!, position integer!, status cca_status!, active boolean!, created_at timestamptz!, updated_at timestamptz!
checkins: id uuid!, profile_id uuid!, shift_id uuid!, work_date date!, checked_in_at timestamptz!, checked_out_at timestamptz, auto_checkout boolean!, ip_address inet, leads_received integer!, created_at timestamptz!
closed_months: period date!, closed_at timestamptz!, closed_by uuid, notes text
daily_entries: id uuid!, report_id uuid!, profile_id uuid!, leads numeric!, calls numeric!, doc_collections numeric!, visits_scheduled numeric!, visits_done numeric!, analyses_sent numeric!, analyses_approved numeric!, sales numeric!, created_at timestamptz!, updated_at timestamptz!
daily_reports: id uuid!, team_id uuid!, report_date date!, submitted_by uuid, submitted_at timestamptz, notes text, created_at timestamptz!, updated_at timestamptz!, filled_by_name text
deal_clients: id uuid!, deal_id uuid!, ordinal smallint!, full_name text!, cpf text, phone text, email citext, pis text, marital_status text, birthplace text, is_shareholder boolean, dependents text, admission_date date, cch_reference text, postal_code text, has_informal_income boolean!, activity_segment text, activity_form text, activity_duration text, disclosure_form text, declares_income_tax boolean, monthly_income numeric, income_notes text, created_at timestamptz!, updated_at timestamptz!
deal_documents: id uuid!, deal_id uuid!, document_type_id uuid!, storage_path text!, original_name text!, stored_name text!, mime_type text, size_bytes bigint, version integer!, superseded_at timestamptz, superseded_by uuid, uploaded_by uuid, created_at timestamptz!
deal_history: id uuid!, deal_id uuid!, actor_id uuid, kind text!, from_value text, to_value text, detail jsonb, created_at timestamptz!
deal_participants: id uuid!, deal_id uuid!, profile_id uuid!, role text!, share_pct numeric!, auto_added boolean!, created_at timestamptz!, ordinal smallint!
deals: id uuid!, code text!, lead_id uuid, developer_id uuid, project_id uuid, unit text, stage_id uuid!, outcome deal_outcome!, month_base date!, vgv_gross numeric, discount_pct numeric!, vgv_net numeric, lead_origin text, notes text, stage_entered_at timestamptz!, closed_at timestamptz, lost_reason text, created_by uuid, created_at timestamptz!, updated_at timestamptz!, status_detail text, document_review_status text!, document_review_requested_at timestamptz, document_review_requested_by uuid, document_reviewed_at timestamptz, document_reviewed_by uuid, document_review_reason text
developer_projects: id uuid!, developer_id uuid!, name text!, city text, state character, active boolean!, created_at timestamptz!, updated_at timestamptz!
developer_submissions: id uuid!, deal_id uuid!, developer_id uuid!, to_email citext!, cc_emails ARRAY, subject text!, body text, document_ids ARRAY!, status text!, attempts integer!, last_error text, sent_at timestamptz, requested_by uuid, created_at timestamptz!, updated_at timestamptz!
developers: id uuid!, name text!, slug text!, flow developer_flow!, submission_email citext, contact_name text, contact_phone text, notes text, active boolean!, created_at timestamptz!, updated_at timestamptz!
distribution_group_forms: group_id uuid!, form_id text!, form_name text, created_at timestamptz!
distribution_group_members: group_id uuid!, profile_id uuid!, active boolean!, created_at timestamptz!
distribution_groups: id uuid!, name text!, slug text!, kind text!, attend_timeout_seconds integer, active boolean!, created_at timestamptz!, updated_at timestamptz!
document_types: id uuid!, code text!, label text!, category text!, required_for_conversion boolean!, allows_multiple boolean!, naming_pattern text, sort_order integer!, active boolean!, created_at timestamptz!, updated_at timestamptz!
funnel_targets: id uuid!, scope text!, team_id uuid, director_id uuid, lead_to_analysis_pct numeric!, analysis_to_approval_pct numeric!, approval_to_sale_pct numeric!, effective_from date!, created_at timestamptz!, updated_at timestamptz!
game_events: id uuid!, season_id uuid!, profile_id uuid!, event_code text!, points integer!, ref_type text, ref_id uuid, occurred_at timestamptz!, created_at timestamptz!
game_scoring_rules: id uuid!, season_id uuid, event_code text!, label text!, points integer!, active boolean!, created_at timestamptz!, updated_at timestamptz!
game_season_results: season_id uuid!, profile_id uuid!, rank integer!, points integer!, sales integer!, vgv numeric!, breakdown jsonb!, frozen_at timestamptz!
game_seasons: id uuid!, label text!, period_start date!, period_end date, closed_at timestamptz, closed_by uuid, created_at timestamptz!, updated_at timestamptz!
goals: id uuid!, scope text!, team_id uuid, profile_id uuid, period_type text!, period date!, metric text!, target numeric!, created_by uuid, created_at timestamptz!, updated_at timestamptz!
gold_tips: id uuid!, title text!, body text!, author_id uuid, sort_order integer!, active boolean!, created_at timestamptz!, updated_at timestamptz!
important_notices: id uuid!, title text!, body text!, severity text!, starts_at timestamptz!, ends_at timestamptz, active boolean!, created_by uuid, created_at timestamptz!, updated_at timestamptz!
lead_assignments: id uuid!, lead_id uuid!, profile_id uuid!, group_id uuid, sequence integer!, assigned_at timestamptz!, deadline timestamptz!, responded_at timestamptz, released_at timestamptz, release_reason lead_release_reason
lead_attachments: id uuid!, lead_id uuid!, document_type_id uuid, storage_path text!, original_name text!, stored_name text!, mime_type text, size_bytes bigint, uploaded_by uuid, created_at timestamptz!
lead_comments: id uuid!, lead_id uuid!, author_id uuid, body text!, created_at timestamptz!, updated_at timestamptz!
lead_events: id uuid!, lead_id uuid!, actor_id uuid, kind text!, from_value text, to_value text, detail jsonb, created_at timestamptz!
lead_sources: id uuid!, code text!, label text!, channel text!, form_id text, active boolean!, created_at timestamptz!, updated_at timestamptz!, sdr_agent_id uuid, welcome_template_id uuid
leads: id uuid!, full_name text!, phone text, phone_raw text, email citext, document text, source_id uuid, distribution_group_id uuid, form_id text, external_id text, campaign_id text, campaign_name text, adset_id text, adset_name text, ad_id text, ad_name text, utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text, landing_page text, raw_payload jsonb, status lead_status!, funnel_stage lead_funnel_stage!, assigned_to uuid, assigned_at timestamptz, attend_deadline timestamptz, first_contact_at timestamptz, last_activity_at timestamptz!, next_action_at timestamptz, sdr_qualified_at timestamptz, converted_at timestamptz, lost_reason text, lost_at timestamptz, notes text, created_at timestamptz!, updated_at timestamptz!, converted_deal_id uuid, roulette_misses integer!
marketing_investments: id uuid!, developer_id uuid!, period date!, amount numeric!, notes text, created_by uuid, created_at timestamptz!, updated_at timestamptz!
month_reopenings: id uuid!, period date!, closed_at timestamptz, closed_by uuid, reopened_at timestamptz!, reopened_by uuid
notifications: id uuid!, profile_id uuid!, kind text!, title text!, body text, link text, channel notification_channel!, read_at timestamptz, sent_at timestamptz, created_at timestamptz!, attempts integer!, last_error text
permissions: code text!, label text!, category text!, description text
pipeline_stages: id uuid!, code text!, label text!, position integer!, outcome deal_outcome!, color text, requires_document boolean!, max_minutes integer, is_initial boolean!, active boolean!, created_at timestamptz!, updated_at timestamptz!
profiles: id uuid!, full_name text!, email citext!, phone text, avatar_url text, slug text, status profile_status!, hired_at date, terminated_at date, bypass_ip_check boolean!, created_at timestamptz!, updated_at timestamptz!, cpf text, creci text, habilitation text, birth_date date, address text, division text, indication text, badge_requested_at date, badge_delivered_at date
public_links: id uuid!, kind text!, team_id uuid, director_id uuid, slug text!, pin_hash text, active boolean!, expires_at timestamptz, last_seen_at timestamptz, created_by uuid, created_at timestamptz!, updated_at timestamptz!, failed_attempts integer!, locked_until timestamptz, pin_set_at timestamptz, has_pin boolean
remarketing_contacts: id uuid!, list_id uuid!, full_name text, phone text!, email citext, lead_id uuid, status text!, sent_at timestamptz, replied_at timestamptz, last_error text, extra jsonb!, created_at timestamptz!
remarketing_lists: id uuid!, name text!, description text, template_id uuid, agent_id uuid, handoff_group_id uuid, status broadcast_status!, scheduled_for timestamptz, throttle_per_minute integer!, created_by uuid, created_at timestamptz!, updated_at timestamptz!
role_change_log: id uuid!, profile_id uuid, profile_email text, actor_id uuid, actor_email text, roles_before ARRAY!, roles_after ARRAY!, created_at timestamptz!
role_permissions: role app_role!, permission text!, allowed boolean!, updated_at timestamptz!
sdr_agents: id uuid!, name text!, role text!, is_orchestrator boolean!, system_prompt text, model text!, temperature numeric!, max_turns integer!, handoff_group_id uuid, handoff_to_agent_id uuid, active boolean!, created_at timestamptz!, updated_at timestamptz!
sdr_conversations: id uuid!, lead_id uuid!, agent_id uuid, status text!, score integer, summary text, collected jsonb!, started_at timestamptz!, last_message_at timestamptz, qualified_at timestamptz, handed_off_at timestamptz, handed_off_to uuid, created_at timestamptz!, updated_at timestamptz!
sdr_messages: id uuid!, conversation_id uuid!, author message_author!, body text!, provider_message_id text, template_id uuid, tokens_in integer, tokens_out integer, created_at timestamptz!, agent_id uuid
stage_permissions: stage_id uuid!, role app_role!, can_enter boolean!, can_exit boolean!
tasks: id uuid!, title text!, description text, assigned_to uuid, created_by uuid, due_at timestamptz, completed_at timestamptz, status task_status!, priority text!, ref_type text, ref_id uuid, created_at timestamptz!, updated_at timestamptz!
team_members: id uuid!, team_id uuid!, profile_id uuid!, joined_at date!, left_at date, created_at timestamptz!
teams: id uuid!, name text!, slug text!, director_id uuid, manager_id uuid, active boolean!, created_at timestamptz!, updated_at timestamptz!
useful_links: id uuid!, label text!, url text!, icon text, category text!, sort_order integer!, active boolean!, created_at timestamptz!, updated_at timestamptz!
user_roles: profile_id uuid!, role app_role!, granted_by uuid, granted_at timestamptz!
visits: id uuid!, deal_id uuid, lead_id uuid, broker_id uuid, scheduled_at timestamptz!, performed_at timestamptz, result visit_result!, notes text, created_at timestamptz!, updated_at timestamptz!
whatsapp_inbound_messages: id uuid!, provider_message_id text!, from_phone text!, body text, lead_id uuid, conversation_id uuid, outcome text!, detail text, handled_at timestamptz, handled_by uuid, created_at timestamptz!
whatsapp_templates: id uuid!, name text!, language text!, category text!, body text!, variables ARRAY!, provider_template_id text, approved boolean!, active boolean!, created_at timestamptz!, updated_at timestamptz!
```

## Estado do banco remoto no snapshot (dados de seed/demo, não produção)

profiles 24 · leads 72 · deals 32 · deal_participants 101 · notifications 1839 · lead_events 1070 ·
teams 3 · developers 2 · pipeline_stages 9 · cca_stages 6 · document_types 9 · game_seasons 4
