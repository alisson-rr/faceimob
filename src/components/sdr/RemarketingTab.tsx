import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { StatusBadge } from "@/components/shared";
import { toast } from "sonner";
import { AlertTriangle, Send, Settings2, Trash2, Upload } from "lucide-react";
import { ImportError, parseSheet, rowsToRecords } from "@/components/leads/importSheet";
import { describeError } from "@/lib/supabaseError";
import { ListContacts, ToggleContatos } from "./ListContacts";
import { disparoEmAndamento, falhaDoDisparo, lerContatos } from "./remarketing";
import {
  resumoDisparo, SEM_PERMISSAO, SEM_SELECAO, situacaoLista,
  type Agent, type Group, type Rlist, type WhatsAppTemplate,
} from "./types";

export function RemarketingTab({ lists, agents, groups, templates, canWrite, reload }: {
  lists: Rlist[]; agents: Agent[]; groups: Group[]; templates: WhatsAppTemplate[]; canWrite: boolean; reload: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [editando, setEditando] = useState<Rlist | null>(null);
  const [testPhone, setTestPhone] = useState("");
  const [ocupado, setOcupado] = useState(false);
  // Painel de contatos aberto (um por vez): é onde o `last_error` de cada
  // contato aparece — o toast do disparo prometia o motivo e não havia onde ler.
  const [contatosDe, setContatosDe] = useState<string | null>(null);
  // Confirmações pelo AlertDialog do app. O `confirm()` nativo não é estilizado,
  // ignora o tema e — em disparo em massa para número de cliente real — não dá
  // espaço para dizer quantos contatos vão receber a mensagem.
  const [confirmando, setConfirmando] = useState<{ tipo: "disparo" | "exclusao"; lista: Rlist } | null>(null);
  // Credencial da Meta que faltou no último disparo. Fica na tela, e não só no
  // toast: "a Meta recusou" o operador resolve tentando de novo, "não há chave
  // cadastrada" não muda até alguém abrir Admin · Integrações — e o toast some
  // em segundos levando junto a única explicação de por que nada saiu.
  const [semCredencial, setSemCredencial] = useState<string | null>(null);

  const ativos = groups.filter(g => g.active);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    // Libera o mesmo arquivo para nova tentativa (o browser não dispara `change`
    // para seleção idêntica). Mesmo padrão do FileDropzone; o `File` já está em `f`.
    e.target.value = "";
    if (!newName.trim()) return toast.error("Dê um nome para a lista antes");
    setUploading(true);
    try {
      // Mesmo leitor da importação de leads: é dele que vêm os limites de
      // tamanho e de linhas, que este upload não tinha, e é ele que passou a
      // ser o único ponto do app que abre planilha de terceiro.
      const rows = rowsToRecords(await parseSheet(f));
      // Aceita colunas: nome/name, fone/telefone/phone, campanha/campaign
      const parsed = rows.map(keys => ({
        name: keys.nome || keys.name || keys.cliente || "",
        phone: keys.fone || keys.telefone || keys.phone || keys.celular || "",
        campaign: keys.campanha || keys.campaign || keys.origem || "",
        extra: keys,
      })).filter(r => r.phone);

      if (parsed.length === 0) return toast.error("Nenhum contato válido (verifique colunas nome/fone/campanha)");

      const contacts = parsed.map(p => ({ full_name: p.name, phone: p.phone, extra: { campaign: p.campaign, ...p.extra } }));
      const { data: listId, error: importError } = await supabase.rpc("import_remarketing_list", {
        p_name: newName.trim(),
        p_template_id: templateId || null,
        p_agent_id: agentId || null,
        p_contacts: contacts,
      });
      if (importError) throw importError;
      // A RPC não recebe o grupo de handoff, e é ele que o
      // `whatsapp-inbound-webhook` usa para decidir a roleta do lead criado a
      // partir de uma resposta — sem ele o lead nasce sem grupo nenhum.
      if (groupId && listId) {
        const { error: groupError } = await supabase
          .from("remarketing_lists").update({ handoff_group_id: groupId }).eq("id", listId as string).select("id");
        if (groupError) toast.error(describeError(groupError, "Lista criada, mas sem a roleta de destino."));
      }
      toast.success(`Lista "${newName.trim()}" criada com ${parsed.length} contatos`);
      setNewName(""); setTemplateId(""); setGroupId("");
      reload();
    } catch (err: unknown) {
      // A planilha recusada já explica o motivo em pt-BR; o resto é erro do
      // banco vindo da RPC de importação, e aí quem traduz é o describeError.
      toast.error(err instanceof ImportError ? err.message : describeError(err, "Falha ao importar a lista."));
    } finally { setUploading(false); }
  }

  async function broadcast(listId: string) {
    setConfirmando(null);
    setOcupado(true);
    const { data, error } = await supabase.functions.invoke("sdr-whatsapp-broadcast", { body: { list_id: listId } });
    setOcupado(false);
    if (error) return toast.error(await functionErrorMessage(error, "Falha no disparo"));
    // Verde SÓ quando saiu alguma coisa: a function conta falha por contato e
    // devolve 200 mesmo com `sent: 0, failed: 500`. O lote é de 500 por
    // chamada, então a fila que sobrou também precisa ser dita.
    const r = resumoDisparo({
      sent: Number(data?.sent ?? 0), failed: Number(data?.failed ?? 0), remaining: Number(data?.remaining ?? 0),
    });
    const emitir = r.tom === "success" ? toast.success : r.tom === "warning" ? toast.warning : toast.error;
    emitir(r.titulo, { description: r.descricao });
    reload();
  }

  async function enviarTeste(listId: string) {
    const fone = testPhone.replace(/\D/g, "");
    if (fone.length < 10) return toast.error("Informe o telefone de teste com DDD.");
    setOcupado(true);
    const { error } = await supabase.functions.invoke("sdr-whatsapp-broadcast", {
      body: { list_id: listId, test_phone: fone },
    });
    setOcupado(false);
    if (error) return toast.error(await functionErrorMessage(error, "Falha no envio de teste"));
    toast.success("Teste enviado para o número informado.");
  }

  async function salvarEdicao() {
    if (!editando) return;
    if (!editando.name.trim()) return toast.error("A lista precisa de um nome");
    setOcupado(true);
    const { data, error } = await supabase.from("remarketing_lists").update({
      name: editando.name.trim(),
      template_id: editando.template_id,
      agent_id: editando.agent_id,
      handoff_group_id: editando.handoff_group_id,
    }).eq("id", editando.id).select("id");
    setOcupado(false);
    if (error) return toast.error(describeError(error, "Não foi possível salvar a lista."));
    if (!data?.length) return toast.error(SEM_PERMISSAO);
    toast.success("Lista atualizada");
    setEditando(null);
    reload();
  }

  async function removeList(id: string) {
    setConfirmando(null);
    const { data, error } = await supabase.from("remarketing_lists").delete().eq("id", id).select("id");
    if (error) return toast.error(describeError(error, "Não foi possível excluir a lista."));
    if (!data?.length) return toast.error(SEM_PERMISSAO);
    if (editando?.id === id) setEditando(null);
    if (contatosDe === id) setContatosDe(null);
    toast.success("Lista excluída");
    reload();
  }

  return (
    <div className="space-y-4">
      {canWrite && (
        <Card className="p-4 space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2"><Upload className="h-4 w-4" />Nova lista (Excel)</h3>
          <p className="text-xs text-muted-foreground">Suba um <b>.xlsx</b> ou <b>.csv</b> com colunas: <b>nome, fone, campanha</b> (podem existir colunas extras que ficam salvas em contexto). Escolha nome, template, agente e roleta de destino antes do arquivo — o upload começa ao selecioná-lo.</p>
          <div className="grid md:grid-cols-5 gap-2">
            <Input placeholder="Nome da lista" aria-label="Nome da lista" value={newName} onChange={e => setNewName(e.target.value)} />
            <Select value={templateId || SEM_SELECAO} onValueChange={v => setTemplateId(v === SEM_SELECAO ? "" : v)}>
              <SelectTrigger aria-label="Template Meta"><SelectValue placeholder="Template Meta (aprovado)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM_SELECAO}>Sem template (não dispara)</SelectItem>
                {templates.map(t => (
                  <SelectItem key={t.id} value={t.id}>{t.name}{t.approved ? "" : " · não aprovado"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={agentId || SEM_SELECAO} onValueChange={v => setAgentId(v === SEM_SELECAO ? "" : v)}>
              <SelectTrigger aria-label="Agente que responde"><SelectValue placeholder="Agente que responde" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM_SELECAO}>Sem agente</SelectItem>
                {agents.filter(a => a.active).map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={groupId || SEM_SELECAO} onValueChange={v => setGroupId(v === SEM_SELECAO ? "" : v)}>
              <SelectTrigger aria-label="Roleta de destino"><SelectValue placeholder="Roleta de destino" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM_SELECAO}>Fila geral</SelectItem>
                {ativos.filter(g => g.kind !== "general").map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input type="file" accept=".xlsx,.xls,.csv" aria-label="Planilha de contatos" onChange={handleFile} disabled={uploading} />
          </div>
        </Card>
      )}

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-2">Listas ({lists.length})</h3>
        <div className="space-y-2">
          {lists.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma lista ainda.</p>}
          {lists.map(l => {
            // O selo sai dos CONTATOS, não da coluna `status`: o broadcast
            // grava 'draft' sempre que sobra fila (lista com 500 enviados
            // voltava a dizer "rascunho") e 'failed' com uma única falha.
            const situacao = situacaoLista(l.status, l.stats);
            return (
            <div key={l.id} className="border rounded p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium flex flex-wrap items-center gap-2">{l.name} <StatusBadge tone={situacao.tone}>{situacao.label}</StatusBadge></div>
                  <div className="text-xs text-muted-foreground">
                    Template: {l.template_name || "—"} · {l.stats.total} contatos ({l.stats.pending} pendentes · {l.stats.sent} enviados · {l.stats.replied} respondidos{l.stats.failed > 0 ? ` · ${l.stats.failed} falhas` : ""}) · Agente: {agents.find(a => a.id === l.agent_id)?.name || "—"} · Roleta: {groups.find(g => g.id === l.handoff_group_id)?.name || "fila geral"}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  {canWrite && (
                    <>
                      {/* Gateado pelo MESMO papel da policy `remarketing_contacts_all`
                          (admin/marketing/sdr). Um director com `menu.sdr` abriria o
                          painel e leria "esta lista não tem contatos" — a RLS devolve
                          zero linhas SEM erro, e a tela estaria mentindo. */}
                      <ToggleContatos
                        aberto={contatosDe === l.id}
                        nome={l.name}
                        onToggle={() => setContatosDe(contatosDe === l.id ? null : l.id)}
                      />
                      <Button size="sm" onClick={() => setConfirmando({ tipo: "disparo", lista: l })} disabled={ocupado || l.status === "running"}><Send className="h-3.5 w-3.5 mr-1" />Disparar</Button>
                      <Button size="icon" variant="ghost" aria-label={`Configurar lista ${l.name}`} onClick={() => { setEditando(editando?.id === l.id ? null : l); setTestPhone(""); }}>
                        <Settings2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" aria-label={`Excluir lista ${l.name}`} onClick={() => setConfirmando({ tipo: "exclusao", lista: l })}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </>
                  )}
                </div>
              </div>

              {canWrite && contatosDe === l.id && (
                <div className="border-t pt-2">
                  <ListContacts listId={l.id} total={l.stats.total} />
                </div>
              )}

              {canWrite && editando?.id === l.id && (
                <div className="border-t pt-2 space-y-2">
                  <div className="grid md:grid-cols-4 gap-2">
                    <div>
                      <Label htmlFor={`rl-nome-${l.id}`} className="text-xs">Nome da lista</Label>
                      <Input id={`rl-nome-${l.id}`} value={editando.name} onChange={e => setEditando({ ...editando, name: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-xs" htmlFor={`rl-tpl-${l.id}`}>Template</Label>
                      <Select value={editando.template_id || SEM_SELECAO} onValueChange={v => setEditando({ ...editando, template_id: v === SEM_SELECAO ? null : v })}>
                        <SelectTrigger id={`rl-tpl-${l.id}`} aria-label="Template da lista"><SelectValue placeholder="Sem template" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={SEM_SELECAO}>Sem template (não dispara)</SelectItem>
                          {templates.map(t => <SelectItem key={t.id} value={t.id}>{t.name}{t.approved ? "" : " · não aprovado"}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs" htmlFor={`rl-agente-${l.id}`}>Agente que responde</Label>
                      <Select value={editando.agent_id || SEM_SELECAO} onValueChange={v => setEditando({ ...editando, agent_id: v === SEM_SELECAO ? null : v })}>
                        <SelectTrigger id={`rl-agente-${l.id}`} aria-label="Agente da lista"><SelectValue placeholder="Sem agente" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={SEM_SELECAO}>Sem agente</SelectItem>
                          {agents.filter(a => a.active).map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs" htmlFor={`rl-grupo-${l.id}`}>Roleta de destino</Label>
                      <Select value={editando.handoff_group_id || SEM_SELECAO} onValueChange={v => setEditando({ ...editando, handoff_group_id: v === SEM_SELECAO ? null : v })}>
                        <SelectTrigger id={`rl-grupo-${l.id}`} aria-label="Roleta de destino da lista"><SelectValue placeholder="Fila geral" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={SEM_SELECAO}>Fila geral</SelectItem>
                          {ativos.filter(g => g.kind !== "general").map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    A roleta de destino é para onde vai o lead criado quando um contato desta lista responde. Sem ela,
                    o lead nasce sem grupo e cai na fila geral.
                  </p>
                  <div className="flex flex-wrap items-end gap-2">
                    <Button size="sm" onClick={salvarEdicao} disabled={ocupado}>Salvar</Button>
                    <Button size="sm" variant="outline" onClick={() => setEditando(null)}>Fechar</Button>
                    <div className="flex items-end gap-2 ml-auto">
                      <div>
                        <Label htmlFor={`rl-teste-${l.id}`} className="text-xs">Telefone para teste</Label>
                        <Input id={`rl-teste-${l.id}`} className="w-44" placeholder="51999999999" value={testPhone} onChange={e => setTestPhone(e.target.value)} />
                      </div>
                      <Button size="sm" variant="outline" disabled={ocupado || !l.template_id} onClick={() => enviarTeste(l.id)}>
                        Enviar teste
                      </Button>
                    </div>
                  </div>
                  {!l.template_id && (
                    <p className="text-xs text-warning">Escolha e salve um template aprovado antes de enviar o teste.</p>
                  )}
                </div>
              )}
            </div>
            );
          })}
        </div>
      </Card>

      <AlertDialog open={!!confirmando} onOpenChange={(aberto) => { if (!aberto) setConfirmando(null); }}>
        <AlertDialogContent>
          {confirmando?.tipo === "disparo" ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Disparar para {confirmando.lista.stats.pending} contato(s)?</AlertDialogTitle>
                <AlertDialogDescription>
                  A lista “{confirmando.lista.name}” envia o template{" "}
                  <b>{confirmando.lista.template_name || "— (nenhum configurado)"}</b> por WhatsApp para números de
                  clientes reais. O lote é de até 500 por clique; o que sobrar exige clicar de novo. Mensagem enviada
                  não volta atrás.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={() => broadcast(confirmando.lista.id)}>Disparar agora</AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : confirmando ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir a lista “{confirmando.lista.name}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  Saem junto os {confirmando.lista.stats.total} contato(s) importados e todo o histórico de envio
                  ({confirmando.lista.stats.sent} enviados · {confirmando.lista.stats.replied} respondidos). Os leads
                  já criados a partir de respostas continuam no CRM. Não há como desfazer.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={() => removeList(confirmando.lista.id)}>Excluir lista</AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
