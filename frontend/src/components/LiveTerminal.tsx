import React, { useState, useEffect, useRef } from 'react';
import { 
  Terminal, 
  Trash2, 
  Copy, 
  Check, 
  ArrowDownCircle, 
  Sparkles, 
  Wrench, 
  Zap, 
  AlertCircle,
  Maximize2,
  Minimize2
} from 'lucide-react';
import type { TerminalEntry } from '../types';

interface LiveTerminalProps {
  entries: TerminalEntry[];
  onClear: () => void;
}

export const LiveTerminal: React.FC<LiveTerminalProps> = ({ entries, onClear }) => {
  const [autoScroll, setAutoScroll] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [entries, autoScroll]);

  const handleCopyLogs = () => {
    const text = entries
      .map((e) => `[${e.timestamp}] [${e.type.toUpperCase()}] ${e.title || ''}: ${e.content}`)
      .join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const filteredEntries = entries.filter((e) => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      (e.title || '').toLowerCase().includes(q) ||
      (e.content || '').toLowerCase().includes(q) ||
      e.type.toLowerCase().includes(q)
    );
  });

  const renderBadge = (type: TerminalEntry['type']) => {
    switch (type) {
      case 'thought':
        return (
          <span className="flex items-center gap-1 text-[10px] font-mono uppercase bg-slate-800 text-slate-300 border border-slate-700 px-1.5 py-0.5 rounded">
            <Sparkles className="w-3 h-3 text-cyan-400" />
            AI Thought
          </span>
        );
      case 'tool_call':
        return (
          <span className="flex items-center gap-1 text-[10px] font-mono uppercase bg-blue-950/80 text-blue-300 border border-blue-800 px-1.5 py-0.5 rounded">
            <Wrench className="w-3 h-3 text-blue-400" />
            K8s Tool
          </span>
        );
      case 'approval':
        return (
          <span className="flex items-center gap-1 text-[10px] font-mono uppercase bg-amber-950/80 text-amber-300 border border-amber-800 px-1.5 py-0.5 rounded">
            <AlertCircle className="w-3 h-3 text-amber-400" />
            Interrupt
          </span>
        );
      case 'execution':
        return (
          <span className="flex items-center gap-1 text-[10px] font-mono uppercase bg-emerald-950/80 text-emerald-300 border border-emerald-800 px-1.5 py-0.5 rounded">
            <Zap className="w-3 h-3 text-emerald-400" />
            Execution
          </span>
        );
      default:
        return (
          <span className="text-[10px] font-mono uppercase bg-slate-900 text-slate-400 px-1.5 py-0.5 rounded">
            {type}
          </span>
        );
    }
  };

  return (
    <div className={`bg-[#0b0f19] border-t border-slate-800 flex flex-col transition-all duration-200 ${
      isExpanded ? 'h-[500px]' : 'h-64 lg:h-72'
    }`}>
      
      {/* Terminal Title Bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-950 border-b border-slate-800 text-xs">
        <div className="flex items-center space-x-2">
          <Terminal className="w-4 h-4 text-emerald-400" />
          <span className="font-mono font-semibold text-slate-200">
            Agent Reasoning & Diagnostic Terminal
          </span>
          <span className="text-[10px] font-mono bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">
            {filteredEntries.length} lines
          </span>
        </div>

        <div className="flex items-center space-x-2">
          <input
            type="text"
            placeholder="Filter trace..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            className="bg-slate-900 text-slate-200 text-[11px] px-2 py-0.5 rounded border border-slate-700 focus:outline-none focus:border-cyan-500 w-28 lg:w-40 font-mono"
          />

          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`p-1.5 rounded transition-colors ${
              autoScroll ? 'text-cyan-400 bg-cyan-950/40' : 'text-slate-500 hover:text-slate-300'
            }`}
            title="Toggle Auto Scroll"
          >
            <ArrowDownCircle className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={handleCopyLogs}
            className="p-1.5 text-slate-400 hover:text-slate-200 transition-colors"
            title="Copy Logs"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>

          <button
            onClick={onClear}
            className="p-1.5 text-slate-400 hover:text-rose-300 transition-colors"
            title="Clear Terminal"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 text-slate-400 hover:text-slate-200 transition-colors"
            title={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Terminal Output Area */}
      <div className="flex-1 overflow-y-auto p-3 font-mono text-xs space-y-2 bg-[#06090e] select-text">
        {filteredEntries.length === 0 ? (
          <div className="text-slate-600 italic p-4 text-center">
            Waiting for agent trace events...
          </div>
        ) : (
          filteredEntries.map((entry) => {
            const timeStr = new Date(entry.timestamp).toLocaleTimeString();
            return (
              <div 
                key={entry.id} 
                className="flex items-start space-x-2 text-[11px] leading-relaxed hover:bg-slate-900/40 p-1 rounded transition-colors"
              >
                <span className="text-slate-600 select-none font-mono text-[10px] pt-0.5">
                  [{timeStr}]
                </span>

                <div className="pt-0.5">
                  {renderBadge(entry.type)}
                </div>

                <div className="flex-1 min-w-0 space-y-0.5">
                  {entry.title && (
                    <div className="text-slate-300 font-semibold font-sans">
                      {entry.title}
                    </div>
                  )}
                  
                  <div className={`whitespace-pre-wrap break-all ${
                    entry.type === 'thought' ? 'text-slate-400' :
                    entry.type === 'tool_call' ? 'text-cyan-300' :
                    entry.type === 'approval' ? 'text-amber-300 font-semibold' :
                    entry.type === 'execution' ? 'text-emerald-300 font-semibold' :
                    'text-slate-300'
                  }`}>
                    {entry.content}
                  </div>

                  {/* If metadata has logs or diff */}
                  {entry.metadata?.logs && (
                    <div className="mt-1 p-2 bg-slate-950/80 border border-slate-800 rounded text-[10px] text-amber-200/90 max-h-24 overflow-y-auto">
                      {entry.metadata.logs.map((l: string, i: number) => (
                        <div key={i} className="whitespace-pre-wrap">{l}</div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

    </div>
  );
};
