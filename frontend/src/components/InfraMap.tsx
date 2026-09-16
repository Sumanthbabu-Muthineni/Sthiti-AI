import React, { useState, useEffect, useCallback } from 'react';
import { 
  Layers, 
  Server, 
  Boxes, 
  Cpu, 
  HardDrive, 
  FileCode, 
  Network, 
  CheckCircle2, 
  AlertTriangle, 
  History, 
  RefreshCw, 
  ChevronRight, 
  ChevronDown, 
  Flame, 
  Zap, 
  X, 
  Activity
} from 'lucide-react';
import { api } from '../services/api';
import type { NeighborhoodResponse, TopologyNode, TopologySnapshot, FoldedEvent } from '../types';

interface InfraMapProps {
  initialNamespace?: string;
  initialKind?: string;
  initialName?: string;
  onClose?: () => void;
  isEmbedded?: boolean;
}

export const InfraMap: React.FC<InfraMapProps> = ({
  initialNamespace = 'watchdog-demo',
  initialKind = 'Deployment',
  initialName = 'payment-processor',
  onClose,
  isEmbedded = false,
}) => {
  const [namespace, setNamespace] = useState<string>(initialNamespace);
  const [resourceKind, setResourceKind] = useState<string>(initialKind);
  const [resourceName, setResourceName] = useState<string>(initialName);
  
  useEffect(() => {
    setNamespace(initialNamespace);
    setResourceKind(initialKind);
    setResourceName(initialName);
  }, [initialNamespace, initialKind, initialName]);
  
  const [data, setData] = useState<NeighborhoodResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  
  const [selectedNode, setSelectedNode] = useState<TopologyNode | null>(null);
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set());
  
  // Historical Time-Travel State
  const [snapshots, setSnapshots] = useState<TopologySnapshot[]>([]);
  const [selectedSnapshot, setSelectedSnapshot] = useState<string>('');
  const [isHistoricalMode, setIsHistoricalMode] = useState<boolean>(false);

  const fetchTopology = useCallback(async (ts?: string) => {
    setLoading(true);
    setError(null);
    try {
      const topoData = await api.getTopologyNeighborhood(
        namespace,
        resourceKind,
        resourceName,
        ts || undefined
      );
      setData(topoData);
      // Auto-select node: in full view auto-select critical or root; in embedded view keep closed by default
      if (topoData && topoData.nodes) {
        if (!isEmbedded) {
          const failingNode = topoData.nodes.find((n: TopologyNode) => n.worst_state === 'Critical') ||
            topoData.nodes.find((n: TopologyNode) => n.is_root) ||
            topoData.nodes[0];
          setSelectedNode(failingNode || null);
        } else {
          setSelectedNode(null);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch topology neighborhood');
    } finally {
      setLoading(false);
    }
  }, [namespace, resourceKind, resourceName, isEmbedded]);

  const fetchSnapshots = useCallback(async () => {
    try {
      const snaps = await api.getTopologySnapshots();
      setSnapshots(snaps);
    } catch (err) {
      console.debug('Error loading snapshots:', err);
    }
  }, []);

  useEffect(() => {
    fetchTopology(selectedSnapshot);
    fetchSnapshots();
  }, [fetchTopology, fetchSnapshots, selectedSnapshot]);

  // Collapse / Expand toggle
  const toggleCollapse = (nodeId: string) => {
    setCollapsedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const handleTimeTravelToggle = (historical: boolean) => {
    setIsHistoricalMode(historical);
    if (!historical) {
      setSelectedSnapshot('');
      fetchTopology();
    } else if (snapshots.length > 0) {
      setSelectedSnapshot(snapshots[0].timestamp);
      fetchTopology(snapshots[0].timestamp);
    }
  };

  const getNodeIcon = (kind: string) => {
    switch (kind.toLowerCase()) {
      case 'deployment':
      case 'statefulset':
      case 'daemonset':
        return <Layers className="w-4 h-4 text-indigo-400" />;
      case 'replicaset':
        return <Boxes className="w-4 h-4 text-blue-400" />;
      case 'pod':
        return <Cpu className="w-4 h-4 text-cyan-400" />;
      case 'node':
        return <Server className="w-4 h-4 text-emerald-400" />;
      case 'service':
        return <Network className="w-4 h-4 text-teal-400" />;
      case 'configmap':
      case 'secret':
        return <FileCode className="w-4 h-4 text-amber-400" />;
      case 'persistentvolumeclaim':
      case 'persistentvolume':
        return <HardDrive className="w-4 h-4 text-purple-400" />;
      default:
        return <Activity className="w-4 h-4 text-slate-400" />;
    }
  };

  const getWorstStateBadge = (state: 'Critical' | 'Warning' | 'Healthy') => {
    switch (state) {
      case 'Critical':
        return (
          <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono font-bold uppercase rounded bg-rose-950/90 text-rose-300 border border-rose-800 animate-pulse">
            <Flame className="w-3 h-3 text-rose-400" />
            Critical
          </span>
        );
      case 'Warning':
        return (
          <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono font-bold uppercase rounded bg-amber-950/80 text-amber-300 border border-amber-800">
            <AlertTriangle className="w-3 h-3 text-amber-400" />
            Warning
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono font-bold uppercase rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            Healthy
          </span>
        );
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'Deploy/Scale':
        return 'bg-blue-950/80 text-blue-300 border-blue-800';
      case 'Image':
        return 'bg-purple-950/80 text-purple-300 border-purple-800';
      case 'Crash/Error':
        return 'bg-rose-950/90 text-rose-300 border-rose-800';
      case 'Health':
        return 'bg-amber-950/80 text-amber-300 border-amber-800';
      default:
        return 'bg-slate-800 text-slate-300 border-slate-700';
    }
  };

  // Compact Pill Renderer for Node Cards (prevents card flooding)
  const renderCompactEventPills = (nodeEvents: FoldedEvent[] = []) => {
    if (!nodeEvents || nodeEvents.length === 0) return null;

    // Deduplicate by reason
    const dedupMap = new Map<string, FoldedEvent>();
    nodeEvents.forEach((e) => {
      const existing = dedupMap.get(e.reason);
      if (!existing || (e.count && e.count > (existing.count || 0))) {
        dedupMap.set(e.reason, e);
      }
    });
    const unique = Array.from(dedupMap.values());

    // Sort with Critical & Warning first
    unique.sort((a, b) => {
      const rank = (ev: FoldedEvent) => (ev.severity === 'Critical' ? 3 : ev.severity === 'Warning' ? 2 : 1);
      return rank(b) - rank(a);
    });

    const visible = unique.slice(0, 2);
    const hiddenCount = unique.length - visible.length;

    return (
      <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex flex-wrap items-center gap-1.5">
        {visible.map((ev, idx) => (
          <span
            key={idx}
            className={`text-[10px] font-mono px-2 py-0.5 rounded border flex items-center gap-1 ${getCategoryColor(ev.category)}`}
          >
            <span>{ev.category}: {ev.reason}</span>
            {ev.multiplier_str && (
              <strong className="font-bold text-white bg-black/40 px-1 rounded">{ev.multiplier_str}</strong>
            )}
          </span>
        ))}
        {hiddenCount > 0 && (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
            +{hiddenCount} more
          </span>
        )}
      </div>
    );
  };

  // Group nodes by architectural tier
  const rootNode = data?.nodes.find((n) => n.is_root) || data?.nodes[0];
  const replicaSets = data?.nodes.filter((n) => n.kind === 'ReplicaSet') || [];
  const pods = data?.nodes.filter((n) => n.kind === 'Pod') || [];
  const auxiliaryNodes = data?.nodes.filter((n) => !['Deployment', 'ReplicaSet', 'Pod'].includes(n.kind)) || [];

  return (
    <div className={`flex flex-col bg-[#070a12] text-slate-200 ${isEmbedded ? 'rounded-xl border border-slate-800' : 'h-full w-full'}`}>
      
      {/* Top Controls Header */}
      <div className="flex flex-wrap items-center justify-between p-3.5 border-b border-slate-800/90 bg-[#0c101c]/90 gap-3 backdrop-blur-md">
        
        {/* Left: Workload & Status Badges */}
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-500 p-0.5 flex items-center justify-center shadow-md shadow-indigo-900/30">
            <Layers className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-sm font-bold font-mono text-white flex items-center gap-1.5">
                {resourceName}
                <span className="text-[11px] font-sans font-normal text-slate-400">({resourceKind})</span>
              </h2>
              {data && getWorstStateBadge(data.worst_state)}
            </div>
            <div className="text-[11px] text-slate-400 font-mono flex items-center gap-2">
              <span>Namespace: <strong className="text-slate-300">{namespace}</strong></span>
              <span>•</span>
              <span>Cluster: <strong className="text-cyan-400">minikube</strong></span>
            </div>
          </div>
        </div>

        {/* Center: Time-Travel & Snapshot Controls */}
        <div className="flex items-center space-x-2 bg-slate-900/90 border border-slate-800 px-3 py-1 rounded-lg text-xs">
          <button
            onClick={() => handleTimeTravelToggle(false)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded font-medium transition-all ${
              !isHistoricalMode 
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Zap className="w-3 h-3 text-cyan-400" />
            Live Cluster
          </button>

          <button
            onClick={() => handleTimeTravelToggle(true)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded font-medium transition-all ${
              isHistoricalMode 
                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <History className="w-3 h-3 text-purple-400" />
            Incident Time (Snapshot)
          </button>

          {isHistoricalMode && snapshots.length > 0 && (
            <select
              value={selectedSnapshot}
              onChange={(e) => {
                setSelectedSnapshot(e.target.value);
                fetchTopology(e.target.value);
              }}
              className="bg-slate-950 text-slate-300 text-[11px] font-mono border border-slate-700 rounded px-2 py-0.5 focus:outline-none focus:border-purple-500"
            >
              {snapshots.map((s, idx) => (
                <option key={idx} value={s.timestamp}>
                  {new Date(s.timestamp).toLocaleTimeString()} ({s.namespace})
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Right: Quick Action Controls */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => fetchTopology(selectedSnapshot)}
            className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-cyan-300 border border-slate-800 transition-colors"
            title="Refresh Neighborhood"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
          </button>

          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-900 hover:bg-rose-950 text-slate-400 hover:text-rose-300 border border-slate-800 transition-colors"
              title="Close Map"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

      </div>

      {/* Main Graph Content & Side Inspector Layout */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden relative min-h-[460px]">
        
        {/* Graph Canvas */}
        <div className="flex-1 overflow-auto p-6 space-y-8 bg-radial from-[#0d1424] to-[#070a12]">
          
          {loading && !data && (
            <div className="flex flex-col items-center justify-center h-64 space-y-3">
              <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin" />
              <p className="text-xs text-slate-400 font-mono">Reconstructing Kubernetes Neighborhood...</p>
            </div>
          )}

          {error && (
            <div className="p-4 bg-rose-950/40 border border-rose-800/80 rounded-xl text-xs text-rose-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {data && (
            <div className="max-w-4xl mx-auto space-y-6">

              {/* Architecture Hierarchy Legend & Guide */}
              <div className="flex flex-wrap items-center justify-between text-[11px] font-mono bg-slate-900/60 px-4 py-2 rounded-xl border border-slate-800/80 gap-2">
                <div className="flex items-center space-x-2 text-slate-300">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                  <span className="font-bold text-slate-200">Neighborhood Hierarchy:</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-slate-400">
                  <span className="px-2 py-0.5 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-800">
                    1. {rootNode?.kind === 'Node' ? 'Host Node' : 'Root Workload'}
                  </span>
                  <span>→</span>
                  {replicaSets.length > 0 && (
                    <>
                      <span className="px-2 py-0.5 rounded bg-blue-950/80 text-blue-300 border border-blue-800">2. Active Rollouts</span>
                      <span>→</span>
                    </>
                  )}
                  <span className="px-2 py-0.5 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-800">
                    {replicaSets.length > 0 ? '3. Child Pods' : '2. Pods on Node'}
                  </span>
                  {auxiliaryNodes.length > 0 && (
                    <>
                      <span>→</span>
                      <span className="px-2 py-0.5 rounded bg-purple-950/80 text-purple-300 border border-purple-800">4. Attached Infra</span>
                    </>
                  )}
                </div>
              </div>
              
              {/* TIER 1: Root Workload Card */}
              {rootNode && (
                <div className="flex flex-col items-center">
                  <div
                    onClick={() => setSelectedNode(rootNode)}
                    className={`w-full max-w-xl p-4 rounded-xl border transition-all cursor-pointer relative ${
                      selectedNode?.id === rootNode.id
                        ? 'bg-slate-900/90 border-cyan-400 shadow-lg shadow-cyan-950/40 ring-1 ring-cyan-400/50'
                        : rootNode.worst_state === 'Critical'
                          ? 'bg-rose-950/20 border-rose-800/80 hover:border-rose-600 shadow-md shadow-rose-950/20'
                          : rootNode.worst_state === 'Warning'
                            ? 'bg-amber-950/20 border-amber-800/80 hover:border-amber-600'
                            : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2.5">
                        <div className="p-2 rounded-lg bg-indigo-950/60 border border-indigo-700/50">
                          {getNodeIcon(rootNode.kind)}
                        </div>
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="text-[10px] font-mono uppercase bg-indigo-950 text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-800">
                              {rootNode.kind}
                            </span>
                            <span className="text-sm font-bold font-mono text-white">
                              {rootNode.name}
                            </span>
                          </div>
                          <span className="text-[11px] text-slate-400 font-mono">
                            {rootNode.kind === 'Node' ? 'Cluster Host Node' : `UID: ${rootNode.uid}`}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center space-x-2">
                        {getWorstStateBadge(rootNode.worst_state)}
                        {rootNode.has_unhealthy_children && (
                          <span className="text-[10px] text-rose-400 font-mono bg-rose-950/80 border border-rose-800 px-2 py-0.5 rounded">
                            Inherited Critical
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Compact Folded Events Bar (Deduplicated, Top 2 Only) */}
                    {renderCompactEventPills(rootNode.events)}
                  </div>

                  {/* Vertical Connection Pipe */}
                  <div className="w-0.5 h-6 bg-gradient-to-b from-indigo-500/80 to-blue-500/80" />
                </div>
              )}

              {/* TIER 2: ReplicaSets (Multi-ReplicaSet Rollouts Supported) */}
              {replicaSets.length > 0 && (
                <div className="flex flex-col items-center space-y-4">
                  {replicaSets.map((rs) => {
                    const isCollapsed = collapsedNodes.has(rs.id);
                    const rsPods = pods.filter((p) =>
                      data?.edges.some((e) => (e.source === rs.id || e.source === rs.uid) && (e.target === p.id || e.target === p.uid)) ||
                      p.name.startsWith(rs.name)
                    );
                    const displayedPods = rsPods.length > 0 ? rsPods : pods;

                    return (
                      <div key={rs.id} className="w-full flex flex-col items-center">
                        <div
                          onClick={() => setSelectedNode(rs)}
                          className={`w-full max-w-lg p-3.5 rounded-xl border transition-all cursor-pointer ${
                            selectedNode?.id === rs.id
                              ? 'bg-slate-900 border-blue-400 shadow-md ring-1 ring-blue-400/40'
                              : rs.worst_state === 'Critical'
                                ? 'bg-rose-950/25 border-rose-800 hover:border-rose-600'
                                : 'bg-slate-900/50 border-slate-800 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleCollapse(rs.id);
                                }}
                                className="p-1 rounded hover:bg-slate-800 text-slate-400"
                              >
                                {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                              </button>
                              {getNodeIcon(rs.kind)}
                              <span className="text-xs font-mono font-bold text-slate-200">
                                {rs.name}
                              </span>
                              <span className="text-[10px] text-slate-400 font-mono">
                                ({rs.metadata?.replicas || 2} replicas)
                              </span>
                            </div>

                            <div className="flex items-center space-x-2">
                              {getWorstStateBadge(rs.worst_state)}
                            </div>
                          </div>

                          {/* Collapsed Warning Notification */}
                          {isCollapsed && rs.worst_state === 'Critical' && (
                            <div className="mt-2 text-[11px] text-rose-300 font-mono bg-rose-950/80 px-2 py-1 rounded flex items-center justify-between">
                              <span>⚠️ Branch collapsed: 1 child pod in Critical state</span>
                              <span className="text-[10px] underline">Click to expand</span>
                            </div>
                          )}

                          {renderCompactEventPills(rs.events)}
                        </div>

                        {/* TIER 3: Child Pods under ReplicaSet */}
                        {!isCollapsed && (
                          <div className="w-full flex flex-col items-center">
                            <div className="w-0.5 h-4 bg-gradient-to-b from-blue-500/80 to-cyan-500/80" />
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-2xl">
                              {displayedPods.map((pod) => (
                                <div
                                  key={pod.id}
                                  onClick={() => setSelectedNode(pod)}
                                  className={`p-3 rounded-lg border transition-all cursor-pointer ${
                                    selectedNode?.id === pod.id
                                      ? 'bg-slate-900 border-cyan-400 ring-1 ring-cyan-400/40 shadow-md'
                                      : pod.worst_state === 'Critical'
                                        ? 'bg-rose-950/30 border-rose-800/90 hover:border-rose-600'
                                        : 'bg-slate-900/40 border-slate-800 hover:border-slate-700'
                                  }`}
                                >
                                  <div className="flex items-center justify-between mb-1.5">
                                    <div className="flex items-center space-x-1.5">
                                      {getNodeIcon(pod.kind)}
                                      <span className="text-xs font-mono font-semibold text-slate-200 truncate max-w-[170px]" title={pod.name}>
                                        {pod.name}
                                      </span>
                                    </div>
                                    {getWorstStateBadge(pod.worst_state)}
                                  </div>

                                  <div className="text-[10px] text-slate-400 font-mono flex items-center justify-between">
                                    <span>Node: {pod.metadata?.node || 'worker-node-1'}</span>
                                    <span className={pod.worst_state === 'Critical' ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
                                      {pod.status}
                                    </span>
                                  </div>

                                  {/* Container Breakdown preview */}
                                  {pod.containers && pod.containers.length > 0 && (
                                    <div className="mt-2 pt-1.5 border-t border-slate-800/80 text-[10px] font-mono space-y-0.5">
                                      {pod.containers.map((c, cIdx) => (
                                        <div key={cIdx} className="flex items-center justify-between text-slate-300">
                                          <span className="truncate max-w-[130px]">{c.name}</span>
                                          <span className={c.ready ? 'text-emerald-400' : 'text-rose-400'}>
                                            {c.state} ({c.restarts} restarts)
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  )}

                                  {renderCompactEventPills(pod.events)}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* TIER 2 & 3: Direct Pods under Host Node (When no ReplicaSets present) */}
              {replicaSets.length === 0 && pods.length > 0 && (
                <div className="w-full flex flex-col items-center">
                  <div className="text-[11px] uppercase font-mono font-semibold text-slate-400 mb-3 flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Pods Hosted on {rootNode?.name} ({pods.length})</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-2xl">
                    {pods.map((pod) => (
                      <div
                        key={pod.id}
                        onClick={() => setSelectedNode(pod)}
                        className={`p-3 rounded-lg border transition-all cursor-pointer ${
                          selectedNode?.id === pod.id
                            ? 'bg-slate-900 border-cyan-400 ring-1 ring-cyan-400/40 shadow-md'
                            : pod.worst_state === 'Critical'
                              ? 'bg-rose-950/30 border-rose-800/90 hover:border-rose-600'
                              : 'bg-slate-900/40 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center space-x-1.5">
                            {getNodeIcon(pod.kind)}
                            <span className="text-xs font-mono font-semibold text-slate-200 truncate max-w-[170px]" title={pod.name}>
                              {pod.name}
                            </span>
                          </div>
                          {getWorstStateBadge(pod.worst_state)}
                        </div>

                        <div className="text-[10px] text-slate-400 font-mono flex items-center justify-between">
                          <span>Node: {pod.metadata?.node || rootNode?.name || 'minikube'}</span>
                          <span className={pod.worst_state === 'Critical' ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
                            {pod.status}
                          </span>
                        </div>

                        {/* Container Breakdown preview */}
                        {pod.containers && pod.containers.length > 0 && (
                          <div className="mt-2 pt-1.5 border-t border-slate-800/80 text-[10px] font-mono space-y-0.5">
                            {pod.containers.map((c, cIdx) => (
                              <div key={cIdx} className="flex items-center justify-between text-slate-300">
                                <span className="truncate max-w-[130px]">{c.name}</span>
                                <span className={c.ready ? 'text-emerald-400' : 'text-rose-400'}>
                                  {c.state} ({c.restarts} restarts)
                                </span>
                              </div>
                            ))}
                          </div>
                        )}

                        {renderCompactEventPills(pod.events)}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TIER 4: Auxiliary Resources (Node, Service, ConfigMap, PVC) */}
              {auxiliaryNodes.length > 0 && (
                <div className="pt-4 border-t border-slate-800/60">
                  <div className="text-[10px] uppercase font-mono font-semibold text-slate-400 mb-2.5 flex items-center gap-1.5">
                    <Boxes className="w-3 h-3 text-cyan-400" />
                    <span>Attached Cluster Infrastructure (Network, Storage, Config)</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {auxiliaryNodes.map((aux) => (
                      <div
                        key={aux.id}
                        onClick={() => setSelectedNode(aux)}
                        className={`p-2.5 rounded-lg border transition-all cursor-pointer ${
                          selectedNode?.id === aux.id
                            ? 'bg-slate-900 border-cyan-400 ring-1 ring-cyan-400/40'
                            : 'bg-slate-900/30 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center space-x-1.5 mb-1">
                          {getNodeIcon(aux.kind)}
                          <span className="text-[11px] font-mono font-bold text-slate-300 truncate">
                            {aux.name}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono">
                          <span>{aux.kind}</span>
                          <span className="text-emerald-400">{aux.status}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          )}

        </div>

        {/* Right Side Node Inspector Drawer */}
        {selectedNode && (
          <div className="w-full lg:w-80 xl:w-96 border-t lg:border-t-0 lg:border-l border-slate-800 bg-[#090d17] p-4 flex flex-col space-y-4 overflow-y-auto">
            
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <div className="p-1.5 rounded-md bg-slate-800">
                  {getNodeIcon(selectedNode.kind)}
                </div>
                <div>
                  <h3 className="text-xs font-bold font-mono text-white truncate max-w-[190px]">
                    {selectedNode.name}
                  </h3>
                  <span className="text-[10px] text-slate-400 font-mono">
                    {selectedNode.kind} in {selectedNode.namespace}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setSelectedNode(null)}
                className="text-slate-400 hover:text-slate-200 p-1"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Health & Status Card */}
            <div className="bg-slate-900/80 border border-slate-800 p-3 rounded-lg space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Worst-State Health:</span>
                {getWorstStateBadge(selectedNode.worst_state)}
              </div>
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-400">Current Phase:</span>
                <span className="text-slate-200">{selectedNode.status}</span>
              </div>
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-400">Native UID:</span>
                <span className="text-[10px] text-cyan-300 truncate max-w-[180px]">{selectedNode.uid}</span>
              </div>
            </div>

            {/* Multi-Container Blame Section (For Pods) */}
            {selectedNode.containers && selectedNode.containers.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-[11px] font-semibold text-slate-300 uppercase font-mono">
                  Container Health Breakdown
                </h4>
                <div className="space-y-1.5">
                  {selectedNode.containers.map((c, idx) => (
                    <div
                      key={idx}
                      className={`p-2 rounded border text-xs font-mono ${
                        c.ready ? 'bg-slate-900/40 border-slate-800 text-slate-300' : 'bg-rose-950/40 border-rose-800 text-rose-200'
                      }`}
                    >
                      <div className="flex items-center justify-between font-bold">
                        <span>{c.name}</span>
                        <span>{c.ready ? 'Ready (1/1)' : 'Not Ready (0/1)'}</span>
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1">
                        <span>Restarts: {c.restarts}</span>
                        <span>State: {c.state}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Categorized Events Section with ×N Multipliers */}
            <div className="space-y-2 flex-1">
              <div className="flex items-center justify-between">
                <h4 className="text-[11px] font-semibold text-slate-300 uppercase font-mono">
                  Categorized Events ({selectedNode.events.length})
                </h4>
              </div>

              {selectedNode.events.length === 0 ? (
                <p className="text-xs text-slate-500 italic py-2">No warning events currently firing on this object.</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {selectedNode.events.map((ev, idx) => (
                    <div key={idx} className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 space-y-1 text-xs">
                      <div className="flex items-center justify-between">
                        <span className={`px-2 py-0.5 text-[9px] font-mono font-bold rounded border ${getCategoryColor(ev.category)}`}>
                          {ev.category}
                        </span>
                        {ev.multiplier_str && (
                          <span className="text-[10px] font-mono font-bold text-orange-400 bg-orange-950/80 border border-orange-800 px-1.5 py-0.2 rounded">
                            {ev.multiplier_str} occurrences
                          </span>
                        )}
                      </div>
                      <div className="font-semibold text-slate-200">{ev.reason}</div>
                      <div className="text-[11px] text-slate-400 leading-relaxed">{ev.message}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        )}

      </div>

    </div>
  );
};
