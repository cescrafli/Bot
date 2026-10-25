import { useState, useRef, useCallback, useEffect } from "react";
import { analyzeHumanVoiceFrame } from "@celyn/shared";

interface UseAudioEngineOptions {
  onAudioChunk: (b64PCM16k: string) => void;
  onVolumeChange?: (rms: number) => void;
  onBargeIn?: () => void;
}

export function useAudioEngine({
  onAudioChunk,
  onVolumeChange,
  onBargeIn,
}: UseAudioEngineOptions) {
  const [isMicActive, setIsMicActive] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0);

  const isPlayingRef = useRef(false);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // Selalu simpan referensi callback terbaru agar tidak terjebak closure usang
  const onAudioChunkRef = useRef(onAudioChunk);
  useEffect(() => {
    onAudioChunkRef.current = onAudioChunk;
  }, [onAudioChunk]);

  const onBargeInRef = useRef(onBargeIn);
  useEffect(() => {
    onBargeInRef.current = onBargeIn;
  }, [onBargeIn]);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletLoadedRef = useRef<boolean>(false);
  const micStreamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const highPassFilterRef = useRef<BiquadFilterNode | null>(null);
  const lowPassFilterRef = useRef<BiquadFilterNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const bargeInStreakRef = useRef<number>(0);

  // Human-Voice VAD & Gumaman ("Hmmm / Aaa") Gate State
  const noiseFloorRef = useRef<number>(0.008);
  const preRollBufferRef = useRef<Int16Array[]>([]);
  const voiceHangoverFramesRef = useRef<number>(0);
  const isGateOpenRef = useRef<boolean>(false);

  // Playback queue & analyser
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const nextPlayTimeRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const lastVolumeRef = useRef<number>(0);
  const playbackEpochRef = useRef<number>(0);
  const decodeChainRef = useRef<Promise<void>>(Promise.resolve());

  // Inisialisasi AudioContext (menggunakan sample rate native perangkat keras sistem)
  const getOrCreateAudioContext = useCallback(() => {
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      const AudioCtxClass =
        window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtxClass();
      audioCtxRef.current = ctx;

      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(1, ctx.currentTime);
      masterGain.connect(ctx.destination);
      masterGainRef.current = masterGain;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.25;
      analyser.connect(masterGain);
      analyserRef.current = analyser;
    }
    if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  // Animasi loop untuk membaca volume RMS dari AnalyserNode (untuk Lip-Sync)
  // Dilengkapi Deadband Filter untuk mencegah 60 FPS re-render berlebihan saat hening
  useEffect(() => {
    const dataArray = new Uint8Array(128);

    const updateVolume = () => {
      // Saat tidak memutar suara Celyn, kunci volume ke 0 tanpa trigger re-render
      if (!isPlayingRef.current) {
        if (lastVolumeRef.current !== 0) {
          lastVolumeRef.current = 0;
          setVolume(0);
          onVolumeChange?.(0);
        }
        animFrameRef.current = requestAnimationFrame(updateVolume);
        return;
      }

      if (analyserRef.current) {
        analyserRef.current.getByteTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const norm = (dataArray[i] - 128) / 128;
          sum += norm * norm;
        }
        const rms = Math.sqrt(sum / dataArray.length);
        const rawNormalized = Math.min(1, rms * 4.5);
        const filtered = rawNormalized < 0.02 ? 0 : rawNormalized;

        // Asymmetric attack/release envelope: mulut terbuka cepat (0.75), menutup luwes (0.40)
        const isRising = filtered > lastVolumeRef.current;
        const alpha = isRising ? 0.75 : 0.40;
        const smoothed = lastVolumeRef.current * (1 - alpha) + filtered * alpha;

        // Deadband Filter: hanya panggil setVolume jika perubahan > 0.012 atau turun ke 0
        if (
          Math.abs(smoothed - lastVolumeRef.current) > 0.012 ||
          (smoothed === 0 && lastVolumeRef.current > 0)
        ) {
          lastVolumeRef.current = smoothed;
          setVolume(smoothed);
          onVolumeChange?.(smoothed);
        }
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

  // Mengubah Base64 PCM 24kHz (16-bit Little-Endian) ke AudioBuffer untuk diputar
  const base64PcmToAudioBuffer = (
    ctx: AudioContext,
    b64: string,
    sampleRate = 24000
  ): AudioBuffer => {
    const binary = atob(b64);
    const numSamples = Math.floor(binary.length / 2);
    if (numSamples === 0) {
      return ctx.createBuffer(1, 1, sampleRate);
    }

    const float32 = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      const byte1 = binary.charCodeAt(i * 2);
      const byte2 = binary.charCodeAt(i * 2 + 1);
      let val = byte1 | (byte2 << 8);
      if (val >= 0x8000) val -= 0x10000;
      float32[i] = val / 32768.0;
    }

    const buffer = ctx.createBuffer(1, float32.length, sampleRate);
    buffer.getChannelData(0).set(float32);
    return buffer;
  };

  // Jadwalkan AudioBuffer ke antrean pemutaran gapless & AnalyserNode Lip-Sync
  const scheduleAudioBuffer = useCallback(
    (ctx: AudioContext, audioBuffer: AudioBuffer) => {
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;

      if (analyserRef.current) {
        source.connect(analyserRef.current);
      } else {
        source.connect(ctx.destination);
      }

      const now = ctx.currentTime;
      // Berikan natural breathing gap (140ms) jika menyambung dari audio sebelumnya
      const hasPriorAudio = nextPlayTimeRef.current > now;
      const startTime = hasPriorAudio ? nextPlayTimeRef.current + 0.14 : now;
      source.start(startTime);
      nextPlayTimeRef.current = startTime + audioBuffer.duration;

      activeSourcesRef.current.push(source);
      setIsPlaying(true);
      isPlayingRef.current = true;

      source.onended = () => {
        activeSourcesRef.current = activeSourcesRef.current.filter(
          (s) => s !== source
        );
        if (activeSourcesRef.current.length === 0) {
          setIsPlaying(false);
          isPlayingRef.current = false;
        }
      };
    },
    []
  );

  // Mainkan audio chunk (mendukung MP3 dari Microsoft Edge Neural id-ID-GadisNeural maupun PCM 24kHz)
  const playAudioChunk = useCallback(
    (b64Audio: string, mimeType?: string) => {
      try {
        const ctx = getOrCreateAudioContext();
        if (ctx.state === "suspended") {
          ctx.resume();
        }

        const isMp3 =
          mimeType?.includes("mp3") ||
          mimeType?.includes("mpeg") ||
          (!mimeType &&
            (b64Audio.startsWith("//") ||
              b64Audio.startsWith("SUQz") ||
              b64Audio.startsWith("/+")));

        if (isMp3) {
          const epochAtEnqueue = playbackEpochRef.current;
          decodeChainRef.current = decodeChainRef.current
            .then(async () => {
              if (epochAtEnqueue !== playbackEpochRef.current) return;
              const binary = atob(b64Audio);
              const bytes = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
              }
              const decodedBuffer = await ctx.decodeAudioData(
                bytes.buffer.slice(0)
              );
              if (epochAtEnqueue !== playbackEpochRef.current) return;
              scheduleAudioBuffer(ctx, decodedBuffer);
            })
            .catch((err) => {
              console.error("Gagal men-decode audio MP3 GadisNeural:", err);
            });
          return;
        }

        const audioBuffer = base64PcmToAudioBuffer(ctx, b64Audio, 24000);
        scheduleAudioBuffer(ctx, audioBuffer);
      } catch (err) {
        console.error("Gagal memainkan chunk audio:", err);
      }
    },
    [getOrCreateAudioContext, scheduleAudioBuffer]
  );

  // Hentikan seketika saat barge-in dengan micro-fade untuk mencegah klik/pop
  const stopPlayback = useCallback(() => {
    playbackEpochRef.current++;

    if (audioCtxRef.current && masterGainRef.current) {
      const now = audioCtxRef.current.currentTime;
      try {
        masterGainRef.current.gain.cancelScheduledValues(now);
        masterGainRef.current.gain.setValueAtTime(masterGainRef.current.gain.value, now);
        masterGainRef.current.gain.linearRampToValueAtTime(0, now + 0.035);
      } catch {}
    }

    setTimeout(() => {
      for (const source of activeSourcesRef.current) {
        try {
          source.stop();
          source.disconnect();
        } catch {}
      }
      activeSourcesRef.current = [];
      if (audioCtxRef.current && masterGainRef.current) {
        try {
          masterGainRef.current.gain.setValueAtTime(1, audioCtxRef.current.currentTime);
        } catch {}
      }
    }, 40);

    if (audioCtxRef.current) {
      nextPlayTimeRef.current = audioCtxRef.current.currentTime;
    }
    setIsPlaying(false);
    isPlayingRef.current = false;
    setVolume(0);
  }, []);

  // Mulai menangkap mikrofon
  const startMic = useCallback(async () => {
    try {
      const ctx = getOrCreateAudioContext();
      if (!workletLoadedRef.current) {
        await ctx.audioWorklet.addModule("/audio-processor.js");
        workletLoadedRef.current = true;
      }

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

      // Rantai filter frekuensi pita suara manusia (90 Hz HPF + 3600 Hz LPF)
      // Menghilangkan dengung AC/kipas angin (<90 Hz) dan klik mouse/keyboard (>3600 Hz)
      const highPass = ctx.createBiquadFilter();
      highPass.type = "highpass";
      highPass.frequency.value = 90;
      highPass.Q.value = 0.707;
      highPassFilterRef.current = highPass;

      const lowPass = ctx.createBiquadFilter();
      lowPass.type = "lowpass";
      lowPass.frequency.value = 3600;
      lowPass.Q.value = 0.707;
      lowPassFilterRef.current = lowPass;

      const workletNode = new AudioWorkletNode(ctx, "gemini-audio-recorder");
      workletNodeRef.current = workletNode;

      workletNode.port.onmessage = (e) => {
        const pcm16k = e.data as Int16Array;
        const analysis = analyzeHumanVoiceFrame(pcm16k, noiseFloorRef.current);

        // Update noise floor secara adaptif saat hening/background noise ruangan
        if (!analysis.isHumanVoice && analysis.rms < 0.02) {
          noiseFloorRef.current = noiseFloorRef.current * 0.95 + analysis.rms * 0.05;
        }

        // =========================================================================
        // 1. SMART BARGE-IN (Saat Celyn sedang berbicara)
        // Hanya bisa dipotong oleh suara bicara manusia / gumaman aktif, bukan klik/batuk
        // =========================================================================
        if (isPlayingRef.current) {
          if (analysis.isHumanVoice && analysis.rms > 0.085) {
            bargeInStreakRef.current++;
            // Jika pengguna berbicara kontinu selama 3 paket berturut-turut (~384ms), picu barge-in
            if (bargeInStreakRef.current >= 3) {
              console.log("⚡ [Smart Barge-In] Suara manusia memotong Celyn terdeteksi!");
              stopPlayback();
              bargeInStreakRef.current = 0;
              onBargeInRef.current?.();
              const b64 = int16ToBase64(pcm16k);
              onAudioChunkRef.current?.(b64);
            }
          } else {
            bargeInStreakRef.current = 0;
          }
          return;
        }

        // =========================================================================
        // 2. LISTENING MODE (Saat Celyn mendengarkan pengguna)
        // Tidak sensitif terhadap bising, hanya aktif jika ada orang bicara / gumaman "hmmm" / "aaa"
        // =========================================================================
        bargeInStreakRef.current = 0;

        if (analysis.isHumanVoice || analysis.isSustainedVocal) {
          // Gerbang terbuka: jika baru aktif, flush pre-roll buffer (256ms) agar awalan kata tidak hilang
          if (!isGateOpenRef.current) {
            isGateOpenRef.current = true;
            for (const preRoll of preRollBufferRef.current) {
              onAudioChunkRef.current?.(int16ToBase64(preRoll));
            }
            preRollBufferRef.current = [];
          }
          voiceHangoverFramesRef.current = 7; // Tahan gerbang tetap terbuka ~896ms
          onAudioChunkRef.current?.(int16ToBase64(pcm16k));
        } else if (voiceHangoverFramesRef.current > 0) {
          // Hangover tail: menjaga gumaman lambat ("hmmm... aaa...") dan jeda mikro antar-kata
          voiceHangoverFramesRef.current--;
          onAudioChunkRef.current?.(int16ToBase64(pcm16k));
        } else {
          // Gerbang tertutup: tidak ada orang berbicara (hanya kebisingan ruangan/kipas/klik)
          if (isGateOpenRef.current) {
            isGateOpenRef.current = false;
          }
          // Simpan ke ring buffer pre-roll (maksimal 2 frame = 256ms)
          preRollBufferRef.current.push(pcm16k);
          if (preRollBufferRef.current.length > 2) {
            preRollBufferRef.current.shift();
          }
          // Kirim frame hening (digital silence) agar Gemini Live tetap sync tanpa terpicu bising
          const silence = new Int16Array(pcm16k.length);
          onAudioChunkRef.current?.(int16ToBase64(silence));
        }
      };

      // Sambungkan rantai filter: mic -> HPF -> LPF -> workletNode
      micSource.connect(highPass);
      highPass.connect(lowPass);
      lowPass.connect(workletNode);

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
  }, [getOrCreateAudioContext, stopPlayback]);

  // Hentikan mikrofon
  const stopMic = useCallback(() => {
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }
    if (highPassFilterRef.current) {
      highPassFilterRef.current.disconnect();
      highPassFilterRef.current = null;
    }
    if (lowPassFilterRef.current) {
      lowPassFilterRef.current.disconnect();
      lowPassFilterRef.current = null;
    }
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (silentGainRef.current) {
      silentGainRef.current.disconnect();
      silentGainRef.current = null;
    }
    preRollBufferRef.current = [];
    voiceHangoverFramesRef.current = 0;
    bargeInStreakRef.current = 0;
    isGateOpenRef.current = false;
    setIsMicActive(false);
  }, []);

  // Fitur Tes Bicara & Lip-Sync Mandiri (Memutar rekaman suara asli Celyn dari Gemini)
  const triggerTestSpeech = useCallback(async () => {
    try {
      // Hentikan pemutaran sebelumnya jika sedang ada suara
      stopPlayback();

      const ctx = getOrCreateAudioContext();
      if (ctx.state === "suspended") {
        await ctx.resume();
      }

      console.log("🔊 Memutar audio tes GadisNeural (/celyn_test_greeting.mp3)...");
      const res = await fetch("/celyn_test_greeting.mp3");
      const arrayBuffer = await res.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;

      if (analyserRef.current) {
        source.connect(analyserRef.current);
      } else {
        source.connect(ctx.destination);
      }

      activeSourcesRef.current.push(source);
      source.start();
      setIsPlaying(true);
      isPlayingRef.current = true;

      source.onended = () => {
        activeSourcesRef.current = activeSourcesRef.current.filter((s) => s !== source);
        if (activeSourcesRef.current.length === 0) {
          setIsPlaying(false);
          isPlayingRef.current = false;
        }
        console.log("✅ Tes audio Celyn selesai.");
      };
    } catch (err) {
      console.error("Gagal memutar tes audio:", err);
      setIsPlaying(false);
      isPlayingRef.current = false;
    }
  }, [getOrCreateAudioContext, stopPlayback]);

  // Pembersihan resource audio saat hook di-unmount
  useEffect(() => {
    return () => {
      stopPlayback();
      stopMic();
      if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
        try {
          audioCtxRef.current.close();
        } catch {}
        audioCtxRef.current = null;
      }
    };
  }, [stopPlayback, stopMic]);

  return {
    isMicActive,
    isPlaying,
    volume,
    startMic,
    stopMic,
    playAudioChunk,
    stopPlayback,
    triggerTestSpeech,
  };
}
