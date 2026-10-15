import type { SoundName } from "./audio";

export type SoundId = SoundName | "premiacao";
export type CustomSound = { sound_id: SoundId; storage_path: string; file_name: string; duration: number };
export const SOUND_BUCKET = "system-sounds";
export const MAX_SOUND_BYTES = 2 * 1024 * 1024;
export const MAX_SOUND_SECONDS = 10;
export const AUDIO_TYPES: Record<string, string> = {
  "audio/mpeg": "mp3", "audio/ogg": "ogg", "audio/webm": "webm", "audio/wav": "wav", "audio/x-wav": "wav",
};
let urls: Partial<Record<SoundId, string>> = {};
export function setCustomSoundUrls(next: Partial<Record<SoundId, string>>) { urls = next; }
export function customSoundUrl(id: SoundId) { return urls[id]; }

export function validateSoundFile(file: File): void {
  if (!AUDIO_TYPES[file.type]) throw new Error("Escolha um áudio MP3, OGG, WebM/WEBA ou WAV.");
  if (!file.size || file.size > MAX_SOUND_BYTES) throw new Error("O áudio deve ter até 2 MB e não pode estar vazio.");
}

export function soundDuration(file: File): Promise<number> {
  validateSoundFile(file);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const finish = (error?: string) => {
      clearTimeout(timer);
      const duration = audio.duration;
      audio.onloadedmetadata = null;
      audio.onerror = null;
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
      if (error) reject(new Error(error)); else resolve(duration);
    };
    const timer = setTimeout(() => finish("Não foi possível ler este áudio. Tente outro arquivo."), 10000);
    audio.onloadedmetadata = () => finish(
      !Number.isFinite(audio.duration) || audio.duration <= 0 || audio.duration > MAX_SOUND_SECONDS
        ? "Escolha um áudio com duração de até 10 segundos." : undefined,
    );
    audio.onerror = () => finish("Formato de áudio não suportado neste navegador.");
    audio.preload = "metadata";
    audio.src = url;
  });
}
