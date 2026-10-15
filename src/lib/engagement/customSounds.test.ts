import { describe, expect, it } from "vitest";
import { validateSoundFile, MAX_SOUND_BYTES, customSoundUrl, setCustomSoundUrls } from "./customSounds";

describe("upload de sons", () => {
  it("aceita áudio e recusa tipo diferente, vazio ou acima do limite", () => {
    expect(() => validateSoundFile(new File(["mp3"], "som.mp3", { type: "audio/mpeg" }))).not.toThrow();
    expect(() => validateSoundFile(new File(["<svg>"], "som.mp3", { type: "image/svg+xml" }))).toThrow();
    expect(() => validateSoundFile(new File([], "som.mp3", { type: "audio/mpeg" }))).toThrow();
    expect(() => validateSoundFile(new File([new Uint8Array(MAX_SOUND_BYTES + 1)], "som.mp3", { type: "audio/mpeg" }))).toThrow();
  });
  it("restaurar padrão remove a URL anterior", () => {
    setCustomSoundUrls({ checkin: "https://example.com/som.mp3" });
    expect(customSoundUrl("checkin")).toContain("som.mp3");
    setCustomSoundUrls({});
    expect(customSoundUrl("checkin")).toBeUndefined();
  });
});
