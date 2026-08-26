from typing import Dict, Any, List, Optional, Literal
from pydantic import BaseModel, Field
from datetime import datetime, timezone

class AlertEvent(BaseModel):
    event_id: str = Field(..., description="Unique event identifier")
    cluster: str = Field(default="production-k8s-cluster", description="Cluster name or identifier")
    namespace: str = Field(..., description="Target Kubernetes namespace")
    resource_kind: str = Field(..., description="Resource kind (Pod, Deployment, Node, etc.)")
    resource_name: str = Field(..., description="Resource name")
    severity: Literal["Critical", "Warning", "Info"] = Field(default="Critical", description="Alert severity level")
    reason: str = Field(..., description="Reason code (e.g., OOMKilled, CrashLoopBackOff, ImagePullBackOff)")
    reasons: Optional[List[str]] = Field(default_factory=list, description="All accumulated failure reasons for this incident")
    alert_count: int = Field(default=1, description="Cumulative count of alerts received for this incident")
    message: str = Field(..., description="Alert message or error description")
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat(), description="ISO timestamp")
    raw_metadata: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Additional context metadata")

class RCAAnalysisAndProposal(BaseModel):
    root_cause_summary: str = Field(
        ..., 
        description="Concise 1-2 sentence executive summary of the underlying root cause"
    )
    detailed_explanation: str = Field(
        ..., 
        description="Comprehensive technical analysis referencing logs, events, metrics, and failure timeline"
    )
    confidence_score: float = Field(
        ..., 
        ge=0.0, 
        le=1.0, 
        description="AI confidence score between 0.0 and 1.0"
    )
    blast_radius: str = Field(
        ..., 
        description="Assessment of service impact and blast radius (e.g., 'Low - single pod in staging' or 'High - primary checkout API')"
    )
    severity: Literal["Critical", "Warning", "Info"] = Field(
        ..., 
        description="Assessed severity level after log analysis"
    )
    action_type: Literal["imperative", "gitops"] = Field(
        ..., 
        description="Remediation mode: 'imperative' for immediate runtime action or 'gitops' for persistent config PR"
    )
    action_title: str = Field(
        ..., 
        description="Short title of the proposed remediation"
    )
    action_description: str = Field(
        ..., 
        description="Detailed step-by-step description of how the proposed remediation fixes the root cause"
    )
    imperative_command: Optional[str] = Field(
        default=None, 
        description="Exact kubectl or CLI command to execute for imperative action (if action_type == 'imperative')"
    )
    gitops_file_path: Optional[str] = Field(
        default=None, 
        description="Target GitOps manifest file path (if action_type == 'gitops')"
    )
    gitops_before_yaml: Optional[str] = Field(
        default=None, 
        description="Original YAML snippet before remediation"
    )
    gitops_after_yaml: Optional[str] = Field(
        default=None, 
        description="Updated YAML snippet after remediation"
    )
    gitops_diff: Optional[str] = Field(
        default=None, 
        description="Unified diff showing proposed configuration change"
    )

class ApprovalRequest(BaseModel):
    approved: bool = Field(..., description="True to execute the proposed remediation, False to reject")
    comment: Optional[str] = Field(default=None, description="Optional reviewer feedback or notes")

class StreamMessage(BaseModel):
    type: Literal["thought", "tool_call", "log", "state_change", "approval_required", "execution", "done", "error"] = Field(...)
    thread_id: str = Field(...)
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    payload: Dict[str, Any] = Field(default_factory=dict)

class AuditRecord(BaseModel):
    event_id: str
    thread_id: Optional[str] = None
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    event: Optional[AlertEvent] = None
    resource: Optional[str] = None
    alert_count: Optional[int] = 1
    reasons: Optional[List[str]] = Field(default_factory=list)
    root_cause: Optional[str] = None
    action_taken: Optional[str] = None
    action_type: Optional[str] = None
    pr_url: Optional[str] = None
    pr_number: Optional[int] = None
    branch_name: Optional[str] = None
    gitops_diff: Optional[str] = None
    imperative_command: Optional[str] = None
    investigation_data: Optional[Dict[str, Any]] = None
    sanitized_logs: Optional[List[str]] = None
    analysis: Optional[Dict[str, Any]] = None
    proposed_action: Optional[Dict[str, Any]] = None
    human_approved: Optional[bool] = None
    approver_comment: Optional[str] = None
    execution_result: Optional[Dict[str, Any]] = None
    execution_status: Optional[str] = None
    status: Literal["analyzing", "awaiting_approval", "remediated", "rejected", "failed"] = "analyzing"
    timeline: Optional[List[Dict[str, Any]]] = Field(default_factory=list)
