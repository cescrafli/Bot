import { useState, useRef, useCallback, useEffect } from "react";

interface UseScreenCaptureOptions {
  onFrame: (b64JPEG: string) => void;
  fps?: number; // default 1 FPS
}

export interface ScreenCaptureStats {
  framesCaptured: number;
  framesSent: number;
  framesSkipped: number;
  savingsPercentage: number;
}

export function useScreenCapture({ onFrame, fps = 1 }: UseScreenCaptureOptions) {
  const [isSharing, setIsSharing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<ScreenCaptureStats>({
    framesCaptured: 0,
    framesSent: 0,
    framesSkipped: 0,
    savingsPercentage: 0,
  });

  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const intervalRef = useRef<number | null>(null);

  // Canvas untuk deteksi perubahan cepat (32x32 thumbnail)
  const diffCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Canvas untuk render frame beresolusi optimal (maks 1024px)
  const sendCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const prevThumbRef = useRef<Uint8ClampedArray | null>(null);

  // Counters ref untuk menghindari re-render berlebihan di loop 1 FPS
  const countersRef = useRef({
    captured: 0,
    sent: 0,
    skipped: 0,
  });

  const stopScreenShare = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current = null;
    }
    prevThumbRef.current = null;
    setIsSharing(false);
    setIsPaused(false);
  }, []);

  const captureFrame = useCallback(() => {
    if (isPaused) return;

    const video = videoRef.current;
    if (!video || video.readyState < 2) return;

    countersRef.current.captured++;

    if (!diffCanvasRef.current) {
      diffCanvasRef.current = document.createElement("canvas");
      diffCanvasRef.current.width = 32;
      diffCanvasRef.current.height = 32;
    }
    if (!sendCanvasRef.current) {
      sendCanvasRef.current = document.createElement("canvas");
    }

    const diffCanvas = diffCanvasRef.current;
    const diffCtx = diffCanvas.getContext("2d", { willReadFrequently: true });
    if (!diffCtx) return;

    // 1. Gambar thumbnail 32x32 untuk diff check cepat
    diffCtx.drawImage(video, 0, 0, 32, 32);
    const currThumb = diffCtx.getImageData(0, 0, 32, 32).data;

    let diffPixels = 0;
    if (prevThumbRef.current) {
      for (let i = 0; i < currThumb.length; i += 4) {
        const delta =
          Math.abs(currThumb[i] - prevThumbRef.current[i]) +
          Math.abs(currThumb[i + 1] - prevThumbRef.current[i + 1]) +
          Math.abs(currThumb[i + 2] - prevThumbRef.current[i + 2]);
        if (delta > 35) diffPixels++;
      }
    }

    // Hanya kirim jika frame pertama atau perbedaan > 2.5% dari thumbnail (25 px)
    const hasChanged = !prevThumbRef.current || diffPixels > 25;

    if (!hasChanged) {
      countersRef.current.skipped++;
      const total = countersRef.current.captured;
      const savings = total > 0 ? Math.round((countersRef.current.skipped / total) * 100) : 0;
      setStats({
        framesCaptured: countersRef.current.captured,
        framesSent: countersRef.current.sent,
        framesSkipped: countersRef.current.skipped,
        savingsPercentage: savings,
      });
      return; // Layar statis: simpan bandwidth dan token!
    }

    countersRef.current.sent++;
    prevThumbRef.current = new Uint8ClampedArray(currThumb);

    const total = countersRef.current.captured;
    const savings = total > 0 ? Math.round((countersRef.current.skipped / total) * 100) : 0;
    setStats({
      framesCaptured: countersRef.current.captured,
      framesSent: countersRef.current.sent,
      framesSkipped: countersRef.current.skipped,
      savingsPercentage: savings,
    });

    // 2. Skala ke maks 1024px untuk dikirim ke Gemini
    const maxDim = 1024;
    const scale = Math.min(
      1,
      maxDim / Math.max(video.videoWidth, video.videoHeight)
    );
    const sendCanvas = sendCanvasRef.current;
    sendCanvas.width = Math.round(video.videoWidth * scale);
    sendCanvas.height = Math.round(video.videoHeight * scale);

    const sendCtx = sendCanvas.getContext("2d");
    if (!sendCtx) return;

    sendCtx.drawImage(video, 0, 0, sendCanvas.width, sendCanvas.height);

    // Format JPEG kualitas 0.65 optimal
    const dataUrl = sendCanvas.toDataURL("image/jpeg", 0.65);
    const b64 = dataUrl.split(",")[1];
    if (b64) {
      onFrame(b64);
    }
  }, [isPaused, onFrame]);

  const startScreenShare = useCallback(async () => {
    try {
      setError(null);
      countersRef.current = { captured: 0, sent: 0, skipped: 0 };

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: "browser",
        },
        audio: false,
      });

      streamRef.current = stream;

      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();
      videoRef.current = video;

      // Event saat pengguna menekan "Stop sharing" bawaan browser
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          stopScreenShare();
        };
      }

      setIsSharing(true);
      setIsPaused(false);

      // Tangkap frame pertama setelah video siap
      setTimeout(captureFrame, 250);

      // Mulai timer 1 FPS
      intervalRef.current = window.setInterval(captureFrame, 1000 / fps);
    } catch (err: any) {
      console.warn("Screen share dibatalkan atau ditolak:", err);
      if (err.name !== "NotAllowedError") {
        setError(err.message || "Gagal memulai screen share");
      }
      stopScreenShare();
    }
  }, [fps, captureFrame, stopScreenShare]);

  const togglePause = useCallback(() => {
    setIsPaused((prev) => !prev);
  }, []);

  useEffect(() => {
    return () => {
      stopScreenShare();
    };
  }, [stopScreenShare]);

  return {
    isSharing,
    isPaused,
    error,
    stats,
    startScreenShare,
    stopScreenShare,
    togglePause,
    videoElement: videoRef.current,
  };
}
