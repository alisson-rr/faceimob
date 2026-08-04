import { useState, useRef } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { X, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEAL_STAGES, type PipelineDeal, type DealStage, type DealHistoryEntry } from "@/types/crm";
import { mockDevelopers, mockProjects, mockBrokers, mockManagers } from "@/data/mockData";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import DealDocumentUpload from "@/components/DealDocumentUpload";
import TaskPanel from "@/components/TaskPanel";
import DealHistoryPanel from "@/components/DealHistoryPanel";
import VisitPanel from "@/components/VisitPanel";
import { toast } from "@/hooks/use-toast";

interface Props {
  deal: PipelineDeal;
  open: boolean;
  onClose: () => void;
  onSave: (deal: PipelineDeal) => void;
}

const statusOptions = [
  "PROPOSTA", "VIROU NEGÓCIO", "OFF", "DISTRATO", "VENDA"
];

const CCA_FIELDS: { key: string; label: string; type?: "select"; options?: string[] }[] = [
  { key: "tabela", label: "Tabela", type: "select", options: ["Escolher", "Tabela 1", "Tabela 2"] },
  { key: "fator", label: "Fator", type: "select", options: ["Escolher", "Sim", "Não"] },
  { key: "cotista", label: "Cotista", type: "select", options: ["Escolher", "Sim", "Não"] },
  { key: "fgts_futuro", label: "FGTS Futuro", type: "select", options: ["Escolher", "Sim", "Não"] },
  { key: "fgts", label: "FGTS", type: "select", options: ["Escolher", "Sim", "Não"] },
  { key: "valor_fgts", label: "Valor FGTS" },
  { key: "valor_fgts_futuro", label: "Valor FGTS Futuro" },
  { key: "valor_avaliacao", label: "Valor de Avaliação" },
  { key: "valor_compra_venda", label: "Valor de Compra e Venda" },
  { key: "financiamento_aprovado", label: "Financiamento Aprovado" },
  { key: "subsidio_federal", label: "Subsídio Federal" },
  { key: "subsidio_estadual", label: "Subsídio Estadual" },
  { key: "referencia_cch", label: "Referência CCH Análise" },
  { key: "renda_aprovada", label: "Renda Aprovada" },
  { key: "parcela_aprovada", label: "Parcela Aprovada" },
  { key: "prazo", label: "Prazo" },
];

export default function DealDetailModal({ deal, open, onClose, onSave }: Props) {
  const { role } = useAuth();
  const [tab, setTab] = useState<"detalhes" | "anexos" | "agenda" | "historico" | "cca">("detalhes");
  const [form, setForm] = useState<PipelineDeal>({ ...deal });
  const [newNote, setNewNote] = useState("");
  const [ccaData, setCcaData] = useState<Record<string, string>>({});

  const isAdmin = role === "admin";
  const canEditCca = role === "cca" || role === "admin";

  const set = (key: keyof PipelineDeal, val: any) => setForm(p => ({ ...p, [key]: val }));

  const addHistoryEntry = () => {
    if (!newNote.trim()) return;
    const entry: DealHistoryEntry = {
      id: String(Date.now()),
      user_name: "Usuário Atual",
      text: newNote.trim(),
      timestamp: new Date().toISOString(),
    };
    setForm(p => ({ ...p, history: [...(p.history || []), entry] }));
    setNewNote("");
  };

  const handleSave = () => {
    onSave(form);
    toast({ title: "Alterações salvas" });
  };

  const tabs = [
    { key: "detalhes" as const, label: "Detalhes" },
    { key: "anexos" as const, label: "Anexos" },
    { key: "agenda" as const, label: "Agenda" },
    { key: "historico" as const, label: "Histórico" },
    { key: "cca" as const, label: "CCA" },
  ];

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="glass-strong max-w-2xl max-h-[92vh] overflow-y-auto p-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-bottom-4 data-[state=open]:duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:slide-out-to-bottom-4">
        {/* Tabs */}
        <div className="flex items-center justify-between border-b border-border px-4 pt-4 pb-0">
          <div className="flex gap-4">
            {tabs.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn("pb-3 text-sm font-medium border-b-2 transition-colors",
                  tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground mb-3">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {tab === "detalhes" && (
            <>
              {/* Row 1: Mês, Origem, Toggles */}
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="text-[10px] text-primary font-bold uppercase">Mês</label>
                  <Input
                    value={form.month_base || format(new Date(), "dd/MM/yyyy")}
                    onChange={e => isAdmin && set("month_base", e.target.value)}
                    disabled={!isAdmin}
                    className={cn("mt-1 text-xs", !isAdmin && "opacity-60")}
                  />
                </div>
                <div>
                  <label className="text-[10px] text-primary font-bold uppercase">Origem do Lead</label>
                  <Select value={form.lead_origin || "Lead Próprio"} onValueChange={v => set("lead_origin", v)}>
                    <SelectTrigger className="mt-1 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Lead Próprio">Lead Próprio</SelectItem>
                      <SelectItem value="Indicação">Indicação</SelectItem>
                      <SelectItem value="Facebook">Facebook</SelectItem>
                      <SelectItem value="Google">Google</SelectItem>
                      <SelectItem value="Stand">Stand</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col items-center">
                  <label className="text-[10px] text-primary font-bold uppercase">Habilitar 2° cliente?</label>
                  <Switch
                    checked={form.has_second_client || false}
                    onCheckedChange={v => set("has_second_client", v)}
                    className="mt-2"
                  />
                </div>
                <div className="flex flex-col items-center">
                  <label className="text-[10px] text-primary font-bold uppercase">Renda Informal?</label>
                  <Switch
                    checked={form.has_informal_income || false}
                    onCheckedChange={v => set("has_informal_income", v)}
                    className="mt-2"
                  />
                </div>
              </div>

              {/* Dates info */}
              <div className="flex gap-4 text-[10px] text-muted-foreground">
                <span>Data Criação: <strong className="text-foreground">{form.created_at}</strong></span>
                <span>Data Base Atual: <strong className="text-foreground">{form.month_base || format(new Date(), "MM/yyyy")}</strong></span>
              </div>

              {/* Client 1 */}
              <div className="grid grid-cols-3 gap-3">
                <Field label="Cliente" value={form.client} onChange={v => set("client", v)} color="text-destructive" />
                <Field label="CPF" value={form.cpf} onChange={v => set("cpf", v)} color="text-destructive" />
                <Field label="Contato" value={form.contato} onChange={v => set("contato", v)} color="text-destructive" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Número do PIS" value={form.numero_pis} onChange={v => set("numero_pis", v)} />
                <Field label="Estado Civil" value={form.estado_civil} onChange={v => set("estado_civil", v)} />
                <Field label="E-mail" value={form.email_client} onChange={v => set("email_client", v)} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Naturalidade" value={form.naturalidade} onChange={v => set("naturalidade", v)} />
                <SelectField label="Cotista" value={form.cotista} onChange={v => set("cotista", v)} options={["NÃO", "SIM"]} />
                <SelectField label="Dependente" value={form.dependente} onChange={v => set("dependente", v)} options={["NÃO", "SIM"]} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Data Admissão" value={form.data_admissao} onChange={v => set("data_admissao", v)} />
                <Field label="Referência CCH" value={form.referencia_cch} onChange={v => set("referencia_cch", v)} />
                <Field label="CEP do Endereço" value={form.cep} onChange={v => set("cep", v)} />
              </div>

              {/* 2nd Client */}
              {form.has_second_client && (
                <>
                  <div className="border-t border-primary/30 pt-3">
                    <p className="text-xs font-bold text-primary mb-3">2° Cliente</p>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Cliente" value={form.client2} onChange={v => set("client2", v)} color="text-destructive" />
                    <Field label="CPF" value={form.cpf2} onChange={v => set("cpf2", v)} color="text-destructive" />
                    <Field label="Contato" value={form.contato2} onChange={v => set("contato2", v)} color="text-destructive" />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Número do PIS" value={form.numero_pis2} onChange={v => set("numero_pis2", v)} />
                    <Field label="Estado Civil" value={form.estado_civil2} onChange={v => set("estado_civil2", v)} />
                    <Field label="E-mail" value={form.email_client2} onChange={v => set("email_client2", v)} />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Naturalidade" value={form.naturalidade2} onChange={v => set("naturalidade2", v)} />
                    <SelectField label="Cotista" value={form.cotista2} onChange={v => set("cotista2", v)} options={["NÃO", "SIM"]} />
                    <SelectField label="Dependente" value={form.dependente2} onChange={v => set("dependente2", v)} options={["NÃO", "SIM"]} />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Data Admissão" value={form.data_admissao2} onChange={v => set("data_admissao2", v)} />
                    <Field label="Referência CCH" value={form.referencia_cch2} onChange={v => set("referencia_cch2", v)} />
                    <Field label="CEP do Endereço" value={form.cep2} onChange={v => set("cep2", v)} />
                  </div>
                </>
              )}

              {/* Informal Income */}
              {form.has_informal_income && (
                <>
                  <div className="border-t border-cyan-500/30 pt-3">
                    <p className="text-xs font-bold text-cyan-400 mb-3 text-center">Informações Complementares de Renda</p>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Segmento/Atividade" value={form.segmento_atividade} onChange={v => set("segmento_atividade", v)} />
                    <Field label="Forma de Atuação" value={form.forma_atuacao} onChange={v => set("forma_atuacao", v)} />
                    <Field label="Tempo de Atividade" value={form.tempo_atividade} onChange={v => set("tempo_atividade", v)} />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <SelectField label="Forma de Divulgação" value={form.forma_divulgacao} onChange={v => set("forma_divulgacao", v)} options={["Emite Nota/Recibo/Documento similar", "Não emite"]} />
                    <SelectField label="Declara Imposto de Renda" value={form.declara_ir} onChange={v => set("declara_ir", v)} options={["SIM", "NÃO"]} />
                    <Field label="Rendimento Mensal" value={form.rendimento_mensal} onChange={v => set("rendimento_mensal", v)} />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground font-bold uppercase">Observações</label>
                    <Textarea value={form.observacoes_renda || ""} onChange={e => set("observacoes_renda", e.target.value)} rows={2} className="mt-1 text-xs" />
                  </div>
                </>
              )}

              {/* Developer / Project / Unit */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] text-warning font-bold uppercase">Construtora (Obrigatório)</label>
                  <Select value={form.developer} onValueChange={v => set("developer", v)}>
                    <SelectTrigger className="mt-1 text-xs"><SelectValue placeholder="Escolher" /></SelectTrigger>
                    <SelectContent>{mockDevelopers.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-[10px] text-warning font-bold uppercase">Empreendimento (Obrigatório)</label>
                  <Select value={form.project} onValueChange={v => set("project", v)}>
                    <SelectTrigger className="mt-1 text-xs"><SelectValue placeholder="Escolher" /></SelectTrigger>
                    <SelectContent>{mockProjects.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <Field label="Bloco | Unidade (Opcional)" value={form.unit} onChange={v => set("unit", v)} />
              </div>

              {/* Brokers */}
              <div className="grid grid-cols-3 gap-3">
                <BrokerSelect label="Corretor 1 (Obrigatório)" value={form.broker1} onChange={v => set("broker1", v)} />
                <BrokerSelect label="Corretor 2 (opcional)" value={form.broker2} onChange={v => set("broker2", v)} optional />
                <BrokerSelect label="Corretor 3 (opcional)" value={form.broker3} onChange={v => set("broker3", v)} optional />
              </div>

              {/* Managers */}
              <div className="grid grid-cols-3 gap-3">
                <ManagerSelect label="Gerente 1 (Obrigatório)" value={form.manager1} onChange={v => set("manager1", v)} />
                <ManagerSelect label="Gerente 2 (opcional)" value={form.manager2} onChange={v => set("manager2", v)} optional />
                <ManagerSelect label="Gerente 3 (opcional)" value={form.manager3} onChange={v => set("manager3", v)} optional />
              </div>

              {/* VGV */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] text-success font-bold uppercase">VGV Bruto</label>
                  <Input type="number" value={form.vgv_bruto || ""} onChange={e => set("vgv_bruto", Number(e.target.value))} className="mt-1 text-xs" placeholder="Inserir VGV Bruto" />
                </div>
                <div>
                  <label className="text-[10px] text-success font-bold uppercase">Perc. Desconto</label>
                  <Input value={form.perc_desconto || ""} onChange={e => set("perc_desconto", e.target.value)} className="mt-1 text-xs" placeholder="Inserir Perc. Desconto" />
                </div>
                <div>
                  <label className="text-[10px] text-success font-bold uppercase">VGV Líquido</label>
                  <Input type="number" value={form.vgv_liquido || 0} onChange={e => set("vgv_liquido", Number(e.target.value))} className="mt-1 text-xs" />
                </div>
              </div>

              {/* Histórico */}
              <div className="border-t border-border pt-3">
                <p className="text-sm font-bold text-destructive mb-2">Histórico</p>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {(form.history || []).map(entry => (
                    <div key={entry.id} className="text-xs">
                      <span className="text-muted-foreground">{format(new Date(entry.timestamp), "dd/MM")} </span>
                      <span className="font-bold text-primary">{entry.user_name} :</span>
                      <p className="text-muted-foreground ml-2">{entry.text}</p>
                    </div>
                  ))}
                  {(!form.history || form.history.length === 0) && (
                    <p className="text-xs text-muted-foreground">Nenhum histórico ainda.</p>
                  )}
                </div>
                <div className="flex gap-2 mt-2">
                  <Textarea
                    value={newNote}
                    onChange={e => setNewNote(e.target.value)}
                    placeholder="Digite aqui o novo histórico..."
                    rows={2}
                    className="text-xs flex-1"
                  />
                  <Button size="icon" onClick={addHistoryEntry} className="self-end h-9 w-9">
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Status 1 & Status da venda */}
              <div className="grid grid-cols-2 gap-4 border-t border-border pt-3">
                <div>
                  <label className="text-[10px] text-destructive font-bold uppercase">Status 1</label>
                  <Select value={form.stage} onValueChange={v => isAdmin && set("stage", v as DealStage)} disabled={!isAdmin}>
                    <SelectTrigger className={cn("mt-1 text-xs border-destructive/50", !isAdmin && "opacity-60")}><SelectValue /></SelectTrigger>
                    <SelectContent>{DEAL_STAGES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase flex items-center gap-1">
                    Qual o STATUS da venda?
                    <span className="text-destructive text-[8px]">Off</span>
                    <Switch checked={form.status === "OFF"} onCheckedChange={v => set("status", v ? "OFF" : "Ativo")} className="ml-1" />
                  </label>
                  <Select value={form.status} onValueChange={v => set("status", v)}>
                    <SelectTrigger className="mt-1 text-xs border-success/50"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {statusOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          )}

          {tab === "anexos" && (
            <div className="animate-in fade-in-50 slide-in-from-bottom-2 duration-300">
              <DealDocumentUpload
                dealId={form.id}
                clientName={form.client}
                dealCode={form.id}
              />
            </div>
          )}

          {tab === "agenda" && (
            <div className="space-y-4 animate-in fade-in-50 slide-in-from-bottom-2 duration-300">
              <TaskPanel refType="deal" refId={form.id} />
              <div className="pt-3 border-t border-border/40">
                <VisitPanel dealId={form.id} />
              </div>
            </div>
          )}

          {tab === "historico" && (
            <div className="animate-in fade-in-50 slide-in-from-bottom-2 duration-300">
              <DealHistoryPanel dealId={form.id} />
            </div>
          )}

          {tab === "cca" && (
            <div className="space-y-4 animate-in fade-in-50 slide-in-from-bottom-2 duration-300">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-primary">Aprovação CCA</p>
                {!canEditCca && (
                  <Badge variant="outline" className="text-[10px] text-warning border-warning/50">
                    Somente CCA pode editar
                  </Badge>
                )}
              </div>
              <div className="grid grid-cols-3 gap-3">
                {CCA_FIELDS.map(f => (
                  <div key={f.key}>
                    <label className="text-[10px] text-muted-foreground font-bold uppercase">{f.label}</label>
                    {f.type === "select" ? (
                      <Select
                        value={ccaData[f.key] || ""}
                        onValueChange={v => canEditCca && setCcaData(p => ({ ...p, [f.key]: v }))}
                        disabled={!canEditCca}
                      >
                        <SelectTrigger className={cn("mt-1 text-xs", !canEditCca && "opacity-60")}>
                          <SelectValue placeholder="Escolher" />
                        </SelectTrigger>
                        <SelectContent>
                          {(f.options || []).map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        value={ccaData[f.key] || ""}
                        onChange={e => canEditCca && setCcaData(p => ({ ...p, [f.key]: e.target.value }))}
                        disabled={!canEditCca}
                        placeholder={`Inserir ${f.label}`}
                        className={cn("mt-1 text-xs", !canEditCca && "opacity-60")}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-center gap-3 p-4 border-t border-border">
          <Button variant="outline" onClick={onClose} className="text-destructive border-destructive/50 hover:bg-destructive/10">Cancelar</Button>
          <Button onClick={handleSave}>Confirmar Alterações</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Tiny field helpers ──

function Field({ label, value, onChange, color }: { label: string; value?: string; onChange: (v: string) => void; color?: string }) {
  return (
    <div>
      <label className={cn("text-[10px] font-bold uppercase", color || "text-muted-foreground")}>{label}</label>
      <Input value={value || ""} onChange={e => onChange(e.target.value)} className="mt-1 text-xs" />
    </div>
  );
}

function SelectField({ label, value, onChange, options }: { label: string; value?: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div>
      <label className="text-[10px] text-muted-foreground font-bold uppercase">{label}</label>
      <Select value={value || options[0]} onValueChange={onChange}>
        <SelectTrigger className="mt-1 text-xs"><SelectValue placeholder="Escolher" /></SelectTrigger>
        <SelectContent>{options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}

function BrokerSelect({ label, value, onChange, optional }: { label: string; value?: string; onChange: (v: string) => void; optional?: boolean }) {
  return (
    <div>
      <label className="text-[10px] text-muted-foreground font-bold uppercase">{label}</label>
      <Select value={value || (optional ? "none" : "")} onValueChange={v => onChange(v === "none" ? "" : v)}>
        <SelectTrigger className="mt-1 text-xs"><SelectValue placeholder={optional ? "Inserir Corretor" : "Escolher"} /></SelectTrigger>
        <SelectContent>
          {optional && <SelectItem value="none">Nenhum</SelectItem>}
          {mockBrokers.filter(b => b.active).map(b => <SelectItem key={b.id} value={b.name}>{b.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function ManagerSelect({ label, value, onChange, optional }: { label: string; value?: string; onChange: (v: string) => void; optional?: boolean }) {
  return (
    <div>
      <label className="text-[10px] text-muted-foreground font-bold uppercase">{label}</label>
      <Select value={value || (optional ? "none" : "")} onValueChange={v => onChange(v === "none" ? "" : v)}>
        <SelectTrigger className="mt-1 text-xs"><SelectValue placeholder={optional ? "Inserir Gerente" : "Escolher"} /></SelectTrigger>
        <SelectContent>
          {optional && <SelectItem value="none">Nenhum</SelectItem>}
          {mockManagers.filter(m => m.active).map(m => <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
