import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Bot, Plus, Trash2 } from "lucide-react";
import { describeError } from "@/lib/supabaseError";
import type { Database } from "@/integrations/supabase/types";
import { handoffOptions } from "./handoffChain";
import { efeitosDaExclusao, PAPEL_AGENTE, SEM_PERMISSAO, SEM_SELECAO, type Agent, type Group, type Rlist, type Source } from "./types";

/** Mesmo default da function (`DEFAULT_OPENAI_MODEL`) e da coluna (0040). */
const MODELO_PADRAO = "gpt-4o-mini";
/** Mesmo default da coluna `sdr_agents.max_turns` (0008). */
const TURNOS_PADRAO = 12;

export function AgentsTab({ agents, groups, sources, lists, canWrite, reload }: {
  agents: Agent[]; groups: Group[]; sources: Source[]; lists: Rlist[]; canWrite: boolean; reload: () => void;
}) {
  const [editing, setEditing] = useState<Partial<Agent> | null>(null);
  // Confirmação de exclusão pelo AlertDialog do app, não pelo `confirm()` do
  // navegador: o nativo não é estilizado, não respeita o tema e — o que pesa
  // aqui — corta o texto longo que enumera o que perde o vínculo.
  const [excluindo, setExcluindo] = useState<Agent | null>(null);

  async function save() {
    if (!editing?.name) return toast.error("Nome obrigatório");
    const turnos = Number(editing.max_turns ?? TURNOS_PADRAO);
    if (!Number.isFinite(turnos) || turnos < 1) {
      return toast.error("O teto de turnos precisa ser pelo menos 1");
    }
    // O `min`/`max` do input só vale para as setas: digitar 5 passa direto, e o
    // CHECK da coluna devolve 23514 traduzido para "Um dos campos está fora do
    // valor permitido" — sem dizer QUAL campo. Validar aqui nomeia o campo.
    const temperatura = Number(editing.temperature ?? 0.7);
    if (!Number.isFinite(temperatura) || temperatura < 0 || temperatura > 2) {
      return toast.error("A temperatura precisa ficar entre 0 e 2 (0 = respostas previsíveis, 2 = muito criativas).");
    }
    const payload: Database["public"]["Tables"]["sdr_agents"]["Insert"] = {
      name: editing.name, role: editing.role || "qualifier",
      is_orchestrator: !!editing.is_orchestrator,
      system_prompt: editing.system_prompt || null,
      model: editing.model || MODELO_PADRAO,
      temperature: temperatura,
      max_turns: Math.trunc(turnos),
      active: editing.active ?? true,
      handoff_to_agent_id: editing.handoff_to_agent_id || null,
      handoff_group_id: editing.handoff_group_id || null,
    };
    const q = editing.id
      ? supabase.from("sdr_agents").update(payload).eq("id", editing.id)
      : supabase.from("sdr_agents").insert(payload);
    const { data, error } = await q.select("id");
    if (error) return toast.error(describeError(error, "Não foi possível salvar o agente."));
    if (!data?.length) return toast.error(SEM_PERMISSAO);
    toast.success("Agente salvo");
    setEditing(null); reload();
  }

  async function remove(agent: Agent) {
    const { data, error } = await supabase.from("sdr_agents").delete().eq("id", agent.id).select("id");
    if (error) return toast.error(describeError(error, "Não foi possível excluir o agente."));
    if (!data?.length) return toast.error(SEM_PERMISSAO);
    if (editing?.id === agent.id) setEditing(null);
    setExcluindo(null);
    toast.success("Agente excluído");
    reload();
  }

  // Todas as FKs são ON DELETE SET NULL: excluir desliga em silêncio as origens
  // e listas que usavam o agente, e os leads daquele formulário param de entrar
  // na IA e caem na roleta. O aviso antigo contava só o encadeamento entre
  // agentes — o efeito real (origem e lista órfãs) não aparecia em lugar nenhum.
  const efeitos = excluindo ? efeitosDaExclusao(excluindo.id, { agents, sources, lists }) : [];

  const destinos = handoffOptions(agents, editing?.id);
  const grupoAtivos = groups.filter((g) => g.active);
  const grupoGeral = grupoAtivos.find((g) => g.kind === "general");

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Agentes ({agents.length})</h3>
          {canWrite && (
            <Button size="sm" onClick={() => setEditing({ name: "", role: "qualifier", model: MODELO_PADRAO, temperature: 0.7, max_turns: TURNOS_PADRAO, active: true })}>
              <Plus className="h-4 w-4 mr-1" />Novo
            </Button>
          )}
        </div>
        <div className="space-y-2">
          {agents.length === 0 && <p className="text-xs text-muted-foreground">Nenhum agente. Crie um orquestrador e alguns especialistas (qualificador, reengajador, handoff).</p>}
          {/* Abrir o agente é um botão de verdade, IRMÃO do de excluir — nunca
              um `role="button"` com outro controle dentro: `button` está na
              lista de "Presentational Children" da ARIA 1.2, o leitor de tela
              descarta os descendentes e o único caminho para excluir o agente
              deixa de existir. `ul`/`li` dá o recorte da linha para quem lê a
              tela por regiões. Mesmo desenho de WhatsAppTab e ConversationsTab. */}
          <ul className="space-y-2">
          {agents.map(a => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-2 border rounded-md p-2 hover:bg-muted/40"
            >
              <button
                type="button"
                onClick={() => setEditing(a)}
                aria-pressed={editing?.id === a.id}
                className="flex flex-1 min-w-0 items-center gap-2 text-left"
              >
                <Bot className={`h-4 w-4 shrink-0 ${a.is_orchestrator ? "text-warning" : "text-primary"}`} aria-hidden />
                <div className="min-w-0">
                  <div className="text-sm font-medium">{a.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {PAPEL_AGENTE[a.role] ?? a.role} · {a.model} · até {a.max_turns} respostas
                    {a.handoff_group_id && ` · entrega em ${groups.find(g => g.id === a.handoff_group_id)?.name ?? "grupo removido"}`}
                  </div>
                </div>
              </button>
              <div className="flex items-center gap-2">
                {a.is_orchestrator && <Badge variant="secondary">Orquestrador</Badge>}
                {!a.active && <Badge variant="outline">Inativo</Badge>}
                {canWrite && (
                  <Button size="icon" variant="ghost" aria-label={`Excluir agente ${a.name}`} onClick={() => setExcluindo(a)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </li>
          ))}
          </ul>
        </div>
      </Card>

      <Card className="p-4">
        {!editing ? (
          <p className="text-xs text-muted-foreground">{canWrite ? "Selecione ou crie um agente." : "Selecione um agente para ver a configuração. Seu papel só consulta este módulo."}</p>
        ) : (
          <fieldset disabled={!canWrite} className="space-y-3 min-w-0">
            <h3 className="text-sm font-semibold">{!canWrite ? "Agente (somente leitura)" : editing.id ? "Editar agente" : "Novo agente"}</h3>
            <div>
              <Label htmlFor="ag-name">Nome</Label>
              <Input id="ag-name" value={editing.name || ""} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="Ex.: Orquestrador Face, Qualificador Frio, Reengajador..." />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="ag-role">Papel (rótulo)</Label>
                <Select value={editing.role || "qualifier"} onValueChange={v => setEditing({ ...editing, role: v })}>
                  <SelectTrigger id="ag-role" aria-label="Papel"><SelectValue /></SelectTrigger>
                  {/* Mesmo mapa da lista ao lado: fonte única para o rótulo. */}
                  <SelectContent>
                    {Object.entries(PAPEL_AGENTE).map(([valor, rotulo]) => (
                      <SelectItem key={valor} value={valor}>{rotulo}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="ag-model">Modelo OpenAI</Label>
                <Select value={editing.model || MODELO_PADRAO} onValueChange={v => setEditing({ ...editing, model: v })}>
                  <SelectTrigger id="ag-model" aria-label="Modelo OpenAI"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gpt-4o-mini">gpt-4o-mini (rápido/barato)</SelectItem>
                    <SelectItem value="gpt-4o">gpt-4o (potente)</SelectItem>
                    <SelectItem value="gpt-4.1-mini">gpt-4.1-mini</SelectItem>
                    <SelectItem value="gpt-4.1">gpt-4.1</SelectItem>
                    <SelectItem value="o4-mini">o4-mini (raciocínio)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {/* Quem manda no comportamento é o switch "Orquestrador" e o prompt;
                o "Papel" acima é só organização da lista. Dizer isso evita o
                operador trocar o papel esperando mudar o fluxo. */}
            <p className="text-xs text-muted-foreground">
              O papel é apenas um rótulo para organizar a lista. Quem define o comportamento é o system prompt, e quem
              recebe a conversa primeiro é o agente marcado como <b>orquestrador</b>.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="ag-temp">Temperatura ({editing.temperature ?? 0.7})</Label>
                <Input id="ag-temp" type="number" step="0.1" min="0" max="2" value={editing.temperature ?? 0.7} onChange={e => setEditing({ ...editing, temperature: Number(e.target.value) })} />
              </div>
              <div>
                <Label htmlFor="ag-turns">Máximo de respostas</Label>
                <Input id="ag-turns" type="number" step="1" min="1" max="60" value={editing.max_turns ?? TURNOS_PADRAO} onChange={e => setEditing({ ...editing, max_turns: Number(e.target.value) })} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <Switch id="ag-orch" checked={!!editing.is_orchestrator} onCheckedChange={v => setEditing({ ...editing, is_orchestrator: v })} />
                <Label htmlFor="ag-orch">Orquestrador</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="ag-active" checked={editing.active ?? true} onCheckedChange={v => setEditing({ ...editing, active: v })} />
                <Label htmlFor="ag-active">Ativo</Label>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Atingido o máximo de respostas, o agente para de escrever e o lead volta para a roleta — sem ser marcado
              como qualificado. É o que impede uma conversa que nunca conclui de rodar sem fim.
            </p>
            <div>
              <Label htmlFor="ag-prompt">System prompt (instruções do agente)</Label>
              <Textarea id="ag-prompt" rows={8} value={editing.system_prompt || ""} onChange={e => setEditing({ ...editing, system_prompt: e.target.value })}
                placeholder="Ex.: Você é um SDR da Faceimob. Qualifique o lead perguntando: renda, urgência, tipo de imóvel, cidade e se possui FGTS. Nunca prometa aprovação. Quando o lead estiver quente, termine a resposta com a tag [QUALIFICADO]." />
            </div>
            <div>
              <Label htmlFor="ag-handoff">Handoff para agente</Label>
              <Select value={editing.handoff_to_agent_id || SEM_SELECAO} onValueChange={v => setEditing({ ...editing, handoff_to_agent_id: v === SEM_SELECAO ? null : v })}>
                <SelectTrigger id="ag-handoff" aria-label="Handoff para agente"><SelectValue placeholder="Nenhum" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM_SELECAO}>Nenhum</SelectItem>
                  {destinos.map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Quando este agente emitir [QUALIFICADO], a conversa passa para o agente escolhido. Sem escolha, o lead
                volta para a roleta. A lista esconde agentes inativos e os que fechariam um ciclo de encadeamento.
              </p>
              {/* Decisão de 02/09/2026 registrada onde ela é tomada: o campo
                  existe, e a recomendação é não usá-lo ainda. Cada elo da
                  cadeia multiplica o custo por lead e cria mais um ponto onde a
                  conversa pode travar sem ninguém perceber. */}
              <p className="text-xs text-muted-foreground mt-1">
                <b>Comece com um agente só.</b> Cada elo da cadeia multiplica o custo por lead e acrescenta um ponto
                onde a conversa pode parar. Encadeie (orquestrador → qualificador → crédito) depois que o primeiro
                agente estiver calibrado.
              </p>
            </div>
            <div>
              <Label htmlFor="ag-group">Roleta que recebe o lead qualificado</Label>
              <Select value={editing.handoff_group_id || SEM_SELECAO} onValueChange={v => setEditing({ ...editing, handoff_group_id: v === SEM_SELECAO ? null : v })}>
                <SelectTrigger id="ag-group" aria-label="Roleta que recebe o lead qualificado">
                  <SelectValue placeholder="Fila geral" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM_SELECAO}>
                    Fila geral{grupoGeral ? ` (${grupoGeral.name})` : ""}
                  </SelectItem>
                  {grupoAtivos.filter(g => g.kind !== "general").map(g => (
                    <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                É o grupo de distribuição para onde o lead vai quando este agente encerra a qualificação — o de crédito
                para o agente de crédito, por exemplo. Sem escolha, cai na fila geral.
              </p>
            </div>
            {canWrite && (
              <div className="flex gap-2">
                <Button onClick={save}>Salvar</Button>
                <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
              </div>
            )}
          </fieldset>
        )}
      </Card>

      <AlertDialog open={!!excluindo} onOpenChange={(aberto) => { if (!aberto) setExcluindo(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir o agente “{excluindo?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {efeitos.length > 0
                ? <>Perdem o vínculo com ele: <b>{efeitos.join(" · ")}</b>. Os leads dessas origens deixam de passar
                  pela IA e caem direto na roleta.</>
                : <>Nenhuma origem, lista ou agente aponta para ele hoje — a exclusão não solta nenhum vínculo.</>}
              {" "}Para tirá-lo do fluxo sem perder o histórico das conversas, desmarque “Ativo” e salve.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => excluindo && remove(excluindo)}>Excluir agente</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
