// AudioWorkletProcessor untuk menangkap audio mikrofon, downsampling ke 16,000 Hz,
// dan mengonversi Float32Array ke 16-bit Linear PCM Little-Endian untuk Gemini Live API.

class GeminiAudioRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetSampleRate = 16000;
    this.bufferSize = 2048; // Buffer ukuran ~128ms pada 16kHz
    this.outputBuffer = new Int16Array(this.bufferSize);
    this.outputIndex = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const inputChannel = input[0]; // Mono channel
    const inputSampleRate = sampleRate; // Diberikan otomatis oleh AudioWorkletGlobalScope

    // Rasio downsampling
    const ratio = inputSampleRate / this.targetSampleRate;

    for (let i = 0; i < inputChannel.length; i += ratio) {
      const idx = Math.floor(i);
      const sample = Math.max(-1, Math.min(1, inputChannel[idx]));
      // Konversi -1.0..1.0 float32 ke -32768..32767 16-bit integer
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;

      this.outputBuffer[this.outputIndex++] = int16;

      if (this.outputIndex >= this.bufferSize) {
        // Kirim buffer ke main thread
        this.port.postMessage(this.outputBuffer.slice(0, this.bufferSize));
        this.outputIndex = 0;
      }
    }

    return true;
  }
}

registerProcessor("gemini-audio-recorder", GeminiAudioRecorderProcessor);
