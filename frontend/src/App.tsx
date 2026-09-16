import { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { EventFeed } from './components/EventFeed';
import { ApprovalCenter } from './components/ApprovalCenter';
import { LiveTerminal } from './components/LiveTerminal';
import { AuditHistory } from './components/AuditHistory';
import { SimulateModal } from './components/SimulateModal';
import { InfraMap } from './components/InfraMap';
import { useSSE } from './hooks/useSSE';
import { api } from './services/api';
import type { PendingApproval, EventRecord, AuditRecord, SSEMessage, ClusterInfo } from './types';

export function App() {
  const [activeView, setActiveView] = useState<'dashboard' | 'inframap' | 'history'>('dashboard');
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditRecord[]>([]);
  const [clusterInfo, setClusterInfo] = useState<ClusterInfo | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [infraMapTarget, setInfraMapTarget] = useState<{ namespace: string; kind: string; name: string }>({
    namespace: 'watchdog-demo',
    kind: 'Deployment',
    name: 'payment-processor',
  });
  const [isSimulateOpen, setIsSimulateOpen] = useState<boolean>(false);
  const [isProcessingApproval, setIsProcessingApproval] = useState<boolean>(false);
  const [scrubbedTokenCount, setScrubbedTokenCount] = useState<number>(14);

  // Fetch initial data
  const loadData = useCallback(async () => {
    try {
      const [pending, evs, audits, cluster] = await Promise.all([
        api.getPendingApprovals(),
        api.getEvents(),
        api.getAuditLogs(),
        api.getClusterStatus().catch(() => null),
      ]);

      setPendingApprovals(pending);
      setEvents(evs);
      setAuditLogs(audits);
      if (cluster) setClusterInfo(cluster);

      if (pending.length > 0 && !selectedThreadId) {
        setSelectedThreadId(pending[0].thread_id);
      }
    } catch (err) {
      console.error('Error fetching cluster watchdog data:', err);
    }
  }, [selectedThreadId]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Handle incoming real-time SSE messages
  const handleSSEEvent = useCallback((msg: SSEMessage) => {
    if (msg.event_type === 'approval_required' || msg.event_type === 'done' || msg.event_type === 'state_change' || msg.event_type === 'event_received') {
      loadData();
    }

    if (msg.event_type === 'tool_call' && msg.data?.scrubbed_tokens) {
      setScrubbedTokenCount((prev) => prev + Number(msg.data.scrubbed_tokens));
    }

    if (msg.event_type === 'approval_required' && msg.thread_id) {
      setSelectedThreadId(msg.thread_id);
    }
  }, [loadData]);

  // SSE Hook
  const { connected, entries, clearEntries } = useSSE({
    onEvent: handleSSEEvent,
  });

  // Action Approval Handler
  const handleApprove = async (threadId: string, approved: boolean, comment?: string) => {
    setIsProcessingApproval(true);
    try {
      await api.approveRemediation(threadId, approved, comment);
      // Wait briefly for graph execution to register
      setTimeout(() => {
        loadData();
        setIsProcessingApproval(false);
      }, 1200);
    } catch (err) {
      console.error('Approval failed:', err);
      setIsProcessingApproval(false);
      throw err;
    }
  };

  const handleOpenInfraMap = (target: { namespace: string; kind: string; name: string }) => {
    setInfraMapTarget(target);
    setActiveView('inframap');
  };

  const remediatedCount = auditLogs.filter((a) => a.human_approved === true).length;
  const totalAlertsCount = events.reduce(
    (sum, e) => sum + (e.alert_count || e.event?.alert_count || 1),
    0
  );

  return (
    <div className="min-h-screen bg-[#080c14] text-slate-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
      
      {/* Top Header with Live Minikube Cluster Telemetry */}
      <Header
        connected={connected}
        pendingCount={pendingApprovals.length}
        remediatedCount={remediatedCount}
        totalAlerts={totalAlertsCount}
        scrubbedCount={scrubbedTokenCount}
        activeView={activeView}
        clusterInfo={clusterInfo}
        onViewChange={setActiveView}
        onOpenSimulate={() => setIsSimulateOpen(true)}
      />

      {/* Main App Body */}
      {activeView === 'history' ? (
        <AuditHistory
          auditLogs={auditLogs}
          onClose={() => setActiveView('dashboard')}
        />
      ) : activeView === 'inframap' ? (
        <div className="flex-1 h-[calc(100vh-65px)] overflow-hidden">
          <InfraMap
            initialNamespace={infraMapTarget.namespace}
            initialKind={infraMapTarget.kind}
            initialName={infraMapTarget.name}
            onClose={() => setActiveView('dashboard')}
          />
        </div>
      ) : (
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
          
          {/* Left Event Feed Sidebar */}
          <EventFeed
            events={events}
            selectedThreadId={selectedThreadId}
            onSelectEvent={(threadId) => setSelectedThreadId(threadId)}
            onOpenInfraMap={handleOpenInfraMap}
            onTriggerSimulate={() => setIsSimulateOpen(true)}
          />

          {/* Center / Right Workspace */}
          <main className="flex-1 flex flex-col h-[calc(100vh-65px)] overflow-hidden">
            
            {/* Upper Half: Approval Center */}
            <ApprovalCenter
              pendingApprovals={pendingApprovals}
              selectedThreadId={selectedThreadId}
              onApprove={handleApprove}
              onOpenInfraMap={handleOpenInfraMap}
              isProcessing={isProcessingApproval}
            />

            {/* Lower Half: Live Terminal */}
            <LiveTerminal
              entries={entries}
              onClear={clearEntries}
            />

          </main>

        </div>
      )}

      {/* Simulation Modal */}
      <SimulateModal
        isOpen={isSimulateOpen}
        onClose={() => setIsSimulateOpen(false)}
        onAlertTriggered={loadData}
      />

    </div>
  );
}

export default App;
