import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ClipboardPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { dbError } from "@/lib/supabaseError";

// RPC da 0187, ainda fora do `types.ts` gerado.
const untyped = supabase as unknown as SupabaseClient;

type LinkDoDaily = { team_id: string; equipe: string; slug: string };

const lerLinks = (data: unknown): LinkDoDaily[] =>
  (Array.isArray(data) ? data : []).flatMap((row) => {
    const r = (row ?? {}) as Record<string, unknown>;
    return typeof r.slug === "string" && typeof r.team_id === "string"
      ? [{ team_id: r.team_id, equipe: typeof r.equipe === "string" ? r.equipe : "Equipe", slug: r.slug }]
      : [];
  });

/**
 * "Preencher daily" no Checkpoint (pedido de 02/10/2026): o gerente e o diretor
 * não liam o link do diário (só admin), então não tinham por onde lançar. Abre
 * o diário da equipe em outra aba; o PIN continua sendo pedido lá.
 */
export function PreencherDaily() {
  const links = useQuery({
    queryKey: ["checkpoint", "meus-links-daily"],
    queryFn: async () => {
      const { data, error } = await untyped.rpc("meus_links_de_daily");
      if (error) throw dbError("meus_links_de_daily", error);
      return lerLinks(data);
    },
    staleTime: 5 * 60_000,
  });

  if (!links.data?.length) return null;
  return (
    <>
      {links.data.map((link) => (
        <Button key={link.team_id} size="sm" asChild>
          <a href={`/daily/${link.slug}`} target="_blank" rel="noopener noreferrer">
            <ClipboardPen className="h-4 w-4" aria-hidden />
            {links.data.length > 1 ? `Daily · ${link.equipe}` : "Preencher daily"}
          </a>
        </Button>
      ))}
    </>
  );
}
