import React from "react";
import { Sliders, X, RotateCcw, Copy, Check, Eye } from "lucide-react";

export interface RigConfig {
  armPivotLX: number;
  armPivotLY: number;
  armPivotRX: number;
  armPivotRY: number;
  hairPivotLX: number;
  hairPivotLY: number;
  hairPivotRX: number;
  hairPivotRY: number;
  armMaxRot: number;
  hairMaxRot: number;
  breathIntensity: number;
  breathSpeed: number;
  showPivots: boolean;
}

export const DEFAULT_RIG_CONFIG: RigConfig = {
  armPivotLX: 26.0,
  armPivotLY: 45.8,
  armPivotRX: 74.2,
  armPivotRY: 45.8,
  hairPivotLX: 38.0,
  hairPivotLY: 23.0,
  hairPivotRX: 62.0,
  hairPivotRY: 23.0,
  armMaxRot: 2.2,
  hairMaxRot: 3.2,
  breathIntensity: 3.5,
  breathSpeed: 1.6,
  showPivots: false,
};

interface RigCalibrationPanelProps {
  config: RigConfig;
  onChange: (config: RigConfig) => void;
  onReset: () => void;
  onClose: () => void;
}

export const RigCalibrationPanel: React.FC<RigCalibrationPanelProps> = ({
  config,
  onChange,
  onReset,
  onClose,
}) => {
  const [copied, setCopied] = React.useState(false);

  const update = (key: keyof RigConfig, value: number | boolean) => {
    onChange({ ...config, [key]: value });
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(config, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="absolute top-16 right-6 z-50 w-80 max-h-[85vh] overflow-y-auto glass-panel border border-rose-500/30 rounded-2xl p-4 shadow-2xl text-xs text-slate-200 animate-in fade-in slide-in-from-right-4 backdrop-blur-xl">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-rose-400" />
          <span className="font-semibold text-white">Kalibrasi Rig 2D Celyn</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Kontrol Pivot Crosshairs */}
      <div className="flex items-center justify-between py-1.5 px-2.5 rounded-lg bg-slate-900/60 mb-3 border border-white/5">
        <span className="flex items-center gap-1.5 font-medium">
          <Eye className="w-3.5 h-3.5 text-cyan-400" />
          Tampilkan Titik Poros
        </span>
        <input
          type="checkbox"
          checked={config.showPivots}
          onChange={(e) => update("showPivots", e.target.checked)}
          className="rounded border-slate-700 text-rose-500 focus:ring-rose-400 cursor-pointer"
        />
      </div>

      {/* Bagian Lengan */}
      <div className="space-y-3 mb-4">
        <div className="text-[11px] font-bold text-rose-300 uppercase tracking-wider">
          Sendi Bahu & Lengan
        </div>
        <div>
          <div className="flex justify-between mb-1">
            <span>Bahu Kiri (X, Y)</span>
            <span className="text-slate-400">
              {config.armPivotLX.toFixed(1)}%, {config.armPivotLY.toFixed(1)}%
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="range"
              min="10"
              max="50"
              step="0.2"
              value={config.armPivotLX}
              onChange={(e) => update("armPivotLX", parseFloat(e.target.value))}
              className="w-full accent-rose-500"
            />
            <input
              type="range"
              min="30"
              max="65"
              step="0.2"
              value={config.armPivotLY}
              onChange={(e) => update("armPivotLY", parseFloat(e.target.value))}
              className="w-full accent-rose-500"
            />
          </div>
        </div>

        <div>
          <div className="flex justify-between mb-1">
            <span>Bahu Kanan (X, Y)</span>
            <span className="text-slate-400">
              {config.armPivotRX.toFixed(1)}%, {config.armPivotRY.toFixed(1)}%
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="range"
              min="50"
              max="90"
              step="0.2"
              value={config.armPivotRX}
              onChange={(e) => update("armPivotRX", parseFloat(e.target.value))}
              className="w-full accent-rose-500"
            />
            <input
              type="range"
              min="30"
              max="65"
              step="0.2"
              value={config.armPivotRY}
              onChange={(e) => update("armPivotRY", parseFloat(e.target.value))}
              className="w-full accent-rose-500"
            />
          </div>
        </div>

        <div>
          <div className="flex justify-between mb-1">
            <span>Maks Sudut Ayunan Lengan</span>
            <span className="text-slate-400">{config.armMaxRot.toFixed(1)}°</span>
          </div>
          <input
            type="range"
            min="0"
            max="6"
            step="0.1"
            value={config.armMaxRot}
            onChange={(e) => update("armMaxRot", parseFloat(e.target.value))}
            className="w-full accent-rose-500"
          />
        </div>
      </div>

      {/* Bagian Rambut */}
      <div className="space-y-3 mb-4 pt-2 border-t border-white/10">
        <div className="text-[11px] font-bold text-pink-300 uppercase tracking-wider">
          Akar Helai Rambut
        </div>
        <div>
          <div className="flex justify-between mb-1">
            <span>Rambut Kiri (X, Y)</span>
            <span className="text-slate-400">
              {config.hairPivotLX.toFixed(1)}%, {config.hairPivotLY.toFixed(1)}%
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="range"
              min="20"
              max="50"
              step="0.2"
              value={config.hairPivotLX}
              onChange={(e) => update("hairPivotLX", parseFloat(e.target.value))}
              className="w-full accent-pink-500"
            />
            <input
              type="range"
              min="10"
              max="40"
              step="0.2"
              value={config.hairPivotLY}
              onChange={(e) => update("hairPivotLY", parseFloat(e.target.value))}
              className="w-full accent-pink-500"
            />
          </div>
        </div>

        <div>
          <div className="flex justify-between mb-1">
            <span>Rambut Kanan (X, Y)</span>
            <span className="text-slate-400">
              {config.hairPivotRX.toFixed(1)}%, {config.hairPivotRY.toFixed(1)}%
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="range"
              min="50"
              max="80"
              step="0.2"
              value={config.hairPivotRX}
              onChange={(e) => update("hairPivotRX", parseFloat(e.target.value))}
              className="w-full accent-pink-500"
            />
            <input
              type="range"
              min="10"
              max="40"
              step="0.2"
              value={config.hairPivotRY}
              onChange={(e) => update("hairPivotRY", parseFloat(e.target.value))}
              className="w-full accent-pink-500"
            />
          </div>
        </div>

        <div>
          <div className="flex justify-between mb-1">
            <span>Maks Ayunan Inersia Rambut</span>
            <span className="text-slate-400">{config.hairMaxRot.toFixed(1)}°</span>
          </div>
          <input
            type="range"
            min="0"
            max="8"
            step="0.2"
            value={config.hairMaxRot}
            onChange={(e) => update("hairMaxRot", parseFloat(e.target.value))}
            className="w-full accent-pink-500"
          />
        </div>
      </div>

      {/* Bagian Napas & Fisika Tubuh */}
      <div className="space-y-3 mb-4 pt-2 border-t border-white/10">
        <div className="text-[11px] font-bold text-cyan-300 uppercase tracking-wider">
          Fisika Pernapasan Tubuh
        </div>
        <div>
          <div className="flex justify-between mb-1">
            <span>Intensitas Napas (Amplitudo)</span>
            <span className="text-slate-400">{config.breathIntensity.toFixed(1)} px</span>
          </div>
          <input
            type="range"
            min="0"
            max="8"
            step="0.2"
            value={config.breathIntensity}
            onChange={(e) => update("breathIntensity", parseFloat(e.target.value))}
            className="w-full accent-cyan-500"
          />
        </div>

        <div>
          <div className="flex justify-between mb-1">
            <span>Kecepatan Napas</span>
            <span className="text-slate-400">{config.breathSpeed.toFixed(1)}x</span>
          </div>
          <input
            type="range"
            min="0.5"
            max="3"
            step="0.1"
            value={config.breathSpeed}
            onChange={(e) => update("breathSpeed", parseFloat(e.target.value))}
            className="w-full accent-cyan-500"
          />
        </div>
      </div>

      {/* Tombol Aksi */}
      <div className="flex items-center gap-2 pt-3 border-t border-white/10">
        <button
          onClick={onReset}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset</span>
        </button>
        <button
          onClick={handleCopy}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-rose-500 hover:bg-rose-600 text-white font-medium transition-colors shadow-lg shadow-rose-500/20"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? "Tersalin!" : "Salin JSON"}</span>
        </button>
      </div>
    </div>
  );
};
