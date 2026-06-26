import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pencil, Trash2, Download, X, UserPlus } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { mockBrokers } from "@/data/mockData";
import { toast } from "@/hooks/use-toast";

const ROLES = [
  { value: "broker", label: "Corretor" },
  { value: "manager", label: "Gerente" },
  { value: "director", label: "Diretor" },
  { value: "cca", label: "CCA" },
  { value: "admin", label: "Administrador" },
  { value: "adm", label: "Adm" },
  { value: "administrativo", label: "Administrativo" },
  { value: "servicos", label: "Serviços Gerais" },
];

const DIRECTORS = ["Archimedes", "Fabio Batista", "Mauricio"];
const TEAMS = ["Alexandre", "Alisson", "Daiane Dias", "Jose Portilho", "Leonardo", "Susana", "Veronica", "Victor", "Archimedes", "Zona Sul", "Mauricio"];
const HABILITACOES = ["CRECI", "Estágio", "Não Possui (Estágio)", "OAB", "Outro"];

interface Collaborator {
  id: string;
  nickname: string;
  fullName: string;
  email: string;
  password: string;
  team: string;
  director: string;
  birthDate: string;
  habilitacao: string;
  creci: string;
  entryDate: string;
  cpf: string;
  phone: string;
  address: string;
  role: string;
  division: string;
  referral: string;
  active: boolean;
  isCCA?: boolean;
}

const genPwd = () => Math.random().toString(36).slice(-8);

const initialCollaborators: Collaborator[] = mockBrokers.filter(b => b.active).map((b, i) => ({
  id: b.id,
  nickname: b.name.split(" ")[0],
  fullName: b.name,
  email: `${b.name.toLowerCase().replace(/\s+/g, ".")}@faceimob.com.br`,
  password: genPwd(),
  team: b.team || TEAMS[i % TEAMS.length],
  director: DIRECTORS[i % 3],
  birthDate: "",
  habilitacao: i % 5 === 0 ? "Estágio" : "CRECI",
  creci: String(60000 + i * 7),
  entryDate: "2025-01-15",
  cpf: "",
  phone: `5198${String(1000000 + i * 13).slice(-7)}`,
  address: "",
  role: "broker",
  division: "1",
  referral: i % 3 === 0 ? "Gabriel Dutra" : "",
  active: true,
}));

const habBadge = (h: string) => {
  if (h === "Estágio") return "bg-amber-700/60 text-amber-100";
  if (h.includes("Não Possui")) return "bg-red-700/60 text-red-100";
  return "text-foreground";
};

export default function Profile() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const [collaborators, setCollaborators] = useState<Collaborator[]>(initialCollaborators);

  const [filterGerencia, setFilterGerencia] = useState<string>("all");
  const [filterHab, setFilterHab] = useState<string>("all");
  const [filterNomeCorretor, setFilterNomeCorretor] = useState("");
  const [filterNomeColab, setFilterNomeColab] = useState("");

  const [dlgColab, setDlgColab] = useState(false);
  const [dlgCCA, setDlgCCA] = useState(false);
  const [editing, setEditing] = useState<Collaborator | null>(null);

  const emptyForm = (cca = false): Collaborator => ({
    id: String(Date.now()), nickname: "", fullName: "", email: "", password: genPwd(),
    team: "", director: DIRECTORS[0], birthDate: "", habilitacao: cca ? "" : "CRECI",
    creci: "", entryDate: new Date().toISOString().slice(0, 10), cpf: "", phone: "",
    address: "", role: cca ? "cca" : "broker", division: "1", referral: "", active: true, isCCA: cca,
  });

  const [form, setForm] = useState<Collaborator>(emptyForm());

  const filtered = useMemo(() => collaborators.filter(c => {
    if (filterGerencia !== "all" && c.director !== filterGerencia) return false;
    if (filterHab !== "all" && c.habilitacao !== filterHab) return false;
    if (filterNomeCorretor && !c.fullName.toLowerCase().includes(filterNomeCorretor.toLowerCase())) return false;
    if (filterNomeColab && !c.nickname.toLowerCase().includes(filterNomeColab.toLowerCase())) return false;
    return true;
  }), [collaborators, filterGerencia, filterHab, filterNomeCorretor, filterNomeColab]);

  // Team summary
  const teamSummary = useMemo(() => {
    const map = new Map<string, number>();
    collaborators.filter(c => c.role === "broker").forEach(c => {
      map.set(c.team, (map.get(c.team) || 0) + 1);
    });
    return Array.from(map.entries()).map(([team, corretores]) => ({
      team, corretores, meta: 8, metaPorCorretor: corretores ? +(8 / corretores).toFixed(1) : 0,
    }));
  }, [collaborators]);

  // Role summary
  const roleSummary = useMemo(() => {
    const count = (r: string) => collaborators.filter(c => c.role === r && c.active).length;
    return {
      gerentes: count("manager"),
      corretores: count("broker"),
      diretores: count("director"),
      adm: count("adm") + count("admin"),
      administrativo: count("administrativo"),
      servicos: count("servicos"),
      total: collaborators.filter(c => c.active).length,
    };
  }, [collaborators]);

  const openNew = (cca: boolean) => { setEditing(null); setForm(emptyForm(cca)); cca ? setDlgCCA(true) : setDlgColab(true); };
  const openEdit = (c: Collaborator) => { setEditing(c); setForm({ ...c }); c.isCCA ? setDlgCCA(true) : setDlgColab(true); };

  const save = () => {
    if (!form.fullName.trim()) { toast({ title: "Nome obrigatório", variant: "destructive" }); return; }
    if (editing) setCollaborators(prev => prev.map(c => c.id === editing.id ? form : c));
    else setCollaborators(prev => [...prev, form]);
    setDlgColab(false); setDlgCCA(false);
    toast({ title: editing ? "Atualizado" : "Cadastrado" });
  };

  const del = (id: string) => {
    setCollaborators(prev => prev.filter(c => c.id !== id));
    toast({ title: "Removido" });
  };

  const downloadCSV = () => {
    const headers = ["Colaborador", "Diretor", "Gerência", "Email", "Celular", "Indicação", "Habilitação", "Ativo"];
    const rows = filtered.map(c => [c.nickname, c.director, c.team, c.email, c.phone, c.referral, c.habilitacao, c.active ? "Sim" : "Não"]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${v ?? ""}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "colaboradores.csv"; a.click();
  };

  return (
    <div className="space-y-6">
      {/* Top action buttons */}
      <div className="flex justify-center gap-3">
        <Button onClick={() => openNew(false)} className="bg-transparent border-2 border-emerald-500 text-emerald-400 hover:bg-emerald-500/10 px-6">
          Adicionar Colaborador
        </Button>
        <Button onClick={() => openNew(true)} className="bg-transparent border-2 border-amber-500 text-amber-400 hover:bg-amber-500/10 px-6">
          Adicionar CCA
        </Button>
      </div>

      {/* Top summary cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="glass p-0 overflow-hidden lg:col-span-2">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border/50">
                <TableHead className="text-center">Equipe</TableHead>
                <TableHead className="text-center">Corretores</TableHead>
                <TableHead className="text-center">Meta p/ corret</TableHead>
                <TableHead className="text-center">Meta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {teamSummary.map(t => (
                <TableRow key={t.team}>
                  <TableCell className="text-center py-1.5">{t.team}</TableCell>
                  <TableCell className="text-center py-1.5">{t.corretores}</TableCell>
                  <TableCell className="text-center py-1.5">{t.metaPorCorretor}</TableCell>
                  <TableCell className="text-center py-1.5">{t.meta}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <Card className="glass p-4 space-y-2">
          {[
            ["Gerentes", roleSummary.gerentes, "text-foreground"],
            ["Corretores", roleSummary.corretores, "text-amber-500"],
            ["Diretor", roleSummary.diretores, "text-foreground"],
            ["Adm", roleSummary.adm, "text-foreground"],
            ["Administrativo", roleSummary.administrativo, "text-foreground"],
            ["Serviços Gerais", roleSummary.servicos, "text-muted-foreground"],
            ["Total", roleSummary.total, "text-amber-500"],
          ].map(([label, val, color]) => (
            <div key={label as string} className={`flex justify-between border-b border-border/30 py-1.5 ${color as string}`}>
              <span className="font-semibold">{label as string}</span>
              <span>{val as number}</span>
            </div>
          ))}
        </Card>
      </div>

      {/* Filter + Download */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <Card className="glass p-4 lg:col-span-2 relative">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Filtrar Colaboradores</h3>
            <button onClick={() => { setFilterGerencia("all"); setFilterHab("all"); setFilterNomeCorretor(""); setFilterNomeColab(""); }}>
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select value={filterGerencia} onValueChange={setFilterGerencia}>
              <SelectTrigger className="rounded-full border-amber-600/40"><SelectValue placeholder="Escolher Gerência" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas Gerências</SelectItem>
                {DIRECTORS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input placeholder="Filtrar por nome Corretor" className="rounded-full border-amber-600/40" value={filterNomeCorretor} onChange={e => setFilterNomeCorretor(e.target.value)} />
            <Select value={filterHab} onValueChange={setFilterHab}>
              <SelectTrigger className="rounded-full border-amber-600/40"><SelectValue placeholder="Escolher Habilitação" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas Habilitações</SelectItem>
                {HABILITACOES.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input placeholder="Filtrar por nome Colaborador" className="rounded-full border-amber-600/40" value={filterNomeColab} onChange={e => setFilterNomeColab(e.target.value)} />
          </div>
        </Card>

        <div className="flex justify-end">
          <Button onClick={downloadCSV} className="bg-primary hover:bg-primary/90 px-6 py-6">
            Baixar Lista <Download className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Main table */}
      <Card className="glass p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Colaboradores</TableHead>
                <TableHead>Diretor</TableHead>
                <TableHead>Gerência</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Senha</TableHead>
                <TableHead>Celular</TableHead>
                <TableHead>Indicação</TableHead>
                <TableHead>Habilitação</TableHead>
                <TableHead className="text-center">Editar</TableHead>
                <TableHead className="text-center">Deletar</TableHead>
                <TableHead className="text-center">Ativo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(c => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.nickname}</TableCell>
                  <TableCell className="text-xs">{c.director}</TableCell>
                  <TableCell className="text-xs">{c.team}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{c.email}</TableCell>
                  <TableCell className="text-xs font-mono">{c.password}</TableCell>
                  <TableCell className="text-xs">{c.phone}</TableCell>
                  <TableCell className="text-xs">{c.referral}</TableCell>
                  <TableCell>
                    <span className={`text-xs px-2 py-1 rounded ${habBadge(c.habilitacao)}`}>
                      {c.habilitacao === "CRECI" ? c.creci : c.habilitacao}
                    </span>
                  </TableCell>
                  <TableCell className="text-center">
                    {isAdmin && <Button variant="ghost" size="sm" onClick={() => openEdit(c)}><Pencil className="h-3.5 w-3.5 text-blue-400" /></Button>}
                  </TableCell>
                  <TableCell className="text-center">
                    {isAdmin && <Button variant="ghost" size="sm" onClick={() => del(c.id)}><Trash2 className="h-3.5 w-3.5 text-red-400" /></Button>}
                  </TableCell>
                  <TableCell className="text-center">
                    <span className={`text-xs px-3 py-1 rounded ${c.active ? "bg-emerald-700/60 text-emerald-100" : "bg-red-700/60 text-red-100"}`}>
                      {c.active ? "Ativo" : "Inativo"}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Novo Colaborador Dialog */}
      <Dialog open={dlgColab} onOpenChange={setDlgColab}>
        <DialogContent className="glass-strong max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Colaborador" : "Novo Colaborador"}</DialogTitle>
          </DialogHeader>

          <div className="flex justify-center my-2">
            <div className="w-28 h-28 rounded-full border-2 border-dashed border-border flex items-center justify-center text-center text-[10px] text-muted-foreground px-2">
              Clique para carregar<br />foto de perfil
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Colaborador"><Input placeholder="Inserir nome colaborador" value={form.nickname} onChange={e => setForm(p => ({ ...p, nickname: e.target.value }))} /></Field>
            <Field label="Nome Completo"><Input placeholder="Inserir nome completo" value={form.fullName} onChange={e => setForm(p => ({ ...p, fullName: e.target.value }))} /></Field>
            <Field label="Email"><Input placeholder="Inserir email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} /></Field>

            <Field label="Função">
              <Select value={form.role} onValueChange={v => setForm(p => ({ ...p, role: v }))}>
                <SelectTrigger><SelectValue placeholder="Escolher função" /></SelectTrigger>
                <SelectContent>{ROLES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Equipe">
              <Select value={form.team} onValueChange={v => setForm(p => ({ ...p, team: v }))}>
                <SelectTrigger><SelectValue placeholder="Escolher equipe" /></SelectTrigger>
                <SelectContent>{TEAMS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Habilitação">
              <Select value={form.habilitacao} onValueChange={v => setForm(p => ({ ...p, habilitacao: v }))}>
                <SelectTrigger><SelectValue placeholder="Escolher Habilitação" /></SelectTrigger>
                <SelectContent>{HABILITACOES.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
              </Select>
            </Field>

            <div className="sm:col-span-3"><Field label="Indicação"><Input placeholder="Inserir indicação" value={form.referral} onChange={e => setForm(p => ({ ...p, referral: e.target.value }))} /></Field></div>

            <Field label="Entrada"><Input type="date" value={form.entryDate} onChange={e => setForm(p => ({ ...p, entryDate: e.target.value }))} /></Field>
            <Field label="CPF"><Input placeholder="Inserir CPF" value={form.cpf} onChange={e => setForm(p => ({ ...p, cpf: e.target.value }))} /></Field>
            <Field label="Celular"><Input placeholder="Inserir celular" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} /></Field>
            <Field label="Endereço"><Input placeholder="Inserir endereço" value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} /></Field>
            <Field label="Divisão"><Input placeholder="Inserir divisão" value={form.division} onChange={e => setForm(p => ({ ...p, division: e.target.value }))} /></Field>
            <Field label="Nascimento"><Input placeholder="DD/MM/AAAA" value={form.birthDate} onChange={e => setForm(p => ({ ...p, birthDate: e.target.value }))} /></Field>
          </div>

          <div className="flex justify-center gap-3 pt-4">
            <Button variant="outline" className="border-red-500 text-red-400 hover:bg-red-500/10 px-8" onClick={() => setDlgColab(false)}>Cancelar</Button>
            <Button className="bg-transparent border-2 border-emerald-500 text-emerald-400 hover:bg-emerald-500/10 px-8" onClick={save}>
              <UserPlus className="h-4 w-4 mr-2" /> {editing ? "Salvar" : "Adicionar Colaborador"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Novo CCA Dialog */}
      <Dialog open={dlgCCA} onOpenChange={setDlgCCA}>
        <DialogContent className="glass-strong max-w-2xl">
          <DialogHeader>
            <DialogTitle>Novo CCA</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Colaborador"><Input placeholder="Inserir nome colaborador" value={form.nickname} onChange={e => setForm(p => ({ ...p, nickname: e.target.value }))} /></Field>
            <Field label="Nome Completo"><Input placeholder="Inserir nome completo" value={form.fullName} onChange={e => setForm(p => ({ ...p, fullName: e.target.value }))} /></Field>
            <Field label="Email"><Input placeholder="Inserir email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} /></Field>
            <Field label="Entrada"><Input type="date" value={form.entryDate} onChange={e => setForm(p => ({ ...p, entryDate: e.target.value }))} /></Field>
            <Field label="CPF"><Input placeholder="Inserir CPF" value={form.cpf} onChange={e => setForm(p => ({ ...p, cpf: e.target.value }))} /></Field>
            <Field label="Celular"><Input placeholder="Inserir celular" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} /></Field>
            <Field label="Endereço"><Input placeholder="Inserir endereço" value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} /></Field>
            <Field label="Divisão"><Input placeholder="Inserir divisão" value={form.division} onChange={e => setForm(p => ({ ...p, division: e.target.value }))} /></Field>
            <Field label="Nascimento"><Input placeholder="DD/MM/AAAA" value={form.birthDate} onChange={e => setForm(p => ({ ...p, birthDate: e.target.value }))} /></Field>
          </div>
          <div className="flex justify-center gap-3 pt-4">
            <Button variant="outline" className="border-red-500 text-red-400 hover:bg-red-500/10 px-8" onClick={() => setDlgCCA(false)}>Cancelar</Button>
            <Button className="bg-transparent border-2 border-emerald-500 text-emerald-400 hover:bg-emerald-500/10 px-8" onClick={save}>
              Adicionar CCA
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-foreground mb-1 block font-semibold">{label}</label>
      {children}
    </div>
  );
}
