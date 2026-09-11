import { useId, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pause, Play, Wallet } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { brl, parseBrl } from "@/lib/format";
import { invocarAcaoMeta } from "./acaoMeta";

/**
 * Pausar, ativar e mudar a verba diária de uma campanha sincronizada, na Meta
 * (F1.3), pela edge `meta-campaign-action` — o mesmo executor da fila do gestor IA.
 *
 * Toda ação passa por uma confirmação: é dinheiro de verdade e não tem desfazer
 * automático. A regra dos 30% não mora aqui: quem decide é o banco (e o
 * executor, com a verba lida ao vivo na Meta), e o 409 'aprendizado' abre o
 * segundo aviso. As travas da tela repetem as do banco (lição 7): sem conta da
 * Meta ou sem `marketing.meta_manage` nada aparece; verba total ou nível de
 * verba ainda não sincronizado deixam "Mudar verba" desligado, com a frase.
 */

type Acao = "pausar" | "ativar" | "verba";

type Campanha = {
  id: string;
  name: string;
  status: string | null;
  dailyBudget: number | null;
  metaAccountId: string | null;
  metaBudgetLevel: "campaign" | "adset" | "lifetime" | null;
};

type Pedido = { campaign_id: string; acao: Acao; verba_diaria?: number; confirma_aprendizado?: true };
type Aviso = { variacao: number | null; verba_atual: number | null; verba_nova: number | null };
type Resposta =
  | { tipo: "feito"; status: "executada" | "parcial"; erro: string | null }
  | { tipo: "aprendizado"; aviso: Aviso }
  | { tipo: "falha"; mensagem: string };

const pct = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" });
const reais = (v: number | null | undefined) => brl(v, { cents: true });

const CONFIRMA: Record<Acao, { titulo: (nome: string) => string; texto: string; botao: string }> = {
  pausar: {
    titulo: (nome) => `Pausar "${nome}" na Meta?`,
    texto: "A campanha para de veicular assim que a Meta aceitar. Fica registrado quem pausou e quando, no histórico de ações.",
    botao: "Pausar na Meta",
  },
  ativar: {
    titulo: (nome) => `Ativar "${nome}" na Meta?`,
    texto: "A campanha volta a veicular e a gastar a verba configurada na Meta. Fica registrado quem ativou e quando.",
    botao: "Ativar na Meta",
  },
  verba: {
    titulo: (nome) => `Mudar a verba diária de "${nome}"?`,
    texto: "O valor vai para a Meta assim que você confirmar. Fica registrado quem mudou, quando e de quanto para quanto.",
    botao: "Mudar verba na Meta",
  },
};

const FEITO: Record<Acao, string> = {
  pausar: "Campanha pausada na Meta",
  ativar: "Campanha ativada na Meta",
  verba: "Verba diária mudada na Meta",
};

const SEM_STATUS = "A ação respondeu sem dizer o que a Meta fez: confira o histórico de ações.";

async function enviar(pedido: Pedido): Promise<Resposta> {
  const r = await invocarAcaoMeta(pedido, SEM_STATUS);
  if (r.tipo !== "feito") return r;
  if (r.status === "executada" || r.status === "parcial") return { tipo: "feito", status: r.status, erro: r.erro };
  // 200 sem dizer o que a Meta fez não vira sucesso na tela.
  return { tipo: "falha", mensagem: SEM_STATUS };
}

export function MetaCampaignActions({ campaign, onDone }: { campaign: Campanha; onDone: () => void }) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const baseId = useId();
  const origem = useRef<HTMLElement | null>(null);
  const [aberta, setAberta] = useState<Acao | null>(null);
  const [verbaTexto, setVerbaTexto] = useState("");
  const [aprendizado, setAprendizado] = useState<{ pedido: Pedido; aviso: Aviso } | null>(null);

  const mandar = useMutation({
    mutationFn: enviar,
    onSuccess: async (r, pedido) => {
      setAberta(null);
      setAprendizado(r.tipo === "aprendizado" ? { pedido, aviso: r.aviso } : null);
      // Em qualquer desfecho a ação pode ter ficado registrada no histórico.
      const recarregar = queryClient.invalidateQueries({ queryKey: ["marketing"] });
      if (r.tipo === "aprendizado") return;
      await recarregar;
      if (r.tipo === "falha") {
        toast.error("A ação não foi concluída", { description: r.mensagem });
        return;
      }
      if (r.status === "parcial") {
        toast.warning("A verba mudou só em parte", {
          description: r.erro ?? "Veja conjunto por conjunto no histórico de ações.",
        });
      } else {
        toast.success(FEITO[pedido.acao], {
          description: pedido.acao === "verba"
            ? `${campaign.name}: ${reais(pedido.verba_diaria)} por dia.`
            : campaign.name,
        });
      }
      onDone();
    },
    onError: (e) => {
      setAberta(null);
      setAprendizado(null);
      toast.error("A ação não foi concluída", { description: e.message });
    },
  });

  if (!campaign.metaAccountId || !can("marketing.meta_manage")) return null;

  const pendente = mandar.isPending;
  const digitada = parseBrl(verbaTexto);
  const verbaNova = digitada === null ? null : Math.round(digitada * 100) / 100;
  const verbaValida = verbaNova !== null && verbaNova > 0;
  const travaVerba =
    campaign.metaBudgetLevel === "lifetime"
      ? "Verba total: mude no Gerenciador de Anúncios."
      : campaign.metaBudgetLevel === null
        ? "Sincronize antes de mudar a verba: ainda não se sabe se ela fica na campanha ou nos conjuntos."
        : null;
  const travaId = `${baseId}-trava`;
  const campoId = `${baseId}-verba`;

  const abrir = (acao: Acao, alvo: HTMLElement) => {
    origem.current = alvo;
    setVerbaTexto("");
    setAberta(acao);
  };

  const confirmar = () => {
    if (aberta === "verba") {
      if (verbaNova !== null && verbaNova > 0) {
        mandar.mutate({ campaign_id: campaign.id, acao: "verba", verba_diaria: verbaNova });
      }
    } else if (aberta) {
      mandar.mutate({ campaign_id: campaign.id, acao: aberta });
    }
  };

  // Sem Trigger do Radix, o foco volta à mão para o botão que abriu o diálogo.
  const devolverFoco = (e: Event) => {
    e.preventDefault();
    origem.current?.focus();
  };

  const aviso = aprendizado?.aviso;
  const confirma = aberta ? CONFIRMA[aberta] : null;

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2">
        {campaign.status !== "PAUSED" && (
          <Button
            size="sm"
            variant="outline"
            disabled={pendente}
            aria-label={`Pausar ${campaign.name} na Meta`}
            onClick={(e) => abrir("pausar", e.currentTarget)}
          >
            <Pause aria-hidden />
            Pausar
          </Button>
        )}
        {campaign.status !== "ACTIVE" && (
          <Button
            size="sm"
            variant="outline"
            disabled={pendente}
            aria-label={`Ativar ${campaign.name} na Meta`}
            onClick={(e) => abrir("ativar", e.currentTarget)}
          >
            <Play aria-hidden />
            Ativar
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={pendente || travaVerba !== null}
          aria-label={`Mudar verba de ${campaign.name} na Meta`}
          aria-describedby={travaVerba ? travaId : undefined}
          onClick={(e) => abrir("verba", e.currentTarget)}
        >
          <Wallet aria-hidden />
          Mudar verba
        </Button>
      </div>
      {travaVerba && <p id={travaId} className="text-xs text-muted-foreground">{travaVerba}</p>}

      <AlertDialog open={aberta !== null} onOpenChange={(abrirDialogo) => { if (!abrirDialogo && !pendente) setAberta(null); }}>
        <AlertDialogContent onCloseAutoFocus={devolverFoco}>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirma?.titulo(campaign.name)}</AlertDialogTitle>
            <AlertDialogDescription>{confirma?.texto}</AlertDialogDescription>
          </AlertDialogHeader>

          {aberta === "verba" && (
            <div className="space-y-2">
              <Label htmlFor={campoId}>Nova verba diária (R$)</Label>
              <Input
                id={campoId}
                inputMode="decimal"
                autoComplete="off"
                placeholder="Ex.: 150,00"
                value={verbaTexto}
                disabled={pendente}
                aria-invalid={verbaTexto !== "" && !verbaValida}
                aria-describedby={`${campoId}-ajuda`}
                onChange={(e) => setVerbaTexto(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirmar(); } }}
              />
              <p id={`${campoId}-ajuda`} className="text-xs text-muted-foreground">
                {campaign.dailyBudget != null
                  ? `Pela última sincronização, hoje são ${reais(campaign.dailyBudget)} por dia.`
                  : "A verba atual ainda não foi sincronizada."}
                {campaign.metaBudgetLevel === "adset" &&
                  " A verba está nos conjuntos: cada conjunto ativo muda na mesma proporção, com mínimo de R$ 1,00."}
              </p>
              {verbaTexto !== "" && !verbaValida && (
                <p role="status" className="text-xs text-destructive">Informe um valor maior que zero.</p>
              )}
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={pendente}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={pendente || (aberta === "verba" && !verbaValida)}
              onClick={(e) => { e.preventDefault(); confirmar(); }}
            >
              {pendente ? "Enviando à Meta…" : confirma?.botao}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={aprendizado !== null} onOpenChange={(abrirDialogo) => { if (!abrirDialogo && !pendente) setAprendizado(null); }}>
        <AlertDialogContent onCloseAutoFocus={devolverFoco}>
          <AlertDialogHeader>
            <AlertDialogTitle>A campanha volta para a fase de aprendizado</AlertDialogTitle>
            <AlertDialogDescription>
              A verba diária sobe {aviso?.variacao != null ? pct.format(aviso.variacao) : "muito"}
              {aviso?.verba_atual != null && aviso.verba_nova != null
                ? `: de ${reais(aviso.verba_atual)} para ${reais(aviso.verba_nova)} por dia`
                : ""}
              . Uma subida desse tamanho faz a Meta reiniciar a fase de aprendizado, e o custo por resultado costuma
              subir por alguns dias. Para escalar sem reiniciar, suba em degraus menores, com 48 h entre eles.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pendente}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={pendente}
              onClick={(e) => {
                e.preventDefault();
                if (aprendizado) mandar.mutate({ ...aprendizado.pedido, confirma_aprendizado: true });
              }}
            >
              {pendente ? "Enviando à Meta…" : "Subir mesmo assim"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
