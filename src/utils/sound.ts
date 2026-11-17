class PixelSoundEngine {
  private ctx: AudioContext | null = null;
  public muted = false;

  private ensureContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private tone(freq: number, duration: number, type: OscillatorType = 'square', volume = 0.07, delay = 0) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  click() {
    this.tone(520, 0.05, 'square', 0.05);
  }

  dice() {
    this.tone(240, 0.06, 'square', 0.06, 0);
    this.tone(320, 0.06, 'square', 0.06, 0.06);
    this.tone(440, 0.07, 'square', 0.06, 0.12);
    this.tone(580, 0.09, 'triangle', 0.07, 0.18);
  }

  build() {
    this.tone(190, 0.08, 'square', 0.08, 0);
    this.tone(380, 0.1, 'square', 0.07, 0.07);
  }

  trade() {
    this.tone(523.25, 0.08, 'triangle', 0.08, 0);
    this.tone(659.25, 0.08, 'triangle', 0.08, 0.07);
    this.tone(783.99, 0.14, 'triangle', 0.08, 0.14);
  }

  robber() {
    this.tone(180, 0.14, 'sawtooth', 0.07, 0);
    this.tone(130, 0.22, 'sawtooth', 0.07, 0.12);
  }

  victory() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, idx) => {
      this.tone(n, 0.18, 'square', 0.07, idx * 0.11);
    });
  }

  error() {
    this.tone(160, 0.12, 'sawtooth', 0.06, 0);
  }
}

export const soundFX = new PixelSoundEngine();
