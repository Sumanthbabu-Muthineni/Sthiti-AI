import React, { useState } from 'react';
import { 
  ShieldCheck, 
  AlertTriangle, 
  GitPullRequest, 
  Terminal, 
  Check, 
  X, 
  Loader2, 
  Sparkles, 
  Eye, 
  Layers, 
  Zap, 
  Flame, 
  Activity,
  Boxes
} from 'lucide-react';
import type { PendingApproval } from '../types';
import { DiffViewer } from './DiffViewer';
import { InfraMap } from './InfraMap';

interface ApprovalCenterProps {
  pendingApprovals: PendingApproval[];
  selectedThreadId: string | null;
  onApprove: (threadId: string, approved: boolean, comment?: string) => Promise<void>;
  onOpenInfraMap?: (target: { namespace: string; kind: string; name: string }) => void;
  isProcessing: boolean;
}

export const ApprovalCenter: React.FC<ApprovalCenterProps> = ({
  pendingApprovals,
  selectedThreadId,
  onApprove,
  onOpenInfraMap,
  isProcessing,
}) => {
  const [comment, setComment] = useState<string>('');
  const [showLogs, setShowLogs] = useState<boolean>(false);
  const [showInlineMap, setShowInlineMap] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Find active pending approval
  const activeApproval = 
    pendingApprovals.find((p) => p.thread_id === selectedThreadId) ||
    pendingApprovals[0] ||
    null;

  const handleDecision = async (approved: boolean) => {
    if (!activeApproval) return;
    setActionError(null);
    try {
      await onApprove(activeApproval.thread_id, approved, comment);
      setComment('');
    } catch (err: any) {
      setActionError(err.message || 'Failed to submit decision');
    }
  };

  if (!activeApproval) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center bg-[#080c14] border-b border-slate-800">
        <div className="w-16 h-16 rounded-2xl bg-emerald-950/40 border border-emerald-800/40 flex items-center justify-center text-emerald-400 mb-4 shadow-lg shadow-emerald-900/20">
          <ShieldCheck className="w-8 h-8" />
        </div>
        <h3 className="text-base font-semibold text-slate-200">All Systems Nominal</h3>
        <p className="text-xs text-slate-400 max-w-md mt-1 mb-6">
          No pending remediations awaiting operator approval. The autonomous watchdog is actively monitoring cluster telemetry.
        </p>
      </div>
    );
  }

  const { event, analysis, proposed_action, sanitized_logs = [] } = activeApproval;
  const isGitOps = proposed_action.action_type === 'gitops';
  const confidencePercent = Math.round((analysis.confidence_score || 0.95) * 100);
  const alertCount = activeApproval.alert_count || event.alert_count || 1;
  const reasonsList = activeApproval.reasons || event.reasons || (event.reason ? [event.reason] : ['Cluster Alert']);
  const deploymentName = activeApproval.deployment_name || event.resource_name || 'workload';

  return (
    <div className="flex-1 flex flex-col bg-[#080c14] overflow-y-auto p-4 lg:p-6 space-y-6">
      
      {/* Top Banner: Incident Context */}
      <div className="glass-panel rounded-xl p-4 lg:p-5 border border-slate-800 relative overflow-hidden">
        <div className="absolute top-0 right-0 transform translate-x-4 -translate-y-4 w-32 h-32 bg-cyan-500/5 rounded-full blur-2xl pointer-events-none" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`px-2.5 py-0.5 text-xs font-semibold uppercase rounded-md ${
                event.severity === 'Critical' 
                  ? 'bg-rose-950/80 text-rose-300 border border-rose-800/60'
                  : 'bg-amber-950/80 text-amber-300 border border-amber-800/60'
              }`}>
                {event.severity} Alert
              </span>

              {/* Cumulative Alert Counter Badge */}
              <span className={`px-2.5 py-0.5 text-xs font-mono font-bold rounded-md flex items-center gap-1.5 ${
                alertCount > 1
                  ? 'bg-orange-950/90 text-orange-300 border border-orange-700/70 shadow-sm animate-pulse'
                  : 'bg-cyan-950/80 text-cyan-300 border border-cyan-700/60'
              }`}>
                {alertCount > 1 ? (
                  <Flame className="w-3.5 h-3.5 text-orange-400" />
                ) : (
                  <Zap className="w-3.5 h-3.5 text-cyan-400" />
                )}
                <span>{alertCount} Cumulative {alertCount === 1 ? 'Alert' : 'Alerts'}</span>
              </span>

              {/* Multi-Reason Pills */}
              {reasonsList.map((r, idx) => (
                <span 
                  key={idx}
                  className={`text-xs font-mono px-2.5 py-0.5 rounded border ${
                    idx === 0 
                      ? 'bg-slate-800 text-cyan-300 border-slate-700 font-semibold' 
                      : 'bg-slate-900 text-slate-300 border-slate-800'
                  }`}
                >
                  {r}
                </span>
              ))}

              <span className="text-xs text-slate-400 font-mono">
                Thread: {activeApproval.thread_id}
              </span>
            </div>

            <div>
              <h2 className="text-lg font-bold text-white font-mono flex items-center gap-2">
                <Layers className="w-4 h-4 text-indigo-400" />
                {deploymentName}
                <span className="text-xs text-slate-400 font-sans font-normal">
                  ({event.resource_kind}/{event.resource_name}) in namespace <strong className="text-slate-200 font-mono">{event.namespace}</strong>
                </span>
              </h2>

              {reasonsList.length > 1 && (
                <div className="flex items-center gap-1.5 text-xs text-amber-300/90 mt-1 font-sans">
                  <Activity className="w-3.5 h-3.5 text-amber-400" />
                  <span>
                    Multiple failure symptoms consolidated into this single incident: <strong className="text-slate-200 font-mono">{reasonsList.join(' → ')}</strong> ({alertCount} total events)
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Full Infra Map Button */}
            <button
              onClick={() => {
                if (onOpenInfraMap) {
                  onOpenInfraMap({
                    namespace: event.namespace || 'watchdog-demo',
                    kind: event.resource_kind || 'Deployment',
                    name: deploymentName
                  });
                } else {
                  setShowInlineMap(true);
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-950/90 hover:bg-indigo-900 text-cyan-300 border border-indigo-700/60 hover:border-cyan-500/60 transition-all text-xs font-mono font-semibold cursor-pointer shadow-sm"
              title="Open Full Screen Infra Map"
            >
              <Boxes className="w-3.5 h-3.5 text-cyan-400" />
              <span>⚡ Full Infra Map</span>
            </button>

            {/* Toggle Inline Preview */}
            <button
              onClick={() => setShowInlineMap(!showInlineMap)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-mono transition-all cursor-pointer ${
                showInlineMap 
                  ? 'bg-cyan-950 text-cyan-300 border-cyan-600' 
                  : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
              }`}
              title="Toggle Inline Topology Preview"
            >
              <span>{showInlineMap ? 'Hide Preview' : '🗺️ Preview Topology'}</span>
            </button>

            <div className="flex items-center space-x-2 bg-slate-900/90 border border-slate-800 px-3 py-1.5 rounded-lg">
              <div className="text-right">
                <div className="text-[9px] text-slate-400 uppercase tracking-wider font-semibold">Confidence</div>
                <div className="text-xs font-bold text-cyan-400 font-mono">{confidencePercent}%</div>
              </div>
              <div className="w-6 h-6 rounded-full border border-cyan-500/40 flex items-center justify-center text-cyan-400">
                <Sparkles className="w-3 h-3" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Inline Kubernetes Neighborhood Map Preview */}
      {showInlineMap && (
        <div className="rounded-xl overflow-hidden border border-cyan-500/40 bg-[#070a12] shadow-2xl animate-in fade-in">
          <div className="px-4 py-2 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between text-xs font-mono">
            <div className="flex items-center gap-2 text-slate-200">
              <Boxes className="w-4 h-4 text-cyan-400" />
              <span>Kubernetes Neighborhood Topology: <strong className="text-cyan-300">{deploymentName}</strong></span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (onOpenInfraMap) {
                    onOpenInfraMap({
                      namespace: event.namespace || 'watchdog-demo',
                      kind: event.resource_kind || 'Deployment',
                      name: deploymentName
                    });
                  }
                }}
                className="text-[11px] text-cyan-400 hover:underline px-2.5 py-0.5 rounded bg-cyan-950/60 border border-cyan-800/60 cursor-pointer"
              >
                Open Full Screen ↗
              </button>
              <button
                onClick={() => setShowInlineMap(false)}
                className="text-slate-400 hover:text-white px-1.5 py-0.5 rounded hover:bg-slate-800 cursor-pointer"
                title="Close Preview"
              >
                ✕
              </button>
            </div>
          </div>
          <InfraMap
            initialNamespace={event.namespace || 'watchdog-demo'}
            initialKind={event.resource_kind || 'Deployment'}
            initialName={deploymentName}
            isEmbedded={true}
            onClose={() => setShowInlineMap(false)}
          />
        </div>
      )}

      {/* Grid: Root Cause Analysis & Proposed Fix */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        
        {/* Left Column: AI RCA Analysis Card (5 Cols) */}
        <div className="xl:col-span-5 space-y-4">
          <div className="glass-panel rounded-xl p-5 border border-slate-800 space-y-4 h-full flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center space-x-2 text-slate-200 font-semibold text-sm">
                  <Sparkles className="w-4 h-4 text-cyan-400" />
                  <span>AI Root Cause Analysis</span>
                </div>
                <span className="text-[10px] font-mono bg-cyan-950/60 text-cyan-300 border border-cyan-800/40 px-2 py-0.5 rounded">
                  gpt-4o
                </span>
              </div>

              {/* Summary */}
              <div className="bg-slate-900/80 border border-slate-800/80 p-3.5 rounded-lg">
                <h4 className="text-xs font-semibold text-amber-300 mb-1 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Root Cause Identified
                </h4>
                <p className="text-xs text-slate-200 leading-relaxed">
                  {analysis.root_cause_summary}
                </p>
              </div>

              {/* Deep Technical Explanation */}
              <div className="space-y-1.5">
                <h4 className="text-xs font-semibold text-slate-300">Technical Assessment</h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  {analysis.detailed_explanation}
                </p>
              </div>

              {/* Blast Radius */}
              <div className="bg-slate-900/40 border border-slate-800 p-3 rounded-lg flex items-center justify-between text-xs">
                <div className="flex items-center space-x-2 text-slate-400">
                  <Layers className="w-4 h-4 text-purple-400" />
                  <span>Blast Radius:</span>
                </div>
                <span className="font-mono text-slate-200 font-medium">{analysis.blast_radius}</span>
              </div>
            </div>

            {/* Sanitized Log Drawer Toggle */}
            <div className="pt-2 border-t border-slate-800/80">
              <button
                onClick={() => setShowLogs(!showLogs)}
                className="flex items-center justify-between w-full text-xs text-slate-400 hover:text-cyan-300 transition-colors py-1 cursor-pointer"
              >
                <span className="flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5" />
                  {showLogs ? 'Hide Sanitized Diagnostic Logs' : 'View Sanitized Diagnostic Logs'}
                </span>
                <span className="font-mono text-[10px] bg-slate-800 px-1.5 py-0.5 rounded">
                  {sanitized_logs.length} lines
                </span>
              </button>

              {showLogs && (
                <div className="mt-2 p-3 bg-slate-950 border border-slate-800 rounded-lg max-h-48 overflow-y-auto font-mono text-[11px] text-slate-300 space-y-1">
                  {sanitized_logs.map((line, idx) => (
                    <div key={idx} className="whitespace-pre-wrap leading-tight text-slate-400">
                      {line}
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        </div>

        {/* Right Column: Proposed Remediation & Diff/Command (7 Cols) */}
        <div className="xl:col-span-7 space-y-4">
          <div className="glass-panel rounded-xl p-5 border border-slate-800 space-y-4">
            
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2 text-slate-200 font-semibold text-sm">
                {isGitOps ? (
                  <GitPullRequest className="w-4 h-4 text-purple-400" />
                ) : (
                  <Terminal className="w-4 h-4 text-cyan-400" />
                )}
                <span>Proposed Remediation Plan</span>
              </div>

              {/* Action Mode Badge */}
              <span className={`px-2.5 py-0.5 text-xs font-mono font-bold uppercase rounded border ${
                isGitOps
                  ? 'bg-purple-950/80 text-purple-300 border-purple-700/60'
                  : 'bg-cyan-950/80 text-cyan-300 border-cyan-700/60'
              }`}>
                {isGitOps ? '[GITOPS - Config PR]' : '[IMPERATIVE - Runtime Action]'}
              </span>
            </div>

            {/* Action Title & Description */}
            <div className="space-y-2">
              <h3 className="text-sm font-bold text-white">
                {proposed_action.action_title}
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                {proposed_action.action_description}
              </p>
            </div>

            {/* Diff / Command Preview */}
            <DiffViewer action={proposed_action} />

            {/* Approver Input & Decision Buttons */}
            <div className="pt-4 border-t border-slate-800 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Approver Feedback / Audit Comment (Optional):
                </label>
                <input
                  type="text"
                  placeholder="e.g., Approved memory scale-up for peak batch traffic..."
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  disabled={isProcessing}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500 transition-colors"
                />
              </div>

              {actionError && (
                <div className="p-2 bg-rose-950/50 border border-rose-800 text-rose-300 text-xs rounded">
                  {actionError}
                </div>
              )}

              <div className="flex items-center justify-end space-x-3 pt-2">
                <button
                  onClick={() => handleDecision(false)}
                  disabled={isProcessing}
                  className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-rose-950/40 text-rose-300 border border-rose-900/60 hover:border-rose-700 rounded-lg text-xs font-semibold transition-all cursor-pointer disabled:opacity-50"
                >
                  <X className="w-4 h-4 text-rose-400" />
                  Reject & Dismiss
                </button>

                <button
                  onClick={() => handleDecision(true)}
                  disabled={isProcessing}
                  className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-lg text-xs font-bold shadow-lg shadow-emerald-900/30 hover:shadow-emerald-700/50 transition-all cursor-pointer disabled:opacity-50"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-white" />
                      Executing Remediation...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4 text-white stroke-[3]" />
                      Approve & Execute Fix
                    </>
                  )}
                </button>
              </div>
            </div>

          </div>
        </div>

      </div>

    </div>
  );
};
