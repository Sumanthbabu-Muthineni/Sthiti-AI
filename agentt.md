# Role & Context
Act as a Principal Kubernetes Infrastructure Engineer and a Lead AI Engineer. Your task is to build a production-grade, full-stack "K8s Agentic Watchdog".

This system functions as an autonomous AI Site Reliability Engineer (SRE). It receives cluster alerts, investigates root causes using OpenAI (`gpt-4o`), sanitizes sensitive cluster logs, proposes actionable remediations via structured outputs, pauses for human approval via an interactive web dashboard, and executes the fix upon approval.

# Project Structure
Create a monorepo with three directories: 
- `/backend` (Python, FastAPI, LangGraph, LangChain-OpenAI)
- `/frontend` (React, Vite, TypeScript, Tailwind CSS, Lucide icons)
- `/k8s` (Production-grade Kubernetes manifests)

---

## 1. Backend Architecture (Python, FastAPI, LangGraph)
Initialize a Python 3.11+ project using `poetry` or `pip` with `fastapi`, `uvicorn`, `langgraph`, `langchain-openai`, `pydantic`, `aiofiles`, and `kubernetes`.

### Core Mechanics & OpenAI Integration:
- **LLM Configuration:** Initialize `ChatOpenAI(model="gpt-4o", temperature=0.1)` reading `OPENAI_API_KEY` from `.env`.
- **Structured Outputs:** Use Pydantic models with `.with_structured_output()` for the analysis node to enforce deterministic schema for Root Cause Analysis (RCA) and proposed actions.
- **Event-Driven Ingestion:** Create `POST /api/v1/webhook/event` to receive K8s alert payloads (from Alertmanager, Falco, or K8s Watchers). Each incoming event generates a unique `thread_id` and triggers a graph execution.
- **State Persistence:** Use LangGraph's `SqliteSaver` (or `AsyncSqliteSaver`) checkpointer storing into `/data/watchdog_state.db`. Paused states waiting for human approval must survive container restarts.

### Tooling & Security (`backend/tools.py`):
1. `Data_Sanitizer`: Middleware function that scrubs PII, API tokens, base64 strings, and internal IP addresses from Pod logs and Kubernetes descriptions using regex before passing payloads to OpenAI.
2. `Investigate_Cluster`: Reads specific Pod logs, describe events, deployment manifests, or node statuses filtered by the event payload.
3. `Execute_Imperative_Action`: Performs safe, ephemeral runtime actions (e.g., deleting a crashed pod, cordoning a node, or restarting a rollout).
4. `Execute_GitOps_PR`: For persistent configuration fixes (e.g., updating CPU/memory limits, fixing bad image tags, or correcting configmap keys). Simulates creating a Git branch and opening a PR.

### LangGraph Workflow (`backend/agent.py`):
- **State Definition (`AgentState`):** 
  - `event_data: dict`
  - `investigation_data: dict`
  - `analysis: dict` (Root cause explanation, severity, recommended strategy)
  - `proposed_action: dict` (type: `"imperative" | "gitops"`, payload/command, diff/yaml)
  - `human_approved: Optional[bool]`
  - `execution_result: Optional[dict]`
- **Workflow Nodes:**
  1. `investigate_node`: Gathers targeted diagnostic context via `Investigate_Cluster`.
  2. `analyze_node`: Uses `ChatOpenAI` to generate the RCA and structured fix proposal.
  3. `approval_node`: Uses LangGraph's `interrupt()` to halt execution if a fix is proposed.
  4. `execute_node`: Routes to `Execute_Imperative_Action` or `Execute_GitOps_PR` based on `proposed_action.type` if `human_approved == True`.
  5. `audit_node`: Records the action, approval status, and output into an audit log.

### API Endpoints (`backend/main.py`):
- `POST /api/v1/webhook/event`: Accepts alerts and starts graph execution.
- `GET /api/v1/stream/{thread_id}`: Server-Sent Events (SSE) streaming real-time agent reasoning steps, tool calls, and state transitions.
- `GET /api/v1/pending-approvals`: Lists all threads currently paused at the `interrupt()` step.
- `POST /api/v1/approve/{thread_id}`: Resumes a paused LangGraph thread with `{ "approved": true/false, "comment": "optional feedback" }`.

---

## 2. Frontend Architecture (React, TypeScript, Tailwind)
Build a responsive, dark-mode operations dashboard (Datadog/Grafana style).
- **Live Stream Terminal:** Real-time log/trace feed consuming the SSE endpoint. Visually separates:
  - Agent Thought / Reasoning (Muted gray)
  - Tool Invocation / K8s Queries (Blue badges)
  - Findings & Sanitized Logs (Amber/Green code blocks)
- **Action Approval Center:** Renders active cards for pending approvals from `/api/v1/pending-approvals`:
  - Severity badge (Critical / Warning / Info).
  - AI Root Cause Analysis summary.
  - Action Mode badge: `[IMPERATIVE - Runtime Action]` or `[GITOPS - Config PR]`.
  - Side-by-side YAML Diff or Command preview.
  - Action buttons: **Approve & Execute** (Green) and **Reject & Dismiss** (Red).
- **Cluster Event Feed:** Sidebar showing incoming webhook alerts with status indicators (Analyzing, Awaiting Approval, Remediated, Rejected).

---

## 3. Kubernetes Deployment & RBAC (`/k8s`)
- **Least-Privilege RBAC:** Generate `ServiceAccount`, `ClusterRole`, and `ClusterRoleBinding` granting read-only access (`get`, `list`, `watch`) across standard resources, and scoped write access (`delete` on pods for imperative restarts).
- **Backend StatefulSet:** Deploy the FastAPI backend as a `StatefulSet` with a `PersistentVolumeClaim` (PVC mounted at `/data`) so the SQLite checkpointer database is persistent.
- **Frontend Deployment:** Deploy the React app via Nginx with reverse-proxy configurations for `/api/v1` and SSE streaming endpoints.
- **Secrets Management:** Include a template `Secret` manifest for `OPENAI_API_KEY`.

---

## Execution Instructions for the AI IDE
Generate clean, production-ready code with complete implementations:
1. `backend/requirements.txt` and `.env.example`
2. `backend/tools.py` (Data sanitizer, K8s diagnostics, imperative & gitops execution handlers)
3. `backend/agent.py` (LangGraph state machine with OpenAI structured outputs and `interrupt()` breakpoint)
4. `backend/main.py` (FastAPI routes, SSE generator, checkpointer management)
5. `frontend/` (Vite + React + Tailwind setup, SSE hooks, Dashboard UI, Approval cards)
6. `k8s/` manifests (`rbac.yaml`, `backend-statefulset.yaml`, `frontend-deployment.yaml`, `secret-template.yaml`)
7. `README.md` with step-by-step local testing instructions (using `kubectl proxy` or local `~/.kube/config`).