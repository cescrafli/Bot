import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRM, VRMUtils } from "@pixiv/three-vrm";
import { EmotionType, LookAtTarget } from "@celyn/shared";
import { Upload, AlertCircle } from "lucide-react";

interface AvatarVRM3DProps {
  emotion: EmotionType;
  mouthOpen: number; // 0.0 - 1.0
  isSpeaking: boolean;
  lookAt: LookAtTarget | null;
}

export const AvatarVRM3D: React.FC<AvatarVRM3DProps> = ({
  emotion,
  mouthOpen,
  isSpeaking,
  lookAt,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const vrmRef = useRef<VRM | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Simpan props dinamis dalam ref agar loop 60 FPS dapat membaca nilai terbaru
  // tanpa memicu re-inisialisasi WebGLRenderer dan Scene Three.js
  const propsRef = useRef({ emotion, mouthOpen, isSpeaking, lookAt });
  propsRef.current = { emotion, mouthOpen, isSpeaking, lookAt };

  // Inisialisasi Three.js Scene & Render loop SEKALI saat mount
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 400;
    const height = container.clientHeight || 500;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(30.0, width / height, 0.1, 20.0);
    camera.position.set(0.0, 1.4, 1.3); // Fokus setengah badan / wajah

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    // Pencahayaan
    const light = new THREE.DirectionalLight(0xffffff, Math.PI * 0.8);
    light.position.set(1.0, 1.0, 1.0).normalize();
    scene.add(light);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    // Coba muat model default /avatars/celyn.vrm jika ada
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    loader.load(
      "/avatars/celyn.vrm",
      (gltf) => {
        const vrm = gltf.userData.vrm as VRM;
        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.combineSkeletons(gltf.scene);
        scene.add(vrm.scene);
        vrmRef.current = vrm;
        setModelLoaded(true);
        setLoadError(null);
      },
      undefined,
      () => {
        // Jika file vrm belum ada di public/avatars, beri tahu pengguna
        setLoadError("Model 3D /avatars/celyn.vrm belum tersedia.");
      }
    );

    const clock = new THREE.Clock();
    let animId: number;

    // State kedipan mata alami 3D
    let blinkTimer = 0;
    let nextBlinkTime = 2.8;
    let isBlinking = false;
    let blinkProgress = 0;

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      const elapsedTime = clock.getElapsedTime();

      const {
        emotion: curEmotion,
        mouthOpen: curMouthOpen,
        isSpeaking: curIsSpeaking,
        lookAt: curLookAt,
      } = propsRef.current;

      // Update siklus kedipan mata 3D alami (130ms tiap 2.5 - 5 detik)
      blinkTimer += delta;
      if (!isBlinking && blinkTimer > nextBlinkTime) {
        isBlinking = true;
        blinkProgress = 0;
        blinkTimer = 0;
        nextBlinkTime = 2.5 + Math.random() * 2.5;
      }
      let blinkVal = 0;
      if (isBlinking) {
        blinkProgress += delta;
        const norm = blinkProgress / 0.13;
        if (norm >= 1) {
          isBlinking = false;
          blinkVal = 0;
        } else {
          blinkVal = Math.sin(norm * Math.PI);
        }
      }

      if (vrmRef.current) {
        vrmRef.current.update(delta);

        // Update Lip-sync dengan Pause Gate & ekspresi emosi
        if (vrmRef.current.expressionManager) {
          const filteredMouth =
            curIsSpeaking && curMouthOpen >= 0.015
              ? Math.min(1, curMouthOpen * 2.4)
              : 0;
          vrmRef.current.expressionManager.setValue("aa", filteredMouth);
          vrmRef.current.expressionManager.setValue("blink", blinkVal);
          vrmRef.current.expressionManager.setValue("happy", curEmotion === "happy" ? 0.85 : 0);
          vrmRef.current.expressionManager.setValue("surprised", curEmotion === "surprised" ? 0.85 : 0);
          vrmRef.current.expressionManager.setValue("sad", curEmotion === "sad" ? 0.85 : 0);
          vrmRef.current.expressionManager.setValue("relaxed", curEmotion === "thinking" || curEmotion === "shy" ? 0.7 : 0);
          vrmRef.current.expressionManager.update();
        }

        // Procedural humanoid bone posing (head nod, spine slump, idle motion)
        const spineNode = vrmRef.current.humanoid?.getNormalizedBoneNode("spine");
        if (spineNode) {
          const slumpBonus = curEmotion === "sad" ? 0.08 : curEmotion === "happy" ? -0.04 : 0;
          spineNode.rotation.x = Math.sin(elapsedTime * 1.8) * 0.018 + slumpBonus;
          spineNode.rotation.y = curLookAt ? (curLookAt.x - 0.5) * 0.12 : 0;
        }

        const headNode = vrmRef.current.humanoid?.getNormalizedBoneNode("head");
        if (headNode) {
          if (curEmotion === "sad") {
            headNode.rotation.x = 0.15; // menunduk sayu
            headNode.rotation.z = -0.05;
          } else if (curEmotion === "thinking") {
            headNode.rotation.z = 0.12; // miring berpikir
            headNode.rotation.x = -0.08;
          } else if (curEmotion === "happy") {
            headNode.rotation.x = Math.sin(elapsedTime * 3.0) * 0.04 - 0.03;
            headNode.rotation.z = 0;
          } else if (curEmotion === "shy") {
            headNode.rotation.x = 0.1;
            headNode.rotation.y = -0.12;
          } else {
            headNode.rotation.x = 0;
            headNode.rotation.z = 0;
          }
        }

        // Update LookAt tatapan mata / kepala
        if (vrmRef.current.lookAt && curLookAt) {
          const targetX = (curLookAt.x - 0.5) * 1.5;
          const targetY = 1.4 - (curLookAt.y - 0.5) * 0.8;
          vrmRef.current.lookAt.lookAt(new THREE.Vector3(targetX, targetY, 2.0));
        }
      }

      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener("resize", handleResize);

    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(animId);
      resizeObserver.disconnect();
      window.removeEventListener("resize", handleResize);
      if (vrmRef.current) {
        VRMUtils.deepDispose(vrmRef.current.scene);
        vrmRef.current = null;
      }
      if (renderer.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }
      renderer.dispose();
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []); // Run sekali saat mount

  // Handle upload custom .vrm langsung dari browser
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }

    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    loader.load(
      url,
      (gltf) => {
        const vrm = gltf.userData.vrm as VRM;
        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.combineSkeletons(gltf.scene);

        // Hapus model lama dari scene jika ada dan bersihkan VRAM GPU
        if (sceneRef.current) {
          if (vrmRef.current) {
            sceneRef.current.remove(vrmRef.current.scene);
            VRMUtils.deepDispose(vrmRef.current.scene);
          }
          sceneRef.current.add(vrm.scene);
        }

        vrmRef.current = vrm;
        setModelLoaded(true);
        setLoadError(null);
      },
      undefined,
      (err) => {
        console.error("Gagal memuat file VRM:", err);
        setLoadError("Format file .VRM tidak valid.");
      }
    );
    // Reset file input agar pengguna bisa memilih kembali file yang sama
    e.target.value = "";
  };

  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <div ref={containerRef} className="w-full h-full" />

      {/* Hidden file input untuk upload .vrm */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".vrm"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Tombol ganti model ketika model 3D sudah aktif */}
      {modelLoaded && (
        <button
          onClick={() => fileInputRef.current?.click()}
          className="absolute top-3 right-3 z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900/60 hover:bg-slate-900/90 text-[11px] font-medium text-slate-300 border border-white/10 backdrop-blur-md transition-colors shadow-md"
          title="Ganti Model 3D .VRM"
        >
          <Upload className="w-3 h-3 text-rose-400" />
          <span>Ganti Model</span>
        </button>
      )}

      {!modelLoaded && (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-slate-900/80 backdrop-blur-md rounded-2xl m-4 border border-slate-700/60">
          <AlertCircle className="w-10 h-10 text-amber-400 mb-3" />
          <h3 className="text-base font-semibold text-slate-100 mb-1">
            Mode 3D VRM Siap Digunakan
          </h3>
          <p className="text-xs text-slate-400 max-w-xs mb-4">
            Simpan model avatar 3D Anda di <code className="text-rose-400">apps/web/public/avatars/celyn.vrm</code> atau unggah langsung file .vrm dari perangkat Anda.
          </p>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white cursor-pointer shadow-lg transition-colors"
          >
            <Upload className="w-4 h-4" />
            <span>Pilih File .VRM</span>
          </button>
        </div>
      )}
    </div>
  );
};
