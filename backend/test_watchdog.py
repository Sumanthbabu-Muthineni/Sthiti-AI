import pytest
import asyncio
from models import AlertEvent, ApprovalRequest
from tools import DataSanitizer, ClusterInvestigator, ImperativeExecutor, GitOpsExecutor
from agent import create_watchdog_graph
from langgraph.types import Command
from fastapi.testclient import TestClient
from main import app

def test_data_sanitizer_regex():
    """Verify that sensitive tokens, IPs, passwords, and keys are scrubbed."""
    raw_log = (
        "2026-08-22 12:00:00 [ERROR] Auth failure with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyIjoiYWRtaW4ifQ.abc123def456 "
        "connecting to internal IP 10.244.3.45 with api_key=sk-live99882233445566778899 "
        "and db_password='mySecretPassword123' from admin@internal.corp"
    )
    
    sanitized, counts = DataSanitizer.sanitize(raw_log)
    
    assert "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" not in sanitized
    assert "10.244.3.45" not in sanitized
    assert "sk-live99882233445566778899" not in sanitized
    assert "mySecretPassword123" not in sanitized
    assert "admin@internal.corp" not in sanitized
    
    assert "[REDACTED" in sanitized
    assert sum(counts.values()) >= 4


def test_cluster_investigator():
    """Verify cluster investigation gathers telemetry and applies log sanitization."""
    investigator = ClusterInvestigator()
    event_data = {
        "event_id": "test-oom-1",
        "namespace": "billing",
        "resource_kind": "Pod",
        "resource_name": "billing-processor-abc",
        "reason": "OOMKilled",
        "message": "Memory limit exceeded."
    }
    
    result = investigator.investigate(event_data)
    assert result["resource_info"]["name"] == "billing-processor-abc"
    assert len(result["sanitized_logs"]) > 0
    assert len(result["events"]) > 0
    assert "manifest_summary" in result


def test_executors():
    """Verify imperative and gitops execution outputs."""
    investigator = ClusterInvestigator()
    imperative = ImperativeExecutor(investigator)
    gitops = GitOpsExecutor()

    # Test imperative action
    imp_res = imperative.execute({
        "imperative_command": "kubectl rollout restart deployment/billing-processor -n billing",
        "resource_name": "billing-processor",
        "namespace": "billing",
        "action_title": "Restart Billing Rollout"
    })
    assert imp_res["status"] == "success"
    assert imp_res["action_type"] == "imperative"

    # Test gitops action
    git_res = gitops.execute({
        "gitops_file_path": "k8s/deployments/billing-processor.yaml",
        "gitops_diff": "--- a/k8s.yaml\n+++ b/k8s.yaml\n- memory: 256Mi\n+ memory: 1Gi",
        "action_title": "Increase Memory Limits to 1Gi"
    })
    assert git_res["status"] == "success"
    assert git_res["action_type"] == "gitops"
    assert "pr_url" in git_res
    assert "branch_name" in git_res


@pytest.mark.asyncio
async def test_langgraph_workflow_interrupt_and_resume():
    """Verify LangGraph workflow runs to interrupt() and resumes on approval asynchronously."""
    app_graph = create_watchdog_graph()
    thread_id = "test-thread-workflow-1"
    config = {"configurable": {"thread_id": thread_id}}

    initial_state = {
        "event_data": {
            "event_id": "test-alert-101",
            "namespace": "checkout",
            "resource_kind": "Pod",
            "resource_name": "cartservice-xyz",
            "severity": "Critical",
            "reason": "OOMKilled",
            "message": "Pod terminated with exit code 137"
        },
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

    # Step 1: Run asynchronously until interrupt
    async for chunk in app_graph.astream(initial_state, config, stream_mode="updates"):
        pass

    state_snapshot = await app_graph.aget_state(config)
    # Verify paused at approval
    assert any(task.interrupts for task in state_snapshot.tasks)
    assert state_snapshot.values["analysis"] is not None
    assert state_snapshot.values["proposed_action"] is not None

    # Step 2: Resume with approval asynchronously
    async for chunk in app_graph.astream(
        Command(resume={"approved": True, "comment": "Approved for memory increase"}),
        config,
        stream_mode="updates"
    ):
        pass

    final_snapshot = await app_graph.aget_state(config)
    assert final_snapshot.values["human_approved"] is True
    assert final_snapshot.values["execution_result"] is not None
    assert final_snapshot.values["audit_log"] is not None


def test_fastapi_endpoints():
    """Verify FastAPI routes for webhook, pending approvals, simulate, and healthz."""
    client = TestClient(app)

    # 1. Health check
    res = client.get("/healthz")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"

    # 2. Simulate alert
    sim_res = client.post("/api/v1/simulate/alert?preset=oom")
    assert sim_res.status_code == 200
    thread_id = sim_res.json()["thread_id"]
    assert thread_id.startswith("thread_alert-")

    # 3. List events
    events_res = client.get("/api/v1/events")
    assert events_res.status_code == 200
    assert len(events_res.json()["events"]) >= 1


def test_incident_deduplication_and_cumulative_alert_count():
    """Verify multiple alerts for the same deployment consolidate into 1 incident with cumulative counts and multi-reasons."""
    client = TestClient(app)

    # Event 1: Initial Image Pull Failure
    ev1 = {
        "event_id": "test-dedup-01",
        "namespace": "frontend-apps",
        "resource_kind": "Deployment",
        "resource_name": "storefront-web",
        "severity": "Critical",
        "reason": "ErrImagePull",
        "message": "Failed to pull image tag v3.0.0-rc2"
    }
    r1 = client.post("/api/v1/webhook/event", json=ev1)
    assert r1.status_code == 200
    res1 = r1.json()
    assert res1["status"] == "queued"
    thread_id = res1["thread_id"]
    assert res1["alert_count"] == 1
    assert res1["reasons"] == ["ErrImagePull"]

    # Event 2: ImagePullBackOff for the same deployment
    ev2 = {
        "event_id": "test-dedup-02",
        "namespace": "frontend-apps",
        "resource_kind": "Deployment",
        "resource_name": "storefront-web",
        "severity": "Critical",
        "reason": "ImagePullBackOff",
        "message": "Back-off pulling image registry.internal.corp/storefront-web:v3.0.0-rc2"
    }
    r2 = client.post("/api/v1/webhook/event", json=ev2)
    assert r2.status_code == 200
    res2 = r2.json()
    assert res2["status"] == "aggregated"
    assert res2["thread_id"] == thread_id
    assert res2["alert_count"] == 2
    assert res2["reasons"] == ["ErrImagePull", "ImagePullBackOff"]

    # Event 3: Pod under the same deployment throws CrashLoop / Container restart
    ev3 = {
        "event_id": "test-dedup-03",
        "namespace": "frontend-apps",
        "resource_kind": "Pod",
        "resource_name": "storefront-web-5d78b74684-x9kz2",
        "severity": "Warning",
        "reason": "CrashLoopBackOff",
        "message": "Container failed readiness probe"
    }
    r3 = client.post("/api/v1/webhook/event", json=ev3)
    assert r3.status_code == 200
    res3 = r3.json()
    assert res3["status"] == "aggregated"
    assert res3["thread_id"] == thread_id
    assert res3["alert_count"] == 3
    assert "CrashLoopBackOff" in res3["reasons"]

    # Verify GET /api/v1/events contains single consolidated record for storefront-web with alert_count=3
    events_res = client.get("/api/v1/events")
    assert events_res.status_code == 200
    all_events = events_res.json()["events"]
    storefront_records = [e for e in all_events if e["thread_id"] == thread_id]
    assert len(storefront_records) == 1
    assert storefront_records[0]["alert_count"] == 3
    assert "ErrImagePull" in storefront_records[0]["reasons"]
    assert "ImagePullBackOff" in storefront_records[0]["reasons"]
    assert "CrashLoopBackOff" in storefront_records[0]["reasons"]


@pytest.mark.asyncio
async def test_strict_human_approval_cannot_auto_remediate_without_approval():
    """
    CRITICAL TEST: Verifies that an incident strictly remains in 'awaiting_approval'
    and is NEVER auto-remediated by historical PRs, cluster pollers, or time passing
    until an operator explicitly submits an approval decision.
    """
    from main import EVENT_STORE, auto_resolve_incidents_for_pr, ingest_or_aggregate_alert

    test_event_id = "test-strict-gate-001"
    alert = AlertEvent(
        event_id=test_event_id,
        cluster="minikube",
        namespace="watchdog-demo",
        resource_kind="Deployment",
        resource_name="auth-gateway",
        severity="Critical",
        reason="CrashLoopBackOff",
        message="Container continuous crash on startup (exit code 1)"
    )

    # 1. Ingest alert and wait for workflow to reach approval breakpoint
    ingest_res = await ingest_or_aggregate_alert(alert, None)
    thread_id = ingest_res["thread_id"]
    assert thread_id in EVENT_STORE

    # Wait for LangGraph to analyze and pause at interrupt()
    for _ in range(60):
        if EVENT_STORE[thread_id]["status"] == "awaiting_approval":
            break
        await asyncio.sleep(0.2)

    assert EVENT_STORE[thread_id]["status"] == "awaiting_approval"

    # 2. Simulate historical/unrelated merged PRs from GitHub (e.g. past PR #99 for auth or payment)
    # This MUST NOT auto-resolve the active incident!
    resolved_count = await auto_resolve_incidents_for_pr(
        pr_number=9999,
        pr_url="https://github.com/org/repo/pull/9999",
        branch_name="watchdog/fix-auth-gateway-old-20250101"
    )
    assert resolved_count == 0
    # Incident MUST STILL BE in 'awaiting_approval'
    assert EVENT_STORE[thread_id]["status"] == "awaiting_approval"

    # 3. Simulate another unrelated PR merge
    resolved_count_2 = await auto_resolve_incidents_for_pr(
        pr_number=8888,
        pr_url="https://github.com/org/repo/pull/8888",
        branch_name="feature/payment-v2"
    )
    assert resolved_count_2 == 0
    assert EVENT_STORE[thread_id]["status"] == "awaiting_approval"

    # 4. Only an explicit human operator approval resumes the thread to 'remediated'
    client = TestClient(app)
    app_res = client.post(
        f"/api/v1/approve/{thread_id}",
        json={"approved": True, "comment": "Operator verified and approved memory fix."}
    )
    assert app_res.status_code == 200
    assert app_res.json()["decision"] == "approved"

    # Wait for execution node to complete
    for _ in range(60):
        if EVENT_STORE[thread_id]["status"] == "remediated":
            break
        await asyncio.sleep(0.2)

    assert EVENT_STORE[thread_id]["status"] == "remediated"
    assert EVENT_STORE[thread_id]["state"]["human_approved"] is True
    assert EVENT_STORE[thread_id]["state"]["approver_comment"] == "Operator verified and approved memory fix."


@pytest.mark.asyncio
async def test_pre_execution_revalidation_node_detects_external_resolution():
    """
    Verifies that the revalidate_node inspects live cluster status post-approval,
    detects if an engineer manually resolved the issue beforehand, and skips redundant execution.
    """
    from agent import revalidate_node, execute_node

    # State with human approval where the cluster is already healthy
    state_already_healthy = {
        "event_data": {
            "event_id": "test-revalidate-001",
            "namespace": "watchdog-demo",
            "resource_kind": "Deployment",
            "resource_name": "payment-processor",
            "reason": "OOMKilled"
        },
        "proposed_action": {
            "action_type": "gitops",
            "action_title": "Increase Memory Limits to 1Gi",
            "gitops_diff": "+ memory: 1Gi"
        },
        "human_approved": True,
        "approver_comment": "Approved memory fix",
        "timeline": []
    }

    # 1. Run revalidate_node
    reval_res = await revalidate_node(state_already_healthy)
    assert "already_resolved" in reval_res
    assert "resolution_reason" in reval_res
    assert len(reval_res["timeline"]) >= 1

    # 2. Merge into state and run execute_node
    merged_state = {**state_already_healthy, **reval_res}
    exec_res = await execute_node(merged_state)

    if reval_res["already_resolved"]:
        # If live Minikube is healthy, execute_node skipped redundant execution
        assert exec_res["execution_result"]["status"] == "already_resolved"
        assert "Verified Healthy" in exec_res["execution_result"]["action_title"]
    else:
        # If running in offline test mode without Minikube, execute proceeds normally
        assert exec_res["status"] in ["remediated", "already_resolved"]



