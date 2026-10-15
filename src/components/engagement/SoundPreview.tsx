import { useSyncExternalStore } from "react";
import { Play, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/shared";
import { isSoundOn, playSound, setSoundOn, subscribeSound, type SoundName } from "@/lib/engagement/audio";
import { tocarPremiacao } from "@/hooks/useSomDePremiacao";
import { SoundUpload } from "./SoundUpload";
import type { SoundId } from "@/lib/engagement/customSounds";

/** Ouvir o som vigente e administrar o arquivo sem disparar eventos do game. */
const catalogo = (name: SoundName) => () => playSound(name, { manual: true });

const SONS: { id: SoundId; label: string; quando: string; tocar: () => void }[] = [
  {
    id: "premiacao",
    label: "Música de premiação",
    quando: "Movimentação do game: subida no ranking e meta batida (quem conquistou). Trecho de 7 s.",
    tocar: () => tocarPremiacao({ manual: true }),
  },
  { id: "cashRegister", label: "Caixa registradora", quando: "Venda fechada (todos ouvem, junto do card de venda).", tocar: catalogo("cashRegister") },
  { id: "leadNew", label: "Lead novo", quando: "Lead entra na roleta.", tocar: catalogo("leadNew") },
  { id: "leadClaimed", label: "Lead travado", quando: "O corretor pega o lead e a trava começa.", tocar: catalogo("leadClaimed") },
  { id: "checkin", label: "Check-in", quando: "Presença confirmada, o corretor entra na fila.", tocar: catalogo("checkin") },
  { id: "rankUp", label: "Subiu no ranking (curto)", quando: "No lugar da música, para quem subiu.", tocar: catalogo("rankUp") },
  { id: "goal", label: "Meta batida (curto)", quando: "No lugar da música, para quem bateu a meta de VGV do mês.", tocar: catalogo("goal") },
  { id: "success", label: "Sucesso", quando: "Aviso de gravação concluída (toast de sucesso).", tocar: catalogo("success") },
  { id: "error", label: "Erro", quando: "Aviso de falha (toast de erro).", tocar: catalogo("error") },
  { id: "birthday", label: "Aniversário", quando: "Comemoração de aniversário.", tocar: catalogo("birthday") },
  { id: "sale", label: "Fanfarra curta", quando: "Alternativa curta da premiação.", tocar: catalogo("sale") },
];

export function SoundPreview() {
  const ligado = useSyncExternalStore(subscribeSound, isSoundOn, () => true);

  return (
    <SectionCard
      title="Sons do sistema"
      icon={ligado ? Volume2 : VolumeX}
      description="Envie MP3, OGG, WebM/WEBA ou WAV de até 2 MB e 10 segundos. A premiação toca até 7 segundos. Salvar altera o som para toda a equipe."
      actions={!ligado
        ? (
          <Button size="sm" variant="outline" onClick={() => setSoundOn(true)}>
            <Volume2 className="h-4 w-4" /> Ligar os sons
          </Button>
        )
        : undefined}
    >
      <p className="mb-4 text-sm text-muted-foreground">
        Baixe efeitos no <a href="https://mixkit.co/free-sound-effects/" target="_blank" rel="noopener noreferrer" className="underline">Mixkit</a> (busque notification, cash register ou success).
        {" "}Use arquivos com licença para seu uso. Os áudios enviados ficam acessíveis por link público; envie apenas efeitos sonoros.
      </p>
      {!ligado && (
        <p className="mb-3 text-sm text-warning">
          Os sons estão desligados neste navegador. Enquanto estiverem, tocar não produz áudio nenhum.
        </p>
      )}
      <ul className="grid gap-2 sm:grid-cols-2">
        {SONS.map((som) => (
          <li
            key={som.id}
            className="min-w-0 rounded-xl border border-border bg-muted/30 px-3 py-2"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{som.label}</p>
                <p className="text-xs text-muted-foreground">{som.quando}</p>
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
            </div>
            <SoundUpload id={som.id} label={som.label} />
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
