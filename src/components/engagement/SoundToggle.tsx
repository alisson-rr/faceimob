import { useSyncExternalStore } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isSoundOn, setSoundOn, subscribeSound } from "@/lib/engagement/audio";

/**
 * Liga e desliga o som do sistema. Fica no header, ao lado do troca-papel.
 *
 * A preferência mora em `localStorage` (`faceimob-sound`) e é lida pelo módulo
 * de áudio — este botão só reflete e alterna. `useSyncExternalStore` mantém
 * todas as abas da mesma sessão coerentes sem estado duplicado.
 */
export function SoundToggle() {
  const on = useSyncExternalStore(subscribeSound, isSoundOn, () => true);

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8 shrink-0"
      aria-pressed={on}
      aria-label={on ? "Desligar sons do sistema" : "Ligar sons do sistema"}
      title={on ? "Sons ligados" : "Sons desligados"}
      onClick={() => setSoundOn(!on)}
    >
      {on ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4 text-muted-foreground" />}
    </Button>
  );
}
