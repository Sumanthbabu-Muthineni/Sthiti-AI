import type { PendingApproval, EventRecord, AuditRecord, AlertEvent } from '../types';

const API_BASE = '/api/v1';

export const api = {
  async getPendingApprovals(): Promise<PendingApproval[]> {
    const res = await fetch(`${API_BASE}/pending-approvals`);
    if (!res.ok) throw new Error('Failed to fetch pending approvals');
    const data = await res.json();
    return data.pending_approvals || [];
  },

  async getEvents(): Promise<EventRecord[]> {
    const res = await fetch(`${API_BASE}/events`);
    if (!res.ok) throw new Error('Failed to fetch cluster events');
    const data = await res.json();
    return data.events || [];
  },

  async getAuditLogs(): Promise<AuditRecord[]> {
    const res = await fetch(`${API_BASE}/audit-logs`);
    if (!res.ok) throw new Error('Failed to fetch audit history');
    const data = await res.json();
    return data.audit_logs || [];
  },

  async approveRemediation(threadId: string, approved: boolean, comment?: string): Promise<any> {
    const res = await fetch(`${API_BASE}/approve/${threadId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved, comment: comment || '' }),
    });
    if (!res.ok) throw new Error('Failed to send approval decision');
    return res.json();
  },

  async simulateAlert(preset: string = 'oom'): Promise<any> {
    const res = await fetch(`${API_BASE}/simulate/alert?preset=${encodeURIComponent(preset)}`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error('Failed to simulate alert');
    return res.json();
  },

  async sendWebhookEvent(event: Partial<AlertEvent>): Promise<any> {
    const res = await fetch(`${API_BASE}/webhook/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
    if (!res.ok) throw new Error('Failed to submit webhook event');
    return res.json();
  },

  async getClusterStatus(): Promise<any> {
    const res = await fetch(`${API_BASE}/cluster/status`);
    if (!res.ok) throw new Error('Failed to fetch cluster status');
    return res.json();
  },

  async getTopologyNeighborhood(
    namespace: string = 'watchdog-demo',
    kind: string = 'Deployment',
    name: string = 'payment-processor',
    timestamp?: string
  ): Promise<any> {
    const params = new URLSearchParams({
      namespace,
      resource_kind: kind,
      resource_name: name,
    });
    if (timestamp) params.append('timestamp', timestamp);
    const res = await fetch(`${API_BASE}/topology/neighborhood?${params.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch topology neighborhood');
    return res.json();
  },

  async getTopologySnapshots(): Promise<any[]> {
    const res = await fetch(`${API_BASE}/topology/snapshots`);
    if (!res.ok) throw new Error('Failed to fetch topology snapshots');
    const data = await res.json();
    return data.snapshots || [];
  },

  async getTopologyEvents(namespace: string = 'watchdog-demo', workload: string = ''): Promise<any[]> {
    const params = new URLSearchParams({ namespace });
    if (workload) params.append('workload', workload);
    const res = await fetch(`${API_BASE}/topology/events?${params.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch topology events');
    const data = await res.json();
    return data.events || [];
  }
};
