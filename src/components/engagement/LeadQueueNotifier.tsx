import { useEffect, useRef } from "react";
import { BellRing, ListOrdered } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useMyQueues } from "@/hooks/useMyQueues";
import { playSound } from "@/lib/engagement/audio";

const STORAGE_PREFIX = "faceimob-lead-queue-position";

type Positions = Record<string, number | null>;

function readPositions(profileId: string): Positions {
  try {
    return JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}:${profileId}`) ?? "{}") as Positions;
  } catch {
    return {};
  }
}

function savePositions(profileId: string, positions: Positions): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}:${profileId}`, JSON.stringify(positions));
  } catch {
    // Storage bloqueado: a ref mantém a comparação enquanto a aba estiver aberta.
  }
}

/** Aviso global da roleta: acompanha a posição mesmo fora da tela de Leads. */
export function LeadQueueNotifier() {
  const { user, role } = useAuth();
  const profileId = user?.id ?? null;
  const previous = useRef<Positions | null>(null);
  const queues = useMyQueues(role === "broker" ? profileId : null);

  useEffect(() => { previous.current = null; }, [profileId, role]);

  useEffect(() => {
    if (!profileId || role !== "broker" || !queues.isSuccess) return;
    const before = previous.current ?? readPositions(profileId);
    const next: Positions = {};

    for (const queue of queues.data) {
      const mine = queue.entries.find((entry) => entry.profile_id === profileId);
      const position = mine?.queue_position ?? null;
      next[queue.groupId] = position;
      if (before[queue.groupId] === position) continue;

      if (position === 1) {
        playSound("leadNew");
        toast("Fique alerta: você é o próximo a receber leads!", {
          id: `lead-queue-${queue.groupId}`,
          icon: <BellRing className="h-4 w-4 text-warning" />,
          description: `${queue.groupName}: você agora é o 1º da fila.`,
          duration: 10_000,
        });
      } else if (position) {
        toast(`Você agora é o ${position}º na fila`, {
          id: `lead-queue-${queue.groupId}`,
          icon: <ListOrdered className="h-4 w-4 text-primary" />,
          description: queue.groupName,
          duration: 7_000,
        });
      } else if (before[queue.groupId]) {
        toast("Você saiu da fila de leads", {
          id: `lead-queue-${queue.groupId}`,
          description: `${queue.groupName}: faça check-in e regularize eventuais atrasos para voltar.`,
          duration: 7_000,
        });
      }
    }

    previous.current = next;
    savePositions(profileId, next);
  }, [profileId, role, queues.data, queues.isSuccess]);

  return null;
}
