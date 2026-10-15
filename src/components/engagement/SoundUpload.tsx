import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { soundsDb, soundsKey, useCustomSounds } from "@/hooks/useCustomSounds";
import { AUDIO_TYPES, SOUND_BUCKET, soundDuration, type SoundId } from "@/lib/engagement/customSounds";

export function SoundUpload({ id, label }: { id: SoundId; label: string }) {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const query = useCustomSounds(isAdmin);
  const saved = query.data?.find((sound) => sound.sound_id === id);
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const selection = useRef(0);
  useEffect(() => {
    if (!file) { setPreview(undefined); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  if (!isAdmin) return null;

  async function choose(next?: File) {
    const version = ++selection.current;
    setFile(undefined);
    setMessage("");
    if (!next) return;
    try {
      await soundDuration(next);
      if (version === selection.current) setFile(next);
    } catch (error) {
      if (version === selection.current) setMessage(error instanceof Error ? error.message : "Não foi possível ler o áudio.");
    }
  }

  async function save(restore = false) {
    if (!restore && !file) return;
    setBusy(true);
    setMessage("");
    let uploaded: string | undefined;
    let committed = false;
    try {
      if (restore) {
        const { error } = await soundsDb.from("system_sounds").delete().eq("sound_id", id).select("sound_id").single();
        if (error) throw error;
      } else if (file) {
        const duration = await soundDuration(file);
        const path = `${id}/${crypto.randomUUID()}.${AUDIO_TYPES[file.type]}`;
        const upload = await supabase.storage.from(SOUND_BUCKET).upload(path, file, { contentType: file.type });
        if (upload.error) throw upload.error;
        uploaded = path;
        const { error } = await soundsDb.from("system_sounds").upsert({ sound_id: id, storage_path: path, file_name: file.name.slice(0, 255), duration });
        if (error) throw error;
      }
      committed = true;
      let cleanupFailed = false;
      if (saved) {
        const cleanup = await supabase.storage.from(SOUND_BUCKET).remove([saved.storage_path]);
        cleanupFailed = Boolean(cleanup.error);
      }
      setFile(undefined);
      if (input.current) input.current.value = "";
      await queryClient.invalidateQueries({ queryKey: soundsKey });
      setMessage(cleanupFailed
        ? "Som atualizado. O arquivo antigo não pôde ser removido do armazenamento."
        : restore ? "Som padrão restaurado." : "Som salvo para toda a equipe. Outros aparelhos recebem a troca na próxima atualização automática.");
    } catch {
      if (uploaded && !committed) {
        // Uma resposta perdida pode ter confirmado a gravação no servidor.
        // ponytail: preserva arquivo em falha ambígua; limpar órfãos quando houver acúmulo no bucket.
        await queryClient.invalidateQueries({ queryKey: soundsKey });
        setMessage("O arquivo foi enviado, mas não foi possível confirmar a troca. Confira o som atual antes de tentar novamente.");
        return;
      }
      setMessage("Não foi possível salvar o som. Confira sua conexão e permissão e tente novamente.");
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      <p className="break-all text-xs text-muted-foreground">{saved ? `Personalizado: ${saved.file_name}` : "Som padrão"}</p>
      <label className="block text-xs font-medium" htmlFor={`sound-${id}`}>Enviar áudio para {label}</label>
      <input ref={input} id={`sound-${id}`} type="file" accept=".mp3,.ogg,.webm,.weba,.wav" disabled={busy || query.isPending || Boolean(query.error)}
        className="block w-full min-w-0 text-xs file:mr-2 file:rounded file:border file:border-border file:bg-muted file:p-2"
        onChange={(event) => void choose(event.target.files?.[0])} />
      {preview && <audio controls src={preview} className="h-10 w-full" aria-label={`Prévia de ${label}`} />}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!file || busy || Boolean(query.error)} onClick={() => void save()}>{busy ? "Salvando…" : "Salvar som"}</Button>
        {saved && <Button size="sm" variant="outline" disabled={busy || Boolean(query.error)} onClick={() => void save(true)}>Restaurar padrão</Button>}
      </div>
      {query.error && <p role="alert" className="text-xs text-destructive">Não foi possível carregar os sons. <button className="underline" onClick={() => void query.refetch()}>Tentar novamente</button></p>}
      {message && <p role="status" className="text-xs">{message}</p>}
    </div>
  );
}
