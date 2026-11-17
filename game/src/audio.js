import { mulberry32 } from './util.js';

// Entire sound bank is synthesized locally after a browser gesture.
export class Audio {
  constructor() { this.context = null; this.muted = false; }
  unlock() {
    if (this.context) { void this.context.resume(); return; }
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    this.context = new Context();
    this.output = this.context.createGain(); this.output.gain.value = 0.32;
    this.output.connect(this.context.destination);
    this.noise = this.context.createBuffer(1, this.context.sampleRate, this.context.sampleRate);
    const samples = this.noise.getChannelData(0), rng = mulberry32(88);
    for (let i = 0; i < samples.length; i++) samples[i] = rng() * 2 - 1;
  }
  tone(frequency, duration = 0.1, gain = 0.2, type = 'sine', delay = 0, end = frequency) {
    if (!this.context || this.muted) return;
    const time = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator(), envelope = this.context.createGain();
    oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, time);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, end), time + duration);
    envelope.gain.setValueAtTime(gain, time); envelope.gain.exponentialRampToValueAtTime(0.001, time + duration);
    oscillator.connect(envelope); envelope.connect(this.output);
    oscillator.start(time); oscillator.stop(time + duration + 0.01);
  }
  hiss(duration, frequency, gain, delay = 0) {
    if (!this.context || this.muted) return;
    const time = this.context.currentTime + delay;
    const source = this.context.createBufferSource(), filter = this.context.createBiquadFilter(), envelope = this.context.createGain();
    source.buffer = this.noise; filter.type = 'lowpass'; filter.frequency.value = frequency;
    envelope.gain.setValueAtTime(gain, time); envelope.gain.exponentialRampToValueAtTime(0.001, time + duration);
    source.connect(filter); filter.connect(envelope); envelope.connect(this.output);
    source.start(time); source.stop(time + duration);
  }
  shot(id, distance) {
    const attenuation = 1 / (1 + distance * 0.09);
    const profiles = { pistol: [0.12, 2700, 170], smg: [0.08, 3500, 230], rifle: [0.16, 2100, 130], shotgun: [0.27, 1500, 95], sniper: [0.4, 1100, 75] };
    const [duration, frequency, bass] = profiles[id];
    this.hiss(duration, frequency / (1 + distance * 0.02), 0.7 * attenuation);
    this.tone(bass, duration, 0.35 * attenuation, 'triangle', 0, 38);
    this.tone(1200, 0.025, 0.05 * attenuation, 'square', 0.025, 600);
  }
  dry() { this.tone(520, 0.035, 0.12, 'square', 0, 300); }
  reload() { [0, 0.25, 0.8].forEach((delay, i) => this.hiss(0.08, 1600 + i * 700, 0.12, delay)); }
  hit(kill) { this.tone(1700, 0.06, 0.2); if (kill) this.tone(2400, 0.12, 0.2, 'sine', 0.06); }
  hurt() { this.tone(170, 0.17, 0.3, 'triangle', 0, 50); }
  step(distance = 0) { this.hiss(0.06, 600, 0.1 / (1 + distance * 0.25)); }
  beep() { this.tone(1250, 0.065, 0.12); }
  plant() { this.tone(700, 0.13); this.tone(1300, 0.12, 0.2, 'sine', 0.13); }
  explosion(distance) {
    const gain = 1 / (1 + distance * 0.06);
    this.hiss(0.9, 650, gain); this.tone(85, 0.7, gain * 0.7, 'sine', 0, 25);
  }
  bounce() { this.tone(420, 0.045, 0.14, 'triangle', 0, 210); }
  buy() { this.tone(880, 0.08); this.tone(1320, 0.12, 0.2, 'sine', 0.08); }
  denied() { this.tone(150, 0.1, 0.15, 'square'); }
  round(win) { (win ? [440, 554, 660, 880] : [440, 349, 262]).forEach((note, i) => this.tone(note, 0.3, 0.18, 'triangle', i * 0.12)); }
  stop() { if (this.context) void this.context.close(); }
}
