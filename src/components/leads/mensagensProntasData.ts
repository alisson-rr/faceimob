import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { dbError } from "@/lib/supabaseError";
import { primeiroNome, type MensagemPronta } from "./mensagensProntas";

// Tabela da 0192 e `profiles.nickname` (0183), ainda fora do `types.ts` gerado.
const untyped = supabase as unknown as SupabaseClient;
const CHAVE = ["leads", "mensagens-prontas"] as const;

export const useMensagensProntas = () =>
  useQuery({
    queryKey: CHAVE,
    queryFn: async (): Promise<MensagemPronta[]> => {
      const { data, error } = await untyped
        .from("mensagens_prontas")
        .select("id,titulo,texto,dono,compartilhada")
        .order("compartilhada", { ascending: false })
        .order("titulo");
      if (error) throw dbError("mensagens_prontas", error);
      return (data ?? []) as MensagemPronta[];
    },
    staleTime: 60_000,
  });

/** O apelido de quem manda a mensagem; sem apelido, o primeiro nome do cadastro. */
export function useMeuApelido(): string {
  const { user, profile } = useAuth();
  const query = useQuery({
    queryKey: ["perfil", "apelido", user?.id ?? null],
    queryFn: async () => {
      const { data, error } = await untyped.from("profiles").select("nickname").eq("id", user?.id ?? "").maybeSingle();
      if (error) throw dbError("profiles", error);
      return (data?.nickname as string | null | undefined)?.trim() || null;
    },
    enabled: Boolean(user?.id),
    staleTime: 5 * 60_000,
  });
  return query.data || primeiroNome(profile?.name) || "Faceimob";
}

export type MensagemProntaRascunho = { id?: string; titulo: string; texto: string; compartilhada: boolean };

export function useSalvarMensagemPronta() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, titulo, texto, compartilhada }: MensagemProntaRascunho) => {
      const linha = { titulo: titulo.trim(), texto: texto.trim(), compartilhada };
      const { error } = id
        ? await untyped.from("mensagens_prontas").update(linha).eq("id", id)
        : await untyped.from("mensagens_prontas").insert(linha);
      if (error) throw dbError("mensagens_prontas", error);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: CHAVE }),
  });
}

export function useExcluirMensagemPronta() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await untyped.from("mensagens_prontas").delete().eq("id", id);
      if (error) throw dbError("mensagens_prontas", error);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: CHAVE }),
  });
}
