import { describe, expect, it } from "vitest";
import { montarAnuncio } from "./anuncios.ts";

describe("montarAnuncio", () => {
  it("imagem: copy e arte do link_data quando o topo não traz", () => {
    expect(montarAnuncio({
      id: "120", name: "Motoboy", effective_status: "ACTIVE", campaign: { id: "9", name: "Motoboy" },
      creative: { object_story_spec: { link_data: { message: "A CAIXA FORMALIZOU SUA RENDA!", picture: "https://scontent/a.jpg" } } },
    })).toMatchObject({
      ad_id: "120", formato: "imagem", copy: "A CAIXA FORMALIZOU SUA RENDA!", imagem_meta_url: "https://scontent/a.jpg",
      campanha_nome: "Motoboy", status: "ACTIVE",
    });
  });

  it("carrossel: todas as artes na ordem, a primeira como capa", () => {
    const a = montarAnuncio({
      id: "121",
      creative: { object_story_spec: { link_data: { message: "AP Olavio", child_attachments: [
        { picture: "https://x/1.jpg" }, { picture: "https://x/2.jpg" }, { picture: "javascript:alert(1)" },
      ] } } },
    });
    expect(a?.formato).toBe("carrossel");
    expect(a?.imagens_meta).toEqual(["https://x/1.jpg", "https://x/2.jpg"]);
    expect(a?.imagem_meta_url).toBe("https://x/1.jpg");
  });

  it("vídeo: capa do vídeo e copy do video_data", () => {
    expect(montarAnuncio({
      id: "122",
      creative: { video_id: "77", thumbnail_url: "https://t/thumb.jpg", object_story_spec: { video_data: { message: "South", image_url: "https://v/capa.jpg" } } },
    })).toMatchObject({ formato: "video", copy: "South", imagem_meta_url: "https://v/capa.jpg" });
  });

  it("id inválido não vira linha", () => {
    expect(montarAnuncio({ id: "abc" })).toBeNull();
    expect(montarAnuncio({})).toBeNull();
  });
});
