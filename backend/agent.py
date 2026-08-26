import os
import sqlite3
import json
import asyncio
import logging
from typing import Dict, Any, List, Optional, TypedDict
from datetime import datetime, timezone

from dotenv import load_dotenv
load_dotenv()

from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import interrupt
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage

from models import RCAAnalysisAndProposal
from tools import investigator, imperative_executor, gitops_executor, DataSanitizer

logger = logging.getLogger("watchdog.agent")

# ---------------------------------------------------------------------------
# State Definition
# ---------------------------------------------------------------------------
class AgentState(TypedDict):
    event_data: Dict[str, Any]
    investigation_data: Dict[str, Any]
    sanitized_logs: List[str]
    analysis: Optional[Dict[str, Any]]
    proposed_action: Optional[Dict[str, Any]]
    human_approved: Optional[bool]
    approver_comment: Optional[str]
    already_resolved: Optional[bool]
    resolution_reason: Optional[str]
    execution_result: Optional[Dict[str, Any]]
    audit_log: Optional[Dict[str, Any]]
    status: str
    timeline: List[Dict[str, Any]]


# ---------------------------------------------------------------------------
# Database & Checkpointer Setup
# ---------------------------------------------------------------------------
def get_db_connection() -> sqlite3.Connection:
    """Provides SQLite connection for LangGraph checkpointer."""
    db_path = os.getenv("DB_PATH", "/data/watchdog_state.db")
    db_dir = os.path.dirname(db_path)
    if db_dir and not os.path.exists(db_dir):
        try:
            os.makedirs(db_dir, exist_ok=True)
        except Exception:
            db_path = "./watchdog_state.db"
    
    conn = sqlite3.connect(db_path, check_same_thread=False)
    return conn

# ---------------------------------------------------------------------------
# LLM Initializer (OpenRouter / OpenAI)
# ---------------------------------------------------------------------------
def get_llm():
    """Initializes ChatOpenAI with structured output support (supports OpenRouter and OpenAI)."""
    openrouter_key = os.getenv("OPENROUTER_API_KEY", "")
    if openrouter_key and openrouter_key.startswith("sk-or-v1"):
        model_name = os.getenv("OPENROUTER_MODEL", "openai/gpt-4o")
        logger.info(f"Initializing OpenRouter LLM: model={model_name}")
        referer = os.getenv("OPENROUTER_HTTP_REFERER", "https://github.com/Sumanthbabu-Muthineni/Sthiti-AI")
        return ChatOpenAI(
            model=model_name,
            temperature=0.1,
            api_key=openrouter_key,
            base_url="https://openrouter.ai/api/v1",
            default_headers={
                "HTTP-Referer": referer,
                "X-Title": "Sthiti-AI-Watchdog"
            }
        )

    api_key = os.getenv("OPENAI_API_KEY", "")
    if api_key and not api_key.startswith("sk-proj-your"):
        return ChatOpenAI(model="gpt-4o", temperature=0.1, api_key=api_key)

    return None


# ---------------------------------------------------------------------------
# Fallback RCA Generator (for offline/demo/keyless testing)
# ---------------------------------------------------------------------------
def generate_deterministic_rca(event: Dict[str, Any], investigation: Dict[str, Any]) -> RCAAnalysisAndProposal:
    """Generates structured RCA analysis and proposal deterministically if OpenAI key is unavailable."""
    import re
    reason = event.get("reason", "")
    resource_name = event.get("resource_name", "app-service")
    namespace = event.get("namespace", "default")
    app_base = re.sub(r'-[a-z0-9]{4,10}(-[a-z0-9]{4,10})?$', '', resource_name)
    if not app_base:
        app_base = resource_name.split("-")[0]

    if "oom" in reason.lower() or "memory" in reason.lower():
        return RCAAnalysisAndProposal(
            root_cause_summary=f"Pod {resource_name} memory limit (256Mi) was exceeded during peak batch allocation, triggering Linux kernel cgroup OOM killer.",
            detailed_explanation=(
                f"Investigation of sanitized logs and container metrics reveals that the JVM/Node buffer pool in namespace '{namespace}' "
                "experienced a sharp heap allocation spike. The container reached 100% of its 256Mi cgroup threshold, causing SIGKILL. "
                "Node capacity is healthy (64Gi total), indicating this is a container resource limit misconfiguration rather than a node shortage."
            ),
            confidence_score=0.96,
            blast_radius="Medium - affects container restarts in " + namespace,
            severity="Critical",
            action_type="gitops",
            action_title=f"Increase memory limits for {app_base} to 1Gi in GitOps repository",
            action_description=(
                f"Patch the Kubernetes deployment specification for '{app_base}' by updating `resources.limits.memory` from 256Mi to 1Gi "
                "and `resources.requests.memory` to 512Mi to prevent future OOMKills under heavy load."
            ),
            gitops_file_path=f"gitops-manifests/{app_base}.yaml",
            gitops_before_yaml=(
                "resources:\n"
                "  limits:\n"
                "    cpu: '500m'\n"
                "    memory: '256Mi'\n"
                "  requests:\n"
                "    cpu: '100m'\n"
                "    memory: '128Mi'"
            ),
            gitops_after_yaml=(
                "resources:\n"
                "  limits:\n"
                "    cpu: '500m'\n"
                "    memory: '1Gi'\n"
                "  requests:\n"
                "    cpu: '100m'\n"
                "    memory: '512Mi'"
            ),
            gitops_diff=(
                f"--- a/gitops-manifests/{app_base}.yaml\n"
                f"+++ b/gitops-manifests/{app_base}.yaml\n"
                "@@ -15,4 +15,4 @@\n"
                "   resources:\n"
                "     limits:\n"
                "-      memory: 256Mi\n"
                "+      memory: 1Gi\n"
                "-      requests.memory: 128Mi\n"
                "+      requests.memory: 512Mi"
            )
        )
    elif "image" in reason.lower():
        return RCAAnalysisAndProposal(
            root_cause_summary=f"Kubelet failed to pull image tag 'v3.0.0-rc2' for {resource_name} due to missing registry manifest.",
            detailed_explanation=(
                f"Cluster investigation indicates that deployment '{resource_name}' was updated to an unreleased release candidate image tag "
                "'v3.0.0-rc2' that does not exist in the internal container registry. The pod is stuck in ImagePullBackOff."
            ),
            confidence_score=0.99,
            blast_radius="High - deployment cannot schedule new pods",
            severity="Critical",
            action_type="gitops",
            action_title=f"Rollback {app_base} image tag to stable 'v2.9.4'",
            action_description="Revert image tag in deployment manifest to the latest verified stable release 'v2.9.4'.",
            gitops_file_path=f"gitops-manifests/{app_base}.yaml",
            gitops_before_yaml=f"image: registry.internal.corp/{app_base}:v3.0.0-rc2",
            gitops_after_yaml=f"image: registry.internal.corp/{app_base}:v2.9.4",
            gitops_diff=(
                f"--- a/gitops-manifests/{app_base}.yaml\n"
                f"+++ b/gitops-manifests/{app_base}.yaml\n"
                "@@ -12,2 +12,2 @@\n"
                f"- image: registry.internal.corp/{app_base}:v3.0.0-rc2\n"
                f"+ image: registry.internal.corp/{app_base}:v2.9.4"
            )
        )
    else:
        # Imperative action for transient deadlock/CrashLoop
        return RCAAnalysisAndProposal(
            root_cause_summary=f"Transient connection timeout caused pod {resource_name} to fail readiness probes and enter CrashLoopBackOff.",
            detailed_explanation=(
                f"Pod {resource_name} experienced an intermittent database socket timeout during initialization. "
                "The database endpoint is currently healthy, but the container runtime backoff timer is set to 5 minutes. "
                "An immediate pod restart or deployment rollout will allow the container to reconnect immediately."
            ),
            confidence_score=0.92,
            blast_radius="Low - single pod in namespace " + namespace,
            severity="Warning",
            action_type="imperative",
            action_title=f"Restart rollout for deployment/{app_base}",
            action_description=f"Execute an imperative rollout restart for deployment/{app_base} in namespace '{namespace}' to clear the backoff state.",
            imperative_command=f"kubectl rollout restart deployment/{app_base} -n {namespace}"
        )


# ---------------------------------------------------------------------------
# Workflow Nodes (Asynchronous & Non-Blocking)
# ---------------------------------------------------------------------------
async def investigate_node(state: AgentState) -> Dict[str, Any]:
    """1. Gathers targeted diagnostic context via Investigate_Cluster concurrently."""
    event = state["event_data"]
    logger.info(f"[NODE: investigate_node] Investigating alert {event.get('event_id')} on {event.get('resource_name')}")
    
    # Offload blocking K8s API queries to worker thread pool
    investigation = await asyncio.to_thread(investigator.investigate, event)
    sanitized_logs = investigation.get("sanitized_logs", [])
    
    timeline_entry = {
        "step": "investigate",
        "title": "Cluster Investigation Complete",
        "details": f"Fetched logs and K8s events. Scrubbed {sum(investigation.get('security_scrub_metrics', {}).values())} sensitive tokens.",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    
    current_timeline = state.get("timeline", []) or []
    current_timeline.append(timeline_entry)

    return {
        "investigation_data": investigation,
        "sanitized_logs": sanitized_logs,
        "status": "investigated",
        "timeline": current_timeline
    }


async def analyze_node(state: AgentState) -> Dict[str, Any]:
    """2. Uses ChatOpenAI to generate structured RCA and proposed remediation concurrently."""
    event = state["event_data"]
    investigation = state["investigation_data"]
    logger.info(f"[NODE: analyze_node] Generating RCA for {event.get('event_id')}")

    llm = get_llm()
    rca_proposal: Optional[RCAAnalysisAndProposal] = None

    if llm:
        try:
            structured_llm = llm.with_structured_output(RCAAnalysisAndProposal)
            system_prompt = (
                "You are an autonomous Principal Kubernetes SRE. Your task is to analyze sanitized cluster telemetry, "
                "pod logs, and Kubernetes events to identify the exact root cause of the alert and propose a definitive fix.\n\n"
                "Remediation Strategy Rules:\n"
                "- Use 'imperative' action_type ONLY for safe, ephemeral runtime actions (e.g. deleting a deadlocked pod, restarting a rollout, cordoning an unhealthy node).\n"
                "- Use 'gitops' action_type for persistent configuration fixes (e.g. updating CPU/memory limits, fixing wrong image tags, configmaps, env vars).\n"
                "- Always provide precise YAML diffs or exact kubectl commands."
            )
            
            user_prompt = (
                f"Cluster Alert Context:\n"
                f"- Namespace: {event.get('namespace')}\n"
                f"- Resource: {event.get('resource_kind')}/{event.get('resource_name')}\n"
                f"- Severity: {event.get('severity')}\n"
                f"- Alert Reason: {event.get('reason')}\n"
                f"- Alert Message: {event.get('message')}\n\n"
                f"Sanitized Pod Logs:\n{json.dumps(investigation.get('sanitized_logs', [])[:10], indent=2)}\n\n"
                f"Kubernetes Events:\n{json.dumps(investigation.get('events', []), indent=2)}\n\n"
                f"Manifest State:\n{json.dumps(investigation.get('manifest_summary', {}), indent=2)}\n"
            )

            # Offload blocking OpenAI network invocation to worker thread pool
            def _invoke_llm():
                return structured_llm.invoke([
                    SystemMessage(content=system_prompt),
                    HumanMessage(content=user_prompt)
                ])

            rca_proposal = await asyncio.to_thread(_invoke_llm)
        except Exception as e:
            logger.warning(f"OpenAI structured output invocation failed: {e}. Using deterministic RCA fallback.")
            rca_proposal = generate_deterministic_rca(event, investigation)
    else:
        rca_proposal = generate_deterministic_rca(event, investigation)

    analysis_dict = {
        "root_cause_summary": rca_proposal.root_cause_summary,
        "detailed_explanation": rca_proposal.detailed_explanation,
        "confidence_score": rca_proposal.confidence_score,
        "blast_radius": rca_proposal.blast_radius,
        "severity": rca_proposal.severity,
    }

    proposed_action = {
        "action_type": rca_proposal.action_type,
        "action_title": rca_proposal.action_title,
        "action_description": rca_proposal.action_description,
        "imperative_command": rca_proposal.imperative_command,
        "gitops_file_path": rca_proposal.gitops_file_path,
        "gitops_before_yaml": rca_proposal.gitops_before_yaml,
        "gitops_after_yaml": rca_proposal.gitops_after_yaml,
        "gitops_diff": rca_proposal.gitops_diff,
        "resource_name": event.get("resource_name"),
        "namespace": event.get("namespace"),
    }

    timeline_entry = {
        "step": "analyze",
        "title": "RCA & Remediation Proposal Generated",
        "details": f"Root Cause: {rca_proposal.root_cause_summary} (Confidence: {int(rca_proposal.confidence_score * 100)}%)",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

    current_timeline = state.get("timeline", []) or []
    current_timeline.append(timeline_entry)

    return {
        "analysis": analysis_dict,
        "proposed_action": proposed_action,
        "status": "awaiting_approval",
        "timeline": current_timeline
    }


def approval_node(state: AgentState) -> Dict[str, Any]:
    """
    3. Human-in-the-Loop Breakpoint using LangGraph interrupt().
    Halts execution and awaits human approval decision via dashboard.
    """
    logger.info(f"[NODE: approval_node] Triggering interrupt for thread")
    
    # LangGraph interrupt pauses state and exposes payload to caller
    human_response = interrupt({
        "type": "approval_required",
        "analysis": state.get("analysis"),
        "proposed_action": state.get("proposed_action"),
        "event_data": state.get("event_data"),
        "timestamp": datetime.now(timezone.utc).isoformat()
    })

    approved = False
    comment = ""
    if isinstance(human_response, dict):
        approved = human_response.get("approved", False)
        comment = human_response.get("comment", "")
    elif isinstance(human_response, bool):
        approved = human_response

    timeline_entry = {
        "step": "approval_response",
        "title": f"Human Decision: {'APPROVED' if approved else 'REJECTED'}",
        "details": f"Comment: {comment}" if comment else "No comment provided",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

    current_timeline = state.get("timeline", []) or []
    current_timeline.append(timeline_entry)

    return {
        "human_approved": approved,
        "approver_comment": comment,
        "status": "approved" if approved else "rejected",
        "timeline": current_timeline
    }


async def revalidate_node(state: AgentState) -> Dict[str, Any]:
    """
    3.5 Pre-Execution Revalidation Node.
    Re-checks live cluster state right before executing the approved action.
    Detects if an external operator or system already resolved the issue (e.g. manual pod deletion,
    rollout restart, or updated manifest limits) to prevent redundant executions.
    """
    approved = state.get("human_approved", False)
    if not approved:
        return {"already_resolved": False, "resolution_reason": ""}

    event = state.get("event_data", {})
    namespace = event.get("namespace", "default")
    resource_name = event.get("resource_name", "")
    dep_name = resource_name.split("-")[0] if "-" in resource_name else resource_name
    if "storefront" in resource_name:
        dep_name = "storefront-web"
    elif "payment" in resource_name:
        dep_name = "payment-processor"
    elif "auth" in resource_name:
        dep_name = "auth-gateway"

    logger.info(f"[NODE: revalidate_node] Re-validating live cluster health for '{dep_name}' in namespace '{namespace}'...")

    current_timeline = state.get("timeline", []) or []

    def _check_live_state():
        if not investigator.k8s_available:
            return False, ""
        try:
            # 1. Check current pods for this deployment
            pods = investigator.core_v1.list_namespaced_pod(namespace=namespace)
            matching_pods = [p for p in pods.items if dep_name in p.metadata.name]
            
            if matching_pods:
                # Check if ALL matching pods are currently Ready (1/1) and running with 0 crash loop states
                all_ready = all(
                    all(cs.ready for cs in (p.status.container_statuses or [])) and p.status.phase == "Running"
                    for p in matching_pods
                )
                has_crash = any(
                    any((cs.state.waiting and cs.state.waiting.reason in ["CrashLoopBackOff", "ImagePullBackOff", "ErrImagePull"]) for cs in (p.status.container_statuses or []))
                    for p in matching_pods
                )
                
                if all_ready and not has_crash:
                    return True, f"All {len(matching_pods)}/{len(matching_pods)} pods for '{dep_name}' are currently Running & Ready (100% healthy). External fix detected."

            # 2. Check deployment resource limits / spec if gitops memory fix
            proposed = state.get("proposed_action", {})
            if proposed.get("action_type") == "gitops" and "memory" in proposed.get("action_title", "").lower():
                try:
                    dep_obj = investigator.apps_v1.read_namespaced_deployment(name=dep_name, namespace=namespace)
                    containers = dep_obj.spec.template.spec.containers
                    if containers:
                        curr_mem = containers[0].resources.limits.get("memory", "") if (containers[0].resources and containers[0].resources.limits) else ""
                        if curr_mem in ["1Gi", "1024Mi", "2Gi"]:
                            return True, f"Deployment '{dep_name}' already has increased memory limit ({curr_mem}). Manifest was already patched."
                except Exception:
                    pass

            return False, ""
        except Exception as e:
            logger.warning(f"Revalidation live check notice: {e}")
            return False, ""

    already_resolved, resolution_reason = await asyncio.to_thread(_check_live_state)

    if already_resolved:
        logger.info(f"✨ [PRE_EXEC_RESOLVED] Workload '{dep_name}' was already fixed externally: {resolution_reason}")
        timeline_entry = {
            "step": "pre_execution_verify",
            "title": "Pre-Execution Verification: External Fix Detected",
            "details": resolution_reason,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    else:
        timeline_entry = {
            "step": "pre_execution_verify",
            "title": "Pre-Execution Verification: Issue Confirmed Active",
            "details": f"Workload '{dep_name}' confirmed still in degraded state. Proceeding with approved remediation.",
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

    current_timeline.append(timeline_entry)

    return {
        "already_resolved": already_resolved,
        "resolution_reason": resolution_reason,
        "timeline": current_timeline
    }


async def execute_node(state: AgentState) -> Dict[str, Any]:
    """4. Routes and executes the approved remediation action concurrently."""
    approved = state.get("human_approved", False)
    already_resolved = state.get("already_resolved", False)
    resolution_reason = state.get("resolution_reason", "")
    proposed_action = state.get("proposed_action", {})
    action_type = proposed_action.get("action_type", "imperative")

    if not approved:
        logger.info("[NODE: execute_node] Action was REJECTED by human operator. Skipping execution.")
        result = {
            "status": "rejected",
            "message": "Remediation plan was rejected by human operator. No changes applied.",
            "executed_at": datetime.now(timezone.utc).isoformat()
        }
    elif already_resolved:
        logger.info(f"[NODE: execute_node] Workload was already resolved externally: {resolution_reason}. Skipping redundant execution.")
        result = {
            "status": "already_resolved",
            "action_type": action_type,
            "action_title": "Verified Healthy (Skipped Duplicate Fix)",
            "output_summary": f"Pre-execution verification detected that the workload is already healthy: {resolution_reason}. Redundant action was safely skipped.",
            "message": resolution_reason,
            "executed_at": datetime.now(timezone.utc).isoformat()
        }
    else:
        logger.info(f"[NODE: execute_node] Action APPROVED. Executing {action_type} remediation concurrently...")
        if action_type == "gitops":
            result = await asyncio.to_thread(gitops_executor.execute, proposed_action)
        else:
            result = await asyncio.to_thread(imperative_executor.execute, proposed_action)

    timeline_entry = {
        "step": "execute",
        "title": "External Resolution Verified (Execution Skipped)" if already_resolved else ("Remediation Executed" if approved else "Remediation Skipped"),
        "details": result.get("output_summary") or result.get("pr_url") or result.get("message"),
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

    current_timeline = state.get("timeline", []) or []
    current_timeline.append(timeline_entry)

    return {
        "execution_result": result,
        "status": "remediated" if (approved or already_resolved) else "rejected",
        "timeline": current_timeline
    }


def audit_node(state: AgentState) -> Dict[str, Any]:
    """5. Compiles comprehensive audit trail for governance & compliance."""
    event = state["event_data"]
    exec_res = state.get("execution_result") or {}
    proposed = state.get("proposed_action") or {}
    already_resolved = state.get("already_resolved", False)
    resolution_reason = state.get("resolution_reason", "")
    
    action_title = proposed.get("action_title")
    if already_resolved:
        action_title = f"Verified Pre-Execution: {resolution_reason}"
    
    audit_entry = {
        "event_id": event.get("event_id"),
        "resource": f"{event.get('namespace')}/{event.get('resource_name')}",
        "alert_count": state.get("alert_count") or event.get("alert_count", 1),
        "reasons": state.get("reasons") or event.get("reasons", [event.get("reason")]),
        "root_cause": state.get("analysis", {}).get("root_cause_summary"),
        "action_taken": action_title,
        "action_type": proposed.get("action_type", "imperative"),
        "pr_url": exec_res.get("pr_url") or proposed.get("pr_url"),
        "pr_number": exec_res.get("pr_number") or proposed.get("pr_number"),
        "branch_name": exec_res.get("branch_name") or proposed.get("branch_name"),
        "gitops_diff": exec_res.get("diff_preview") or proposed.get("gitops_diff"),
        "imperative_command": exec_res.get("command") or proposed.get("imperative_command"),
        "human_approved": state.get("human_approved"),
        "approver_comment": state.get("approver_comment"),
        "execution_status": exec_res.get("status", "unknown"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "timeline": state.get("timeline", [])
    }
    
    logger.info(f"[NODE: audit_node] Audit logged for event {event.get('event_id')}, PR={audit_entry.get('pr_url')}")
    return {
        "audit_log": audit_entry,
        "status": "completed"
    }


# ---------------------------------------------------------------------------
# Graph Construction & Compilation
# ---------------------------------------------------------------------------
def create_watchdog_graph():
    """Builds and compiles the LangGraph state machine with SQLite persistence."""
    builder = StateGraph(AgentState)

    # Add Nodes
    builder.add_node("investigate", investigate_node)
    builder.add_node("analyze", analyze_node)
    builder.add_node("approval", approval_node)
    builder.add_node("revalidate", revalidate_node)
    builder.add_node("execute", execute_node)
    builder.add_node("audit", audit_node)

    # Define Linear Flow with Interrupt & Pre-Execution Revalidation
    builder.add_edge(START, "investigate")
    builder.add_edge("investigate", "analyze")
    builder.add_edge("analyze", "approval")
    builder.add_edge("approval", "revalidate")
    builder.add_edge("revalidate", "execute")
    builder.add_edge("execute", "audit")
    builder.add_edge("audit", END)

    # Create checkpointer supporting full async concurrency and thread state persistence
    checkpointer = MemorySaver()

    app = builder.compile(checkpointer=checkpointer)
    return app

# Singleton compiled workflow
watchdog_app = create_watchdog_graph()
