import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, Building2, Inbox, Pencil, Plus, Trash2 } from "lucide-react";
import { EmptyState, LoadingState, PageHeader, SectionCard, StatusBadge } from "@/components/shared";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { isEmail } from "@/integrations/supabase/developerSubmissions";
import { slugify } from "@/lib/utils";
import { describeError } from "@/lib/supabaseError";

type DeveloperFlow = "internal" | "external";

type DeveloperRow = {
  id: string;
  name: string;
  flow: DeveloperFlow;
  submission_email: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  notes: string | null;
  active: boolean;
};

type ProjectRow = { id: string; developer_id: string; name: string; city: string | null; state: string | null; active: boolean };

/** Falha de rede, 500 e timeout não têm `code`: sem orientação no fallback,
 *  `describeError` devolve a paráfrase do título e a tela repete a frase. */
const TENTE_DE_NOVO = 'A consulta não respondeu. Verifique a conexão e use "Tentar de novo".';

const COLUNAS = "id,name,flow,submission_email,contact_name,contact_phone,notes,active";

/** RLS de update/delete não erra: só não casa linha. Sem linha = sem permissão. */
const NO_PERMISSION = "Sem permissão para alterar construtoras (apenas admin/CCA).";

const EMAIL_INVALIDO = "O e-mail está fora do formato (nome@dominio.com). É para ele que o dossiê da construtora é enviado.";

function EmailCell({ dev, onSave }: { dev: DeveloperRow; onSave: (email: string) => Promise<boolean> }) {
  const [email, setEmail] = useState(dev.submission_email ?? "");
  const save = async () => {
    const valor = email.trim();
    if ((dev.submission_email ?? "") === valor) return;
    // O input fora de <form> não valida nada e a coluna é citext: sem esta
    // checagem, "credito@" era gravado e o dossiê saía para o vazio.
    if (valor && !isEmail(valor)) {
      setEmail(dev.submission_email ?? "");
      return toast({ title: "E-mail inválido", description: EMAIL_INVALIDO, variant: "destructive" });
    }
    // Recusado pelo banco (constraint ou RLS): o campo volta ao valor que o
    // banco realmente tem. Sem isto o toast de erro sumia e a tela continuava
    // exibindo um endereço que não é o destino do dossiê.
    if (!(await onSave(valor))) setEmail(dev.submission_email ?? "");
  };
  return (
    <Input
      type="email"
      value={email}
      onChange={e => setEmail(e.target.value)}
      onBlur={save}
      onKeyDown={e => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      placeholder="email@construtora.com"
      className="h-7 text-xs"
      aria-label={`E-mail de envio de ${dev.name}`}
    />
  );
}

/**
 * Nome do empreendimento editável no lugar, gravando no `onBlur` — o mesmo
 * desenho de `EmailCell`. Recusa do banco devolve o campo ao valor gravado, em
 * vez de deixar na tela um nome que não existe.
 */
function ProjectNameCell({ project, onRename }: { project: ProjectRow; onRename: (name: string) => Promise<boolean> }) {
  const [name, setName] = useState(project.name);
  const save = async () => {
    if (name.trim() === project.name) return;
    if (!(await onRename(name))) setName(project.name);
  };
  return (
    <Input
      value={name}
      onChange={e => setName(e.target.value)}
      onBlur={save}
      onKeyDown={e => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className="h-7 w-44 text-xs"
      aria-label={`Nome do empreendimento ${project.name}`}
    />
  );
}

/**
 * Construtoras e o fluxo de crédito de cada uma.
 *
 * Quem escreve aqui é admin e CCA (`developers_write`) — e desde a 0063 o CCA
 * também tem `menu.admin_developers`, porque quem toca a esteira é quem sabe se
 * a construtora virou fluxo externo. Antes o banco autorizava a escrita e a
 * tela não abria para ele: permissão que ninguém conseguia exercer.
 */
export default function AdminDevelopers() {
  const [developers, setDevelopers] = useState<DeveloperRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newDev, setNewDev] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newFlow, setNewFlow] = useState<DeveloperFlow>("internal");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<DeveloperRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase.from("developers").select(COLUNAS).order("name");
    setLoading(false);
    // Sem este `return`, a falha caía em `developers = []` e a tela afirmava
    // "nenhuma construtora cadastrada" — o toast some e a mentira fica.
    if (error) return setLoadError(describeError(error, TENTE_DE_NOVO));
    setDevelopers((data ?? []) as DeveloperRow[]);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const update = async (id: string, patch: Partial<DeveloperRow>) => {
    const { data, error } = await supabase.from("developers").update(patch).eq("id", id).select("id");
    if (error) {
      toast({ title: "Erro ao atualizar", description: describeError(error, "Não foi possível atualizar a construtora."), variant: "destructive" });
      return false;
    }
    if (!data?.length) {
      toast({ title: NO_PERMISSION, variant: "destructive" });
      return false;
    }
    setDevelopers(prev => prev.map(d => (d.id === id ? { ...d, ...patch } : d)));
    return true;
  };

  const toggleCca = async (dev: DeveloperRow) => {
    const flow: DeveloperFlow = dev.flow === "internal" ? "external" : "internal";
    if (flow === "external" && !dev.submission_email) {
      return toast({
        title: "Cadastre o e-mail de envio antes",
        description: "O fluxo externo envia os documentos por e-mail à construtora.",
        variant: "destructive",
      });
    }
    if (await update(dev.id, { flow })) toast({ title: "Configuração atualizada" });
  };

  const toggleActive = async (dev: DeveloperRow) => {
    if (await update(dev.id, { active: !dev.active })) {
      toast({
        title: dev.active ? "Construtora desativada" : "Construtora reativada",
        description: dev.active
          ? "Ela some das listas de escolha, mas o histórico de aportes e negócios continua no lugar."
          : undefined,
      });
    }
  };

  /**
   * O campo grava no `onBlur`, sem botão: sem confirmação, sair do campo
   * deixava a tela idêntica e não havia como distinguir "salvou" de "não fez
   * nada" — justamente no endereço para onde `submit_deal_for_analysis` manda o
   * dossiê. Os dois switches da mesma linha já confirmam; este era o único mudo.
   */
  const saveEmail = async (dev: DeveloperRow, email: string) => {
    // Constraint do banco: fluxo externo exige e-mail — o erro volta no toast.
    const ok = await update(dev.id, { submission_email: email || null });
    if (ok) toast({ title: email ? "E-mail de envio salvo" : "E-mail de envio removido" });
    return ok;
  };

  const addDev = async () => {
    const name = newDev.trim();
    const email = newEmail.trim();
    // Clicar e a tela não responder era o comportamento anterior (`if (!name) return`).
    if (!name) return toast({ title: "Informe o nome da construtora", variant: "destructive" });
    if (email && !isEmail(email)) return toast({ title: "E-mail inválido", description: EMAIL_INVALIDO, variant: "destructive" });
    if (newFlow === "external" && !email) {
      return toast({
        title: "Fluxo externo exige e-mail",
        description: "É por ele que os documentos vão para a construtora.",
        variant: "destructive",
      });
    }
    setSaving(true);
    const { error } = await supabase.from("developers").insert({
      name,
      slug: slugify(name),
      flow: newFlow,
      submission_email: email || null,
    });
    setSaving(false);
    if (error) {
      return toast({ title: "Erro ao adicionar construtora", description: describeError(error, "Não foi possível adicionar a construtora."), variant: "destructive" });
    }
    setNewDev("");
    setNewEmail("");
    setNewFlow("internal");
    toast({ title: "Construtora adicionada" });
    await load();
  };

  const removeDev = async (dev: DeveloperRow) => {
    if (!confirm(`Remover "${dev.name}"? Se houver negócio ou aporte vinculado, prefira desativar.`)) return;
    const { data, error } = await supabase.from("developers").delete().eq("id", dev.id).select("id");
    if (error) {
      return toast({
        title: "Não foi possível remover",
        description: `${describeError(error, "Não foi possível remover a construtora.")} Se houver negócios vinculados, desative a construtora em vez de removê-la.`,
        variant: "destructive",
      });
    }
    if (!data?.length) return toast({ title: NO_PERMISSION, variant: "destructive" });
    setDevelopers(prev => prev.filter(d => d.id !== dev.id));
    toast({ title: "Construtora removida" });
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <PageHeader
        title="Construtoras & CCA"
        eyebrow="Administração"
        icon={Building2}
        description="Quais construtoras usam o CCA interno para aprovação de crédito. No fluxo externo, os documentos vão por e-mail à construtora."
      />

      <SectionCard title="Adicionar construtora" icon={Plus} description="O fluxo pode ser escolhido já no cadastro; o externo exige e-mail.">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <Label htmlFor="dev-nome" className="text-xs">Nome</Label>
            <Input id="dev-nome" value={newDev} onChange={e => setNewDev(e.target.value)} placeholder="Nome da construtora" className="h-8 text-xs" />
          </div>
          <div>
            <Label htmlFor="dev-email" className="text-xs">E-mail de envio</Label>
            <Input id="dev-email" type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="credito@construtora.com" className="h-8 text-xs" />
          </div>
          <div>
            <Label htmlFor="dev-fluxo" className="text-xs">Fluxo de crédito</Label>
            <Select value={newFlow} onValueChange={v => setNewFlow(v as DeveloperFlow)}>
              <SelectTrigger id="dev-fluxo" className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="internal">CCA interno</SelectItem>
                <SelectItem value="external">Fluxo externo (e-mail)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button size="sm" onClick={addDev} disabled={saving} className="h-8 gap-1 text-xs">
              <Plus className="h-4 w-4" /> {saving ? "Adicionando…" : "Adicionar"}
            </Button>
          </div>
        </div>
      </SectionCard>

      <Card className="border-border/50">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4"><LoadingState variant="table" rows={3} label="Carregando construtoras…" /></div>
          ) : loadError ? (
            <div className="p-4">
              <EmptyState
                icon={AlertTriangle}
                tone="danger"
                title="Não consegui carregar as construtoras"
                description={loadError}
                action={<Button variant="outline" onClick={() => void load()}>Tentar de novo</Button>}
              />
            </div>
          ) : developers.length === 0 ? (
            <div className="p-4">
              <EmptyState icon={Inbox} title="Nenhuma construtora cadastrada" description="Cadastre a primeira acima para começar a vincular negócios e aportes." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/40">
                    <th className="p-3 text-left font-medium text-muted-foreground">Construtora</th>
                    <th className="p-3 text-center font-medium text-muted-foreground">CCA Interno</th>
                    <th className="p-3 text-left font-medium text-muted-foreground">E-mail de envio</th>
                    <th className="p-3 text-center font-medium text-muted-foreground">Ativa</th>
                    <th className="p-3 text-right font-medium text-muted-foreground">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {developers.map(dev => (
                    <tr key={dev.id} className="border-b border-border/10 hover:bg-primary/5">
                      <td className="p-3 font-medium">
                        <span className="flex flex-wrap items-center gap-1.5">
                          {dev.name}
                          <StatusBadge tone={dev.flow === "internal" ? "warning" : "neutral"}>
                            {dev.flow === "internal" ? "CCA Ativo" : "Fluxo externo"}
                          </StatusBadge>
                        </span>
                        {dev.contact_name && <span className="block text-muted-foreground">{dev.contact_name}{dev.contact_phone ? ` · ${dev.contact_phone}` : ""}</span>}
                      </td>
                      <td className="p-3 text-center">
                        <Switch checked={dev.flow === "internal"} onCheckedChange={() => toggleCca(dev)} aria-label={`CCA interno de ${dev.name}`} />
                      </td>
                      <td className="p-3 min-w-48">
                        <EmailCell key={`${dev.id}-${dev.submission_email ?? ""}`} dev={dev} onSave={email => saveEmail(dev, email)} />
                      </td>
                      <td className="p-3 text-center">
                        <Switch checked={dev.active} onCheckedChange={() => toggleActive(dev)} aria-label={`Construtora ${dev.name} ativa`} />
                      </td>
                      <td className="p-3 text-right whitespace-nowrap">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(dev)} aria-label={`Editar ${dev.name}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeDev(dev)} aria-label={`Remover ${dev.name}`}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {editing && (
        <DeveloperEditDialog
          dev={editing}
          onClose={() => setEditing(null)}
          onSaved={(patch) => {
            setDevelopers(prev => prev.map(d => (d.id === editing.id ? { ...d, ...patch } : d)));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Ficha da construtora: nome, contato e observações — colunas que existiam em
 * `developers` e não apareciam em tela nenhuma — mais os empreendimentos.
 *
 * `developer_projects` é lida pelo cadastro de lead e pelo negócio, e até aqui
 * só tinha caminho de escrita por seed/SQL: quem cadastra a construtora agora
 * cadastra também os empreendimentos dela.
 */
function DeveloperEditDialog({
  dev,
  onClose,
  onSaved,
}: {
  dev: DeveloperRow;
  onClose: () => void;
  onSaved: (patch: Partial<DeveloperRow>) => void;
}) {
  const [form, setForm] = useState({
    name: dev.name,
    submission_email: dev.submission_email ?? "",
    contact_name: dev.contact_name ?? "",
    contact_phone: dev.contact_phone ?? "",
    notes: dev.notes ?? "",
    flow: dev.flow,
  });
  const [saving, setSaving] = useState(false);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [newProject, setNewProject] = useState({ name: "", city: "", state: "" });
  const [removingProject, setRemovingProject] = useState<string | null>(null);

  const loadProjects = useCallback(async () => {
    setLoadingProjects(true);
    setProjectsError(null);
    const { data, error } = await supabase
      .from("developer_projects")
      .select("id,developer_id,name,city,state,active")
      .eq("developer_id", dev.id)
      .order("name");
    setLoadingProjects(false);
    if (error) return setProjectsError(describeError(error, "Não consegui carregar os empreendimentos. Feche e reabra a construtora para tentar de novo."));
    setProjects((data ?? []) as ProjectRow[]);
  }, [dev.id]);

  useEffect(() => { void loadProjects(); }, [loadProjects]);

  const save = async () => {
    const name = form.name.trim();
    const email = form.submission_email.trim();
    if (!name) return toast({ title: "O nome não pode ficar vazio", variant: "destructive" });
    if (email && !isEmail(email)) return toast({ title: "E-mail inválido", description: EMAIL_INVALIDO, variant: "destructive" });
    if (form.flow === "external" && !email) {
      return toast({ title: "Fluxo externo exige e-mail", description: "É por ele que os documentos vão para a construtora.", variant: "destructive" });
    }
    const patch = {
      name,
      submission_email: email || null,
      contact_name: form.contact_name.trim() || null,
      contact_phone: form.contact_phone.trim() || null,
      notes: form.notes.trim() || null,
      flow: form.flow,
    };
    setSaving(true);
    const { data, error } = await supabase.from("developers").update(patch).eq("id", dev.id).select("id");
    setSaving(false);
    if (error) return toast({ title: "Erro ao salvar", description: describeError(error, "Não foi possível salvar a construtora."), variant: "destructive" });
    if (!data?.length) return toast({ title: NO_PERMISSION, variant: "destructive" });
    toast({ title: "Construtora salva" });
    onSaved(patch);
  };

  const addProject = async () => {
    const name = newProject.name.trim();
    if (!name) return toast({ title: "Informe o nome do empreendimento", variant: "destructive" });
    // `state` é `character(2)`: mandar "São Paulo" derruba o insert com 22001.
    const uf = newProject.state.trim().toUpperCase();
    if (uf && !/^[A-Z]{2}$/.test(uf)) {
      return toast({ title: "UF inválida", description: "Use a sigla de duas letras (SP, MG, GO).", variant: "destructive" });
    }
    const { data, error } = await supabase
      .from("developer_projects")
      .insert({ developer_id: dev.id, name, city: newProject.city.trim() || null, state: uf || null })
      .select("id,developer_id,name,city,state,active");
    if (error) return toast({ title: "Erro ao adicionar empreendimento", description: describeError(error, "Não foi possível adicionar o empreendimento."), variant: "destructive" });
    if (!data?.length) return toast({ title: NO_PERMISSION, variant: "destructive" });
    setProjects(prev => [...prev, ...(data as ProjectRow[])].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")));
    setNewProject({ name: "", city: "", state: "" });
    toast({ title: "Empreendimento adicionado" });
  };

  /**
   * Renomear e excluir empreendimento — o cadastro só sabia criar e
   * ativar/desativar. Um nome digitado errado ficava para sempre na lista que o
   * cadastro de lead e o negócio leem, e a única saída era SQL.
   */
  const renameProject = async (project: ProjectRow, name: string): Promise<boolean> => {
    const limpo = name.trim();
    if (!limpo) {
      toast({ title: "O nome do empreendimento não pode ficar vazio", variant: "destructive" });
      return false;
    }
    if (limpo === project.name) return true;
    const { data, error } = await supabase
      .from("developer_projects")
      .update({ name: limpo })
      .eq("id", project.id)
      .select("id");
    if (error) {
      toast({ title: "Erro ao renomear", description: describeError(error, "Não foi possível renomear o empreendimento."), variant: "destructive" });
      return false;
    }
    if (!data?.length) {
      toast({ title: NO_PERMISSION, variant: "destructive" });
      return false;
    }
    setProjects(prev => prev.map(p => (p.id === project.id ? { ...p, name: limpo } : p)).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")));
    toast({ title: "Empreendimento renomeado" });
    return true;
  };

  const removeProject = async (project: ProjectRow) => {
    if (!confirm(`Excluir o empreendimento "${project.name}"? Se houver lead ou negócio vinculado, prefira desativar.`)) return;
    setRemovingProject(project.id);
    const { data, error } = await supabase.from("developer_projects").delete().eq("id", project.id).select("id");
    setRemovingProject(null);
    if (error) {
      return toast({
        title: "Não foi possível excluir",
        description: `${describeError(error, "Não foi possível excluir o empreendimento.")} Se houver lead ou negócio vinculado, desative em vez de excluir.`,
        variant: "destructive",
      });
    }
    if (!data?.length) return toast({ title: NO_PERMISSION, variant: "destructive" });
    setProjects(prev => prev.filter(p => p.id !== project.id));
    toast({ title: "Empreendimento excluído" });
  };

  const toggleProject = async (project: ProjectRow) => {
    const { data, error } = await supabase
      .from("developer_projects")
      .update({ active: !project.active })
      .eq("id", project.id)
      .select("id");
    if (error) return toast({ title: "Erro ao atualizar", description: describeError(error, "Não foi possível atualizar o empreendimento."), variant: "destructive" });
    if (!data?.length) return toast({ title: NO_PERMISSION, variant: "destructive" });
    setProjects(prev => prev.map(p => (p.id === project.id ? { ...p, active: !p.active } : p)));
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Editar {dev.name}</DialogTitle></DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="edit-nome" className="text-xs">Nome</Label>
            <Input id="edit-nome" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className="h-8 text-xs" />
          </div>
          <div>
            <Label htmlFor="edit-email" className="text-xs">E-mail de envio</Label>
            <Input id="edit-email" type="email" value={form.submission_email} onChange={e => setForm(p => ({ ...p, submission_email: e.target.value }))} className="h-8 text-xs" />
          </div>
          <div>
            <Label htmlFor="edit-contato" className="text-xs">Contato</Label>
            <Input id="edit-contato" value={form.contact_name} onChange={e => setForm(p => ({ ...p, contact_name: e.target.value }))} className="h-8 text-xs" />
          </div>
          <div>
            <Label htmlFor="edit-telefone" className="text-xs">Telefone</Label>
            <Input id="edit-telefone" value={form.contact_phone} onChange={e => setForm(p => ({ ...p, contact_phone: e.target.value }))} className="h-8 text-xs" />
          </div>
          <div>
            <Label htmlFor="edit-fluxo" className="text-xs">Fluxo de crédito</Label>
            <Select value={form.flow} onValueChange={v => setForm(p => ({ ...p, flow: v as DeveloperFlow }))}>
              <SelectTrigger id="edit-fluxo" className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="internal">CCA interno</SelectItem>
                <SelectItem value="external">Fluxo externo (e-mail)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="edit-notas" className="text-xs">Observações</Label>
            <Textarea id="edit-notas" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} className="text-xs" />
          </div>
        </div>

        <div className="space-y-2 rounded-lg border border-border/40 p-3">
          <p className="text-xs font-semibold">Empreendimentos</p>
          {loadingProjects ? (
            <LoadingState variant="list" rows={2} label="Carregando empreendimentos…" />
          ) : projectsError ? (
            <p role="alert" className="text-xs text-destructive">{projectsError}</p>
          ) : projects.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum empreendimento cadastrado para esta construtora.</p>
          ) : (
            <ul className="space-y-1">
              {projects.map(p => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 text-xs">
                  {/* O nome era só texto: renomear exigia SQL, e a lista é lida
                      pelo cadastro de lead e pelo negócio. */}
                  <ProjectNameCell key={`${p.id}-${p.name}`} project={p} onRename={name => renameProject(p, name)} />
                  <span className="text-muted-foreground">{[p.city, p.state].filter(Boolean).join(" · ") || "sem cidade"}</span>
                  <span className="ml-auto flex items-center gap-2">
                    {!p.active && <StatusBadge tone="neutral">inativo</StatusBadge>}
                    <Switch checked={p.active} onCheckedChange={() => toggleProject(p)} aria-label={`Empreendimento ${p.name} ativo`} />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={removingProject === p.id}
                      onClick={() => removeProject(p)}
                      aria-label={`Excluir empreendimento ${p.name}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input value={newProject.name} onChange={e => setNewProject(p => ({ ...p, name: e.target.value }))} placeholder="Nome do empreendimento" className="h-8 text-xs" aria-label="Nome do empreendimento" />
            <Input value={newProject.city} onChange={e => setNewProject(p => ({ ...p, city: e.target.value }))} placeholder="Cidade" className="h-8 text-xs sm:w-40" aria-label="Cidade do empreendimento" />
            {/* `state` era lida em toda parte e nunca preenchida: a coluna
                existia sempre nula. `character(2)`, daí o maxLength. */}
            <Input
              value={newProject.state}
              onChange={e => setNewProject(p => ({ ...p, state: e.target.value.toUpperCase().slice(0, 2) }))}
              placeholder="UF"
              maxLength={2}
              className="h-8 text-xs sm:w-16"
              aria-label="UF do empreendimento"
            />
            <Button size="sm" variant="outline" onClick={addProject} className="h-8 gap-1 text-xs"><Plus className="h-4 w-4" /> Adicionar</Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Salvando…" : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
