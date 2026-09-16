export type SeverityLevel = 'Critical' | 'Warning' | 'Info';
export type IncidentStatus = 'analyzing' | 'awaiting_approval' | 'remediated' | 'rejected' | 'failed' | 'investigating';
export type ActionType = 'imperative' | 'gitops';

export type EventCategory = 'Deploy/Scale' | 'Image' | 'Crash/Error' | 'Health';

export interface FoldedEvent {
  event_uid: string;
  logical_key?: string;
  reason: string;
  category: EventCategory;
  severity: SeverityLevel;
  message: string;
  count: number;
  delta_count?: number;
  accumulated_count?: number;
  multiplier_str: string;
  container_name?: string;
  involved_kind?: string;
  involved_name?: string;
  involved_uid?: string;
  first_timestamp?: string;
  last_timestamp?: string;
}

export interface TopologyContainerStatus {
  name: string;
  ready: boolean;
  restarts: number;
  state: string;
}

export interface TopologyNode {
  id: string;
  uid: string;
  name: string;
  kind: string;
  namespace: string;
  status: string;
  worst_state: 'Critical' | 'Warning' | 'Healthy';
  has_unhealthy_children?: boolean;
  is_root?: boolean;
  events: FoldedEvent[];
  containers?: TopologyContainerStatus[];
  metadata?: Record<string, any>;
}

export interface TopologyEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
}

export interface NeighborhoodResponse {
  root_id: string;
  cluster: string;
  namespace: string;
  timestamp: string;
  is_historical: boolean;
  worst_state: 'Critical' | 'Warning' | 'Healthy';
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

export interface TopologySnapshot {
  timestamp: string;
  cluster: string;
  namespace: string;
}

export interface AlertEvent {
  event_id: string;
  cluster: string;
  namespace: string;
  resource_kind: string;
  resource_name: string;
  resource_uid?: string;
  root_workload_uid?: string;
  container_name?: string;
  severity: SeverityLevel;
  reason: string;
  reasons?: string[];
  alert_count?: number;
  message: string;
  timestamp: string;
  raw_metadata?: Record<string, any>;
}

export interface RCAAnalysis {
  root_cause_summary: string;
  detailed_explanation: string;
  confidence_score: number;
  blast_radius: string;
  severity: SeverityLevel;
}

export interface ProposedAction {
  action_type: ActionType;
  action_title: string;
  action_description: string;
  imperative_command?: string;
  gitops_file_path?: string;
  gitops_before_yaml?: string;
  gitops_after_yaml?: string;
  gitops_diff?: string;
  resource_name?: string;
  namespace?: string;
}

export interface PendingApproval {
  thread_id: string;
  event_id: string;
  created_at: string;
  updated_at?: string;
  alert_count?: number;
  reasons?: string[];
  deployment_name?: string;
  event: AlertEvent;
  analysis: RCAAnalysis;
  proposed_action: ProposedAction;
  sanitized_logs: string[];
  timeline?: Array<{
    step: string;
    title: string;
    details: string;
    timestamp: string;
  }>;
}

export interface ExecutionResult {
  status: string;
  action_type: string;
  action_title: string;
  command?: string;
  pr_url?: string;
  pr_number?: number;
  branch_name?: string;
  target_file?: string;
  output_summary?: string;
  execution_logs?: string[];
  duration_ms?: number;
  executed_at?: string;
  message?: string;
}

export interface AuditRecord {
  event_id: string;
  resource: string;
  root_cause: string;
  action_taken: string;
  action_type?: ActionType | string;
  pr_url?: string;
  pr_number?: number;
  branch_name?: string;
  gitops_diff?: string;
  imperative_command?: string;
  alert_count?: number;
  reasons?: string[];
  human_approved: boolean | null;
  approver_comment?: string;
  execution_status: string;
  timestamp: string;
  timeline?: Array<{
    step: string;
    title: string;
    details: string;
    timestamp: string;
  }>;
}

export interface EventRecord {
  event_id: string;
  thread_id: string;
  event: AlertEvent;
  status: IncidentStatus;
  created_at: string;
  updated_at?: string;
  alert_count?: number;
  reasons?: string[];
  deployment_name?: string;
  state?: any;
}

export interface SSEMessage {
  event_type: 'event_received' | 'state_change' | 'tool_call' | 'thought' | 'approval_required' | 'execution' | 'done' | 'error' | 'connected' | 'ping';
  thread_id?: string;
  timestamp: string;
  data: any;
}

export interface TerminalEntry {
  id: string;
  timestamp: string;
  type: 'thought' | 'tool_call' | 'log' | 'approval' | 'execution' | 'system' | 'error';
  title?: string;
  content: string;
  metadata?: any;
  thread_id?: string;
}

export interface NodeInfo {
  name: string;
  ready: boolean;
  kubelet_version: string;
  os_image?: string;
  architecture?: string;
  cpu_capacity?: string;
  memory_capacity?: string;
}

export interface ClusterInfo {
  connected: boolean;
  cluster_name: string;
  status: string;
  nodes: NodeInfo[];
  namespaces: string[];
  pod_count: number;
  timestamp: string;
}
