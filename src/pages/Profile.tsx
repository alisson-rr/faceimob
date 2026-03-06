import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { UserCircle, Mail, Phone, Shield, Plus, Pencil, Search, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { mockBrokers, mockManagers } from "@/data/mockData";
import { toast } from "@/hooks/use-toast";

const ROLES = [
  { value: "broker", label: "Corretor" },
  { value: "manager", label: "Gerente" },
  { value: "director", label: "Diretor" },
  { value: "cca", label: "CCA" },
  { value: "admin", label: "Administrador" },
  { value: "partner", label: "Sócio" },
];

const DIRECTORS = ["André Martins", "Paula Ferreira", "Lucas Andrade"];

interface Collaborator {
  id: string;
  nickname: string;
  fullName: string;
  email: string;
  team: string;
  birthDate: string;
  license: string;
  creci: string;
  entryDate: string;
  cpf: string;
  phone: string;
  address: string;
  role: string;
  division: string;
  director: string;
  referral: string;
  active: boolean;
  username: string;
  password: string;
}

const initialCollaborators: Collaborator[] = mockBrokers.filter(b => b.active).map((b, i) => ({
  id: b.id,
  nickname: b.name.split(" ")[0],
  fullName: b.name,
  email: `${b.name.split(" ")[0].toLowerCase()}@faceimob.com.br`,
  team: b.team,
  birthDate: "",
  license: "CRECI",
  creci: String(80000 + i),
  entryDate: "2025-01-15",
  cpf: "",
  phone: "",
  address: "",
  role: "broker",
  division: "1",
  director: DIRECTORS[i % 3],
  referral: "",
  active: true,
  username: b.name.split(" ")[0].toLowerCase(),
  password: "123456",
}));

export default function Profile() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const [collaborators, setCollaborators] = useState<Collaborator[]>(initialCollaborators);
  const [search, setSearch] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editingCollab, setEditingCollab] = useState<Collaborator | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const emptyCollab: Collaborator = {
    id: "", nickname: "", fullName: "", email: "", team: "", birthDate: "",
    license: "CRECI", creci: "", entryDate: new Date().toISOString().slice(0, 10),
    cpf: "", phone: "", address: "", role: "broker", division: "1",
    director: DIRECTORS[0], referral: "", active: true, username: "", password: "",
  };

  const filtered = useMemo(() =>
    collaborators.filter(c => {
      const s = search.toLowerCase();
      return !s || c.fullName.toLowerCase().includes(s) || c.nickname.toLowerCase().includes(s) || c.email.toLowerCase().includes(s);
    }), [collaborators, search]);

  const openNew = () => { setEditingCollab(null); setEditOpen(true); setShowPassword(false); };
  const openEdit = (c: Collaborator) => { setEditingCollab(c); setEditOpen(true); setShowPassword(false); };

  const [formData, setFormData] = useState<Collaborator>(emptyCollab);

  const handleOpen = (c: Collaborator | null) => {
    setFormData(c ? { ...c } : { ...emptyCollab, id: String(Date.now()) });
  };

  const save = () => {
    if (!formData.fullName.trim()) {
      toast({ title: "Nome obrigatório", variant: "destructive" });
      return;
    }
    if (editingCollab) {
      setCollaborators(prev => prev.map(c => c.id === editingCollab.id ? formData : c));
    } else {
      setCollaborators(prev => [...prev, formData]);
    }
    setEditOpen(false);
    toast({ title: editingCollab ? "Colaborador atualizado" : "Colaborador cadastrado" });
  };

  // When dialog opens, sync formData
  const onOpenChange = (open: boolean) => {
    if (!open) { setEditOpen(false); return; }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Pessoal</h1>
          <p className="text-muted-foreground">Gerencie os colaboradores do sistema</p>
        </div>
        {isAdmin && (
          <Button size="sm" onClick={() => { openNew(); handleOpen(null); }}>
            <Plus className="h-4 w-4 mr-1" /> Novo Colaborador
          </Button>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Buscar colaborador..." className="pl-10" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Table */}
      <Card className="glass overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Colaborador</TableHead>
                <TableHead>Nome Completo</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Função</TableHead>
                <TableHead>Equipe</TableHead>
                <TableHead>Celular</TableHead>
                <TableHead>CRECI</TableHead>
                <TableHead className="text-center">Ativo</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(c => (
                <TableRow key={c.id} className="cursor-pointer hover:bg-secondary/30" onClick={() => { openEdit(c); handleOpen(c); }}>
                  <TableCell className="font-medium">{c.nickname}</TableCell>
                  <TableCell>{c.fullName}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{c.email}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-[10px]">
                      {ROLES.find(r => r.value === c.role)?.label || c.role}
                    </Badge>
                  </TableCell>
                  <TableCell>{c.team}</TableCell>
                  <TableCell className="text-xs">{c.phone}</TableCell>
                  <TableCell className="text-xs">{c.creci}</TableCell>
                  <TableCell className="text-center">
                    <span className={`w-2 h-2 rounded-full inline-block ${c.active ? "bg-emerald-500" : "bg-destructive"}`} />
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm"><Pencil className="h-3 w-3" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Edit / New Collaborator Dialog */}
      <Dialog open={editOpen} onOpenChange={(o) => { if (!o) setEditOpen(false); }}>
        <DialogContent className="glass-strong max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingCollab ? "Editar Colaborador" : "Novo Colaborador"}</DialogTitle>
          </DialogHeader>

          {/* Avatar placeholder */}
          <div className="flex justify-center mb-2">
            <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center text-primary text-2xl font-bold">
              {formData.nickname?.charAt(0) || "?"}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block font-semibold">Colaborador</label>
              <Input value={formData.nickname} onChange={e => setFormData(p => ({ ...p, nickname: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block font-semibold">Nome Completo</label>
              <Input value={formData.fullName} onChange={e => setFormData(p => ({ ...p, fullName: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block font-semibold">Email</label>
              <Input type="email" value={formData.email} onChange={e => setFormData(p => ({ ...p, email: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block font-semibold">Equipe</label>
              <Input value={formData.team} onChange={e => setFormData(p => ({ ...p, team: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block font-semibold">Nascimento</label>
              <Input value={formData.birthDate} onChange={e => setFormData(p => ({ ...p, birthDate: e.target.value }))} placeholder="DD/MM/AAAA" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block font-semibold">Habilitação</label>
              <Select value={formData.license} onValueChange={v => setFormData(p => ({ ...p, license: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="CRECI">CRECI</SelectItem>
                  <SelectItem value="OAB">OAB</SelectItem>
                  <SelectItem value="CRC">CRC</SelectItem>
                  <SelectItem value="Outro">Outro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-3">
              <label className="text-xs text-muted-foreground mb-1 block font-semibold">CRECI / Registro</label>
              <Input value={formData.creci} onChange={e => setFormData(p => ({ ...p, creci: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block font-semibold">Entrada</label>
              <Input type="date" value={formData.entryDate} onChange={e => setFormData(p => ({ ...p, entryDate: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block font-semibold">CPF</label>
              <Input value={formData.cpf} onChange={e => setFormData(p => ({ ...p, cpf: e.target.value }))} placeholder="000.000.000-00" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block font-semibold">Celular</label>
              <Input value={formData.phone} onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))} placeholder="(00) 00000-0000" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block font-semibold">Endereço</label>
              <Input value={formData.address} onChange={e => setFormData(p => ({ ...p, address: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block font-semibold">Função</label>
              <Select value={formData.role} onValueChange={v => setFormData(p => ({ ...p, role: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block font-semibold">Divisão</label>
              <Input value={formData.division} onChange={e => setFormData(p => ({ ...p, division: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block font-semibold">Diretor</label>
              <Select value={formData.director} onValueChange={v => setFormData(p => ({ ...p, director: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DIRECTORS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block font-semibold">Indicação</label>
              <Input value={formData.referral} onChange={e => setFormData(p => ({ ...p, referral: e.target.value }))} placeholder="Inserir indicação" />
            </div>

            {/* User credentials */}
            <div className="sm:col-span-3 border-t border-border pt-4 mt-2">
              <p className="text-sm font-semibold mb-3">Acesso ao Sistema</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block font-semibold">Usuário (login)</label>
                  <Input value={formData.username} onChange={e => setFormData(p => ({ ...p, username: e.target.value }))} placeholder="nome.sobrenome" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block font-semibold">Senha</label>
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={formData.password}
                      onChange={e => setFormData(p => ({ ...p, password: e.target.value }))}
                      placeholder="••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Active toggle */}
            <div className="sm:col-span-3 flex items-center gap-3 mt-2">
              <label className="text-xs font-semibold">Ativo</label>
              <Switch checked={formData.active} onCheckedChange={v => setFormData(p => ({ ...p, active: v }))} />
            </div>
          </div>

          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={save}>Confirmar Alterações</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
