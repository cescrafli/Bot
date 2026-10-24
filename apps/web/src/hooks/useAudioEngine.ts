import { useState, useRef, useCallback, useEffect } from "react";

interface UseAudioEngineOptions {
  onAudioChunk: (b64PCM16k: string) => void;
  onVolumeChange?: (rms: number) => void;
}

export function useAudioEngine({
  onAudioChunk,
  onVolumeChange,
}: UseAudioEngineOptions) {
  const [isMicActive, setIsMicActive] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0);

  // Selalu simpan referensi callback terbaru agar tidak terjebak closure usang
  const onAudioChunkRef = useRef(onAudioChunk);
  useEffect(() => {
    onAudioChunkRef.current = onAudioChunk;
  }, [onAudioChunk]);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);

  // Playback queue & analyser
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const nextPlayTimeRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Inisialisasi AudioContext (harus dipicu aksi klik pengguna)
  const getOrCreateAudioContext = useCallback(() => {
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      const AudioCtxClass =
        window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtxClass({ sampleRate: 24000 });
      audioCtxRef.current = ctx;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.3;
      analyser.connect(ctx.destination);
      analyserRef.current = analyser;
    }
    if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  // Animasi loop untuk membaca volume RMS dari AnalyserNode (untuk Lip-Sync)
  useEffect(() => {
    const dataArray = new Uint8Array(128);

    const updateVolume = () => {
      if (analyserRef.current) {
        analyserRef.current.getByteTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const norm = (dataArray[i] - 128) / 128;
          sum += norm * norm;
        }
        const rms = Math.sqrt(sum / dataArray.length);
        const normalized = Math.min(1, rms * 4.5);
        setVolume((prev) => prev * 0.4 + normalized * 0.6);
        onVolumeChange?.(normalized);
      }
      animFrameRef.current = requestAnimationFrame(updateVolume);
    };

    animFrameRef.current = requestAnimationFrame(updateVolume);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [onVolumeChange]);

  // Mengubah Int16Array PCM ke Base64
  const int16ToBase64 = (int16Array: Int16Array): string => {
    const uint8Array = new Uint8Array(
      int16Array.buffer,
      int16Array.byteOffset,
      int16Array.byteLength
    );
    let binary = "";
    const len = uint8Array.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    return btoa(binary);
  };

  // Mengubah Base64 PCM 24kHz ke AudioBuffer untuk diputar
  const base64PcmToAudioBuffer = (
    ctx: AudioContext,
    b64: string,
    sampleRate = 24000
  ): AudioBuffer => {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768.0;
    }

    const buffer = ctx.createBuffer(1, float32.length, sampleRate);
    buffer.getChannelData(0).set(float32);
    return buffer;
  };

  // Mainkan audio chunk yang datang dari Gemini
  const playAudioChunk = useCallback(
    (b64PCM24k: string) => {
      try {
        const ctx = getOrCreateAudioContext();
        const audioBuffer = base64PcmToAudioBuffer(ctx, b64PCM24k, 24000);

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;

        if (analyserRef.current) {
          source.connect(analyserRef.current);
        } else {
          source.connect(ctx.destination);
        }

        const now = ctx.currentTime;
        const startTime = Math.max(now, nextPlayTimeRef.current);
        source.start(startTime);
        nextPlayTimeRef.current = startTime + audioBuffer.duration;

        activeSourcesRef.current.push(source);
        setIsPlaying(true);

        source.onended = () => {
          activeSourcesRef.current = activeSourcesRef.current.filter(
            (s) => s !== source
          );
          if (activeSourcesRef.current.length === 0) {
            setIsPlaying(false);
          }
        };
      } catch (err) {
        console.error("Gagal memainkan chunk audio:", err);
      }
    },
    [getOrCreateAudioContext]
  );

  // Hentikan seketika saat barge-in
  const stopPlayback = useCallback(() => {
    for (const source of activeSourcesRef.current) {
      try {
        source.stop();
        source.disconnect();
      } catch {}
    }
    activeSourcesRef.current = [];
    if (audioCtxRef.current) {
      nextPlayTimeRef.current = audioCtxRef.current.currentTime;
    }
    setIsPlaying(false);
    setVolume(0);
  }, []);

  // Mulai menangkap mikrofon
  const startMic = useCallback(async () => {
    try {
      const ctx = getOrCreateAudioContext();
      await ctx.audioWorklet.addModule("/audio-processor.js");

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      micStreamRef.current = stream;

      const micSource = ctx.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(ctx, "gemini-audio-recorder");
      workletNodeRef.current = workletNode;

      workletNode.port.onmessage = (e) => {
        const pcm16k = e.data as Int16Array;
        const b64 = int16ToBase64(pcm16k);
        onAudioChunkRef.current?.(b64);
      };

      micSource.connect(workletNode);

      // Hubungkan workletNode ke destination dengan gain 0 agar browser tidak men-suspend audio thread
      const silentGain = ctx.createGain();
      silentGain.gain.value = 0;
      workletNode.connect(silentGain);
      silentGain.connect(ctx.destination);
      silentGainRef.current = silentGain;

      setIsMicActive(true);
      console.log("🎤 Mikrofon aktif dan terhubung ke AudioWorklet");
    } catch (err) {
      console.error("Gagal mengaktifkan mikrofon:", err);
      throw err;
    }
  }, [getOrCreateAudioContext]);

  // Hentikan mikrofon
  const stopMic = useCallback(() => {
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (silentGainRef.current) {
      silentGainRef.current.disconnect();
      silentGainRef.current = null;
    }
    setIsMicActive(false);
  }, []);

  return {
    isMicActive,
    isPlaying,
    volume,
    startMic,
    stopMic,
    playAudioChunk,
    stopPlayback,
  };
}
