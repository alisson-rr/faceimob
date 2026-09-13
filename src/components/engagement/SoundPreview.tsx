import { useSyncExternalStore } from "react";
import { Play, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/shared";
import { isSoundOn, playSound, setSoundOn, subscribeSound, type SoundName } from "@/lib/engagement/audio";
import { tocarPremiacao } from "@/hooks/useSomDePremiacao";

/**
 * Escuta dos sons do sistema, um a um.
 *
 * A música de premiação é a faixa do cliente (`useSomDePremiacao`); o resto sai
 * de osciladores (`lib/engagement/audio`). Nenhuma máquina do harness tem saída
 * de som: nenhum teste automatizado consegue afirmar que um som soa bem — só
 * que ele é disparado. A conferência é por ouvido, e até 06/09 ela exigia
 * fechar uma venda de verdade. Aqui cada som toca sozinho, sem mexer no placar.
 *
 * Os três sons curtos de marco (venda, ranking, meta) só tocam no lugar da
 * música: com `prefers-reduced-motion`, ou quando o navegador recusa a faixa.
 * O texto diz isso para ninguém procurar a fanfarra numa venda normal.
 *
 * Com o som DESLIGADO nada toca: um botão que não faz som e não diz por quê é
 * pior do que um botão desabilitado com o motivo escrito. Por isso a lista
 * inteira sai do ar com o aviso e o atalho para religar.
 */
const catalogo = (name: SoundName) => () => playSound(name, { manual: true });

const SONS: { id: string; label: string; quando: string; tocar: () => void }[] = [
  {
    id: "premiacao",
    label: "Música de premiação",
    quando: "Venda fechada (todos ouvem), subida no ranking e meta batida (quem conquistou). Trecho de 7 s.",
    tocar: () => tocarPremiacao({ manual: true }),
  },
  { id: "leadNew", label: "Lead novo", quando: "Lead entra na roleta.", tocar: catalogo("leadNew") },
  { id: "leadClaimed", label: "Lead travado", quando: "O corretor pega o lead e a trava começa.", tocar: catalogo("leadClaimed") },
  { id: "checkin", label: "Check-in", quando: "Presença confirmada, o corretor entra na fila.", tocar: catalogo("checkin") },
  { id: "sale", label: "Venda fechada (curto)", quando: "No lugar da música, com menos movimento ou música recusada.", tocar: catalogo("sale") },
  { id: "rankUp", label: "Subiu no ranking (curto)", quando: "No lugar da música, para quem subiu.", tocar: catalogo("rankUp") },
  { id: "goal", label: "Meta batida (curto)", quando: "No lugar da música, para quem bateu a meta de VGV do mês.", tocar: catalogo("goal") },
  { id: "success", label: "Sucesso", quando: "Aviso de gravação concluída (toast de sucesso).", tocar: catalogo("success") },
  { id: "error", label: "Erro", quando: "Aviso de falha (toast de erro).", tocar: catalogo("error") },
];

export function SoundPreview() {
  const ligado = useSyncExternalStore(subscribeSound, isSoundOn, () => true);

  return (
    <SectionCard
      title="Sons do sistema"
      icon={ligado ? Volume2 : VolumeX}
      description="Toca cada som isolado, sem pontuar nada. A música é a faixa entregue pelo cliente; os outros sons são gerados no navegador."
      actions={!ligado
        ? (
          <Button size="sm" variant="outline" onClick={() => setSoundOn(true)}>
            <Volume2 className="h-4 w-4" /> Ligar os sons
          </Button>
        )
        : undefined}
    >
      {!ligado && (
        <p className="mb-3 text-sm text-warning">
          Os sons estão desligados neste navegador. Enquanto estiverem, tocar não produz áudio nenhum.
        </p>
      )}
      <ul className="grid gap-2 sm:grid-cols-2">
        {SONS.map((som) => (
          <li
            key={som.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{som.label}</p>
              <p className="truncate text-xs text-muted-foreground">{som.quando}</p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              disabled={!ligado}
              aria-label={`Tocar o som ${som.label}`}
              onClick={som.tocar}
            >
              <Play className="h-4 w-4" aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
