import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Camera, KeyRound, Loader2, Copy, Check, IdCard, Sparkles } from "lucide-react";
import logoWhite from "@/assets/logo-faceimob-white.png";

type Manager = { id: string; name: string };
type Director = { id: string; name: string };

export type EditableBroker = {
  id: string;
  name: string | null;
  full_name?: string | null;
  email?: string | null;
  role?: string | null;
  manager_id?: string | null;
  director_id?: string | null;
  active?: boolean | null;
  user_id?: string | null;
  avatar_url?: string | null;
  habilitation?: string | null;
  creci?: string | null;
  cpf?: string | null;
  celular?: string | null;
  address?: string | null;
  birth_date?: string | null;
  entry_date?: string | null;
  division?: string | null;
  indication?: string | null;
  login_email?: string | null;
  login_password_plain?: string | null;
  login_email_confirmed?: boolean | null;
  badge_requested?: boolean | null;
  badge_requested_at?: string | null;
  badge_delivered_at?: string | null;
};

function slug(s: string) {
  return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}
function suggestEmail(full: string | null | undefined, fallback?: string | null) {
  const src = (full || fallback || "").trim();
  if (!src) return "";
  const parts = src.split(/\s+/).filter(Boolean);
  const first = slug(parts[0] || "");
  const last = slug(parts[parts.length - 1] || "");
  const local = first && last && first !== last ? `${first}.${last}` : first || last;
  return local ? `${local}@faceimob.com.br` : "";
}

const ROLES = ["broker", "manager", "director", "cca", "admin", "partner"];

export function BrokerEditModal({
  open, broker, managers, directors, onClose, onSaved, isAdmin,
}: {
  open: boolean;
  broker: EditableBroker | null;
  managers: Manager[];
  directors: Director[];
  onClose: () => void;
  onSaved: () => void;
  isAdmin: boolean;
}) {
  const [form, setForm] = useState<EditableBroker | null>(broker);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [creds, setCreds] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { setForm(broker); setCreds(null); }, [broker]);

  if (!form) return null;
  const upd = (k: keyof EditableBroker, v: any) => setForm(p => p ? { ...p, [k]: v } : p);

  const save = async () => {
    setSaving(true);
    const patch = {
      name: form.name, full_name: form.full_name, email: form.email,
      role: form.role, manager_id: form.manager_id || null, director_id: form.director_id || null,
      active: form.active ?? true, avatar_url: form.avatar_url,
      habilitation: form.habilitation, creci: form.creci, cpf: form.cpf,
      celular: form.celular, address: form.address, birth_date: form.birth_date || null,
      entry_date: form.entry_date || null, division: form.division, indication: form.indication,
      login_email: form.login_email || null,
      login_email_confirmed: !!form.login_email_confirmed,
      badge_requested: !!form.badge_requested,
      badge_requested_at: form.badge_requested_at || null,
      badge_delivered_at: form.badge_delivered_at || null,
    };
    const { error } = await supabase.from("brokers").update(patch).eq("id", form.id);
    setSaving(false);
    if (error) return toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
    toast({ title: "Dados atualizados" });
    onSaved();
  };

  const uploadAvatar = async (file: File) => {
    setUploading(true);
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${form.id}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
    if (upErr) { setUploading(false); return toast({ title: "Falha no upload", description: upErr.message, variant: "destructive" }); }
    const { data: signed } = await supabase.storage.from("avatars").createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
    const url = signed?.signedUrl || null;
    upd("avatar_url", url);
    setUploading(false);
  };

  const provision = async (reset = false) => {
    setProvisioning(true); setCreds(null);
    const { data, error } = await supabase.functions.invoke("provision-broker-user", {
      body: { broker_id: form.id, email: form.login_email || form.email, reset },
    });
    setProvisioning(false);
    if (error || (data as any)?.error) {
      return toast({ title: "Falha", description: (data as any)?.error || error?.message, variant: "destructive" });
    }
    setCreds({ email: (data as any).email, password: (data as any).password });
    toast({ title: reset ? "Senha redefinida" : "Acesso criado com sucesso" });
    onSaved();
  };

  const copy = (label: string, val: string) => {
    navigator.clipboard.writeText(val);
    setCopied(label); setTimeout(() => setCopied(null), 1500);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar Colaborador</DialogTitle>
          <DialogDescription>Perfil, dados pessoais e acesso ao sistema.</DialogDescription>
        </DialogHeader>

        {/* Avatar */}
        <div className="flex justify-center py-2">
          <div className="relative">
            <div className="w-28 h-28 rounded-full overflow-hidden border-2 border-primary/40 bg-secondary flex items-center justify-center">
              {form.avatar_url
                ? <img src={form.avatar_url} alt={form.name || ""} className="w-full h-full object-cover" />
                : <img src={logoWhite} alt="" className="w-16 h-16 object-contain opacity-60" />}
            </div>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="absolute bottom-0 right-0 bg-primary text-primary-foreground rounded-full p-1.5 border-2 border-background"
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => e.target.files?.[0] && uploadAvatar(e.target.files[0])} />
          </div>
        </div>

        {/* Fields grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Colaborador (apelido)"><Input value={form.name || ""} onChange={e => upd("name", e.target.value)} /></Field>
          <Field label="Nome Completo"><Input value={form.full_name || ""} onChange={e => upd("full_name", e.target.value)} /></Field>
          <Field label="Email"><Input type="email" value={form.email || ""} onChange={e => upd("email", e.target.value)} /></Field>

          <Field label="Equipe (Gerente)">
            <Select value={form.manager_id || "__none__"} onValueChange={v => upd("manager_id", v === "__none__" ? null : v)}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— sem gerente —</SelectItem>
                {managers.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Nascimento"><Input type="date" value={form.birth_date || ""} onChange={e => upd("birth_date", e.target.value)} /></Field>
          <Field label="Habilitação">
            <Select value={form.habilitation || "__none__"} onValueChange={v => upd("habilitation", v === "__none__" ? null : v)}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">—</SelectItem>
                <SelectItem value="CRECI">CRECI</SelectItem>
                <SelectItem value="CRECI-ESTAGIARIO">CRECI Estagiário</SelectItem>
                <SelectItem value="OUTRO">Outro</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="CRECI" className="md:col-span-3"><Input value={form.creci || ""} onChange={e => upd("creci", e.target.value)} /></Field>

          <Field label="Entrada"><Input type="date" value={form.entry_date || ""} onChange={e => upd("entry_date", e.target.value)} /></Field>
          <Field label="CPF"><Input value={form.cpf || ""} onChange={e => upd("cpf", e.target.value)} /></Field>
          <Field label="Celular"><Input value={form.celular || ""} onChange={e => upd("celular", e.target.value)} /></Field>

          <Field label="Endereço"><Input value={form.address || ""} onChange={e => upd("address", e.target.value)} /></Field>
          <Field label="Função">
            <Select value={form.role || "broker"} onValueChange={v => upd("role", v)} disabled={!isAdmin}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{ROLES.map(r => <SelectItem key={r} value={r}>{r.toUpperCase()}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Divisão"><Input value={form.division || ""} onChange={e => upd("division", e.target.value)} /></Field>

          <Field label="Diretor" className="md:col-span-2">
            <Select value={form.director_id || "__none__"} onValueChange={v => upd("director_id", v === "__none__" ? null : v)}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— sem diretor —</SelectItem>
                {directors.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Indicação"><Input value={form.indication || ""} onChange={e => upd("indication", e.target.value)} /></Field>

          <div className="flex items-center gap-3 md:col-span-3">
            <Label className="text-xs">Ativo</Label>
            <Switch checked={!!form.active} onCheckedChange={v => upd("active", v)} />
          </div>
        </div>

        {/* Access */}
        {isAdmin && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="text-sm font-semibold flex items-center gap-2"><KeyRound className="h-4 w-4 text-primary" /> Acesso ao sistema</div>
              <div className="flex items-center gap-2">
                {!form.user_id ? (
                  <Button size="sm" onClick={() => provision(false)} disabled={provisioning}>
                    {provisioning ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <KeyRound className="h-3 w-3 mr-1" />}
                    Criar acesso
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => provision(true)} disabled={provisioning}>
                    {provisioning ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <KeyRound className="h-3 w-3 mr-1" />}
                    Redefinir senha
                  </Button>
                )}
              </div>
            </div>
            <Input placeholder="e-mail de login (padrão: nome@faceimob.com.br)" value={form.login_email || ""} onChange={e => upd("login_email", e.target.value)} />
            {form.user_id && !creds && <p className="text-[11px] text-emerald-400">✔ Acesso já provisionado ({form.login_email || form.email})</p>}
            {creds && (
              <div className="rounded-md bg-background/60 border p-2 text-xs space-y-1">
                <p className="font-semibold text-emerald-400">Compartilhe estes dados com o colaborador:</p>
                <div className="flex items-center gap-2"><span className="text-muted-foreground w-16">Email:</span> <code className="flex-1">{creds.email}</code>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => copy("email", creds.email)}>{copied === "email" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}</Button>
                </div>
                <div className="flex items-center gap-2"><span className="text-muted-foreground w-16">Senha:</span> <code className="flex-1">{creds.password}</code>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => copy("pw", creds.password)}>{copied === "pw" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}</Button>
                </div>
                <p className="text-[10px] text-muted-foreground">A senha só é exibida agora — anote ou copie.</p>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label className="text-[10px] uppercase text-muted-foreground">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
