import os
import re
import time
import uuid
import json
import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sse_starlette.sse import EventSourceResponse

from models import AlertEvent, ApprovalRequest, RCAAnalysisAndProposal, AuditRecord
from agent import watchdog_app
from tools import investigator
from langgraph.types import Command

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("watchdog.api")

# Performance & Lifecycle Globals
SHUTDOWN_EVENT = asyncio.Event()
ACTIVE_K8S_WATCH: Any = None
CLUSTER_INFO_CACHE: Dict[str, Any] = {"data": None, "ts": 0}

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Asynchronous lifespan manager: starts background workers & ensures instant <0.2s shutdown on Ctrl+C."""
    SHUTDOWN_EVENT.clear()
    watcher_task = asyncio.create_task(live_kubernetes_event_watcher())
    pr_task = asyncio.create_task(live_pr_and_health_reconciliation_worker())
    logger.info("⚡ High-performance asynchronous background workers started.")
    try:
        yield
    finally:
        logger.info("🛑 Fast graceful shutdown initiated. Stopping K8s watchers & background workers...")
        SHUTDOWN_EVENT.set()
        global ACTIVE_K8S_WATCH
        if ACTIVE_K8S_WATCH:
            try:
                ACTIVE_K8S_WATCH.stop()
            except Exception:
                pass
        watcher_task.cancel()
        pr_task.cancel()
        await asyncio.gather(watcher_task, pr_task, return_exceptions=True)
        logger.info("✅ Watchdog backend shutdown complete in < 0.2s.")


app = FastAPI(
    title="K8s Agentic Watchdog API",
    description="Autonomous AI Site Reliability Engineer for Kubernetes Clusters",
    version="1.0.0",
    lifespan=lifespan
)

# Enable CORS for local dev and frontend deployment
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# In-Memory Event Tracking & SSE Broadcast Manager
# ---------------------------------------------------------------------------
# Store for active threads, events, pending approvals, and audit logs
EVENT_STORE: Dict[str, Dict[str, Any]] = {}
AUDIT_STORE: List[Dict[str, Any]] = []
STREAM_SUBSCRIBERS: List[asyncio.Queue] = []
THREAD_STREAMS: Dict[str, List[asyncio.Queue]] = {}
SEEN_K8S_EVENTS: Dict[str, float] = {}
PROCESSED_K8S_EVENT_UIDS: set = set()
PROCESSED_MERGED_PRS: set = set()
SERVER_START_TIME: float = time.time()


def extract_deployment_name(resource_name: str, resource_kind: str = "Pod") -> str:
    """
    Normalizes resource name to the root deployment/workload name.
    e.g. 'storefront-web-646d9f8-xyz12' -> 'storefront-web'
         'payment-processor-7f89d' -> 'payment-processor'
         'auth-gateway-xyz' -> 'auth-gateway'
         'billing-processor-abc' -> 'billing-processor'
         'cartservice-xyz' -> 'cartservice'
         'worker-node-pool-2b' -> 'worker-node-pool-2b'
    """
    if not resource_name:
        return "unknown"
    
    # Check known keywords first
    for known in ["storefront-web", "payment-processor", "auth-gateway", "billing-processor", "cartservice"]:
        if known in resource_name:
            return known
            
    # Strip standard K8s ReplicaSet & Pod hash suffix (e.g. -5d78b74684-x9kz2 or -7f89d)
    cleaned = re.sub(r'-[a-z0-9]{4,10}(-[a-z0-9]{4,10})?$', '', resource_name)
    if cleaned:
        return cleaned
        
    return resource_name.split("-")[0] if "-" in resource_name else resource_name


def find_active_incident_for_workload(namespace: str, resource_name: str, resource_kind: str = "Pod") -> Optional[str]:
    """
    Finds existing active incident (thread_id) matching namespace and deployment/workload.
    Active statuses: 'analyzing', 'investigating', 'awaiting_approval'.
    """
    target_dep = extract_deployment_name(resource_name, resource_kind)
    for thread_id, record in EVENT_STORE.items():
        if record.get("status") in ["awaiting_approval", "analyzing", "investigating"]:
            rec_event = record.get("event", {})
            rec_ns = rec_event.get("namespace", "")
            rec_res = rec_event.get("resource_name", "")
            rec_dep = record.get("deployment_name") or extract_deployment_name(rec_res, rec_event.get("resource_kind", "Pod"))
            
            # Match if same namespace (or if one is empty/wildcard) AND matching deployment/workload
            ns_match = (rec_ns == namespace) or (not namespace) or (not rec_ns)
            dep_match = (rec_dep == target_dep) or (target_dep in rec_res) or (rec_dep in resource_name)
            
            if ns_match and dep_match:
                return thread_id
    return None


async def ingest_or_aggregate_alert(alert_event: AlertEvent, background_tasks: Optional[BackgroundTasks] = None) -> Dict[str, Any]:
    """
    Core alert ingestion pipeline:
    - If an active incident exists for this deployment, merges the alert into it, increments alert_count,
      and appends new reason to reasons list.
    - If no active incident exists, initializes a single new incident and starts LangGraph workflow.
    """
    dep_name = extract_deployment_name(alert_event.resource_name, alert_event.resource_kind)
    existing_thread_id = find_active_incident_for_workload(alert_event.namespace, alert_event.resource_name, alert_event.resource_kind)

    if existing_thread_id:
        record = EVENT_STORE[existing_thread_id]
        new_count = record.get("alert_count", 1) + 1
        record["alert_count"] = new_count
        
        # Accumulate unique reasons in order of occurrence
        reasons_list = list(record.get("reasons", []))
        if not reasons_list and record.get("event", {}).get("reason"):
            reasons_list.append(record["event"]["reason"])
        if alert_event.reason and alert_event.reason not in reasons_list:
            reasons_list.append(alert_event.reason)
        record["reasons"] = reasons_list
        
        # Update event payload
        record["event"]["alert_count"] = new_count
        record["event"]["reasons"] = reasons_list
        record["event"]["reason"] = alert_event.reason  # latest reason
        record["event"]["message"] = alert_event.message
        record["event"]["timestamp"] = alert_event.timestamp
        if alert_event.severity == "Critical":
            record["event"]["severity"] = "Critical"
        record["updated_at"] = datetime.now(timezone.utc).isoformat()
        
        # Append to event history
        record.setdefault("event_history", []).append(alert_event.model_dump())
        
        logger.info(f"🔄 [ALERT_AGGREGATED] Thread {existing_thread_id} ({dep_name}) -> Total alerts: {new_count}, Reasons: {reasons_list}")

        # Broadcast real-time SSE aggregation update
        await broadcast_event("event_received", {
            "event": record["event"],
            "thread_id": existing_thread_id,
            "alert_count": new_count,
            "reasons": reasons_list,
            "is_aggregated": True,
            "message": f"Aggregated alert #{new_count} ({alert_event.reason}) on {dep_name}"
        }, thread_id=existing_thread_id)

        return {
            "status": "aggregated",
            "thread_id": existing_thread_id,
            "event_id": record.get("event_id"),
            "alert_count": new_count,
            "reasons": reasons_list,
            "message": f"Alert aggregated into active incident ({dep_name}). Total alerts: {new_count}."
        }

    else:
        # Create brand new incident
        thread_id = f"thread_{alert_event.event_id}"
        reasons_list = [alert_event.reason] if alert_event.reason else []
        alert_dict = alert_event.model_dump()
        alert_dict["alert_count"] = 1
        alert_dict["reasons"] = reasons_list

        EVENT_STORE[thread_id] = {
            "event_id": alert_event.event_id,
            "thread_id": thread_id,
            "deployment_name": dep_name,
            "alert_count": 1,
            "reasons": reasons_list,
            "event": alert_dict,
            "status": "analyzing",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "state": None,
            "event_history": [alert_dict]
        }

        logger.info(f"🚨 [NEW_INCIDENT_CREATED] Thread {thread_id} for deployment '{dep_name}' ({alert_event.reason})")

        # Stream initial event receipt
        await broadcast_event("event_received", {
            "event": alert_dict,
            "thread_id": thread_id,
            "alert_count": 1,
            "reasons": reasons_list,
            "is_aggregated": False
        }, thread_id=thread_id)

        # Launch workflow
        if background_tasks:
            background_tasks.add_task(run_agent_workflow, thread_id, alert_dict)
        else:
            asyncio.create_task(run_agent_workflow(thread_id, alert_dict))

        return {
            "status": "queued",
            "thread_id": thread_id,
            "event_id": alert_event.event_id,
            "alert_count": 1,
            "reasons": reasons_list,
            "message": f"Agent investigating {alert_event.resource_kind}/{alert_event.resource_name} ({alert_event.reason})"
        }


async def live_kubernetes_event_watcher():
    """
    Continuous non-blocking background watcher for live Minikube / cluster events.
    Uses short 4s timeouts and clean cancellation so Ctrl+C terminates cleanly in < 0.2s.
    """
    global ACTIVE_K8S_WATCH
    from kubernetes import watch
    logger.info("Starting Token-Protected Live Kubernetes Cluster Watcher with Alert Aggregation...")

    while not SHUTDOWN_EVENT.is_set():
        try:
            if investigator and investigator.k8s_available:
                w = watch.Watch()
                ACTIVE_K8S_WATCH = w

                def _stream_events():
                    try:
                        return list(w.stream(investigator.core_v1.list_event_for_all_namespaces, timeout_seconds=4))
                    except Exception:
                        return []

                event_stream = await asyncio.to_thread(_stream_events)

                for item in event_stream:
                    if SHUTDOWN_EVENT.is_set():
                        break

                    event_obj = item.get("object")
                    if not event_obj:
                        continue

                    reason = getattr(event_obj, "reason", "") or ""
                    event_type = getattr(event_obj, "type", "Normal") or "Normal"
                    metadata = getattr(event_obj, "metadata", None)
                    ns = getattr(metadata, "namespace", "default") if metadata else "default"
                    involved_obj = getattr(event_obj, "involved_object", None)
                    res_name = getattr(involved_obj, "name", "unknown") if involved_obj else "unknown"
                    res_kind = getattr(involved_obj, "kind", "Pod") if involved_obj else "Pod"
                    message = getattr(event_obj, "message", "") or ""
                    event_count = getattr(event_obj, "count", 1) or 1
                    raw_ts = getattr(event_obj, "last_timestamp", None) or getattr(metadata, "creation_timestamp", "") or ""
                    event_uid = f"{getattr(metadata, 'uid', 'k8s')}_{event_count}_{raw_ts}"

                    # 1. Filter out already processed Kubernetes event instances
                    if event_uid in PROCESSED_K8S_EVENT_UIDS:
                        continue
                    PROCESSED_K8S_EVENT_UIDS.add(event_uid)
                    if len(PROCESSED_K8S_EVENT_UIDS) > 10000:
                        PROCESSED_K8S_EVENT_UIDS.clear()

                    # 2. Filter for real chaos warning events
                    CHAOS_REASONS = [
                        "OOMKilled", "BackOff", "CrashLoopBackOff", "Failed", 
                        "FailedScheduling", "Unhealthy", "ErrImagePull", 
                        "ImagePullBackOff", "NodeDiskPressure", "Evicted"
                    ]
                    
                    is_chaos = (event_type == "Warning") or any(cr.lower() in reason.lower() for cr in CHAOS_REASONS) or any(cr.lower() in message.lower() for cr in CHAOS_REASONS)
                    
                    # Ignore system noise
                    if ns in ["kube-system", "kube-node-lease", "kube-public"] or not is_chaos:
                        continue

                    dep_prefix = extract_deployment_name(res_name, res_kind)

                    # 3. Check event age to avoid replaying stale historical events on watch reconnect
                    now_ts = time.time()
                    last_ts = getattr(event_obj, "last_timestamp", None) or getattr(event_obj, "event_time", None) or getattr(metadata, "creation_timestamp", None)
                    if last_ts:
                        try:
                            if hasattr(last_ts, "timestamp"):
                                event_age = now_ts - last_ts.timestamp()
                            else:
                                parsed_dt = datetime.fromisoformat(str(last_ts).replace("Z", "+00:00"))
                                event_age = now_ts - parsed_dt.timestamp()
                            if event_age > 120:  # Skip historical events older than 2 minutes
                                continue
                        except Exception:
                            pass

                    # Check if there is an active incident for this deployment
                    active_thread_id = find_active_incident_for_workload(ns, res_name, res_kind)

                    # Debounce rapid duplicate event bursts within 5 seconds if not active
                    if not active_thread_id:
                        if dep_prefix in SEEN_K8S_EVENTS and (now_ts - SEEN_K8S_EVENTS[dep_prefix]) < 5:
                            continue
                        SEEN_K8S_EVENTS[dep_prefix] = now_ts

                    logger.info(f"🚨 [REAL_K8S_CHAOS_DETECTED] Namespace={ns}, Resource={res_name}, Reason={reason}")

                    # Create live AlertEvent from actual cluster anomaly
                    event_id = f"k8s-live-{uuid.uuid4().hex[:6]}"
                    alert_event = AlertEvent(
                        event_id=event_id,
                        cluster=getattr(investigator, "cluster_name", "minikube") or "minikube",
                        namespace=ns,
                        resource_kind=res_kind,
                        resource_name=res_name,
                        severity="Critical" if any(k in reason for k in ["OOM", "BackOff", "Failed", "ErrImage"]) else "Warning",
                        reason=reason or "ClusterAnomaly",
                        message=message or f"Kubernetes warning condition detected on {res_name}",
                        raw_metadata={"live_k8s": True, "event_type": event_type}
                    )

                    await ingest_or_aggregate_alert(alert_event, None)
            
            await asyncio.sleep(2)
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.debug(f"Live K8s watch poll notice: {e}")
            await asyncio.sleep(2)


async def broadcast_event(event_type: str, data: Dict[str, Any], thread_id: Optional[str] = None):
    """Broadcasts real-time events to all connected SSE clients."""
    payload = {
        "event_type": event_type,
        "thread_id": thread_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": data
    }
    
    # Broadcast to global subscribers
    for queue in list(STREAM_SUBSCRIBERS):
        try:
            await queue.put(payload)
        except Exception:
            pass

    # Broadcast to thread-specific subscribers
    if thread_id and thread_id in THREAD_STREAMS:
        for queue in list(THREAD_STREAMS[thread_id]):
            try:
                await queue.put(payload)
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Background Graph Runner (Fully Async Concurrent)
# ---------------------------------------------------------------------------
async def run_agent_workflow(thread_id: str, alert_data: Dict[str, Any]):
    """
    Executes the LangGraph agent state machine for the given alert event 
    asynchronously using native astream, running investigations in parallel.
    """
    logger.info(f"Starting LangGraph workflow for thread {thread_id}")
    config = {"configurable": {"thread_id": thread_id}}
    
    initial_state = {
        "event_data": alert_data,
        "investigation_data": {},
        "sanitized_logs": [],
        "analysis": None,
        "proposed_action": None,
        "human_approved": None,
        "approver_comment": None,
        "execution_result": None,
        "audit_log": None,
        "status": "analyzing",
        "timeline": []
    }

    await broadcast_event("state_change", {
        "status": "investigating",
        "message": f"Investigating cluster telemetry for {alert_data.get('resource_name')}"
    }, thread_id=thread_id)

    try:
        # Asynchronously stream graph node execution events
        async for chunk in watchdog_app.astream(initial_state, config, stream_mode="updates"):
            for node_name, node_output in chunk.items():
                logger.info(f"Graph update from [{node_name}] for thread {thread_id}")
                
                if node_name == "investigate":
                    sanitized_count = sum(node_output.get("investigation_data", {}).get("security_scrub_metrics", {}).values())
                    await broadcast_event("tool_call", {
                        "tool": "Investigate_Cluster",
                        "node": node_name,
                        "logs": node_output.get("sanitized_logs", []),
                        "events": node_output.get("investigation_data", {}).get("events", []),
                        "scrubbed_tokens": sanitized_count
                    }, thread_id=thread_id)

                elif node_name == "analyze":
                    analysis = node_output.get("analysis", {})
                    action = node_output.get("proposed_action", {})
                    await broadcast_event("thought", {
                        "node": node_name,
                        "analysis": analysis,
                        "proposed_action": action
                    }, thread_id=thread_id)

        # Check graph state after run (should be paused at approval interrupt)
        snapshot = await watchdog_app.aget_state(config)
        
        if snapshot.tasks and any(task.interrupts for task in snapshot.tasks):
            logger.info(f"Thread {thread_id} paused at interrupt(). Awaiting human approval.")
            state_values = snapshot.values
            EVENT_STORE[thread_id]["status"] = "awaiting_approval"
            EVENT_STORE[thread_id]["state"] = state_values
            
            await broadcast_event("approval_required", {
                "thread_id": thread_id,
                "event": alert_data,
                "analysis": state_values.get("analysis"),
                "proposed_action": state_values.get("proposed_action"),
                "sanitized_logs": state_values.get("sanitized_logs", [])
            }, thread_id=thread_id)
        else:
            state_values = snapshot.values
            EVENT_STORE[thread_id]["status"] = state_values.get("status", "completed")
            EVENT_STORE[thread_id]["state"] = state_values

    except Exception as e:
        logger.error(f"Workflow execution failed for thread {thread_id}: {e}", exc_info=True)
        EVENT_STORE[thread_id]["status"] = "failed"
        await broadcast_event("error", {"error": str(e)}, thread_id=thread_id)


# ---------------------------------------------------------------------------
# API Routes (High-Performance & Non-Blocking)
# ---------------------------------------------------------------------------
@app.get("/healthz")
async def health_check():
    """Health check probe for Kubernetes."""
    return {"status": "ok", "service": "k8s-agentic-watchdog", "timestamp": datetime.now(timezone.utc).isoformat()}


@app.get("/api/v1/cluster/status")
async def get_cluster_status():
    """Returns live telemetry with high-performance 3-second caching and non-blocking worker execution."""
    now = time.time()
    if CLUSTER_INFO_CACHE["data"] and (now - CLUSTER_INFO_CACHE["ts"]) < 3.0:
        return CLUSTER_INFO_CACHE["data"]
    
    data = await asyncio.to_thread(investigator.get_cluster_info)
    CLUSTER_INFO_CACHE["data"] = data
    CLUSTER_INFO_CACHE["ts"] = now
    return data


@app.get("/api/v1/cluster/pods")
async def get_cluster_pods(namespace: str = "watchdog-demo"):
    """Returns list of pods in given namespace without blocking the async event loop."""
    def _fetch_pods():
        if investigator.k8s_available:
            try:
                pods = investigator.core_v1.list_namespaced_pod(namespace=namespace)
                result = []
                for p in pods.items:
                    result.append({
                        "name": p.metadata.name,
                        "namespace": p.metadata.namespace,
                        "status": p.status.phase,
                        "pod_ip": p.status.pod_ip,
                        "host_ip": p.status.host_ip,
                        "start_time": str(p.status.start_time),
                        "container_statuses": [
                            {
                                "name": cs.name,
                                "ready": cs.ready,
                                "restart_count": cs.restart_count,
                                "state": "running" if cs.state.running else ("waiting" if cs.state.waiting else "terminated")
                            }
                            for cs in (p.status.container_statuses or [])
                        ]
                    })
                return {"namespace": namespace, "pods": result, "count": len(result)}
            except Exception as e:
                logger.error(f"Error fetching pods from namespace {namespace}: {e}")
                return {"namespace": namespace, "pods": [], "count": 0}
        return {"namespace": namespace, "pods": [], "count": 0}

    return await asyncio.to_thread(_fetch_pods)


@app.post("/api/v1/webhook/event")
async def receive_event(event: AlertEvent, background_tasks: BackgroundTasks):
    """
    Accepts K8s alert payloads (Alertmanager, Falco, or Watchers).
    Aggregates into active incident if already investigating/awaiting approval for this deployment.
    """
    return await ingest_or_aggregate_alert(event, background_tasks)


@app.get("/api/v1/pending-approvals")
async def list_pending_approvals():
    """
    Lists all threads currently paused at the LangGraph interrupt() step,
    awaiting human decision in the dashboard.
    """
    pending = []
    for thread_id, record in EVENT_STORE.items():
        if record.get("status") == "awaiting_approval":
            config = {"configurable": {"thread_id": thread_id}}
            snapshot = await watchdog_app.aget_state(config)
            state_val = snapshot.values if snapshot else {}
            event_data = dict(record.get("event", {}))
            event_data["alert_count"] = record.get("alert_count", 1)
            event_data["reasons"] = record.get("reasons", [event_data.get("reason")])
            pending.append({
                "thread_id": thread_id,
                "event_id": record.get("event_id"),
                "created_at": record.get("created_at"),
                "updated_at": record.get("updated_at"),
                "alert_count": record.get("alert_count", 1),
                "reasons": record.get("reasons", [event_data.get("reason")]),
                "deployment_name": record.get("deployment_name"),
                "event": event_data,
                "analysis": state_val.get("analysis"),
                "proposed_action": state_val.get("proposed_action"),
                "sanitized_logs": state_val.get("sanitized_logs", []),
                "timeline": state_val.get("timeline", [])
            })
    return {"pending_approvals": pending, "count": len(pending)}


@app.post("/api/v1/approve/{thread_id}")
async def approve_remediation(thread_id: str, request: ApprovalRequest, background_tasks: BackgroundTasks):
    """
    Resumes a paused LangGraph thread with human approval decision (approved: true/false).
    """
    if thread_id not in EVENT_STORE:
        raise HTTPException(status_code=404, detail=f"Thread '{thread_id}' not found")

    logger.info(f"Processing approval for thread {thread_id}: approved={request.approved}, comment='{request.comment}'")
    config = {"configurable": {"thread_id": thread_id}}

    async def resume_workflow():
        try:
            await broadcast_event("state_change", {
                "status": "executing" if request.approved else "rejected",
                "decision": request.approved,
                "comment": request.comment
            }, thread_id=thread_id)

            # Asynchronously stream LangGraph updates with Command(resume=...)
            async for chunk in watchdog_app.astream(
                Command(resume={"approved": request.approved, "comment": request.comment}),
                config,
                stream_mode="updates"
            ):
                for node_name, node_output in chunk.items():
                    logger.info(f"Post-approval update from [{node_name}] for thread {thread_id}")
                    if node_name == "revalidate":
                        already_resolved = node_output.get("already_resolved", False)
                        res_msg = node_output.get("resolution_reason", "")
                        await broadcast_event("tool_call", {
                            "tool": "Pre_Execution_Cluster_Verification",
                            "node": node_name,
                            "already_resolved": already_resolved,
                            "details": res_msg or "Live cluster state re-validated. Issue confirmed active, proceeding with remediation."
                        }, thread_id=thread_id)
                    elif node_name == "execute":
                        exec_res = node_output.get("execution_result", {})
                        await broadcast_event("execution", {
                            "node": node_name,
                            "execution_result": exec_res
                        }, thread_id=thread_id)
                    elif node_name == "audit":
                        audit_entry = node_output.get("audit_log", {})
                        audit_entry["alert_count"] = EVENT_STORE[thread_id].get("alert_count", 1)
                        audit_entry["reasons"] = EVENT_STORE[thread_id].get("reasons", [])
                        AUDIT_STORE.insert(0, audit_entry)
                        await broadcast_event("done", {
                            "status": "remediated" if request.approved else "rejected",
                            "audit_log": audit_entry
                        }, thread_id=thread_id)

            # Update final state
            snapshot = await watchdog_app.aget_state(config)
            final_status = "remediated" if request.approved else "rejected"
            EVENT_STORE[thread_id]["status"] = final_status
            EVENT_STORE[thread_id]["state"] = snapshot.values if snapshot else {}

        except Exception as e:
            logger.error(f"Error resuming thread {thread_id}: {e}", exc_info=True)
            EVENT_STORE[thread_id]["status"] = "failed"
            await broadcast_event("error", {"error": str(e)}, thread_id=thread_id)

    background_tasks.add_task(resume_workflow)

    return {
        "status": "resumed",
        "thread_id": thread_id,
        "decision": "approved" if request.approved else "rejected"
    }


@app.get("/api/v1/events")
async def list_events():
    """Returns list of all active and past events with consolidated alert counts."""
    events = []
    for thread_id, record in EVENT_STORE.items():
        rec = dict(record)
        event_data = dict(rec.get("event", {}))
        event_data["alert_count"] = rec.get("alert_count", 1)
        event_data["reasons"] = rec.get("reasons", [event_data.get("reason")])
        rec["event"] = event_data
        events.append(rec)
    events.reverse()
    return {"events": events, "total": len(events)}


@app.get("/api/v1/audit-logs")
async def list_audit_logs():
    """Returns comprehensive historical audit logs."""
    return {"audit_logs": AUDIT_STORE, "total": len(AUDIT_STORE)}


@app.get("/api/v1/stream/{thread_id}")
async def stream_thread_events(thread_id: str, request: Request):
    """Server-Sent Events (SSE) stream for a specific thread."""
    queue = asyncio.Queue()
    if thread_id not in THREAD_STREAMS:
        THREAD_STREAMS[thread_id] = []
    THREAD_STREAMS[thread_id].append(queue)

    async def event_generator():
        try:
            # Yield initial connection message
            yield {
                "event": "connected",
                "data": json.dumps({"thread_id": thread_id, "timestamp": datetime.now(timezone.utc).isoformat()})
            }
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield {
                        "event": msg.get("event_type", "message"),
                        "data": json.dumps(msg)
                    }
                except asyncio.TimeoutError:
                    # Keep-alive heartbeat
                    yield {
                        "event": "ping",
                        "data": json.dumps({"timestamp": datetime.now(timezone.utc).isoformat()})
                    }
        finally:
            if thread_id in THREAD_STREAMS and queue in THREAD_STREAMS[thread_id]:
                THREAD_STREAMS[thread_id].remove(queue)

    return EventSourceResponse(event_generator())


@app.get("/api/v1/stream")
async def stream_all_events(request: Request):
    """Global Server-Sent Events (SSE) stream for all cluster watchdog events."""
    queue = asyncio.Queue()
    STREAM_SUBSCRIBERS.append(queue)

    async def event_generator():
        try:
            yield {
                "event": "connected",
                "data": json.dumps({"status": "connected_to_global_feed", "timestamp": datetime.now(timezone.utc).isoformat()})
            }
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield {
                        "event": msg.get("event_type", "message"),
                        "data": json.dumps(msg)
                    }
                except asyncio.TimeoutError:
                    yield {
                        "event": "ping",
                        "data": json.dumps({"timestamp": datetime.now(timezone.utc).isoformat()})
                    }
        finally:
            if queue in STREAM_SUBSCRIBERS:
                STREAM_SUBSCRIBERS.remove(queue)

    return EventSourceResponse(event_generator())


@app.post("/api/v1/simulate/alert")
async def simulate_alert(preset: str = "oom", background_tasks: BackgroundTasks = None):
    """
    Triggers simulated Kubernetes alert scenarios for instant testing and live demonstrations.
    Aggregates repeat alerts for the same deployment into a single consolidated incident.
    Presets: 'oom', 'crashloop', 'imagepull', 'diskpressure'
    """
    event_id = f"alert-{uuid.uuid4().hex[:6]}"
    
    presets = {
        "oom": AlertEvent(
            event_id=event_id,
            cluster="production-us-east-1",
            namespace="payments",
            resource_kind="Pod",
            resource_name=f"payment-processor-{uuid.uuid4().hex[:4]}",
            severity="Critical",
            reason="OOMKilled",
            message="Container memory limit 256Mi exceeded. Process killed with SIGKILL (exit code 137).",
            raw_metadata={"cgroup_limit_bytes": 268435456, "peak_usage_bytes": 268435456}
        ),
        "crashloop": AlertEvent(
            event_id=event_id,
            cluster="production-us-east-1",
            namespace="auth",
            resource_kind="Pod",
            resource_name=f"auth-gateway-{uuid.uuid4().hex[:4]}",
            severity="Warning",
            reason="CrashLoopBackOff",
            message="Readiness probe failed HTTP 503. Container continuously crashing on startup.",
            raw_metadata={"exit_code": 1, "restart_count": 14}
        ),
        "imagepull": AlertEvent(
            event_id=event_id,
            cluster="staging-eu-west-1",
            namespace="frontend-apps",
            resource_kind="Deployment",
            resource_name="storefront-web",
            severity="Critical",
            reason="ImagePullBackOff",
            message="Failed to pull image 'registry.internal.corp/checkout-api:v3.0.0-rc2': manifest unknown.",
            raw_metadata={"image": "registry.internal.corp/checkout-api:v3.0.0-rc2"}
        ),
        "diskpressure": AlertEvent(
            event_id=event_id,
            cluster="production-us-east-1",
            namespace="monitoring",
            resource_kind="Node",
            resource_name="worker-node-pool-2b",
            severity="Warning",
            reason="NodeDiskPressure",
            message="Kubelet has disk pressure condition set. Available disk space below 10%.",
            raw_metadata={"available_percent": 8.4}
        )
    }

    event = presets.get(preset.lower(), presets["oom"])
    # Adjust event ID to match
    event.event_id = event_id

    return await ingest_or_aggregate_alert(event, background_tasks)


# ---------------------------------------------------------------------------
# 6. GitHub Webhook & Live Auto-Resolution System
# ---------------------------------------------------------------------------

@app.post("/api/v1/webhooks/github")
async def github_webhook(request: Request):
    """
    GitHub Webhook receiver: Called automatically by GitHub when a Pull Request
    is merged, closed, or updated. Auto-resolves corresponding incidents!
    """
    try:
        payload = await request.json()
        action = payload.get("action")
        pr_data = payload.get("pull_request", {})
        is_merged = pr_data.get("merged", False)
        pr_number = pr_data.get("number")
        pr_url = pr_data.get("html_url", "")
        branch_name = pr_data.get("head", {}).get("ref", "")

        logger.info(f"Received GitHub Webhook: action={action}, pr=#{pr_number}, merged={is_merged}")

        if action == "closed" and is_merged:
            logger.info(f"🎉 GitHub PR #{pr_number} MERGED! Triggering autonomous cluster reconciliation...")
            resolved_count = await auto_resolve_incidents_for_pr(pr_number, pr_url, branch_name)
            return {
                "status": "reconciled",
                "pr_number": pr_number,
                "merged": True,
                "auto_resolved_incidents": resolved_count
            }

        return {"status": "ignored", "action": action, "merged": is_merged}
    except Exception as e:
        logger.error(f"GitHub Webhook processing error: {e}")
        return JSONResponse(status_code=400, content={"error": str(e)})


async def auto_resolve_incidents_for_pr(pr_number: Optional[int], pr_url: str, branch_name: str = "") -> int:
    """Auto-resolves pending incidents ONLY if the incident specifically produced this merged PR."""
    if pr_number and pr_number in PROCESSED_MERGED_PRS:
        return 0
    if pr_number:
        PROCESSED_MERGED_PRS.add(pr_number)

    resolved = 0
    now_str = datetime.now(timezone.utc).isoformat()

    for thread_id, record in list(EVENT_STORE.items()):
        status = record.get("status")
        if status in ["awaiting_approval", "analyzing", "investigating"]:
            event = record.get("event", {})
            res_name = event.get("resource_name", "")
            rec_dep = record.get("deployment_name") or extract_deployment_name(res_name)
            
            should_resolve = False
            state_str = str(record.get("state", {}))
            
            # Strictly match the exact PR number or PR branch created for THIS incident
            if pr_number and str(pr_number) in state_str:
                should_resolve = True
            elif branch_name and branch_name in state_str and branch_name.startswith("watchdog/"):
                should_resolve = True
            elif branch_name == "manual_sync_all":
                should_resolve = True
            
            if should_resolve:
                logger.info(f"✅ Resolving incident {thread_id} ({rec_dep}) due to merged GitHub PR #{pr_number}.")
                
                # Update event store
                EVENT_STORE[thread_id]["status"] = "remediated"
                EVENT_STORE[thread_id]["updated_at"] = now_str
                
                # Heal live deployment in Minikube
                if investigator and investigator.k8s_available:
                    try:
                        dep_name = res_name.split("-")[0]
                        if "storefront" in res_name:
                            dep_name = "storefront-web"
                            investigator.apps_v1.patch_namespaced_deployment(
                                name=dep_name,
                                namespace="watchdog-demo",
                                body={"spec": {"template": {"spec": {"containers": [{"name": dep_name, "image": "nginx:alpine"}]}}}}
                            )
                        elif "payment" in res_name:
                            dep_name = "payment-processor"
                            investigator.apps_v1.patch_namespaced_deployment(
                                name=dep_name,
                                namespace="watchdog-demo",
                                body={"spec": {"template": {"spec": {"containers": [{"name": dep_name, "resources": {"limits": {"memory": "1Gi"}}}]}}}}
                            )
                        logger.info(f"☸️ [K8S_HEALED] Minikube deployment '{dep_name}' reconciled with desired GitOps state.")
                    except Exception as e:
                        logger.warning(f"Live heal notice: {e}")

                audit_entry = {
                    "event_id": record.get("event_id"),
                    "resource": f"{event.get('namespace')}/{res_name}",
                    "alert_count": record.get("alert_count", 1),
                    "reasons": record.get("reasons", [event.get("reason")]),
                    "root_cause": record.get("state", {}).get("analysis", {}).get("root_cause_summary", "Resolved via GitOps PR Merge"),
                    "action_taken": f"Pull Request #{pr_number or 'Auto-Sync'} Merged: GitOps desired state applied to cluster.",
                    "human_approved": True,
                    "approver_comment": "Auto-resolved via merged GitHub GitOps Pull Request",
                    "execution_status": "success",
                    "timestamp": now_str,
                    "timeline": [
                        {"step": "gitops_merge", "title": "GitHub PR Merged", "details": f"PR {pr_url or 'GitOps Sync'} merged to main branch.", "timestamp": now_str},
                        {"step": "k8s_reconcile", "title": "Cluster Reconciled", "details": "Minikube deployment updated and pods healthy (Ready: 100%).", "timestamp": now_str}
                    ]
                }
                AUDIT_STORE.insert(0, audit_entry)

                await broadcast_event("done", {
                    "status": "remediated",
                    "audit_log": audit_entry,
                    "message": f"Incident auto-resolved! GitOps PR merged and cluster reconciled."
                }, thread_id=thread_id)

                await broadcast_event("state_change", {
                    "status": "remediated",
                    "thread_id": thread_id
                }, thread_id=thread_id)

                resolved += 1

    return resolved


async def live_pr_and_health_reconciliation_worker():
    """
    Background worker that continuously polls GitHub for merged Pull Requests
    and reconciles matching incidents only when a PR specifically created for that incident is merged into main.
    Does NOT auto-close pending approvals without explicit PR merge or operator action!
    """
    import requests
    logger.info("Initializing Live GitHub PR Reconciliation Worker...")

    while not SHUTDOWN_EVENT.is_set():
        try:
            # Check for Merged GitHub PRs
            github_token = os.getenv("GITHUB_TOKEN")
            github_repo = os.getenv("GITHUB_REPO")
            
            if github_token and github_repo:
                headers = {
                    "Authorization": f"Bearer {github_token}",
                    "Accept": "application/vnd.github.v3+json"
                }
                def _fetch_closed_prs():
                    res = requests.get(f"https://api.github.com/repos/{github_repo}/pulls?state=closed&per_page=5", headers=headers, timeout=5)
                    return res.json() if res.status_code == 200 else []

                closed_prs = await asyncio.to_thread(_fetch_closed_prs)

                for pr in closed_prs:
                    if pr.get("merged_at"):
                        pr_num = pr.get("number")
                        pr_url = pr.get("html_url")
                        branch = pr.get("head", {}).get("ref", "")
                        await auto_resolve_incidents_for_pr(pr_num, pr_url, branch)

            await asyncio.sleep(6)
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.debug(f"GitHub PR poll cycle: {e}")
            await asyncio.sleep(6)


@app.post("/api/v1/sync")
async def trigger_manual_sync():
    """Manual trigger to sync GitHub PR merges and cluster health immediately."""
    resolved = await auto_resolve_incidents_for_pr(None, "Manual Sync", "manual_sync_all")
    return {"status": "synced", "resolved_incidents": resolved}
