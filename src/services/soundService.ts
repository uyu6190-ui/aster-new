
/**
 * Simple Web Audio API sound synthesizer to avoid external asset dependency
 */
export type InstrumentType = 'piano' | 'marimba' | 'celestial';

class SoundService {
  private audioCtx: AudioContext | null = null;
  private currentInstrument: InstrumentType = 'marimba';
  private ttsSynth = typeof window !== 'undefined' ? window.speechSynthesis : null;

  public async resume() {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }
    return this.audioCtx.state === 'running';
  }

  private init() {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(console.error);
    }
  }

  public speak(text: string, lang: string = 'en-GB', rate: number = 1.0): Promise<void> {
    return new Promise((resolve) => {
      if (!this.ttsSynth) return resolve();
      this.ttsSynth.cancel(); 

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = rate;
      utterance.lang = lang;

      // Selection Strategy
      const voices = this.ttsSynth.getVoices();
      let targetVoice: SpeechSynthesisVoice | undefined;
      
      const isGB = lang.includes('GB');
      const isFinnish = lang.includes('fi');
      
      if (isFinnish) {
        // Prioritize Finnish voices
        const fiVoices = voices.filter(v => v.lang.includes('fi'));
        targetVoice = fiVoices[0];
      } else if (isGB) {
        // Prioritize British Male
        const britishVoices = voices.filter(v => v.lang.includes('GB'));
        targetVoice = britishVoices.find(v => 
          v.name.toLowerCase().includes('male') || 
          v.name.includes('Daniel') || 
          v.name.includes('Oliver') ||
          v.name.includes('Google UK English Male')
        );
        
        if (!targetVoice && britishVoices.length > 0) {
          targetVoice = britishVoices[0];
        }
      } else {
        targetVoice = voices.find(v => v.lang.includes(lang));
      }

      if (targetVoice) {
        utterance.voice = targetVoice;
      }

      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      this.ttsSynth.speak(utterance);
    });
  }

  public stopSpeaking() {
    if (this.ttsSynth) this.ttsSynth.cancel();
  }

  public setInstrument(type: InstrumentType) {
    this.currentInstrument = type;
  }

  public getInstrument(): InstrumentType {
    return this.currentInstrument;
  }

  playTap() {
    this.init();
    if (!this.audioCtx || this.audioCtx.state !== 'running') {
      this.resume();
    }

    const now = this.audioCtx!.currentTime;
    
    // Tiny acoustic click
    const osc = this.audioCtx!.createOscillator();
    const gain = this.audioCtx!.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.02);

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.02);

    const filter = this.audioCtx!.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(2000, now);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.audioCtx!.destination);

    osc.start(now);
    osc.stop(now + 0.02);
  }

  private playPiano(freq: number, delay: number, duration: number, volume: number = 0.3) {
    const now = this.audioCtx!.currentTime + delay;
    
    // Impact
    const noiseGain = this.audioCtx!.createGain();
    const noiseBuffer = this.audioCtx!.createBuffer(1, this.audioCtx!.sampleRate * 0.05, this.audioCtx!.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;
    
    const noiseSource = this.audioCtx!.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    const noiseFilter = this.audioCtx!.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(1000, now);
    noiseGain.gain.setValueAtTime(volume * 0.4, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
    
    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.audioCtx!.destination);
    noiseSource.start(now);

    // Body
    const lowPass = this.audioCtx!.createBiquadFilter();
    lowPass.type = 'lowpass';
    lowPass.frequency.setValueAtTime(freq * 4, now);
    lowPass.frequency.exponentialRampToValueAtTime(freq * 1.5, now + duration);
    
    const groupGain = this.audioCtx!.createGain();
    groupGain.gain.setValueAtTime(0, now);
    groupGain.gain.linearRampToValueAtTime(volume, now + 0.005);
    groupGain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    
    [0, 2, -2].forEach(detune => {
      const osc = this.audioCtx!.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);
      osc.detune.setValueAtTime(detune, now);
      
      [2.001, 3.004].forEach((mult, i) => {
        const overtone = this.audioCtx!.createOscillator();
        const overGain = this.audioCtx!.createGain();
        overtone.type = 'sine';
        overtone.frequency.setValueAtTime(freq * mult, now);
        overGain.gain.setValueAtTime(volume / (i + 3), now);
        overGain.gain.exponentialRampToValueAtTime(0.001, now + duration / (i + 2));
        overtone.connect(overGain);
        overGain.connect(lowPass);
        overtone.start(now);
        overtone.stop(now + duration);
      });

      osc.connect(lowPass);
      osc.start(now);
      osc.stop(now + duration);
    });
    
    lowPass.connect(groupGain);
    groupGain.connect(this.audioCtx!.destination);
  }

  private playMarimba(freq: number, delay: number, duration: number, volume: number = 0.3) {
    const now = this.audioCtx!.currentTime + delay;
    
    // Hard Mallet hit
    const malletGain = this.audioCtx!.createGain();
    malletGain.gain.setValueAtTime(volume, now);
    malletGain.gain.exponentialRampToValueAtTime(0.001, now + 0.015);
    const malletOsc = this.audioCtx!.createOscillator();
    malletOsc.type = 'sine';
    malletOsc.frequency.setValueAtTime(freq * 3.9, now); // Wooden strike overtone
    malletOsc.connect(malletGain);
    malletGain.connect(this.audioCtx!.destination);
    malletOsc.start(now);
    malletOsc.stop(now + 0.015);

    // Rosewood Bar resonance
    const gain = this.audioCtx!.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    // Pure Sine + subtle overtones
    [1, 3.9, 9.2].forEach((mult, i) => {
      const osc = this.audioCtx!.createOscillator();
      const oGain = this.audioCtx!.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq * mult, now);
      oGain.gain.setValueAtTime(volume / (i * 2 + 1), now);
      oGain.gain.exponentialRampToValueAtTime(0.001, now + duration / (i * 3 + 1));
      osc.connect(oGain);
      oGain.connect(this.audioCtx!.destination);
      osc.start(now);
      osc.stop(now + duration);
    });
  }

  private playCelestial(freq: number, delay: number, duration: number, volume: number = 0.3) {
    const now = this.audioCtx!.currentTime + delay;
    
    // Glassy attack
    const gain = this.audioCtx!.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    // Pure harmonic series with sine waves
    [1, 2, 3, 4, 5, 8].forEach((mult, i) => {
      const osc = this.audioCtx!.createOscillator();
      const oGain = this.audioCtx!.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq * mult, now);
      oGain.gain.setValueAtTime(volume / (i + 1), now);
      oGain.gain.exponentialRampToValueAtTime(0.001, now + duration / (i + 1));
      osc.connect(oGain);
      oGain.connect(gain);
      osc.start(now);
      osc.stop(now + duration);
    });

    gain.connect(this.audioCtx!.destination);
  }

  private playNote(freq: number, delay: number, duration: number, volume: number = 0.3) {
    switch (this.currentInstrument) {
      case 'marimba':
        this.playMarimba(freq, delay, duration, volume);
        break;
      case 'celestial':
        this.playCelestial(freq, delay, duration, volume);
        break;
      case 'piano':
      default:
        this.playPiano(freq, delay, duration, volume);
        break;
    }
  }

  playSuccess() {
    this.init();
    if (!this.audioCtx || this.audioCtx.state !== 'running') this.resume();

    // D6 (Re) note
    this.playNote(1174.66, 0, 1.5, 0.35);   
  }

  playReview(diff: string) {
    this.init();
    if (!this.audioCtx || this.audioCtx.state !== 'running') this.resume();

    if (diff === 'again') {
      [0, 0.08].forEach(delay => {
        this.playNote(220, delay, 0.6, 0.4); 
      });
    } else if (diff === 'hard') {
      this.playTap();
    } else if (diff === 'good') {
      this.playSuccess();
    } else if (diff === 'easy') {
      this.playNote(1046.50, 0, 1.0, 0.25);   
      this.playNote(1318.51, 0.04, 1.0, 0.2); 
      this.playNote(1567.98, 0.08, 1.0, 0.2); 
      this.playNote(2093.00, 0.12, 1.0, 0.2); 
    }
  }

  playPuppy() {
    this.init();
    if (!this.audioCtx || this.audioCtx.state !== 'running') this.resume();

    const now = this.audioCtx!.currentTime;
    [0, 0.15].forEach(delay => {
      const osc = this.audioCtx!.createOscillator();
      const gain = this.audioCtx!.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1200, now + delay);
      osc.frequency.exponentialRampToValueAtTime(1600, now + delay + 0.03);
      osc.frequency.exponentialRampToValueAtTime(1000, now + delay + 0.08);
      gain.gain.setValueAtTime(0, now + delay);
      gain.gain.linearRampToValueAtTime(0.2, now + delay + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.1);
      osc.connect(gain);
      gain.connect(this.audioCtx!.destination);
      osc.start(now + delay);
      osc.stop(now + delay + 0.1);
    });
  }
}

export const soundService = new SoundService();
