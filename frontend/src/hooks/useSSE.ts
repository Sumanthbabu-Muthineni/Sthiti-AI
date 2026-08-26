import { useEffect, useState, useRef, useCallback } from 'react';
import type { TerminalEntry, SSEMessage } from '../types';

interface UseSSEOptions {
  threadId?: string;
  onEvent?: (event: SSEMessage) => void;
  maxEntries?: number;
}

export function useSSE(options: UseSSEOptions = {}) {
  const { threadId, onEvent, maxEntries = 200 } = options;
  const [connected, setConnected] = useState<boolean>(false);
  const [entries, setEntries] = useState<TerminalEntry[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const addEntry = useCallback((entry: Omit<TerminalEntry, 'id'>) => {
    const id = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    setEntries((prev) => {
      const next = [...prev, { ...entry, id }];
      return next.slice(-maxEntries);
    });
  }, [maxEntries]);

  const clearEntries = useCallback(() => {
    setEntries([]);
  }, []);

  useEffect(() => {
    const url = threadId ? `/api/v1/stream/${threadId}` : '/api/v1/stream';
    let es: EventSource | null = null;
    let reconnectTimeout: any = null;

    const connect = () => {
      try {
        es = new EventSource(url);
        eventSourceRef.current = es;

        es.onopen = () => {
          setConnected(true);
          addEntry({
            timestamp: new Date().toISOString(),
            type: 'system',
            title: 'SSE Stream Connected',
            content: `Connected to watchdog event bus (${threadId ? `thread: ${threadId}` : 'global stream'}). Live AI trace enabled.`,
          });
        };

        const handleIncoming = (e: MessageEvent, eventType: SSEMessage['event_type']) => {
          if (!e.data) return;
          try {
            const parsed = JSON.parse(e.data);
            const msg: SSEMessage = {
              event_type: eventType,
              thread_id: parsed.thread_id,
              timestamp: parsed.timestamp || new Date().toISOString(),
              data: parsed.data || parsed,
            };

            if (onEventRef.current) {
              onEventRef.current(msg);
            }

            if (eventType === 'tool_call') {
              const scrubbed = msg.data.scrubbed_tokens || 0;
              addEntry({
                timestamp: msg.timestamp,
                type: 'tool_call',
                title: `Tool Invoked: ${msg.data.tool || 'Investigate_Cluster'}`,
                content: `Sanitized ${msg.data.logs?.length || 0} pod log lines (${scrubbed} sensitive tokens redacted)`,
                metadata: msg.data,
                thread_id: msg.thread_id,
              });
            } else if (eventType === 'thought') {
              addEntry({
                timestamp: msg.timestamp,
                type: 'thought',
                title: 'AI Root Cause Reasoning (gpt-4o)',
                content: msg.data.analysis?.root_cause_summary || 'Analyzing telemetry patterns...',
                metadata: msg.data,
                thread_id: msg.thread_id,
              });
            } else if (eventType === 'approval_required') {
              addEntry({
                timestamp: msg.timestamp,
                type: 'approval',
                title: 'Action Paused: Awaiting Human Approval',
                content: `Proposed ${msg.data.proposed_action?.action_type?.toUpperCase()} fix: ${msg.data.proposed_action?.action_title}`,
                metadata: msg.data,
                thread_id: msg.thread_id,
              });
            } else if (eventType === 'execution') {
              const res = msg.data.execution_result || {};
              addEntry({
                timestamp: msg.timestamp,
                type: 'execution',
                title: `Remediation Executed (${res.action_type || 'action'})`,
                content: res.output_summary || res.pr_url || 'Execution completed with exit code 0.',
                metadata: res,
                thread_id: msg.thread_id,
              });
            } else if (eventType === 'event_received') {
              const ev = msg.data.event || {};
              const isAggregated = msg.data.is_aggregated || (msg.data.alert_count && msg.data.alert_count > 1);
              const count = msg.data.alert_count || ev.alert_count || 1;
              const title = isAggregated
                ? `⚡ [Aggregated Alert #${count}] ${ev.reason || 'Alert'}`
                : `🚨 [New Incident Ingested] ${ev.reason || 'Alert'}`;
              const content = isAggregated
                ? `Merged into active incident for ${ev.resource_kind}/${ev.resource_name} (Total alerts: ${count}) — Symptoms: ${(msg.data.reasons || [ev.reason]).join(', ')}`
                : `${ev.resource_kind}/${ev.resource_name} in namespace '${ev.namespace}' - ${ev.message}`;
              addEntry({
                timestamp: msg.timestamp,
                type: 'log',
                title,
                content,
                metadata: { ...ev, alert_count: count, reasons: msg.data.reasons },
                thread_id: msg.thread_id,
              });
            } else if (eventType === 'done') {
              addEntry({
                timestamp: msg.timestamp,
                type: 'system',
                title: 'Incident Resolution Finalized',
                content: `Audit logged for thread ${msg.thread_id} with status: ${msg.data.status?.toUpperCase()}`,
                metadata: msg.data,
                thread_id: msg.thread_id,
              });
            }
          } catch (err) {
            console.error('Failed to parse SSE event data', err);
          }
        };

        const eventTypes: SSEMessage['event_type'][] = [
          'event_received',
          'state_change',
          'tool_call',
          'thought',
          'approval_required',
          'execution',
          'done',
          'error',
        ];

        eventTypes.forEach((type) => {
          es?.addEventListener(type, (e: MessageEvent) => handleIncoming(e, type));
        });

        es.onmessage = (e: MessageEvent) => handleIncoming(e, 'state_change');

        es.onerror = () => {
          setConnected(false);
          if (es) {
            es.close();
          }
          reconnectTimeout = setTimeout(connect, 3000);
        };
      } catch (err) {
        console.error('SSE connection error:', err);
        reconnectTimeout = setTimeout(connect, 4000);
      }
    };

    connect();

    return () => {
      if (es) es.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, [threadId, addEntry]);

  return {
    connected,
    entries,
    clearEntries,
    addEntry,
  };
}
