import React, { useState } from 'react';
import { 
  Search, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  ShieldAlert,
  Server,
  Zap,
  Flame,
  Layers,
  Boxes
} from 'lucide-react';
import type { EventRecord, SeverityLevel } from '../types';

interface EventFeedProps {
  events: EventRecord[];
  selectedThreadId: string | null;
  onSelectEvent: (threadId: string) => void;
  onOpenInfraMap?: (target: { namespace: string; kind: string; name: string }) => void;
  onTriggerSimulate: () => void;
}

export const EventFeed: React.FC<EventFeedProps> = ({
  events,
  selectedThreadId,
  onSelectEvent,
  onOpenInfraMap,
  onTriggerSimulate,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filteredEvents = events.filter((record) => {
    const ev = record.event || {};
    const reasonsList = record.reasons || ev.reasons || [ev.reason || ''];
    const query = searchQuery.toLowerCase().trim();

    const matchesSearch = 
      !query ||
      (ev.resource_name || '').toLowerCase().includes(query) ||
      (record.deployment_name || '').toLowerCase().includes(query) ||
      (ev.namespace || '').toLowerCase().includes(query) ||
      (ev.reason || '').toLowerCase().includes(query) ||
      (ev.message || '').toLowerCase().includes(query) ||
      reasonsList.some((r) => r.toLowerCase().includes(query));
    
    const matchesStatus = statusFilter === 'all' || record.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const totalAlertsCount = filteredEvents.reduce(
    (sum, r) => sum + (r.alert_count || r.event?.alert_count || 1),
    0
  );

  const getSeverityBadge = (severity: SeverityLevel = 'Critical') => {
    switch (severity) {
      case 'Critical':
        return (
          <span className="px-2 py-0.5 text-[10px] font-semibold uppercase bg-rose-950/80 text-rose-300 border border-rose-800/60 rounded">
            Critical
          </span>
        );
      case 'Warning':
        return (
          <span className="px-2 py-0.5 text-[10px] font-semibold uppercase bg-amber-950/80 text-amber-300 border border-amber-800/60 rounded">
            Warning
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 text-[10px] font-semibold uppercase bg-cyan-950/80 text-cyan-300 border border-cyan-800/60 rounded">
            Info
          </span>
        );
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'awaiting_approval':
        return (
          <span className="flex items-center gap-1 text-[11px] font-medium text-amber-400">
            <Clock className="w-3 h-3 text-amber-400 animate-pulse" />
            Awaiting Approval
          </span>
        );
      case 'analyzing':
      case 'investigating':
        return (
          <span className="flex items-center gap-1 text-[11px] font-medium text-cyan-400">
            <Loader2 className="w-3 h-3 text-cyan-400 animate-spin" />
            AI Investigating
          </span>
        );
      case 'remediated':
        return (
          <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-400">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            Remediated
          </span>
        );
      case 'rejected':
        return (
          <span className="flex items-center gap-1 text-[11px] font-medium text-slate-400">
            <XCircle className="w-3 h-3 text-slate-400" />
            Dismissed
          </span>
        );
      default:
        return (
          <span className="text-[11px] text-slate-400 capitalize">{status}</span>
        );
    }
  };

  return (
    <aside className="w-full lg:w-80 xl:w-96 flex flex-col bg-[#0b0f19] border-r border-slate-800 h-[calc(100vh-65px)] overflow-hidden">
      
      {/* Header & Filter Controls */}
      <div className="p-3.5 border-b border-slate-800 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Server className="w-4 h-4 text-cyan-400" />
            <h2 className="text-sm font-semibold text-slate-200">Incident Feed</h2>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-cyan-400 font-mono bg-cyan-950/80 border border-cyan-800/60 px-2 py-0.5 rounded font-semibold flex items-center gap-1">
              <Zap className="w-2.5 h-2.5" />
              {totalAlertsCount} alerts
            </span>
            <span className="text-xs text-slate-400 font-mono bg-slate-800/80 px-2 py-0.5 rounded">
              {filteredEvents.length} {filteredEvents.length === 1 ? 'incident' : 'incidents'}
            </span>
          </div>
        </div>

        {/* Search input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Filter by deployment, reason, namespace..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-900/90 text-slate-200 text-xs pl-8 pr-3 py-1.5 rounded border border-slate-700 focus:outline-none focus:border-cyan-500 transition-colors placeholder:text-slate-500 font-sans"
          />
        </div>

        {/* Status filter pills */}
        <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 text-[11px]">
          {['all', 'awaiting_approval', 'analyzing', 'remediated'].map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-2 py-0.5 rounded capitalize whitespace-nowrap transition-colors ${
                statusFilter === st
                  ? 'bg-cyan-900/60 text-cyan-200 border border-cyan-700/60'
                  : 'bg-slate-900/60 text-slate-400 hover:bg-slate-800/60'
              }`}
            >
              {st === 'awaiting_approval' ? 'Pending' : st}
            </button>
          ))}
        </div>
      </div>

      {/* Events List */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
        {filteredEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-slate-900 flex items-center justify-center border border-slate-800 text-slate-500">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-300">No matching cluster incidents</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Cluster is healthy or filters are too restrictive.
              </p>
            </div>
            <button
              onClick={onTriggerSimulate}
              className="text-xs text-cyan-400 hover:text-cyan-300 underline font-medium cursor-pointer"
            >
              Trigger a test alert
            </button>
          </div>
        ) : (
          filteredEvents.map((record) => {
            const ev = record.event || {};
            const isSelected = selectedThreadId === record.thread_id;
            const alertCount = record.alert_count || ev.alert_count || 1;
            const reasonsList = record.reasons || ev.reasons || (ev.reason ? [ev.reason] : ['Alert']);
            const deploymentName = record.deployment_name || ev.resource_name || 'workload';

            const timeFormatted = new Date(record.created_at || Date.now()).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            });

            return (
              <div
                key={record.thread_id}
                onClick={() => onSelectEvent(record.thread_id)}
                className={`p-3.5 transition-all cursor-pointer border-l-2 ${
                  isSelected
                    ? 'bg-slate-800/90 border-l-cyan-400 shadow-inner ring-1 ring-cyan-500/20'
                    : 'bg-transparent border-l-transparent hover:bg-slate-900/70'
                }`}
              >
                <div className="space-y-2">
                  
                  {/* Top Row: Severity Badge + Cumulative Alert Count + Status */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      {getSeverityBadge(ev.severity)}

                      {/* Cumulative Alert Badge */}
                      <span className={`px-2 py-0.5 text-[10px] font-mono font-bold rounded flex items-center gap-1 ${
                        alertCount > 1 
                          ? 'bg-orange-950/80 text-orange-300 border border-orange-700/60 shadow-sm animate-pulse' 
                          : 'bg-cyan-950/70 text-cyan-300 border border-cyan-800/50'
                      }`}>
                        {alertCount > 1 ? (
                          <Flame className="w-3 h-3 text-orange-400" />
                        ) : (
                          <Zap className="w-3 h-3 text-cyan-400" />
                        )}
                        <span>{alertCount} {alertCount === 1 ? 'alert' : 'alerts'}</span>
                      </span>
                    </div>

                    <div className="flex items-center">
                      {getStatusBadge(record.status)}
                    </div>
                  </div>

                  {/* Target Workload / Deployment Info */}
                  <div className="space-y-0.5">
                    <div className="flex items-center space-x-1.5">
                      <Layers className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                      <span className="font-mono text-xs font-bold text-white truncate">
                        {deploymentName}
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-400 font-mono truncate pl-5">
                      {ev.resource_kind}/{ev.resource_name}
                    </div>
                  </div>

                  {/* All Observed Failure Reasons (Multi-Reason Tag List) */}
                  <div className="flex flex-wrap items-center gap-1 pt-0.5">
                    {reasonsList.map((reasonStr, idx) => (
                      <span 
                        key={idx}
                        className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                          idx === 0
                            ? 'bg-slate-800 text-cyan-200 border-slate-700 font-medium'
                            : 'bg-slate-900/90 text-slate-300 border-slate-800'
                        }`}
                      >
                        {reasonStr}
                      </span>
                    ))}
                  </div>

                  {/* Footer Context: Namespace, Timestamp, and 1-Click Infra Map */}
                  <div className="flex items-center justify-between text-[10px] text-slate-400 font-sans pt-1 border-t border-slate-800/60">
                    <div className="flex items-center space-x-1.5">
                      <span className="bg-slate-900 px-1.5 py-0.5 rounded font-mono text-slate-300">
                        ns: {ev.namespace}
                      </span>

                      {onOpenInfraMap && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenInfraMap({
                              namespace: ev.namespace || 'watchdog-demo',
                              kind: ev.resource_kind || 'Deployment',
                              name: deploymentName
                            });
                          }}
                          className="flex items-center gap-1 text-[10px] font-mono text-cyan-400 hover:text-cyan-200 bg-cyan-950/70 hover:bg-cyan-900/80 border border-cyan-800/70 px-1.5 py-0.5 rounded transition-all cursor-pointer shadow-sm hover:shadow-cyan-500/20"
                          title="1-Click Jump to Kubernetes Neighborhood (Infra Map)"
                        >
                          <Boxes className="w-3 h-3 text-cyan-400" />
                          <span>Infra Map</span>
                        </button>
                      )}
                    </div>

                    <div className="flex items-center space-x-1 font-mono text-slate-400">
                      <span>Ingested:</span>
                      <span className="text-slate-300">{timeFormatted}</span>
                    </div>
                  </div>

                </div>
              </div>
            );
          })
        )}
      </div>

    </aside>
  );
};

