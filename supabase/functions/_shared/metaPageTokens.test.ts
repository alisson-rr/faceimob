import { describe, expect, it } from "vitest";
import { parseMetaPageCredentials, tokenForMetaPage } from "./metaPageTokens";

describe("tokens de várias Páginas Meta", () => {
  it("lê apenas linhas válidas e não duplica page_id", () => {
    const parsed = parseMetaPageCredentials(JSON.stringify([
      { page_id: "12345", name: "Principal", access_token: "a".repeat(30) },
      { page_id: "12345", name: "Duplicada", access_token: "b".repeat(30) },
      { page_id: "abc", access_token: "c".repeat(30) },
    ]));
    expect(parsed).toEqual([{ pageId: "12345", name: "Principal", token: "a".repeat(30) }]);
  });

  it("escolhe o token pelo id do evento e não usa outra página", () => {
    const pages = parseMetaPageCredentials(JSON.stringify({ pages: [
      { page_id: "12345", access_token: "a".repeat(30) },
      { page_id: "67890", access_token: "b".repeat(30) },
    ] }));
    expect(tokenForMetaPage(pages, "67890")).toBe("b".repeat(30));
    expect(tokenForMetaPage(pages, "99999")).toBeNull();
  });
});
