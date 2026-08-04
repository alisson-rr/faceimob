import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { getLeadCounts, type LeadCounts } from "@/integrations/supabase/checkin";

/**
 * Contador de leads recebidos por período (ata 23/07).
 *
 * Conta atribuições, não leads em mãos: incluir o que passou pelo corretor e
 * saiu é o que torna o número comparável entre pessoas.
 */
export default function LeadCounter() {
  const { user } = useAuth();
  const [counts, setCounts] = useState<LeadCounts | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user?.id) return;
    try {
      setCounts(await getLeadCounts(user.id));
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`lead-counter-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "lead_assignments", filter: `profile_id=eq.${user.id}` },
        () => void load(),
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [user?.id, load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Contando leads...
      </div>
    );
  }
  if (!counts) return null;

  const items = [
    { label: "Hoje", value: counts.today },
    { label: "Semana", value: counts.week },
    { label: "Mês", value: counts.month },
  ];

  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map((i) => (
        <Card key={i.label} className="border-border/50">
          <CardContent className="p-3 text-center">
            <p className="text-[10px] uppercase text-muted-foreground tracking-wide">{i.label}</p>
            <p className="text-lg font-bold tabular-nums">{i.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
