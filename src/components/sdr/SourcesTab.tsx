import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { describeError } from "@/lib/supabaseError";
import { templateIssues } from "./templateVars";
import { SEM_PERMISSAO, SEM_SELECAO, type Agent, type Source, type WhatsAppTemplate } from "./types";

type Draft = Partial<Source>;
const VAZIO: Draft = { label: "", active: true, channel: "meta" };

/** CHECK de `lead_sources.channel` (0004). Ficava sempre nulo porque a tela
 *  nunca preenchia — e nenhum relatório por canal saía. */
const CANAIS: Array<{ value: string; label: string }> = [
  { value: "meta", label: "Meta Ads" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "organic", label: "Orgânico" },
  { value: "indication", label: "Indicação" },
  { value: "import", label: "Importação" },
  { value: "portal", label: "Portal" },
  { value: "other", label: "Outro" },
];

/** `code` é a chave da origem: slug do que o usuário digitou (ou do rótulo). */
const slug = (text: string) =>
  text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

export function SourcesTab({ sources, agents, templates, canWrite, reload }: {
  sources: Source[]; agents: Agent[]; templates: WhatsAppTemplate[]; canWrite: boolean; reload: () => void;
}) {
  const [row, setRow] = useState<Draft>(VAZIO);
  // Confirmação pelo AlertDialog do app, como nas abas Agentes e Remarketing: o
  // `confirm()` nativo não respeita o tema, não é alcançável por teste de tela e
  // corta o texto que explica o efeito da exclusão.
  const [excluindo, setExcluindo] = useState<Source | null>(null);

  const template = templates.find(t => t.id === row.welcome_template_id) ?? null;
  // O webhook de boas-vindas só envia template aprovado e manda exatamente as
  // variáveis declaradas. Sem este aviso, o operador só descobria pelo silêncio.
  const avisosTemplate = template
    ? [
        ...(template.approved ? [] : ["Este template não está marcado como aprovado na Meta: as boas-vindas não serão enviadas."]),
        ...(template.active ? [] : ["Este template está inativo: as boas-vindas não serão enviadas."]),
        ...templateIssues(template.body, template.variables ?? []),
      ]
    : [];

  async function save() {
    if (!row.label) return toast.error("Rótulo obrigatório");
    const code = slug(row.code || row.label);
    if (!code) return toast.error("Informe um código ou rótulo com letras ou números");
    const payload = {
      code, label: row.label, form_id: row.form_id?.trim() || null,
      channel: row.channel || "meta",
      sdr_agent_id: row.sdr_agent_id || null,
      welcome_template_id: row.welcome_template_id || null,
      active: row.active ?? true,
    };
    // Mesmo padrão do AgentsTab: `row.id` decide entre editar e criar. Antes só
    // existia o insert, e trocar o agente de uma origem exigia apagar e
    // recadastrar — o que zerava a origem dos leads já gravados.
    const q = row.id
      ? supabase.from("lead_sources").update(payload).eq("id", row.id)
      : supabase.from("lead_sources").insert(payload);
    const { data, error } = await q.select("id");
    if (error) {
      // `lead_sources_form_idx` é único parcial: duas origens com o mesmo
      // form_id fariam o `.maybeSingle()` do webhook devolver erro e o lead
      // cairia na roleta sem passar pela IA — em silêncio.
      const duplicado = (error as { code?: string }).code === "23505";
      return toast.error(duplicado
        ? "Já existe uma origem com este form_id ou código. Edite a existente em vez de criar outra."
        : describeError(error, "Não foi possível salvar a origem."));
    }
    if (!data?.length) return toast.error(SEM_PERMISSAO);
    toast.success(row.id ? "Origem atualizada" : "Origem cadastrada");
    setRow(VAZIO); reload();
  }
  async function remove(origem: Source) {
    const { data, error } = await supabase.from("lead_sources").delete().eq("id", origem.id).select("id");
    if (error) return toast.error(describeError(error, "Não foi possível excluir a origem."));
    if (!data?.length) return toast.error(SEM_PERMISSAO);
    if (row.id === origem.id) setRow(VAZIO);
    setExcluindo(null);
    toast.success("Origem excluída");
    reload();
  }

  /** Como o webhook encontra a origem: por form_id (Meta) ou por código = utm_source. */
  const filtro = (s: Source) => s.form_id ? `form_id ${s.form_id}` : `utm_source = ${s.code}`;

  return (
    <Card className="p-4 space-y-3">
      <p className="text-xs text-muted-foreground">
        Origem com agente entra no atendimento IA em vez de cair na roleta. O lead é reconhecido pelo <b>form_id</b> (Meta Lead Ads) ou, sem form_id, pelo <b>código</b> igual ao <code>utm_source</code> que o Zapier/POST manual envia.
        Lead <b>sem telefone</b> não entra na IA — sem número o robô não tem como falar com ele — e segue direto para a roleta.
        {" "}Lead vindo de <b>POST direto sem prova de origem</b> (sem assinatura da Meta e sem a chave de serviço no <code>Authorization</code>) também fica de fora da IA: ele é gravado, ligado a esta origem e vai para a roleta com o aviso nas observações. A URL do webhook é pública — sem essa trava, quem a descobrisse faria o WhatsApp da empresa mandar mensagem para o número que ele mesmo escolhesse.
        {canWrite && " Clique numa origem para editar."}
      </p>
      {canWrite && (
        <div className="space-y-2">
          <div className="grid md:grid-cols-5 gap-2">
            <Input placeholder="Rótulo" aria-label="Rótulo" value={row.label || ""} onChange={e => setRow({ ...row, label: e.target.value })} />
            <Input placeholder="form_id (Meta Ads)" aria-label="form_id" value={row.form_id || ""} onChange={e => setRow({ ...row, form_id: e.target.value })} />
            <Input placeholder="código (= utm_source)" aria-label="Código da origem" value={row.code || ""} onChange={e => setRow({ ...row, code: e.target.value })} />
            <Select value={row.channel || "meta"} onValueChange={v => setRow({ ...row, channel: v })}>
              <SelectTrigger aria-label="Canal"><SelectValue placeholder="Canal" /></SelectTrigger>
              <SelectContent>
                {CANAIS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Switch id="src-active" checked={row.active ?? true} onCheckedChange={v => setRow({ ...row, active: v })} />
              <Label htmlFor="src-active" className="text-xs">Ativa</Label>
            </div>
          </div>
          <div className="grid md:grid-cols-3 gap-2">
            <Select value={row.sdr_agent_id || SEM_SELECAO} onValueChange={v => setRow({ ...row, sdr_agent_id: v === SEM_SELECAO ? null : v })}>
              <SelectTrigger aria-label="Agente"><SelectValue placeholder="Agente" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM_SELECAO}>Sem agente</SelectItem>
                {agents.filter(a => a.active).map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={row.welcome_template_id || SEM_SELECAO} onValueChange={v => setRow({ ...row, welcome_template_id: v === SEM_SELECAO ? null : v })}>
              <SelectTrigger aria-label="Template de boas-vindas"><SelectValue placeholder="Template de boas-vindas" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM_SELECAO}>Sem template</SelectItem>
                {templates.map(t => (
                  <SelectItem key={t.id} value={t.id}>
                    {/* Arquivado (`active = false`) também não dispara: o
                        `meta-ads-webhook` só envia com `tpl?.active`. Sem o
                        selo, a opção parecia sadia e as boas-vindas sumiam em
                        silêncio. Continua na lista porque é ela que exibe o
                        template já vinculado à origem em edição. */}
                    {t.name}{t.approved ? "" : " · não aprovado"}{t.active ? "" : " · arquivado"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Button onClick={save} className="flex-1">
                {row.id ? "Salvar" : <><Plus className="h-4 w-4 mr-1" />Adicionar</>}
              </Button>
              {row.id && <Button variant="outline" onClick={() => setRow(VAZIO)}>Cancelar</Button>}
            </div>
          </div>
          {avisosTemplate.length > 0 && (
            <div role="status" className="rounded-md border border-warning/40 bg-warning/10 p-2 space-y-1">
              {avisosTemplate.map((a) => (
                <p key={a} className="flex items-start gap-1.5 text-xs text-warning">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden />{a}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="space-y-1">
        {sources.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma origem cadastrada.</p>}
        {/* Abrir e excluir são botões IRMÃOS. Com a linha inteira em
            `role="button"`, o botão de excluir ficava aninhado num elemento que
            a ARIA 1.2 marca como "Presentational Children": o leitor de tela
            descarta os descendentes e o único caminho de exclusão deixa de
            existir para quem depende dele. */}
        {sources.map(s => {
          const resumo = (
            <>
              <b>{s.label}</b>{" "}
              <span className="text-muted-foreground text-xs">
                · {filtro(s)} · {CANAIS.find(c => c.value === s.channel)?.label || s.channel} · {agents.find(a => a.id === s.sdr_agent_id)?.name || "sem agente · não entra na IA"} · {templates.find(t => t.id === s.welcome_template_id)?.name || "sem template"}{!s.active && " · inativa"}
              </span>
            </>
          );
          return (
            <div
              key={s.id}
              className={`flex items-center justify-between gap-2 border rounded p-2 text-sm ${row.id === s.id ? "bg-muted" : ""}`}
            >
              {canWrite ? (
                <button
                  type="button"
                  onClick={() => setRow(s)}
                  aria-pressed={row.id === s.id}
                  className="flex-1 min-w-0 rounded text-left hover:bg-muted/40"
                >
                  {resumo}
                </button>
              ) : (
                <div className="flex-1 min-w-0">{resumo}</div>
              )}
              {canWrite && (
                <Button size="icon" variant="ghost" aria-label={`Excluir origem ${s.label}`} onClick={() => setExcluindo(s)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          );
        })}
      </div>

      <AlertDialog open={!!excluindo} onOpenChange={(aberto) => { if (!aberto) setExcluindo(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir a origem “{excluindo?.label}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {/* O que a exclusão faz de verdade: o webhook procura a origem por
                  form_id ou por código, e sem a linha o lead daquele formulário
                  passa a cair na roleta sem passar pela IA. */}
              Os leads já gravados perdem o vínculo com ela, e o próximo lead que chegar por
              {" "}<b>{excluindo ? filtro(excluindo) : ""}</b> deixa de ser reconhecido: entra sem origem e vai direto
              para a roleta, sem agente de IA e sem template de boas-vindas.
              {" "}Para tirá-la do fluxo sem perder o histórico, desmarque “Ativa” e salve.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => excluindo && remove(excluindo)}>Excluir origem</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
