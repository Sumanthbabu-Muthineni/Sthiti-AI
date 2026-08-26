import React, { useState } from 'react';
import { 
  History, 
  CheckCircle2, 
  XCircle, 
  MessageSquare, 
  ShieldCheck,
  Calendar,
  GitPullRequest,
  ExternalLink,
  GitBranch,
  Terminal,
  ChevronDown,
  ChevronUp,
  FileCode,
  Zap,
  Flame,
  Layers
} from 'lucide-react';
import type { AuditRecord } from '../types';

interface AuditHistoryProps {
  auditLogs: AuditRecord[];
  onClose: () => void;
}

export const AuditHistory: React.FC<AuditHistoryProps> = ({ auditLogs, onClose }) => {
  const [expandedDiffs, setExpandedDiffs] = useState<Record<number, boolean>>({});

  const toggleDiff = (idx: number) => {
    setExpandedDiffs((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  return (
    <div className="flex-1 flex flex-col bg-[#080c14] overflow-y-auto p-4 lg:p-6 space-y-6">
      
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-lg bg-cyan-950/60 border border-cyan-800/60 flex items-center justify-center text-cyan-400">
            <History className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">Compliance & Remediation Audit Log</h2>
            <p className="text-xs text-slate-400">
              Immutable record of AI investigation traces, proposed fixes, GitHub Pull Requests, and operator decisions.
            </p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="text-xs text-slate-300 hover:text-white bg-slate-800/90 hover:bg-slate-700/90 px-3.5 py-1.5 rounded-md border border-slate-700 transition-colors cursor-pointer font-medium"
        >
          Close Log View
        </button>
      </div>

      {/* Audit Record Cards */}
      {auditLogs.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-16 text-center text-slate-500 space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-slate-900 flex items-center justify-center border border-slate-800 text-slate-600">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <p className="text-sm font-semibold text-slate-300">No Historical Audit Logs Yet</p>
          <p className="text-xs text-slate-500 max-w-sm">
            When you approve or dismiss an alert remediation, an immutable audit trail with GitHub PR links and diffs will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {auditLogs.map((log, idx) => {
            const isApproved = log.human_approved === true;
            const dateFormatted = new Date(log.timestamp).toLocaleString([], {
              dateStyle: 'medium',
              timeStyle: 'medium'
            });
            const isDiffExpanded = expandedDiffs[idx] ?? true;
            const alertCount = log.alert_count || 1;
            const reasonsList = log.reasons || [];
            const isGitOps = log.action_type === 'gitops' || Boolean(log.pr_url) || Boolean(log.gitops_diff);

            return (
              <div 
                key={idx} 
                className="glass-panel rounded-xl p-5 border border-slate-800 space-y-4 relative overflow-hidden shadow-lg"
              >
                {/* Top Row: Status + Resource + Time */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800/80 pb-3.5">
                  <div className="flex flex-wrap items-center gap-2.5">
                    {isApproved ? (
                      <span className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-700/60">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Remediated & Executed
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded bg-rose-950/80 text-rose-300 border border-rose-700/60">
                        <XCircle className="w-3.5 h-3.5" />
                        Rejected by Operator
                      </span>
                    )}

                    <span className="font-mono text-xs font-bold text-white flex items-center gap-1.5 bg-slate-900 px-2.5 py-1 rounded border border-slate-800">
                      <Layers className="w-3.5 h-3.5 text-indigo-400" />
                      {log.resource}
                    </span>

                    {/* Cumulative Alert Badge */}
                    <span className={`px-2 py-0.5 text-[10px] font-mono font-bold rounded flex items-center gap-1 ${
                      alertCount > 1 
                        ? 'bg-orange-950/80 text-orange-300 border border-orange-700/60' 
                        : 'bg-cyan-950/70 text-cyan-300 border border-cyan-800/50'
                    }`}>
                      {alertCount > 1 ? <Flame className="w-3 h-3 text-orange-400" /> : <Zap className="w-3 h-3 text-cyan-400" />}
                      <span>{alertCount} {alertCount === 1 ? 'alert' : 'alerts'}</span>
                    </span>

                    {/* Symptom Pills */}
                    {reasonsList.map((r, rIdx) => (
                      <span key={rIdx} className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-800">
                        {r}
                      </span>
                    ))}
                  </div>

                  <div className="flex items-center space-x-2 text-xs text-slate-400 font-mono">
                    <Calendar className="w-3.5 h-3.5 text-slate-500" />
                    <span>{dateFormatted}</span>
                  </div>
                </div>

                {/* Core RCA & Action Summary */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="space-y-1.5 bg-slate-900/70 p-3.5 rounded-lg border border-slate-800/80">
                    <span className="text-[11px] text-amber-400 font-semibold uppercase tracking-wider block">
                      Identified Root Cause:
                    </span>
                    <p className="text-slate-200 leading-relaxed">{log.root_cause || 'Root cause analyzed and verified.'}</p>
                  </div>

                  <div className="space-y-1.5 bg-slate-900/70 p-3.5 rounded-lg border border-slate-800/80">
                    <span className="text-[11px] text-cyan-400 font-semibold uppercase tracking-wider block">
                      Action Proposed & Applied:
                    </span>
                    <p className="text-slate-200 leading-relaxed font-medium">{log.action_taken}</p>
                  </div>
                </div>

                {/* GitOps Pull Request & Branch Information (if GitOps fix) */}
                {isGitOps && (
                  <div className="bg-slate-950/80 rounded-lg border border-slate-800 p-3.5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                          <GitPullRequest className="w-4 h-4 text-purple-400" />
                          GitOps Remediation PR:
                        </span>

                        {log.branch_name && (
                          <span className="text-[11px] font-mono bg-slate-900 text-slate-300 px-2 py-0.5 rounded border border-slate-800 flex items-center gap-1">
                            <GitBranch className="w-3 h-3 text-slate-400" />
                            {log.branch_name}
                          </span>
                        )}
                      </div>

                      {/* Clickable GitHub PR Link */}
                      {log.pr_url && (
                        <a
                          href={log.pr_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md bg-purple-950/80 text-purple-200 border border-purple-700/60 hover:bg-purple-900 transition-colors shadow-sm cursor-pointer"
                        >
                          <GitPullRequest className="w-3.5 h-3.5 text-purple-400" />
                          <span>View Pull Request on GitHub</span>
                          <ExternalLink className="w-3 h-3 text-purple-400 ml-0.5" />
                        </a>
                      )}
                    </div>

                    {/* Applied Unified YAML Diff Preview */}
                    {log.gitops_diff && (
                      <div className="space-y-1.5 pt-1">
                        <button
                          onClick={() => toggleDiff(idx)}
                          className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                        >
                          <FileCode className="w-3.5 h-3.5 text-cyan-400" />
                          <span>Applied Manifest Changes (Unified Diff)</span>
                          {isDiffExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>

                        {isDiffExpanded && (
                          <div className="bg-[#050811] rounded-md p-3 font-mono text-xs overflow-x-auto border border-slate-800/80 max-h-56">
                            {log.gitops_diff.split('\n').map((line, lIdx) => {
                              const isAdd = line.startsWith('+') && !line.startsWith('+++');
                              const isDel = line.startsWith('-') && !line.startsWith('---');
                              const isHeader = line.startsWith('@@') || line.startsWith('---') || line.startsWith('+++');

                              return (
                                <div 
                                  key={lIdx} 
                                  className={`px-1 py-0.5 rounded ${
                                    isAdd 
                                      ? 'bg-emerald-950/60 text-emerald-300 font-semibold' 
                                      : isDel 
                                        ? 'bg-rose-950/60 text-rose-300 font-semibold' 
                                        : isHeader
                                          ? 'text-cyan-400 font-bold'
                                          : 'text-slate-300'
                                  }`}
                                >
                                  {line}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Imperative Command executed (if runtime action) */}
                {log.imperative_command && (
                  <div className="bg-slate-950/80 rounded-lg border border-slate-800 p-3 space-y-1.5">
                    <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
                      <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                      Executed Cluster Command:
                    </span>
                    <div className="bg-[#050811] text-cyan-300 font-mono text-xs p-2.5 rounded border border-slate-800 overflow-x-auto">
                      {log.imperative_command}
                    </div>
                  </div>
                )}

                {/* Operator Approval Note */}
                {log.approver_comment && (
                  <div className="flex items-start space-x-2 bg-slate-950/90 p-3 rounded-lg border border-slate-800 text-xs">
                    <MessageSquare className="w-3.5 h-3.5 text-cyan-400 mt-0.5 shrink-0" />
                    <div className="text-slate-300">
                      <strong className="text-cyan-300">Operator Review Note: </strong>
                      {log.approver_comment}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
};
