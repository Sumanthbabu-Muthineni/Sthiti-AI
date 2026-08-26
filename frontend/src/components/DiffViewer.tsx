import React, { useState } from 'react';
import { Copy, Check, FileCode, Terminal } from 'lucide-react';
import type { ProposedAction } from '../types';

interface DiffViewerProps {
  action: ProposedAction;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({ action }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (action.action_type === 'imperative') {
    const cmd = action.imperative_command || `kubectl get pods -n ${action.namespace || 'default'}`;

    return (
      <div className="rounded-lg border border-slate-700 bg-slate-950 overflow-hidden shadow-lg">
        <div className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-800 text-xs">
          <div className="flex items-center space-x-2 text-slate-300 font-mono">
            <Terminal className="w-4 h-4 text-cyan-400" />
            <span>Imperative Command Preview</span>
          </div>
          <button
            onClick={() => handleCopy(cmd)}
            className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 transition-colors bg-slate-800 px-2 py-1 rounded"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied' : 'Copy Command'}</span>
          </button>
        </div>
        <div className="p-4 font-mono text-xs text-emerald-400 bg-slate-950 overflow-x-auto leading-relaxed">
          <div className="flex items-center space-x-2">
            <span className="text-slate-500 select-none">$</span>
            <span className="text-emerald-300 font-semibold">{cmd}</span>
          </div>
        </div>
      </div>
    );
  }

  // GitOps Diff Viewer
  const diffLines = (action.gitops_diff || '').split('\n');
  const filePath = action.gitops_file_path || 'k8s/deployment.yaml';

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-950 overflow-hidden shadow-lg">
      <div className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-800 text-xs">
        <div className="flex items-center space-x-2 text-slate-300 font-mono">
          <FileCode className="w-4 h-4 text-purple-400" />
          <span className="text-purple-300 font-semibold">{filePath}</span>
          <span className="text-slate-500">• Unified GitOps Patch</span>
        </div>
        <button
          onClick={() => handleCopy(action.gitops_diff || '')}
          className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 transition-colors bg-slate-800 px-2 py-1 rounded"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? 'Copied Diff' : 'Copy Diff'}</span>
        </button>
      </div>

      <div className="p-3 font-mono text-xs overflow-x-auto divide-y divide-slate-900/40 select-text">
        {diffLines.length > 0 && diffLines[0] ? (
          diffLines.map((line, idx) => {
            let lineStyle = 'text-slate-400 bg-transparent';
            let prefixBg = 'text-slate-600';

            if (line.startsWith('+') && !line.startsWith('+++')) {
              lineStyle = 'text-emerald-300 bg-emerald-950/40 font-medium';
              prefixBg = 'text-emerald-500 font-bold';
            } else if (line.startsWith('-') && !line.startsWith('---')) {
              lineStyle = 'text-rose-300 bg-rose-950/40 line-through opacity-80';
              prefixBg = 'text-rose-500 font-bold';
            } else if (line.startsWith('@@')) {
              lineStyle = 'text-cyan-400 bg-cyan-950/20 font-semibold';
            }

            return (
              <div key={idx} className={`flex items-start py-0.5 px-2 rounded-sm ${lineStyle}`}>
                <span className={`w-6 text-right select-none pr-3 text-[10px] ${prefixBg}`}>
                  {idx + 1}
                </span>
                <span className="flex-1 whitespace-pre">{line}</span>
              </div>
            );
          })
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-2">
            <div className="bg-rose-950/20 border border-rose-900/50 p-3 rounded">
              <span className="text-[10px] font-bold text-rose-400 block mb-1">ORIGINAL CONFIG</span>
              <pre className="text-slate-300 text-[11px] whitespace-pre-wrap">{action.gitops_before_yaml || 'No snippet'}</pre>
            </div>
            <div className="bg-emerald-950/20 border border-emerald-900/50 p-3 rounded">
              <span className="text-[10px] font-bold text-emerald-400 block mb-1">PROPOSED REMEDIATION</span>
              <pre className="text-slate-300 text-[11px] whitespace-pre-wrap">{action.gitops_after_yaml || 'No snippet'}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
