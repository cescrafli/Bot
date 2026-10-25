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
  lookAt,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const vrmRef = useRef<VRM | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Inisialisasi Three.js Scene & Render loop
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
    renderer.setPixelRatio(window.devicePixelRatio);
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
      },
      undefined,
      () => {
        // Jika file vrm belum ada di public/avatars, beri tahu pengguna
        setLoadError("Model 3D /avatars/celyn.vrm belum tersedia.");
      }
    );

    const clock = new THREE.Clock();
    let animId: number;

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const delta = clock.getDelta();

      if (vrmRef.current) {
        vrmRef.current.update(delta);

        // Update Lip-sync (viseme aa) & ekspresi
        if (vrmRef.current.expressionManager) {
          vrmRef.current.expressionManager.setValue("aa", mouthOpen);
          vrmRef.current.expressionManager.setValue("happy", emotion === "happy" ? 0.8 : 0);
          vrmRef.current.expressionManager.setValue("surprised", emotion === "surprised" ? 0.8 : 0);
          vrmRef.current.expressionManager.setValue("sad", emotion === "sad" ? 0.8 : 0);
          vrmRef.current.expressionManager.update();
        }

        // Update LookAt tatapan mata / kepala
        if (vrmRef.current.lookAt && lookAt) {
          const targetX = (lookAt.x - 0.5) * 1.5;
          const targetY = 1.4 - (lookAt.y - 0.5) * 0.8;
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
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", handleResize);
      if (renderer.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }
      renderer.dispose();
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, [emotion, mouthOpen, lookAt]);

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

        // Hapus model lama dari scene jika ada
        if (sceneRef.current) {
          if (vrmRef.current) {
            sceneRef.current.remove(vrmRef.current.scene);
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
  };

  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <div ref={containerRef} className="w-full h-full" />

      {!modelLoaded && (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-slate-900/80 backdrop-blur-md rounded-2xl m-4 border border-slate-700/60">
          <AlertCircle className="w-10 h-10 text-amber-400 mb-3" />
          <h3 className="text-base font-semibold text-slate-100 mb-1">
            Mode 3D VRM Siap Digunakan
          </h3>
          <p className="text-xs text-slate-400 max-w-xs mb-4">
            Simpan model avatar 3D Anda di <code className="text-rose-400">apps/web/public/avatars/celyn.vrm</code> atau unggah langsung file .vrm dari komputer Anda.
          </p>
          <label className="flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white cursor-pointer shadow-lg transition-colors">
            <Upload className="w-4 h-4" />
            <span>Pilih File .VRM</span>
            <input
              type="file"
              accept=".vrm"
              className="hidden"
              onChange={handleFileChange}
            />
          </label>
        </div>
      )}
    </div>
  );
};
