/**
 * Conversão das fotos para WebP no navegador antes do upload (trazida do painel
 * do site em 05/10/2026): originais grandes (PNG/JPG/HEIC) pesam a galeria e
 * atrasam o site; WebP com no máximo 1920px normaliza tudo.
 */

const MAX_DIMENSION = 1920;
const WEBP_QUALITY = 0.82;

export type OptimizedImage = {
  file: File;
  converted: boolean;
};

function replaceExtension(name: string, ext: string): string {
  return `${name.replace(/\.[^./\\]+$/, "")}.${ext}`;
}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    return await createImageBitmap(file);
  }
  const url = URL.createObjectURL(file);
  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode_failed")); };
    img.src = url;
  });
}

/**
 * Converte para WebP redimensionando para no máximo 1920px no maior lado,
 * preservando a proporção original. Em qualquer falha devolve o arquivo original.
 */
export async function toWebp(file: File): Promise<OptimizedImage> {
  if (!file.type.startsWith("image/") || file.type === "image/webp" || file.type === "image/svg+xml") {
    return { file, converted: false };
  }

  try {
    const bitmap = await decode(file);
    const width = "width" in bitmap ? bitmap.width : 0;
    const height = "height" in bitmap ? bitmap.height : 0;
    if (!width || !height) return { file, converted: false };

    const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
    const targetW = Math.round(width * scale);
    const targetH = Math.round(height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { file, converted: false };
    ctx.drawImage(bitmap as CanvasImageSource, 0, 0, targetW, targetH);
    if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/webp", WEBP_QUALITY),
    );
    if (!blob || blob.size === 0) return { file, converted: false };

    return {
      file: new File([blob], replaceExtension(file.name, "webp"), { type: "image/webp" }),
      converted: true,
    };
  } catch {
    return { file, converted: false };
  }
}
