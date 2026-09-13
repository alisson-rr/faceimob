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

export type SoundName = "leadNew" | "leadClaimed" | "checkin" | "rankUp" | "sale" | "goal" | "success" | "error";

type Note = { freq: number; at: number; dur: number };

/** `wave` padrão é "sine", o timbre do catálogo inteiro; só o erro troca. */
type Preset = { notes: Note[]; peak: number; wave?: OscillatorType };

/** Volume geral. Fanfarra de venda é a loja inteira ouvindo; o resto é discreto. */
const MASTER_GAIN = 0.32;

const STORAGE_KEY = "faceimob-sound";

const CATALOG: Record<SoundName, Preset> = {
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
  // Aviso de sucesso (`toast.success`): duas notas curtas subindo (sol → dó),
  // no volume mais baixo do catálogo. É o som mais frequente do app e não pode
  // competir com a fanfarra de venda.
  success: {
    notes: [
      { freq: 783.99, at: 0, dur: 0.1 },
      { freq: 1046.5, at: 0.08, dur: 0.18 },
    ],
    peak: 0.12,
  },
  // Aviso de erro (`toast.error`): duas notas descendo (sol → ré), mais graves
  // que qualquer outro som do catálogo. Triangular em vez de senoide para o
  // grave ainda aparecer em alto-falante de notebook, sem o estridente da
  // onda quadrada.
  error: {
    notes: [
      { freq: 392, at: 0, dur: 0.12 },
      { freq: 293.66, at: 0.1, dur: 0.22 },
    ],
    peak: 0.18,
    wave: "triangle",
  },
};

// ── contexto único ───────────────────────────────────────────────────────────

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
/** Canal só dos avisos (toast), para a comemoração poder abafá-los — ver `playSound`. */
let avisos: GainNode | null = null;

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
    avisos = ctx.createGain();
    avisos.connect(master);
  } catch {
    ctx = null;
    master = null;
    avisos = null;
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

// O interruptor clicado em outra aba. O evento `storage` só chega às OUTRAS
// abas da mesma origem — a que clicou já avisou os assinantes em `setSoundOn`.
// Sem isto, a TV desligada pelo gerente em outra aba continuava tocando até
// recarregar. `key === null` é `localStorage.clear()`: relê, e volta ao padrão.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    const lido = readStored();
    if (lido === enabled) return;
    enabled = lido;
    listeners.forEach((fn) => fn());
  });
}

/**
 * O contexto já saiu de `suspended` — houve gesto nesta aba. Não cria contexto:
 * perguntar não pode ser o que liga o áudio no carregamento da página.
 */
export function audioLiberado(): boolean {
  return ctx?.state === "running";
}

// ── avisos cedem a vez ───────────────────────────────────────────────────────

/**
 * Som de aviso (toast) nunca soma voz com outro som.
 *
 * É o som mais frequente e o menos importante do app, e coincide com os outros
 * por construção: `toast.error` e `toast.success` no mesmo handler, a lista de
 * "lead fora da sua mão" que dispara um erro por lead, um erro chegando junto
 * do som de lead novo. Duas regras, no relógio do AudioContext:
 *
 * 1. Aviso não toca se QUALQUER som (comemoração ou outro aviso) foi pedido e
 *    ainda não passou `RESPIRO_S` do fim dele. Todo pedido estende a janela,
 *    até o descartado: rajada toca uma vez só.
 * 2. Comemoração que começa com um aviso ainda soando abafa o aviso — os
 *    avisos passam pelo canal `avisos`, que ela zera. O som mais específico
 *    ganha.
 *
 * `manual` é o clique na prévia de sons: ali a pessoa pediu para ouvir, e a
 * janela faria o segundo clique seguido parecer botão quebrado.
 *
 * ponytail: janela fixa, sem fila nem prioridade entre avisos — o primeiro da
 * rajada é o que soa, mesmo que um erro venha logo atrás de um sucesso; evoluir
 * quando houver relato de aviso que não tocou por cair na janela de outro som.
 * A faixa de premiação (`useSomDePremiacao`, HTMLAudio) não passa por aqui: um
 * aviso durante os 7 s dela ainda soa por cima. Hoje salvar o negócio vendido
 * dá aviso neutro (mudo) e nenhum `toast.success` fala de venda; evoluir
 * quando aparecer aviso com som junto do card de venda.
 */
const AVISOS: ReadonlySet<SoundName> = new Set<SoundName>(["success", "error"]);
const RESPIRO_S = 1.2;
/** Instante (relógio do AudioContext) a partir do qual um aviso pode soar. */
let livreEm = 0;

const duracao = (preset: Preset) => Math.max(...preset.notes.map((note) => note.at + note.dur));

// ── toque ────────────────────────────────────────────────────────────────────

export function playSound(name: SoundName, { manual = false }: { manual?: boolean } = {}): void {
  if (!enabled) return;
  const preset = CATALOG[name];
  if (!preset) return;

  const audio = ensureContext();
  if (!audio || !master || !avisos) return;
  // Se o gesto de desbloqueio ainda não aconteceu, isto falha em silêncio.
  void audio.resume?.().catch(() => {});

  const agora = audio.currentTime;
  const aviso = AVISOS.has(name);
  const ocupado = agora < livreEm;
  livreEm = Math.max(livreEm, agora + duracao(preset) + RESPIRO_S);
  if (aviso && ocupado && !manual) return;

  try {
    // Aviso reabre o canal que uma comemoração possa ter zerado. Comemoração
    // abafa o aviso ainda soando por rampa curta — corte seco estala.
    avisos.gain.cancelScheduledValues(agora);
    if (aviso) avisos.gain.setValueAtTime(1, agora);
    else avisos.gain.setTargetAtTime(0, agora, 0.015);
    const saida = aviso ? avisos : master;

    for (const note of preset.notes) {
      const gain = audio.createGain();
      const start = agora + note.at;
      // Rampa exponencial não aceita zero; 0.0001 é o silêncio prático.
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(preset.peak, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + note.dur);
      gain.connect(saida);

      const osc = audio.createOscillator();
      osc.type = preset.wave ?? "sine";
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
