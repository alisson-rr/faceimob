import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { LoadingState, PageHeader } from "@/components/shared";
import { toast } from "sonner";
import { Bot, MessageSquare, Send, Sparkles } from "lucide-react";
import { describeError } from "@/lib/supabaseError";
import { AgentsTab } from "@/components/sdr/AgentsTab";
import { SourcesTab } from "@/components/sdr/SourcesTab";
import { PlaygroundTab } from "@/components/sdr/PlaygroundTab";
import { ConversationsTab } from "@/components/sdr/ConversationsTab";
import { RemarketingTab } from "@/components/sdr/RemarketingTab";
import { WhatsAppTab } from "@/components/sdr/WhatsAppTab";
import {
  canEditTemplates, canManageSdr,
  type Agent, type Group, type ListStats, type Rlist, type Source, type WhatsAppTemplate,
} from "@/components/sdr/types";

export default function SdrModule() {
  const { roles } = useAuth();
  const canWrite = canManageSdr(roles);
  const canWriteTemplates = canEditTemplates(roles);
  const [tab, setTab] = useState("agents");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [lists, setLists] = useState<Rlist[]>([]);
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  // Roletas de destino do handoff. `sdr_handoff` lê `sdr_agents.handoff_group_id`
  // e, sem valor, joga tudo na fila geral — sem este seletor não havia como
  // mandar o lead do agente de crédito para o grupo de crédito.
  const [groups, setGroups] = useState<Group[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Sem esta flag as abas recebiam arrays vazios durante o carregamento e
  // afirmavam "Nenhum agente", "Nenhuma origem cadastrada" — e, no caminho de
  // erro, a tela dizia ao mesmo tempo "não consegui carregar" e "não existe
  // nada". Enquanto não há dado confirmado, nenhuma frase definitiva aparece.
  const [carregando, setCarregando] = useState(true);

  async function loadAll() {
    try {
      await buscarDados();
    } finally {
      // Só o PRIMEIRO carregamento mostra esqueleto: `loadAll` também é o
      // `reload` das abas, e desmontar o conteúdo a cada gravação apagaria o
      // rascunho aberto no formulário ao lado.
      setCarregando(false);
    }
  }

  async function buscarDados() {
    const [a, s, l, w, g] = await Promise.all([
      supabase.from("sdr_agents").select("*").order("created_at"),
      supabase.from("lead_sources").select("*").order("created_at"),
      supabase.from("remarketing_lists").select("*").order("created_at", { ascending: false }),
      supabase.from("whatsapp_templates").select("*").order("created_at"),
      supabase.from("distribution_groups").select("id,name,kind,active").order("name"),
    ]);
    // Sem checar error, falha de RLS/rede virava empty state falso
    // ("Nenhum agente..."). Erro aparece e a tela oferece retry.
    const firstError = a.error || s.error || l.error || w.error || g.error;
    if (firstError) {
      setLoadError(describeError(firstError, "verifique sua permissão e tente de novo"));
      toast.error("Falha ao carregar os dados do SDR.");
      return;
    }
    setLoadError(null);
    setAgents(a.data || []);
    setSources(s.data || []);
    setGroups(g.data || []);
    const templates = w.data || [];
    setTemplates(templates);
    // `remarketing_list_stats` agrega no banco. A versão anterior baixava a
    // tabela inteira de contatos para contar no navegador — cresce com a base e
    // ainda assim só dava o total, sem enviados/respondidos.
    const rows = l.data || [];
    let statsFailed = false;
    const withStats = await Promise.all(rows.map(async row => {
      const { data: stats, error: statsError } = await supabase.rpc("remarketing_list_stats", { p_list_id: row.id });
      if (statsError) statsFailed = true;
      const s0 = (stats as ListStats[] | null)?.[0];
      return {
        ...row,
        template_name: templates.find(template => template.id === row.template_id)?.name || null,
        stats: s0 ?? { total: 0, pending: 0, sent: 0, replied: 0, failed: 0 },
      };
    }));
    setLists(withStats);
    if (statsFailed) toast.error("Falha ao carregar estatísticas de uma ou mais listas de remarketing");
  }
  // `loadAll` é recriada a cada render (função do corpo do componente), então
  // entrar com ela na lista de dependências faria a carga rodar em laço. A
  // referência estável fica num ref e o efeito roda uma vez, na montagem — que
  // é o comportamento que o `[]` já pretendia, agora sem a regra do lint
  // apontando para uma closure velha que ninguém tem.
  const cargaInicial = useRef(loadAll);
  cargaInicial.current = loadAll;
  useEffect(() => { void cargaInicial.current(); }, []);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <PageHeader
        title="SDR IA da Face"
        icon={Bot}
        description="Agentes de IA para qualificação de leads, orquestrador multi-agente e remarketing WhatsApp."
      />

      {loadError && (
        <Card className="p-4 border-destructive/40 flex items-center justify-between gap-2 text-sm">
          <span>Não foi possível carregar os dados do SDR: {loadError}</span>
          <Button size="sm" variant="outline" onClick={loadAll}>Tentar novamente</Button>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="agents"><Bot className="h-4 w-4 mr-2" />Agentes</TabsTrigger>
          <TabsTrigger value="sources">Origens</TabsTrigger>
          <TabsTrigger value="playground"><Sparkles className="h-4 w-4 mr-2" />Playground</TabsTrigger>
          <TabsTrigger value="conversations"><MessageSquare className="h-4 w-4 mr-2" />Conversas</TabsTrigger>
          <TabsTrigger value="remarketing"><Send className="h-4 w-4 mr-2" />Remarketing</TabsTrigger>
          <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
        </TabsList>

        {/* Carregando ou com erro, o conteúdo não aparece: cada aba tem uma
            frase de vazio definitiva ("Nenhum agente", "Nenhuma origem
            cadastrada") que seria mentira nos dois estados. */}
        {carregando ? (
          <div className="mt-4"><LoadingState variant="list" rows={4} label="Carregando agentes, origens, listas e templates…" /></div>
        ) : loadError ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Nada foi carregado, então nenhuma aba pode dizer o que existe ou não. Use “Tentar novamente” acima.
          </p>
        ) : (
          <>
            {/* `sources` e `lists` entram só para o aviso de exclusão dizer o
                que se solta (FKs ON DELETE SET NULL) — a aba não os edita. */}
            <TabsContent value="agents"><AgentsTab agents={agents} groups={groups} sources={sources} lists={lists} canWrite={canWrite} reload={loadAll} /></TabsContent>
            <TabsContent value="sources"><SourcesTab sources={sources} agents={agents} templates={templates} canWrite={canWrite} reload={loadAll} /></TabsContent>
            <TabsContent value="playground"><PlaygroundTab agents={agents} canWrite={canWrite} /></TabsContent>
            <TabsContent value="conversations"><ConversationsTab agents={agents} canWrite={canWrite} /></TabsContent>
            <TabsContent value="remarketing"><RemarketingTab lists={lists} agents={agents} groups={groups} templates={templates} canWrite={canWrite} reload={loadAll} /></TabsContent>
            {/* `sources` e `lists` também aqui, e pelo mesmo motivo da aba
                Agentes: dizer no aviso de exclusão o que perde o vínculo. */}
            <TabsContent value="whatsapp"><WhatsAppTab templates={templates} sources={sources} lists={lists} canWrite={canWriteTemplates} reload={loadAll} /></TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}
