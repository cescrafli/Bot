// AudioWorkletProcessor untuk menangkap audio mikrofon, downsampling ke 16,000 Hz,
// dan mengonversi Float32Array ke 16-bit Linear PCM Little-Endian untuk Gemini Live API.

class GeminiAudioRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetSampleRate = 16000;
    this.bufferSize = 1024; // Buffer ukuran 64ms pada 16kHz (Ultra-low latency)
    this.outputBuffer = new Int16Array(this.bufferSize);
    this.outputIndex = 0;
    this.phaseOffset = 0; // Akumulator kontinuitas fase antar blok
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const inputChannel = input[0]; // Mono channel
    const inputSampleRate = sampleRate; // Disediakan oleh AudioWorkletGlobalScope

    // Rasio downsampling (dengan fallback aman untuk variasi sample rate hardware)
    const ratio = Math.max(0.5, inputSampleRate / this.targetSampleRate);

    let i = Math.max(0, this.phaseOffset);
    while (i < inputChannel.length) {
      const startIdx = Math.floor(i);
      const nextI = i + ratio;
      const endIdx = Math.min(inputChannel.length, Math.floor(nextI));

      // Box-car averaging untuk anti-aliasing frekuensi tinggi
      let sum = 0;
      let count = 0;
      for (let j = startIdx; j < endIdx; j++) {
        sum += inputChannel[j];
        count++;
      }
      const sampleVal = count > 0 ? sum / count : inputChannel[startIdx] || 0;
      const sample = Math.max(-1, Math.min(1, sampleVal));

      // Konversi Float32 (-1.0 s/d 1.0) ke Int16 (-32768 s/d 32767)
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      this.outputBuffer[this.outputIndex++] = int16;

      if (this.outputIndex >= this.bufferSize) {
        this.port.postMessage(this.outputBuffer.slice(0, this.bufferSize));
        this.outputIndex = 0;
      }

      i = nextI;
    }

    // Simpan sisa desimal fase untuk blok berikutnya
    this.phaseOffset = Math.max(0, i - inputChannel.length);
    return true;
  }
}

registerProcessor("gemini-audio-recorder", GeminiAudioRecorderProcessor);
