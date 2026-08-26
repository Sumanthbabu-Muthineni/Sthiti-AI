import React, { useState } from 'react';
import { 
  Zap, 
  X, 
  Flame, 
  RotateCw, 
  PackageX, 
  HardDrive, 
  Send, 
  Loader2
} from 'lucide-react';
import { api } from '../services/api';

interface SimulateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAlertTriggered: () => void;
}

export const SimulateModal: React.FC<SimulateModalProps> = ({
  isOpen,
  onClose,
  onAlertTriggered,
}) => {
  const [loadingPreset, setLoadingPreset] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'presets' | 'custom'>('presets');
  const [customJson, setCustomJson] = useState<string>(JSON.stringify({
    event_id: `custom-alert-${Date.now().toString(36)}`,
    cluster: "production-us-east-1",
    namespace: "ecommerce",
    resource_kind: "Pod",
    resource_name: "order-service-7f89d",
    severity: "Critical",
    reason: "OOMKilled",
    message: "Pod exited with code 137 (OOM Killer). Memory usage 512MB / 512MB limit."
  }, null, 2));

  if (!isOpen) return null;

  const handleTriggerPreset = async (preset: string) => {
    setLoadingPreset(preset);
    try {
      await api.simulateAlert(preset);
      onAlertTriggered();
      onClose();
    } catch (err) {
      console.error('Failed to trigger simulated alert:', err);
    } finally {
      setLoadingPreset(null);
    }
  };

  const handleTriggerCustom = async () => {
    setLoadingPreset('custom');
    try {
      const parsed = JSON.parse(customJson);
      await api.sendWebhookEvent(parsed);
      onAlertTriggered();
      onClose();
    } catch (err) {
      console.error('Failed to send custom alert:', err);
      alert('Invalid JSON payload or server error');
    } finally {
      setLoadingPreset(null);
    }
  };

  const presets = [
    {
      id: 'oom',
      title: 'OOMKilled (Out of Memory)',
      subtitle: 'Pod payment-processor • namespace: payments',
      desc: 'Memory cgroup exceeded 256Mi threshold. AI diagnoses JVM buffer heap leak & proposes GitOps PR to increase memory to 1Gi.',
      icon: Flame,
      color: 'from-rose-600 to-orange-600',
      badge: 'GitOps PR Fix',
      severity: 'Critical',
    },
    {
      id: 'crashloop',
      title: 'CrashLoopBackOff (Transient Socket Timeout)',
      subtitle: 'Pod auth-gateway • namespace: auth',
      desc: 'Readiness probe failed on startup due to transient DB connection timeout. AI verifies DB recovery & proposes Imperative Rollout Restart.',
      icon: RotateCw,
      color: 'from-amber-500 to-yellow-600',
      badge: 'Imperative Rollout',
      severity: 'Warning',
    },
    {
      id: 'imagepull',
      title: 'ImagePullBackOff (Bad Tag in Deployment)',
      subtitle: 'Deployment storefront-web • namespace: frontend-apps',
      desc: 'Kubelet failed to pull non-existent release candidate tag v3.0.0-rc2. AI proposes GitOps rollback to verified release v2.9.4.',
      icon: PackageX,
      color: 'from-purple-600 to-pink-600',
      badge: 'GitOps Rollback',
      severity: 'Critical',
    },
    {
      id: 'diskpressure',
      title: 'NodeDiskPressure (Node Storage Exhaustion)',
      subtitle: 'Node worker-node-pool-2b • Available: 8.4%',
      desc: 'Node storage capacity fell below 10% threshold. AI proposes Imperative Cordon & Pod eviction to protect workloads.',
      icon: HardDrive,
      color: 'from-blue-600 to-cyan-600',
      badge: 'Imperative Cordon',
      severity: 'Warning',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-[#0f172a] border border-slate-700 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/80">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Simulate Kubernetes Alert Event</h3>
              <p className="text-xs text-slate-400">
                Trigger high-fidelity cluster alerts. Repeat alerts for the same deployment automatically aggregate into a single incident with cumulative counts.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-md transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="flex border-b border-slate-800 bg-slate-950/60 px-6 pt-2">
          <button
            onClick={() => setActiveTab('presets')}
            className={`pb-2.5 px-3 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === 'presets'
                ? 'border-cyan-400 text-cyan-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Curated Incident Presets
          </button>
          <button
            onClick={() => setActiveTab('custom')}
            className={`pb-2.5 px-3 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === 'custom'
                ? 'border-cyan-400 text-cyan-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Custom Webhook JSON Payload
          </button>
        </div>

        {/* Body */}
        <div className="p-6 max-h-[70vh] overflow-y-auto">
          {activeTab === 'presets' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {presets.map((p) => {
                const Icon = p.icon;
                const isLoading = loadingPreset === p.id;

                return (
                  <div
                    key={p.id}
                    onClick={() => !loadingPreset && handleTriggerPreset(p.id)}
                    className="glass-panel p-4 rounded-xl border border-slate-800 hover:border-cyan-500/60 transition-all cursor-pointer group flex flex-col justify-between space-y-3 bg-slate-900/60 hover:bg-slate-900"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${p.color} flex items-center justify-center text-white shadow-md`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <span className="text-[10px] font-mono font-semibold uppercase px-2 py-0.5 rounded bg-slate-800 text-cyan-300 border border-slate-700">
                          {p.badge}
                        </span>
                      </div>

                      <div>
                        <h4 className="text-xs font-bold text-white group-hover:text-cyan-300 transition-colors">
                          {p.title}
                        </h4>
                        <div className="text-[11px] text-slate-400 font-mono">
                          {p.subtitle}
                        </div>
                      </div>

                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        {p.desc}
                      </p>
                    </div>

                    <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
                      <span className="text-[10px] text-rose-400 font-semibold uppercase">{p.severity}</span>
                      <button className="flex items-center gap-1 text-cyan-400 font-semibold text-xs group-hover:underline">
                        {isLoading ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <>
                            <span>Simulate</span>
                            <Zap className="w-3 h-3" />
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Kubernetes Webhook Payload (Alertmanager / Falco / Watcher):
                </label>
                <textarea
                  rows={10}
                  value={customJson}
                  onChange={(e) => setCustomJson(e.target.value)}
                  className="w-full bg-slate-950 font-mono text-xs text-emerald-400 p-3 rounded-lg border border-slate-700 focus:outline-none focus:border-cyan-500 leading-relaxed"
                />
              </div>

              <div className="flex justify-end">
                <button
                  onClick={handleTriggerCustom}
                  disabled={loadingPreset === 'custom'}
                  className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 text-white rounded-lg text-xs font-bold shadow-lg transition-all hover:from-cyan-500 hover:to-blue-500 cursor-pointer disabled:opacity-50"
                >
                  {loadingPreset === 'custom' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  Send Custom Webhook Event
                </button>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
