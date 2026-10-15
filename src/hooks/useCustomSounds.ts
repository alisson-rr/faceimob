import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { preloadCustomSounds } from "@/lib/engagement/audio";
import { setCustomSoundUrls, SOUND_BUCKET, type CustomSound, type SoundId } from "@/lib/engagement/customSounds";

// Ponte local até a próxima geração dos tipos do schema.
export const soundsDb = supabase as unknown as SupabaseClient;
export const soundsKey = ["system-sounds"];
export function soundUrl(path: string) { return supabase.storage.from(SOUND_BUCKET).getPublicUrl(path).data.publicUrl; }

export function useCustomSounds(enabled = true) {
  return useQuery({
    queryKey: soundsKey,
    enabled,
    queryFn: async () => {
      const { data, error } = await soundsDb.from("system_sounds").select("sound_id,storage_path,file_name,duration");
      if (error) throw error;
      return data as CustomSound[];
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });
}

export function useLoadCustomSounds(enabled: boolean) {
  const { data } = useCustomSounds(enabled);
  useEffect(() => {
    const urls: Partial<Record<SoundId, string>> = {};
    if (enabled) for (const sound of data ?? []) urls[sound.sound_id] = soundUrl(sound.storage_path);
    setCustomSoundUrls(urls);
    void preloadCustomSounds(urls);
    return () => { setCustomSoundUrls({}); void preloadCustomSounds({}); };
  }, [data, enabled]);
}
