import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { LoadingState, PageHeader } from "@/components/shared";
import { toast } from "sonner";
import { AlertTriangle, Bot, MessageSquare, Send, Sparkles } from "lucide-react";
import { describeError } from "@/lib/supabaseError";
import { AgentsTab } from "@/components/sdr/AgentsTab";
import { SourcesTab } from "@/components/sdr/SourcesTab";
import { PlaygroundTab } from "@/components/sdr/PlaygroundTab";
import { ConversationsTab } from "@/components/sdr/ConversationsTab";
import { RemarketingTab } from "@/components/sdr/RemarketingTab";
import { WhatsAppTab } from "@/components/sdr/WhatsAppTab";
import {
  canEditTemplates, canManageSdr, IA_SEM_CREDENCIAL, ondeCadastrarIa,
  type Agent, type Group, type ListStats, type Rlist, type Source, type WhatsAppTemplate,
} from "@/components/sdr/types";

const SDR_KEY = ["sdr", "modulo"] as const;

type DadosSdr = {
  agents: Agent[];
  sources: Source[];
  lists: Rlist[];
  templates: WhatsAppTemplate[];
  // Roletas de destino do handoff. `sdr_handoff` lê `sdr_agents.handoff_group_id`
  // e, sem valor, joga tudo na fila geral — sem este seletor não havia como
  // mandar o lead do agente de crédito para o grupo de crédito.
  groups: Group[];
  /**
   * A chave da OpenAI está no cofre? `null` enquanto não se sabe — e enquanto
   * não se sabe, nenhuma aba afirma nada, pela mesma disciplina do
   * `carregando`: dizer "não configurada" porque a consulta falhou seria trocar
   * uma mentira por outra.
   */
  iaConfigurada: boolean | null;
};

const SDR_VAZIO: DadosSdr = { agents: [], sources: [], lists: [], templates: [], groups: [], iaConfigurada: null };

async function buscarDados(): Promise<DadosSdr> {
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
    toast.error("Não foi possível carregar os dados do SDR");
    throw firstError;
  }
  const templates = w.data || [];
  // `remarketing_list_stats` agrega no banco. A versão anterior baixava a
  // tabela inteira de contatos para contar no navegador — cresce com a base e
  // ainda assim só dava o total, sem enviados/respondidos.
  const rows = l.data || [];
  let falhaStats: unknown = null;
  const withStats = await Promise.all(rows.map(async row => {
    const { data: stats, error: statsError } = await supabase.rpc("remarketing_list_stats", { p_list_id: row.id });
    if (statsError) falhaStats = statsError;
    const s0 = (stats as ListStats[] | null)?.[0];
    return {
      ...row,
      template_name: templates.find(template => template.id === row.template_id)?.name || null,
      stats: s0 ?? { total: 0, pending: 0, sent: 0, replied: 0, failed: 0 },
    };
  }));
  if (falhaStats) {
    toast.error("Não foi possível carregar as estatísticas das listas", {
      description: describeError(falhaStats, "Os números de uma ou mais listas de remarketing podem aparecer zerados."),
    });
  }

  // Só o veredito booleano; a function nunca devolve o valor da chave. Falha
  // aqui não vira erro de tela: o módulo inteiro funciona sem esta resposta,
  // e o que se perde é apenas o aviso antecipado.
  const { data: cred, error: credErr } = await supabase.functions.invoke("sdr-agent-chat", {
    body: { action: "status" },
  });
  return {
    agents: a.data || [],
    sources: s.data || [],
    lists: withStats,
    templates,
    groups: g.data || [],
    iaConfigurada: credErr || typeof cred?.configured !== "boolean" ? null : cred.configured,
  };
}

export default function SdrModule() {
  const { roles, can, user } = useAuth();
  const canWrite = canManageSdr(roles);
  const canWriteTemplates = canEditTemplates(roles);
  // `?aba=conversas` é o destino dos avisos de WhatsApp no sino (0120).
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get("aba") === "conversas" ? "conversations" : "agents");
  const queryClient = useQueryClient();
  // Cache do TanStack Query: voltar à tela mostra o que já estava aqui e relê
  // por trás. Sem releitura ao focar a aba — a carga manual nunca releu assim,
  // e cada leitura chama a edge function de status e pode repetir o aviso das
  // estatísticas. Sem `retry`, que repetiria o aviso de falha da leitura. O
  // usuário entra na chave para quem entra depois no mesmo navegador não herdar
  // a leitura de quem saiu.
  const sdrKey = [...SDR_KEY, user?.id ?? null] as const;
  const sdr = useQuery({ queryKey: sdrKey, queryFn: buscarDados, retry: false, refetchOnWindowFocus: false });
  const { agents, sources, lists, templates, groups, iaConfigurada } = sdr.data ?? SDR_VAZIO;
  const loadError = sdr.error ? describeError(sdr.error, "verifique sua permissão e tente de novo") : null;
  // Sem esta flag as abas recebiam arrays vazios durante o carregamento e
  // afirmavam "Nenhum agente", "Nenhuma origem cadastrada" — e, no caminho de
  // erro, a tela dizia ao mesmo tempo "não consegui carregar" e "não existe
  // nada". Enquanto não há dado confirmado, nenhuma frase definitiva aparece.
  // Só o PRIMEIRO carregamento mostra esqueleto (`isLoading` = sem dado e sem
  // erro): `loadAll` também é o `reload` das abas, e desmontar o conteúdo a
  // cada gravação apagaria o rascunho aberto no formulário ao lado.
  const carregando = sdr.isLoading;
  const loadAll = () => void queryClient.invalidateQueries({ queryKey: SDR_KEY });

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

      {/* Honestidade antes do primeiro clique: sem a chave, nenhum agente
          responde — e o operador só descobria isso depois de digitar. Mesma
          anatomia do aviso de credencial do WhatsApp (`RemarketingTab`): os
          dois aparecem juntos na mesma rolagem quando falta as duas chaves, e
          duas gramáticas de "aviso amarelo" ensinam o operador a ignorar uma. */}
      {iaConfigurada === false && (
        <Card role="status" className="p-4 border-warning/50 flex items-start gap-2 text-sm">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-warning" aria-hidden="true" />
          <div className="space-y-1 min-w-0">
            <p className="font-medium">{IA_SEM_CREDENCIAL}</p>
            <p className="text-muted-foreground">
              {ondeCadastrarIa(can("menu.admin_integrations"))} Até lá nenhum agente responde: o lead que entra por uma
              origem com SDR fica esperando na conversa, e o SDR é avisado no sino a cada mensagem sem resposta.
              Cadastro de agentes, origens, listas e templates continua valendo — só a resposta da IA depende da chave.
            </p>
          </div>
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
            <TabsContent value="agents"><AgentsTab agents={agents} groups={groups} sources={sources} lists={lists} canWrite={canWrite} iaConfigurada={iaConfigurada} reload={loadAll} /></TabsContent>
            <TabsContent value="sources"><SourcesTab sources={sources} agents={agents} templates={templates} canWrite={canWrite} reload={loadAll} /></TabsContent>
            {/* Um turno que deu certo prova a chave melhor que a consulta de status:
                sem avisar aqui, o Playground respondia e a tela seguia dizendo
                que a IA não responde, até alguém dar F5. */}
            <TabsContent value="playground"><PlaygroundTab agents={agents} canWrite={canWrite} iaConfigurada={iaConfigurada} onCredencialAceita={() => queryClient.setQueryData<DadosSdr>(sdrKey, (d) => d && { ...d, iaConfigurada: true })} /></TabsContent>
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
