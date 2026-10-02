import { endOfMonth, format, startOfMonth } from "date-fns";
import type { WeekRange } from "@/integrations/supabase/game";

/** Mês do relógio local, no formato aceito pelo recorte do placar. */
export function currentMonthRange(today: Date = new Date()): WeekRange {
  return {
    from: format(startOfMonth(today), "yyyy-MM-dd"),
    to: format(endOfMonth(today), "yyyy-MM-dd"),
  };
}
