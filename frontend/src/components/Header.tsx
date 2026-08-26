import React, { useState } from 'react';
import { 
  ShieldAlert, 
  Activity, 
  CheckCircle2, 
  Clock, 
  Zap, 
  Radio, 
  History,
  Lock,
  Server,
  X,
  Cpu,
  HardDrive
} from 'lucide-react';
import type { ClusterInfo } from '../types';

interface HeaderProps {
  connected: boolean;
  pendingCount: number;
  remediatedCount: number;
  totalAlerts: number;
  scrubbedCount: number;
  activeView: 'dashboard' | 'history';
  clusterInfo: ClusterInfo | null;
  onViewChange: (view: 'dashboard' | 'history') => void;
  onOpenSimulate: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  connected,
  pendingCount,
  remediatedCount,
  totalAlerts,
  scrubbedCount,
  activeView,
  clusterInfo,
  onViewChange,
  onOpenSimulate,
}) => {
  const [showClusterModal, setShowClusterModal] = useState(false);
  const isK8sLive = clusterInfo?.connected === true;

  return (
    <>
      <header className="bg-[#0b0f19]/95 backdrop-blur-xl border-b border-slate-800/80 sticky top-0 z-40 px-4 lg:px-6 py-3 shadow-lg shadow-black/40">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          
          {/* Logo & System Brand */}
          <div className="flex items-center space-x-3.5">
            <div className="relative">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 via-blue-600 to-indigo-600 p-0.5 shadow-lg shadow-cyan-500/25 flex items-center justify-center">
                <ShieldAlert className="w-5 h-5 text-white" />
              </div>
              <span className="absolute -bottom-1 -right-1 flex h-3.5 w-3.5">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${connected ? 'bg-emerald-400 opacity-75' : 'bg-amber-400 opacity-75'}`}></span>
                <span className={`relative inline-flex rounded-full h-3.5 w-3.5 border-2 border-[#0b0f19] ${connected ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
              </span>
            </div>

            <div>
              <div className="flex items-center space-x-2.5">
                <h1 className="text-base lg:text-lg font-extrabold tracking-tight text-white flex items-center gap-2">
                  K8S AGENTIC WATCHDOG
                </h1>
                <span className="text-[10px] uppercase font-mono font-bold px-2 py-0.5 bg-gradient-to-r from-cyan-950 to-blue-950 text-cyan-300 border border-cyan-700/60 rounded-full shadow-sm">
                  Autonomous SRE
                </span>
              </div>
              
              <div className="text-xs text-slate-400 flex items-center gap-2 mt-0.5">
                <button
                  onClick={() => setShowClusterModal(true)}
                  className="flex items-center gap-1.5 hover:text-cyan-300 transition-colors group cursor-pointer"
                  title="Click to view live cluster topology"
                >
                  <span className={`inline-block w-2 h-2 rounded-full ${isK8sLive ? 'bg-emerald-400' : 'bg-amber-400'} group-hover:animate-ping`} />
                  <span className="font-mono text-slate-300 font-semibold underline decoration-dotted underline-offset-2">
                    {clusterInfo?.cluster_name || 'minikube'}
                  </span>
                  {clusterInfo?.nodes?.[0]?.kubelet_version && (
                    <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.2 rounded font-mono">
                      {clusterInfo.nodes[0].kubelet_version}
                    </span>
                  )}
                </button>
                <span>•</span>
                <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                  <Radio className="w-3 h-3 animate-pulse" />
                  {connected ? 'Live Telemetry Bus' : 'Reconnecting...'}
                </span>
              </div>
            </div>
          </div>

          {/* Telemetry Metric Badges */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            
            {/* Pending Approvals Card */}
            <div className={`flex items-center space-x-2.5 px-3 py-1.5 rounded-lg border transition-all ${
              pendingCount > 0 
                ? 'bg-amber-950/40 border-amber-500/50 shadow-md shadow-amber-950/30' 
                : 'bg-slate-900/80 border-slate-800/80'
            }`}>
              <div className={`p-1 rounded ${pendingCount > 0 ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-800 text-slate-400'}`}>
                <Clock className="w-3.5 h-3.5" />
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-400 uppercase font-semibold">Pending Review</span>
                <span className={`font-mono font-bold text-xs ${pendingCount > 0 ? 'text-amber-300 animate-pulse' : 'text-slate-300'}`}>
                  {pendingCount}
                </span>
              </div>
            </div>

            {/* Remediated Card */}
            <div className="flex items-center space-x-2.5 bg-slate-900/80 border border-slate-800/80 px-3 py-1.5 rounded-lg">
              <div className="p-1 rounded bg-emerald-500/10 text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-400 uppercase font-semibold">Remediated</span>
                <span className="font-mono font-bold text-xs text-emerald-300">
                  {remediatedCount}
                </span>
              </div>
            </div>

            {/* Total Alerts Card */}
            <div className="flex items-center space-x-2.5 bg-slate-900/80 border border-slate-800/80 px-3 py-1.5 rounded-lg">
              <div className="p-1 rounded bg-cyan-500/10 text-cyan-400">
                <Activity className="w-3.5 h-3.5" />
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-400 uppercase font-semibold">Total Ingested</span>
                <span className="font-mono font-bold text-xs text-slate-200">
                  {totalAlerts}
                </span>
              </div>
            </div>

            {/* Sanitized Tokens Card */}
            <div className="flex items-center space-x-2.5 bg-slate-900/80 border border-slate-800/80 px-3 py-1.5 rounded-lg">
              <div className="p-1 rounded bg-purple-500/10 text-purple-400">
                <Lock className="w-3.5 h-3.5" />
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-400 uppercase font-semibold">Scrubbed Tokens</span>
                <span className="font-mono font-bold text-xs text-purple-300">
                  {scrubbedCount}
                </span>
              </div>
            </div>

          </div>

          {/* Action Controls */}
          <div className="flex items-center space-x-2.5 w-full lg:w-auto justify-end">
            <button
              onClick={() => setShowClusterModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700/80 hover:border-cyan-500/50 rounded-lg text-xs font-medium transition-all cursor-pointer"
            >
              <Server className="w-3.5 h-3.5 text-cyan-400" />
              <span>Nodes & Pods</span>
            </button>

            <button
              onClick={() => onViewChange(activeView === 'dashboard' ? 'history' : 'dashboard')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
                activeView === 'history'
                  ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/50 shadow-sm'
                  : 'bg-slate-900 text-slate-300 border-slate-700/80 hover:bg-slate-800'
              }`}
            >
              <History className="w-3.5 h-3.5 text-indigo-400" />
              {activeView === 'history' ? 'Dashboard' : 'Audit Log'}
            </button>

            <button
              onClick={onOpenSimulate}
              className="flex items-center gap-2 px-4 py-1.5 bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 hover:from-cyan-400 hover:to-blue-500 text-white rounded-lg text-xs font-bold shadow-md shadow-cyan-600/30 hover:shadow-cyan-500/50 transition-all cursor-pointer"
            >
              <Zap className="w-3.5 h-3.5 fill-white text-white" />
              <span>Simulate Incident</span>
            </button>
          </div>

        </div>
      </header>

      {/* Live Cluster Modal */}
      {showClusterModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in">
          <div className="bg-[#0f172a] border border-slate-700 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl space-y-4">
            
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/80">
              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-950/60 border border-emerald-700/50 flex items-center justify-center text-emerald-400">
                  <Server className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    Live Cluster Topology: <span className="font-mono text-emerald-400">{clusterInfo?.cluster_name || 'minikube'}</span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    Direct integration via ~/.kube/config with Kubernetes API
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowClusterModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-md transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              
              {/* Status Banner */}
              <div className="bg-emerald-950/30 border border-emerald-800/40 p-4 rounded-xl flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <span className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse" />
                  <div>
                    <div className="text-xs font-bold text-emerald-300">Cluster Status: Healthy & Ready</div>
                    <div className="text-[11px] text-slate-400">Total active workloads: {clusterInfo?.pod_count || 3} pods across {clusterInfo?.namespaces?.length || 5} namespaces</div>
                  </div>
                </div>
                <span className="font-mono text-xs text-emerald-400 font-bold bg-emerald-950/80 px-2.5 py-1 rounded border border-emerald-700/60">
                  v1.35.1
                </span>
              </div>

              {/* Nodes List */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Control Plane & Worker Nodes</h4>
                {(clusterInfo?.nodes || []).map((node, idx) => (
                  <div key={idx} className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                        <span className="font-mono font-bold text-xs text-white">{node.name}</span>
                        <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono">control-plane</span>
                      </div>
                      <span className="text-[11px] text-emerald-400 font-semibold">Ready</span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-800 text-xs">
                      <div className="flex items-center gap-1.5 text-slate-400">
                        <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                        <span>CPU: <strong className="text-slate-200 font-mono">{node.cpu_capacity || '8 cores'}</strong></span>
                      </div>
                      <div className="flex items-center gap-1.5 text-slate-400">
                        <HardDrive className="w-3.5 h-3.5 text-purple-400" />
                        <span>RAM: <strong className="text-slate-200 font-mono">{node.memory_capacity || '16Gi'}</strong></span>
                      </div>
                      <div className="col-span-2 text-slate-400 truncate">
                        <span>OS: <strong className="text-slate-200 font-mono text-[11px]">{node.os_image || 'Buildroot 2024.02'}</strong></span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Namespaces list */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Active Namespaces</h4>
                <div className="flex flex-wrap gap-1.5">
                  {(clusterInfo?.namespaces || ['default', 'watchdog-demo', 'kube-system']).map((ns) => (
                    <span key={ns} className="px-2.5 py-1 rounded bg-slate-900 text-slate-300 font-mono text-xs border border-slate-800">
                      {ns}
                    </span>
                  ))}
                </div>
              </div>

            </div>

          </div>
        </div>
      )}
    </>
  );
};
