import { useCallback, useEffect, useRef } from "react";
import { BellRing, ListOrdered } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/contexts/AuthContext";
import { getMyQueues } from "@/integrations/supabase/checkin";
import { supabase } from "@/integrations/supabase/client";
import { playSound } from "@/lib/engagement/audio";

const POLL_MS = 60_000;
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
  const loading = useRef(false);

  const load = useCallback(async () => {
    if (!profileId || role !== "broker" || loading.current) return;
    loading.current = true;
    try {
      const queues = await getMyQueues(profileId);
      const before = previous.current ?? readPositions(profileId);
      const next: Positions = {};

      for (const queue of queues) {
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
    } catch {
      // O indicador da tela de check-in já exibe o erro com botão de tentar
      // novamente. O aviso global não cria ruído a cada minuto sem rede.
    } finally {
      loading.current = false;
    }
  }, [profileId, role]);

  useEffect(() => {
    previous.current = null;
    void load();
  }, [load]);

  useEffect(() => {
    if (!profileId || role !== "broker") return;
    const timer = setInterval(() => void load(), POLL_MS);
    const channel = supabase
      .channel(`lead-queue-notifier-${profileId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "lead_assignments" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "checkins", filter: `profile_id=eq.${profileId}` }, () => void load())
      .subscribe();
    return () => {
      clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [profileId, role, load]);

  return null;
}
