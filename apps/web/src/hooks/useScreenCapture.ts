import { useState, useRef, useCallback, useEffect } from "react";

interface UseScreenCaptureOptions {
  onFrame: (b64JPEG: string) => void;
  fps?: number; // default 1 FPS
}

export function useScreenCapture({ onFrame, fps = 1 }: UseScreenCaptureOptions) {
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const intervalRef = useRef<number | null>(null);

  // Canvas untuk deteksi perubahan cepat (32x32 thumbnail)
  const diffCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Canvas untuk render frame beresolusi tinggi (maks 1024px)
  const sendCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const prevThumbRef = useRef<Uint8ClampedArray | null>(null);

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
  }, []);

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;

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
        if (delta > 40) diffPixels++;
      }
    }

    // Hanya kirim jika frame pertama atau perbedaan > 2% dari total 1024 piksel
    const hasChanged = !prevThumbRef.current || diffPixels > 20;

    if (!hasChanged) {
      return; // Layar statis: simpan token & bandwidth!
    }

    prevThumbRef.current = new Uint8ClampedArray(currThumb);

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

    // Ambil format JPEG kualitas 0.65
    const dataUrl = sendCanvas.toDataURL("image/jpeg", 0.65);
    const b64 = dataUrl.split(",")[1];
    if (b64) {
      onFrame(b64);
    }
  }, [onFrame]);

  const startScreenShare = useCallback(async () => {
    try {
      setError(null);
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

      // Tangkap frame langsung sekali saat mulai
      setTimeout(captureFrame, 200);

      // Mulai timer reguler (1 FPS)
      intervalRef.current = window.setInterval(captureFrame, 1000 / fps);
    } catch (err: any) {
      console.warn("Screen share dibatalkan atau ditolak:", err);
      if (err.name !== "NotAllowedError") {
        setError(err.message || "Gagal memulai screen share");
      }
      stopScreenShare();
    }
  }, [fps, captureFrame, stopScreenShare]);

  useEffect(() => {
    return () => {
      stopScreenShare();
    };
  }, [stopScreenShare]);

  return {
    isSharing,
    error,
    startScreenShare,
    stopScreenShare,
    videoElement: videoRef.current,
  };
}
