# Graph Report - .  (2026-07-25)

## Corpus Check
- 224 files · ~193,689 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1188 nodes · 2222 edges · 203 communities (112 shown, 91 thin omitted)
- Extraction: 99% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 11 edges (avg confidence: 0.74)
- Token cost: 49,362 input · 0 output

## Community Hubs (Navigation)
- Table UI & Gamification Admin
- Carousel & React Core Deps
- Card UI & Gamification Notices
- Broker Edit Modal
- Comparative Funnel
- Deal Status Logic
- Lead Detail & Funnel
- Toast Notifications
- App TypeScript Config
- Lead Cards & Button Variants
- Sidebar & Separator UI
- App Sidebar Navigation
- Automation Engine
- Node TypeScript Config
- Deal Detail Modal
- SDR Module & Supabase Client
- shadcn Component Aliases
- Director Checkpoint Plan
- Popover & OTP Input UI
- Mock CRM Data & Types
- AI Analytics
- Radix UI Dependencies
- App Root & Query Client
- Dashboards & Auth Guard
- Auth Context & Role Switcher
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 55
- Community 56
- Community 57
- Community 58
- Community 59
- Community 60
- Community 61
- Community 62
- Community 63
- Community 64
- Community 65
- Community 66
- Community 67
- Community 68
- Community 69
- Community 71
- Community 72
- Community 74
- Community 75
- Community 76
- Community 78
- Community 80
- Community 81
- Community 82
- Community 83
- Community 84
- Community 85
- Community 86
- Community 87
- Community 88
- Community 89
- Community 90
- Community 91
- Community 92
- Community 93
- Community 94
- Community 95
- Community 96
- Community 97
- Community 98
- Community 99
- Community 100
- Community 101
- Community 102
- Community 103
- Community 104
- Community 105
- Community 106
- Community 107
- Community 108
- Community 109
- Community 110
- Community 111
- Community 112
- Community 113
- Community 114
- Community 115
- Community 116
- Community 117
- Community 118
- Community 119
- Community 120
- Community 121
- Community 122
- Community 123
- Community 124
- Community 125
- Community 126
- Community 127
- Community 128
- Community 129
- Community 130
- Community 131
- Community 132
- Community 133
- Community 134
- Community 135
- Community 136
- Community 137
- Community 138
- Community 139
- Community 140
- Community 141
- Community 142
- Community 143
- Community 144
- Community 145
- Community 148
- Community 149
- Community 151
- Community 152
- Community 154
- Community 155
- Community 157
- Community 158
- Community 159
- Community 161
- Community 165
- Community 166
- Community 167
- Community 169

## God Nodes (most connected - your core abstractions)
1. `cn()` - 107 edges
2. `Button` - 35 edges
3. `useAuth()` - 35 edges
4. `supabase` - 34 edges
5. `Card` - 30 edges
6. `Badge()` - 27 edges
7. `CardContent` - 26 edges
8. `Input` - 26 edges
9. `Toast` - 24 edges
10. `CardHeader` - 22 edges

## Surprising Connections (you probably didn't know these)
- `Configuracao PWA / web app iOS` --conceptually_related_to--> `Link Publico do Diretor - Checkpoint Semanal`  [AMBIGUOUS]
  index.html → .lovable/plan.md
- `Politica de crawlers (robots.txt)` --conceptually_related_to--> `Acesso publico sem autenticacao nem PIN`  [AMBIGUOUS]
  public/robots.txt → .lovable/plan.md
- `useCarousel()` --references--> `react`  [EXTRACTED]
  src/components/ui/carousel.tsx → package.json
- `useChart()` --references--> `react`  [EXTRACTED]
  src/components/ui/chart.tsx → package.json
- `useFormField()` --references--> `react`  [EXTRACTED]
  src/components/ui/form.tsx → package.json

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Fluxo do link publico do diretor** — lovable_plan_admin_daily_teams, lovable_plan_slugify, lovable_plan_public_director_checkpoint_page, lovable_plan_director_weekly_edge_function, lovable_plan_weekly_aggregation [EXTRACTED 1.00]
- **Extracao de componentes de checkpoint para reuso** — lovable_plan_checkpoint_page, lovable_plan_director_funnel_card, lovable_plan_team_checkpoint_card, lovable_plan_public_director_checkpoint_page [EXTRACTED 1.00]
- **Superficie de compartilhamento publico do CRM** — index_social_preview_metadata, public_robots_crawler_policy, lovable_plan_public_route_no_auth, readme_deploy_publish [INFERRED 0.85]

## Communities (203 total, 91 thin omitted)

### Community 0 - "Table UI & Gamification Admin"
Cohesion: 0.07
Nodes (37): GamificationAdmin(), GamificationBanners(), Table, TableBody, TableCaption, TableCell, TableFooter, TableHead (+29 more)

### Community 1 - "Carousel & React Core Deps"
Cohesion: 0.05
Nodes (33): react, react, Carousel, CarouselApi, CarouselContent, CarouselContext, CarouselContextProps, CarouselItem (+25 more)

### Community 2 - "Card UI & Gamification Notices"
Cohesion: 0.15
Nodes (19): Notice, Tip, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle (+11 more)

### Community 3 - "Broker Edit Modal"
Cohesion: 0.11
Nodes (22): BrokerEditModal(), Director, EditableBroker, Manager, ROLES, slug(), suggestEmail(), fmt() (+14 more)

### Community 4 - "Comparative Funnel"
Cohesion: 0.10
Nodes (27): CompactFunnel(), ComparativeFunnel(), FunnelData, FunnelStep, IDEAL_STAGES, StageComparisonList(), statusOf(), toSteps() (+19 more)

### Community 5 - "Deal Status Logic"
Cohesion: 0.10
Nodes (26): compareMonth(), currentMonthBase(), isPerda(), isProducao(), isResultado(), normalizeStatus(), pickOpenMonth(), Status1 (+18 more)

### Community 6 - "Lead Detail & Funnel"
Cohesion: 0.16
Nodes (18): LeadRow, stageLabels, LeadRow, STAGES, messages, LeadRow, Button, DialogContent (+10 more)

### Community 7 - "Toast Notifications"
Cohesion: 0.11
Nodes (24): Toast, ToastAction, ToastActionElement, ToastClose, ToastDescription, ToastProps, ToastTitle, toastVariants (+16 more)

### Community 8 - "App TypeScript Config"
Cohesion: 0.08
Nodes (25): DOM, DOM.Iterable, ES2020, src, vitest/globals, compilerOptions, allowImportingTsExtensions, isolatedModules (+17 more)

### Community 9 - "Lead Cards & Button Variants"
Cohesion: 0.11
Nodes (23): Field(), LeadDetailModal(), sourceBadgeCls(), LeadCardMini(), LeadFunnel(), sourceStyle(), ButtonProps, buttonVariants (+15 more)

### Community 10 - "Sidebar & Separator UI"
Cohesion: 0.10
Nodes (18): Separator, SidebarContext, SidebarGroupAction, SidebarHeader, SidebarInput, SidebarInset, SidebarMenuAction, SidebarMenuBadge (+10 more)

### Community 11 - "App Sidebar Navigation"
Cohesion: 0.12
Nodes (17): adminNav, AppSidebar(), mainNav, systemNav, NavLink, NavLinkCompatProps, Sidebar, SidebarContent (+9 more)

### Community 12 - "Automation Engine"
Cohesion: 0.18
Nodes (17): autoAssignBroker(), AutomationAlert, AutoTask, calculateSourceMetrics(), checkFollowUpRules(), EmailTemplate, emailTemplates, generateLeadTasks() (+9 more)

### Community 13 - "Node TypeScript Config"
Cohesion: 0.11
Nodes (17): ES2023, vite.config.ts, compilerOptions, allowImportingTsExtensions, isolatedModules, lib, module, moduleDetection (+9 more)

### Community 14 - "Deal Detail Modal"
Cohesion: 0.13
Nodes (12): CCA_FIELDS, DOC_SLOTS, Props, statusOptions, Switch, Textarea, TextareaProps, mockDevelopers (+4 more)

### Community 15 - "SDR Module & Supabase Client"
Cohesion: 0.14
Nodes (7): Label, labelVariants, supabase, Agent, Rlist, SdrModule(), Source

### Community 16 - "shadcn Component Aliases"
Cohesion: 0.12
Nodes (16): aliases, components, hooks, lib, ui, utils, rsc, $schema (+8 more)

### Community 17 - "Director Checkpoint Plan"
Cohesion: 0.20
Nodes (17): Shell HTML CRM Faceimob, Configuracao PWA / web app iOS, Metadados Open Graph e Twitter Card, AdminDailyTeams - secao Diretores, Pagina Checkpoint (src/pages/Checkpoint.tsx), DirectorFunnelCard (componente extraido), Edge Function director-weekly, Pagina publica PublicDirectorCheckpoint (+9 more)

### Community 18 - "Popover & OTP Input UI"
Cohesion: 0.12
Nodes (10): HoverCardContent, InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot, PopoverContent, Progress, RadioGroup (+2 more)

### Community 19 - "Mock CRM Data & Types"
Cohesion: 0.15
Nodes (15): mockBrokers, mockCampaigns, mockDeals, mockLeads, mockSources, mockTeams, Broker, Campaign (+7 more)

### Community 20 - "AI Analytics"
Cohesion: 0.16
Nodes (14): mockGamification, AIInsight, askAssistant(), BrokerAnalysis, calcDealProbability(), FollowUpRec, generateAlerts(), generateForecast() (+6 more)

### Community 21 - "Radix UI Dependencies"
Cohesion: 0.13
Nodes (15): class-variance-authority, dependencies, class-variance-authority, @radix-ui/react-popover, @radix-ui/react-scroll-area, @radix-ui/react-select, @radix-ui/react-slot, react-dom (+7 more)

### Community 22 - "App Root & Query Client"
Cohesion: 0.19
Nodes (6): queryClient, Toaster(), ToasterProps, DashboardSwitcher(), MetaAdsSetup(), NotFound()

### Community 23 - "Dashboards & Auth Guard"
Cohesion: 0.14
Nodes (14): RequireAuth(), DealDetailModal(), useAuth(), Checkpoint(), DataManagement(), DirectorDashboard(), monthBaseNow(), startOfMonth() (+6 more)

### Community 24 - "Auth Context & Role Switcher"
Cohesion: 0.15
Nodes (12): roleColors, roleLabels, RoleSwitcher(), AppRole, AuthContext, AuthContextType, AuthProvider(), defaultPermissions (+4 more)

### Community 25 - "Community 25"
Cohesion: 0.19
Nodes (12): nextMonthBase(), ccaDevelopers, developerColors, emptyDeal, FACEIMOB_STATUSES, faceimobStatusColor(), getDeveloperColor(), leadStatusColor (+4 more)

### Community 26 - "Community 26"
Cohesion: 0.15
Nodes (13): autoprefixer, electron, eslint, lovable-tagger, devDependencies, autoprefixer, electron, eslint (+5 more)

### Community 27 - "Community 27"
Cohesion: 0.18
Nodes (11): AppLayout(), pageTitles, MotivationalPopup(), PipelineTopRanking(), SidebarProvider, SidebarTrigger, BrokerRow, DealLite (+3 more)

### Community 28 - "Community 28"
Cohesion: 0.20
Nodes (8): Checkbox, ScrollArea, ScrollBar, Broker, Group, Settings, STAGE_LABELS, Window

### Community 29 - "Community 29"
Cohesion: 0.17
Nodes (11): Menubar, MenubarCheckboxItem, MenubarContent, MenubarItem, MenubarLabel, MenubarRadioItem, MenubarSeparator, MenubarShortcut() (+3 more)

### Community 30 - "Community 30"
Cohesion: 0.17
Nodes (11): public.annual_results, public.brokers, public.gold_tips, public.important_notices, public.marketing_investments, public.useful_links, trg_ar_updated_at, trg_gt_updated_at (+3 more)

### Community 31 - "Community 31"
Cohesion: 0.29
Nodes (8): Badge(), BadgeProps, badgeVariants, AdminDailyTeams(), managerSlug(), randomPin(), sha256(), slugify()

### Community 32 - "Community 32"
Cohesion: 0.18
Nodes (9): Command, CommandDialogProps, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator (+1 more)

### Community 33 - "Community 33"
Cohesion: 0.18
Nodes (10): CompositeTypes, Constants, Database, DatabaseWithoutInternals, DefaultSchema, Enums, Json, Tables (+2 more)

### Community 34 - "Community 34"
Cohesion: 0.18
Nodes (9): BrokerRow, DEFAULT_TARGETS, DirAggr, DirectorFunnelCard(), EntryRow, ReportRow, Targets, TeamCheckpointCard() (+1 more)

### Community 35 - "Community 35"
Cohesion: 0.31
Nodes (10): public.sdr_agents, public.sdr_conversations, public.sdr_lead_sources, public.sdr_messages, public.sdr_remarketing_contacts, public.sdr_remarketing_lists, public.sdr_whatsapp_config, trg_sdr_agents_updated (+2 more)

### Community 36 - "Community 36"
Cohesion: 0.18
Nodes (10): compilerOptions, allowJs, noImplicitAny, noUnusedLocals, noUnusedParameters, paths, skipLibCheck, strictNullChecks (+2 more)

### Community 37 - "Community 37"
Cohesion: 0.27
Nodes (8): AccordionContent, AccordionItem, AccordionTrigger, currentYear, MONTHS, Resultados(), Row, YEARS

### Community 38 - "Community 38"
Cohesion: 0.20
Nodes (9): ContextMenuCheckboxItem, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuRadioItem, ContextMenuSeparator, ContextMenuShortcut(), ContextMenuSubContent (+1 more)

### Community 39 - "Community 39"
Cohesion: 0.20
Nodes (9): DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuShortcut(), DropdownMenuSubContent (+1 more)

### Community 40 - "Community 40"
Cohesion: 0.22
Nodes (8): SheetContent, SheetContentProps, SheetDescription, SheetFooter(), SheetHeader(), SheetOverlay, SheetTitle, sheetVariants

### Community 41 - "Community 41"
Cohesion: 0.28
Nodes (7): emptyAggr, MissingDay, MONTH_FIELDS, PublicDirectorCheckpoint(), safeTargets(), slugify(), TeamOut

### Community 42 - "Community 42"
Cohesion: 0.36
Nodes (7): public.dashboard_bi_cache, public.refresh_dashboard_bi_cache_trigger(), refresh_dashboard_bi_cache_brokers, refresh_dashboard_bi_cache_cca_deals, refresh_dashboard_bi_cache_closed_months, refresh_dashboard_bi_cache_deals, refresh_dashboard_bi_cache_leads

### Community 43 - "Community 43"
Cohesion: 0.25
Nodes (8): scripts, build, build:dev, dev, lint, preview, test, test:watch

### Community 44 - "Community 44"
Cohesion: 0.36
Nodes (5): FunnelStat(), Props, Avatar, AvatarFallback, AvatarImage

### Community 45 - "Community 45"
Cohesion: 0.25
Nodes (7): Breadcrumb, BreadcrumbEllipsis(), BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator()

### Community 46 - "Community 46"
Cohesion: 0.25
Nodes (6): DrawerContent, DrawerDescription, DrawerFooter(), DrawerHeader(), DrawerOverlay, DrawerTitle

### Community 47 - "Community 47"
Cohesion: 0.25
Nodes (7): NavigationMenu, NavigationMenuContent, NavigationMenuIndicator, NavigationMenuList, NavigationMenuTrigger, navigationMenuTriggerStyle, NavigationMenuViewport

### Community 48 - "Community 48"
Cohesion: 0.32
Nodes (3): public.brokers, public.deals, public.tasks

### Community 49 - "Community 49"
Cohesion: 0.32
Nodes (6): public.daily_broker_entries, public.daily_team_reports, public.get_team_public_info(), public.team_pins, trg_daily_reports_updated, trg_team_pins_updated

### Community 50 - "Community 50"
Cohesion: 0.33
Nodes (5): ToggleGroup, ToggleGroupContext, ToggleGroupItem, Toggle, toggleVariants

### Community 51 - "Community 51"
Cohesion: 0.29
Nodes (6): public.brokers, public.cca_deals, public.cca_developers, public.deals, public.leads, public.profiles

### Community 52 - "Community 52"
Cohesion: 0.29
Nodes (3): public.allowed_ips, public.broker_checkins, public.distribution_windows

### Community 53 - "Community 53"
Cohesion: 0.48
Nodes (6): public.lead_attachments, public.lead_comments, public.lead_history, public.leads, public.leads_on_stage_change(), trg_leads_stage

### Community 54 - "Community 54"
Cohesion: 0.38
Nodes (5): public.distribution_group_brokers, public.distribution_group_forms, public.distribution_groups, public.leads, upd_distribution_groups

### Community 55 - "Community 55"
Cohesion: 0.33
Nodes (5): main, name, private, type, version

### Community 57 - "Community 57"
Cohesion: 0.33
Nodes (3): BodySchema, EntrySchema, half

### Community 59 - "Community 59"
Cohesion: 0.40
Nodes (4): Alert, AlertDescription, AlertTitle, alertVariants

### Community 60 - "Community 60"
Cohesion: 0.50
Nodes (3): directorSlugMatches(), Schema, slugify()

### Community 61 - "Community 61"
Cohesion: 0.60
Nodes (4): public.get_user_role(), public.has_role(), public.profiles, public.user_roles

### Community 62 - "Community 62"
Cohesion: 0.60
Nodes (3): public.brokers, public.deals, public.leads

### Community 63 - "Community 63"
Cohesion: 0.50
Nodes (4): public.cca_deals, public.cca_stages, public.sync_deal_to_cca(), sync_deal_to_cca_trigger

### Community 64 - "Community 64"
Cohesion: 0.50
Nodes (4): public.checkpoint_targets, public.daily_broker_entries, public.teams, trg_checkpoint_targets_updated_at

### Community 65 - "Community 65"
Cohesion: 0.50
Nodes (4): public.lead_automation_settings, public.leads, public.leads_stage_changed_at(), trg_leads_stage_changed_at

### Community 68 - "Community 68"
Cohesion: 0.67
Nodes (3): corsHeaders, friendlyPassword(), slugify()

## Ambiguous Edges - Review These
- `Link Publico do Diretor - Checkpoint Semanal` → `Configuracao PWA / web app iOS`  [AMBIGUOUS]
  index.html · relation: conceptually_related_to
- `Acesso publico sem autenticacao nem PIN` → `Politica de crawlers (robots.txt)`  [AMBIGUOUS]
  public/robots.txt · relation: conceptually_related_to

## Knowledge Gaps
- **501 isolated node(s):** `$schema`, `style`, `rsc`, `tsx`, `config` (+496 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **91 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Link Publico do Diretor - Checkpoint Semanal` and `Configuracao PWA / web app iOS`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Acesso publico sem autenticacao nem PIN` and `Politica de crawlers (robots.txt)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `cn()` connect `Lead Cards & Button Variants` to `Table UI & Gamification Admin`, `Carousel & React Core Deps`, `Card UI & Gamification Notices`, `Broker Edit Modal`, `Comparative Funnel`, `Deal Status Logic`, `Lead Detail & Funnel`, `Toast Notifications`, `Sidebar & Separator UI`, `App Sidebar Navigation`, `Automation Engine`, `Deal Detail Modal`, `SDR Module & Supabase Client`, `Popover & OTP Input UI`, `Dashboards & Auth Guard`, `Community 25`, `Community 27`, `Community 28`, `Community 29`, `Community 31`, `Community 32`, `Community 34`, `Community 37`, `Community 38`, `Community 39`, `Community 40`, `Community 44`, `Community 45`, `Community 46`, `Community 47`, `Community 50`, `Community 59`?**
  _High betweenness centrality (0.212) - this node is a cross-community bridge._
- **Why does `dependencies` connect `Radix UI Dependencies` to `Community 128`, `Carousel & React Core Deps`, `Community 129`, `Community 130`, `Community 131`, `Community 132`, `Community 133`, `Community 134`, `Community 55`, `Community 80`, `Community 81`, `Community 82`, `Community 84`, `Community 88`, `Community 89`, `Community 90`, `Community 91`, `Community 92`, `Community 93`, `Community 95`, `Community 96`, `Community 98`, `Community 99`, `Community 100`, `Community 101`, `Community 102`, `Community 103`, `Community 104`, `Community 105`, `Community 106`, `Community 107`, `Community 108`, `Community 109`, `Community 110`, `Community 111`, `Community 112`, `Community 113`, `Community 114`, `Community 115`, `Community 116`, `Community 117`, `Community 118`, `Community 119`, `Community 120`, `Community 121`, `Community 122`, `Community 123`, `Community 124`, `Community 125`, `Community 126`, `Community 127`?**
  _High betweenness centrality (0.207) - this node is a cross-community bridge._
- **Why does `Leads()` connect `Automation Engine` to `Lead Cards & Button Variants`, `Community 133`?**
  _High betweenness centrality (0.108) - this node is a cross-community bridge._
- **What connects `$schema`, `style`, `rsc` to the rest of the system?**
  _501 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Table UI & Gamification Admin` be split into smaller, more focused modules?**
  _Cohesion score 0.07272727272727272 - nodes in this community are weakly interconnected._