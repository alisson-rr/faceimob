import { useSyncExternalStore } from "react";
import { Play, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/shared";
import { isSoundOn, playSound, setSoundOn, subscribeSound, type SoundName } from "@/lib/engagement/audio";

/**
 * Escuta dos seis sons do sistema, um a um.
 *
 * Os sons saem de osciladores (`lib/engagement/audio`), sem arquivo de áudio, e
 * nenhuma máquina do harness tem saída de som: nenhum teste automatizado
 * consegue afirmar que a fanfarra soa bem — só que ela é disparada. A
 * conferência é por ouvido, e até 06/09 ela exigia fechar uma venda de verdade
 * para ouvir a fanfarra. Aqui cada som toca sozinho, sem mexer no placar.
 *
 * Com o som DESLIGADO, `playSound` retorna cedo e não toca nada: um botão que
 * não faz som e não diz por quê é pior do que um botão desabilitado com o
 * motivo escrito. Por isso a lista inteira sai do ar com o aviso e o atalho
 * para religar.
 */
const SONS: { name: SoundName; label: string; quando: string }[] = [
  { name: "leadNew", label: "Lead novo", quando: "Lead entra na roleta." },
  { name: "leadClaimed", label: "Lead travado", quando: "O corretor pega o lead e a trava começa." },
  { name: "checkin", label: "Check-in", quando: "Presença confirmada, o corretor entra na fila." },
  { name: "rankUp", label: "Subiu no ranking", quando: "O próprio usuário ganha posição." },
  { name: "sale", label: "Venda fechada", quando: "A loja inteira ouve — é o som da ata de 14/07." },
  { name: "goal", label: "Meta batida", quando: "Sem gatilho: nada no banco publica meta batida hoje." },
];

export function SoundPreview() {
  const ligado = useSyncExternalStore(subscribeSound, isSoundOn, () => true);

  return (
    <SectionCard
      title="Sons do sistema"
      icon={ligado ? Volume2 : VolumeX}
      description="Toca cada som isolado, sem pontuar nada. Os sons são gerados no navegador; a conferência é por ouvido."
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
            key={som.name}
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
              onClick={() => playSound(som.name)}
            >
              <Play className="h-4 w-4" aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
