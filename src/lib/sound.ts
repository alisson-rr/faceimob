/**
 * Sons do sistema via WebAudio.
 *
 * Sem arquivo de áudio de propósito: o app roda em TV da loja e em máquina de
 * corretor, e um mp3 é mais um asset para carregar e falhar. Osciladores dão o
 * mesmo resultado com zero bytes de download.
 *
 * Autoplay é bloqueado até o primeiro gesto do usuário — todas as funções
 * falham em silêncio nesse caso, porque o popup e o toast já avisam. Som é
 * reforço, nunca o único canal.
 */

type Note = { freq: number; at: number; dur: number };

function playNotes(notes: Note[], peakGain: number, tailMs: number) {
  try {
    const Ctor = window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    void ctx.resume?.().catch(() => {});

    for (const note of notes) {
      const gain = ctx.createGain();
      const start = ctx.currentTime + note.at;
      // Rampa exponencial não aceita zero; 0.0001 é o silêncio prático.
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peakGain, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + note.dur);
      gain.connect(ctx.destination);

      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = note.freq;
      osc.connect(gain);
      osc.start(start);
      osc.stop(start + note.dur);
    }

    setTimeout(() => void ctx.close?.().catch(() => {}), tailMs);
  } catch {
    // Sem áudio disponível: segue em silêncio.
  }
}

/** Dois toques curtos — lead novo na roleta. */
export function playLeadAlert() {
  playNotes(
    [
      { freq: 880, at: 0, dur: 0.16 },
      { freq: 1175, at: 0.18, dur: 0.16 },
    ],
    0.25,
    1200,
  );
}

/**
 * Fanfarra de venda: arpejo maior ascendente (dó-mi-sol-dó) e um acorde final.
 * Mais longo e mais alto que o alerta de lead de propósito — é o som que a loja
 * inteira deve ouvir.
 */
export function playSaleFanfare() {
  playNotes(
    [
      { freq: 523.25, at: 0.0, dur: 0.18 },
      { freq: 659.25, at: 0.12, dur: 0.18 },
      { freq: 783.99, at: 0.24, dur: 0.18 },
      { freq: 1046.5, at: 0.36, dur: 0.55 },
      { freq: 1318.5, at: 0.42, dur: 0.5 },
      { freq: 1567.98, at: 0.48, dur: 0.45 },
    ],
    0.3,
    2000,
  );
}
