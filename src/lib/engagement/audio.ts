/**
 * Áudio do sistema — um AudioContext para o app inteiro.
 *
 * Sem arquivo de áudio de propósito: o app roda em TV da loja e em máquina de
 * corretor, e um mp3 é mais um asset para carregar e falhar. Osciladores dão o
 * mesmo resultado com zero bytes de download.
 *
 * A versão anterior criava um `AudioContext` novo a cada toque. Contexto nasce
 * `suspended` até o primeiro gesto do usuário, e `resume()` pedido fora de um
 * gesto não vale: numa TV que ninguém toca, nenhum som saía nunca. Aqui o
 * contexto é único e é desbloqueado no primeiro `pointerdown`/`keydown` da
 * sessão — depois disso todo toque aproveita o mesmo contexto já liberado.
 *
 * Som é sempre reforço, nunca o único canal: popup, toast e card avisam
 * sozinhos. Toda falha aqui é silenciosa.
 */

export type SoundName = "leadNew" | "leadClaimed" | "checkin" | "rankUp" | "sale" | "goal";

type Note = { freq: number; at: number; dur: number };

/** Volume geral. Fanfarra de venda é a loja inteira ouvindo; o resto é discreto. */
const MASTER_GAIN = 0.32;

const STORAGE_KEY = "faceimob-sound";

const CATALOG: Record<SoundName, { notes: Note[]; peak: number }> = {
  // Dois toques curtos — lead novo na roleta.
  leadNew: {
    notes: [
      { freq: 880, at: 0, dur: 0.16 },
      { freq: 1174.66, at: 0.18, dur: 0.16 },
    ],
    peak: 0.25,
  },
  // Curto e positivo: o corretor travou o lead com ele.
  leadClaimed: {
    notes: [
      { freq: 659.25, at: 0, dur: 0.12 },
      { freq: 987.77, at: 0.1, dur: 0.2 },
    ],
    peak: 0.22,
  },
  // Uma nota só — check-in é confirmação, não festa.
  checkin: {
    notes: [{ freq: 880, at: 0, dur: 0.14 }],
    peak: 0.18,
  },
  // Arpejo curto ascendente — subiu no ranking.
  rankUp: {
    notes: [
      { freq: 659.25, at: 0, dur: 0.11 },
      { freq: 830.61, at: 0.09, dur: 0.11 },
      { freq: 987.77, at: 0.18, dur: 0.22 },
    ],
    peak: 0.24,
  },
  // Fanfarra: arpejo maior ascendente (dó-mi-sol-dó) e um acorde final.
  sale: {
    notes: [
      { freq: 523.25, at: 0.0, dur: 0.18 },
      { freq: 659.25, at: 0.12, dur: 0.18 },
      { freq: 783.99, at: 0.24, dur: 0.18 },
      { freq: 1046.5, at: 0.36, dur: 0.55 },
      { freq: 1318.51, at: 0.42, dur: 0.5 },
      { freq: 1567.98, at: 0.48, dur: 0.45 },
    ],
    peak: 0.3,
  },
  // Meta batida: a fanfarra mais um acorde sustentado no fim.
  goal: {
    notes: [
      { freq: 523.25, at: 0.0, dur: 0.18 },
      { freq: 659.25, at: 0.12, dur: 0.18 },
      { freq: 783.99, at: 0.24, dur: 0.18 },
      { freq: 1046.5, at: 0.36, dur: 0.55 },
      { freq: 1318.51, at: 0.42, dur: 0.5 },
      { freq: 1567.98, at: 0.48, dur: 0.45 },
      { freq: 523.25, at: 0.95, dur: 1.1 },
      { freq: 659.25, at: 0.95, dur: 1.1 },
      { freq: 783.99, at: 0.95, dur: 1.1 },
    ],
    peak: 0.3,
  },
};

// ── contexto único ───────────────────────────────────────────────────────────

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function ensureContext(): AudioContext | null {
  if (ctx) return ctx;
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ||
    (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = MASTER_GAIN;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
    master = null;
  }
  return ctx;
}

/** Um único par de listeners: o primeiro gesto da sessão libera o áudio. */
function unlock() {
  window.removeEventListener("pointerdown", unlock);
  window.removeEventListener("keydown", unlock);
  void ensureContext()?.resume?.().catch(() => {});
}

if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock);
}

// ── mudo, persistido ─────────────────────────────────────────────────────────

function readStored(): boolean {
  if (typeof localStorage === "undefined") return true;
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

let enabled = readStored();
const listeners = new Set<() => void>();

export function isSoundOn(): boolean {
  return enabled;
}

export function setSoundOn(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    // Modo anônimo com storage bloqueado: vale só para esta aba.
  }
  listeners.forEach((fn) => fn());
}

/** Assinatura para `useSyncExternalStore` — o toggle do header lê daqui. */
export function subscribeSound(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// ── toque ────────────────────────────────────────────────────────────────────

export function playSound(name: SoundName): void {
  if (!enabled) return;
  const preset = CATALOG[name];
  if (!preset) return;

  const audio = ensureContext();
  if (!audio || !master) return;
  // Se o gesto de desbloqueio ainda não aconteceu, isto falha em silêncio.
  void audio.resume?.().catch(() => {});

  try {
    for (const note of preset.notes) {
      const gain = audio.createGain();
      const start = audio.currentTime + note.at;
      // Rampa exponencial não aceita zero; 0.0001 é o silêncio prático.
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(preset.peak, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + note.dur);
      gain.connect(master);

      const osc = audio.createOscillator();
      osc.type = "sine";
      osc.frequency.value = note.freq;
      osc.connect(gain);
      osc.start(start);
      osc.stop(start + note.dur);
      osc.onended = () => { osc.disconnect(); gain.disconnect(); };
    }
  } catch {
    // Sem áudio disponível: segue em silêncio.
  }
}

/** Dois toques curtos — lead novo na roleta. */
export function playLeadAlert(): void {
  playSound("leadNew");
}

/** Fanfarra de venda: o som que a loja inteira deve ouvir. */
export function playSaleFanfare(): void {
  playSound("sale");
}
