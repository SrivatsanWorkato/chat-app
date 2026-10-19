export type RecordingSession = {
  /** Stops the microphone and resolves with the transcript of everything recorded. */
  stop: () => Promise<string>;
};

const SAMPLE_RATE = 16_000;
const MAX_SECONDS = 300;

function pcmSample(value: number) {
  const clamped = Math.max(-1, Math.min(1, value));
  return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
}

/** 16-bit mono PCM WAV; OpenRouter's AssemblyAI endpoint accepts only wav input. */
function encodeWav(samples: Int16Array) {
  const buffer = new ArrayBuffer(44 + samples.byteLength);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => { for (let index = 0; index < text.length; index++) view.setUint8(offset + index, text.charCodeAt(index)); };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.byteLength, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples.byteLength, true);
  new Int16Array(buffer, 44).set(samples);
  return buffer;
}

export async function startRecording(): Promise<RecordingSession> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  // ScriptProcessorNode is deprecated but needs no separate worklet asset.
  const processor = context.createScriptProcessor(4096, 1, 1);
  const samples = new Int16Array(SAMPLE_RATE * MAX_SECONDS);
  let length = 0;
  const ratio = context.sampleRate / SAMPLE_RATE;

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    for (let position = 0; position < input.length && length < samples.length; position += ratio) {
      samples[length++] = pcmSample(input[Math.floor(position)]);
    }
  };
  source.connect(processor);
  processor.connect(context.destination);

  return {
    stop: async () => {
      processor.onaudioprocess = null;
      processor.disconnect();
      source.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      void context.close();
      if (length < SAMPLE_RATE / 4) return "";
      const response = await fetch("/api/voice/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: encodeWav(samples.subarray(0, length)) });
      const result = await response.json().catch(() => ({})) as { text?: string; error?: string };
      if (!response.ok || typeof result.text !== "string") throw new Error(result.error ?? "Unable to transcribe audio");
      return result.text.trim();
    },
  };
}

const SENTENCE_BOUNDARY = /[.!?]["')\]]?\s+$|\n\s*$/;

/** Splits streamed assistant text into speakable chunks so playback begins before the response finishes. */
export class SpeechQueue {
  private pending = "";
  private chunks: Promise<ArrayBuffer | null>[] = [];
  private playing = false;
  private stopped = false;
  private controller = new AbortController();
  private audio: HTMLAudioElement | null = null;
  private url: string | null = null;

  constructor(private readonly onStateChange: (speaking: boolean) => void) {}

  push(delta: string) {
    if (this.stopped) return;
    this.pending += delta;
    if (this.pending.length >= 60 && SENTENCE_BOUNDARY.test(this.pending)) this.flushPending();
    else if (this.pending.length >= 400) this.flushPending();
  }

  finish() {
    this.flushPending();
  }

  stop() {
    this.stopped = true;
    this.pending = "";
    this.chunks = [];
    this.controller.abort();
    if (this.audio) {
      this.audio.pause();
      this.audio.src = "";
      this.audio = null;
    }
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.playing = false;
    this.onStateChange(false);
  }

  private flushPending() {
    const text = this.pending.replace(/[*_`#>]/g, "").trim();
    this.pending = "";
    if (!text) return;
    const request = fetch("/api/voice/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: this.controller.signal,
    }).then((response) => response.ok ? response.arrayBuffer() : null).catch(() => null);
    this.chunks.push(request);
    void this.drain();
  }

  private async drain() {
    if (this.playing) return;
    this.playing = true;
    this.onStateChange(true);
    while (this.chunks.length && !this.stopped) {
      const buffer = await this.chunks.shift()!;
      if (!buffer || this.stopped) continue;
      await this.play(buffer);
    }
    this.playing = false;
    if (!this.stopped) this.onStateChange(false);
  }

  private play(buffer: ArrayBuffer) {
    const finished = Promise.withResolvers<void>();
    const url = URL.createObjectURL(new Blob([buffer], { type: "audio/mpeg" }));
    const audio = new Audio(url);
    this.audio = audio;
    this.url = url;
    const finish = () => {
      URL.revokeObjectURL(url);
      if (this.audio === audio) { this.audio = null; this.url = null; }
      finished.resolve();
    };
    audio.onended = finish;
    audio.onerror = finish;
    audio.play().catch(finish);
    return finished.promise;
  }
}
