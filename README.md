# K8s Agentic Watchdog

**Autonomous AI Site Reliability Engineer (SRE) for Kubernetes Clusters**

The **K8s Agentic Watchdog** is a production-grade, full-stack autonomous AI operations agent. It ingests Kubernetes cluster alerts, investigates root causes using OpenAI (`gpt-4o`) and live cluster telemetry, scrubs sensitive cluster logs (PII, tokens, internal IPs), proposes structured remediations with unified diffs or kubectl commands, pauses for human approval via an interactive operations dashboard using LangGraph `interrupt()`, and executes the verified fix upon approval with persistent SQLite checkpointing and immutable audit trails.

---

## 🏛️ System Architecture

```mermaid
flowchart TD
    subgraph K8s_Cluster["☸️ Kubernetes Cluster"]
        Alert["🚨 Alert / Webhook\n(Alertmanager / Falco / Watcher)"]
        K8sAPI["☸️ Kubernetes API\n(Pods, Logs, Events, Manifests)"]
        Resources["📦 Pods / Deployments / Nodes"]
    end

    subgraph Backend["⚙️ Backend (FastAPI + LangGraph)"]
        Ingest["POST /api/v1/webhook/event\n(Thread Generation)"]
        Sanitizer["🛡️ Data Sanitizer Middleware\n(Scrub Tokens, Keys, IPs, Base64)"]
        Investigate["🔍 Investigate Node\n(Gather Logs & Events)"]
        Analyze["🧠 Analyze Node\n(OpenAI gpt-4o Structured Output)"]
        Interrupt["⏸️ Approval Node\n(LangGraph interrupt() Breakpoint)"]
        Execute["⚡ Execute Node\n(Imperative / GitOps PR)"]
        Audit["📜 Audit Node\n(Immutable Event Log)"]
        SqliteDB[("💾 SQLite Checkpointer\n/data/watchdog_state.db")]
        SSE["📡 SSE Broadcaster\n(/api/v1/stream)"]
    end

    subgraph Frontend["🖥️ Operations Dashboard (React + TypeScript + Tailwind)"]
        EventSidebar["📋 Cluster Event Feed"]
        ApprovalCard["⚡ Action Approval Center\n(AI RCA + YAML Diff Preview)"]
        Terminal["📟 Live Trace Terminal\n(SSE Reasoning & Sanitized Logs)"]
        HumanOperator(["👤 SRE Operator\n(Approve / Reject)"])
    end

    Alert -->|Payload| Ingest
    Ingest --> Investigate
    Investigate <-->|Query Pods & Events| K8sAPI
    Investigate -->|Raw Telemetry| Sanitizer
    Sanitizer -->|Scrubbed Logs| Analyze
    Analyze -->|RCA & Proposal| Interrupt
    Interrupt <-->|Persist State| SqliteDB
    Interrupt -->|Stream State & Pause| SSE
    SSE -->|Real-time Feed| Terminal
    SSE -->|Pending RCA Card| ApprovalCard
    HumanOperator -->|1-Click Review| ApprovalCard
    ApprovalCard -->|POST /api/v1/approve/{thread_id}| Interrupt
    Interrupt --> Execute
    Execute -->|Runtime Fix| Resources
    Execute -->|GitOps PR| GitRepo[("🐙 Git Repository\nPull Request")]
    Execute --> Audit
    Audit --> SSE
```

---

## 📁 Repository Structure

```
agenticai/
├── backend/                     # Python 3.12+ FastAPI & LangGraph Backend
│   ├── .env.example             # Configuration template
│   ├── requirements.txt         # Production dependencies
│   ├── Dockerfile               # Production container image
│   ├── main.py                  # FastAPI server, REST routes & SSE streams
│   ├── agent.py                 # LangGraph StateGraph with interrupt()
│   ├── tools.py                 # Data Sanitizer, K8s investigator, Imperative & GitOps executors
│   ├── models.py                # Pydantic schemas (Alerts, RCA, Proposals, Audits)
│   └── test_watchdog.py         # Pytest unit & integration test suite
│
├── frontend/                    # React 19 + TypeScript + Vite Dashboard
│   ├── package.json
│   ├── tailwind.config.js       # SRE Dark Mode Palette
│   ├── src/
│   │   ├── App.tsx              # Main Dashboard layout & state
│   │   ├── types/               # TypeScript interfaces
│   │   ├── hooks/useSSE.ts      # Real-time SSE streaming hook
│   │   ├── services/api.ts      # REST API client
│   │   └── components/
│   │       ├── Header.tsx       # Cluster status & live telemetry metrics
│   │       ├── EventFeed.tsx    # Left sidebar with alert filters
│   │       ├── ApprovalCenter.tsx# Main RCA & Action Approval Panel
│   │       ├── DiffViewer.tsx   # Side-by-side YAML diff & command viewer
│   │       ├── LiveTerminal.tsx # Real-time AI reasoning trace feed
│   │       ├── AuditHistory.tsx # Immutable historical audit trail
│   │       └── SimulateModal.tsx# 1-Click alert scenario triggers
│
├── k8s/                         # Kubernetes Deployment Manifests
│   ├── rbac.yaml                # Least-privilege ServiceAccount & ClusterRole
│   ├── backend-statefulset.yaml # Backend StatefulSet with 5Gi persistent PVC
│   ├── frontend-deployment.yaml # Nginx SPA deployment with SSE reverse proxy
│   ├── secret-template.yaml     # Secrets template for OpenAI & Git tokens
│   └── service.yaml             # ClusterIP service definitions
│
└── README.md                    # Comprehensive documentation
```

---

## 🛠️ Environment & Cluster Lifecycle Management (`./dev.sh`)

Use the included `./dev.sh` script to manage starting, stopping, pausing, and inspecting your local Minikube cluster and demo workloads with zero compute waste:

```bash
# Start Minikube & spin up all demo workloads
./dev.sh start

# Stop Minikube completely when done developing (saves 100% CPU/RAM/battery)
./dev.sh stop

# Pause demo workloads (scale to 0 replicas) without stopping Minikube
./dev.sh pause

# Resume demo workloads back to normal active replicas
./dev.sh resume

# Check live cluster & pod health in watchdog-demo namespace
./dev.sh status
```

---

## 🚀 Quickstart: Local Development

### Prerequisites
- **Python 3.11+**
- **Node.js 18+ & npm**
- *(Optional)* Kubernetes CLI (`kubectl`) with active cluster context or `~/.kube/config`
- *(Optional)* OpenAI API Key (System includes deterministic fallback for offline/demo testing)

---

### Step 1: Backend Setup

```bash
cd backend

# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env and insert your OPENAI_API_KEY if available

# Run unit & integration tests
PYTHONPATH=. pytest test_watchdog.py -v

# Start FastAPI server with live reload
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The backend starts at `http://localhost:8000`. You can test health at `http://localhost:8000/healthz` and view Swagger UI at `http://localhost:8000/docs`.

---

### Step 2: Frontend Setup

Open a new terminal window:

```bash
cd frontend

# Install packages
npm install

# Start Vite development server
npm run dev
```

Open your browser at **`http://localhost:5173`**.

---

## 🧪 Interactive Testing & Simulated Incidents

You can simulate realistic Kubernetes failure scenarios directly from the UI or via `curl`:

### Available Simulation Presets

| Preset | Failure Mode | Root Cause | Proposed Remediation |
| :--- | :--- | :--- | :--- |
| **`oom`** | `OOMKilled` | Java/Node buffer pool allocation spiked beyond 256Mi cgroup limit | **`[GITOPS]`** Creates PR patching deployment memory limit from 256Mi to 1Gi |
| **`crashloop`** | `CrashLoopBackOff` | Transient database connection timeout during container initialization | **`[IMPERATIVE]`** Runs `kubectl rollout restart deployment/...` |
| **`imagepull`** | `ImagePullBackOff` | Deployment updated to non-existent tag `v3.0.0-rc2` | **`[GITOPS]`** Creates PR rolling back image to stable `v2.9.4` |
| **`diskpressure`** | `NodeDiskPressure` | Worker node storage capacity dropped below 10% | **`[IMPERATIVE]`** Cordons node and evicts non-critical pods |

### Trigger via UI:
1. Click the **"Simulate Alert"** button in the dashboard header.
2. Select any incident preset (e.g. `OOMKilled`).
3. Observe:
   - Live SSE trace streams agent thoughts, tool invocations, and sanitized log output.
   - Approval card appears in the **Action Approval Center**.
   - Review the AI Root Cause explanation and the unified YAML diff / command.
   - Click **"Approve & Execute Fix"** to resume the LangGraph thread and apply the fix.

### Trigger via CLI:
```bash
# Trigger simulated OOM alert
curl -X POST "http://localhost:8000/api/v1/simulate/alert?preset=oom"

# Ingest custom alert payload
curl -X POST "http://localhost:8000/api/v1/webhook/event" \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "alert-custom-001",
    "cluster": "production-us-east-1",
    "namespace": "billing",
    "resource_kind": "Pod",
    "resource_name": "billing-worker-99ab",
    "severity": "Critical",
    "reason": "OOMKilled",
    "message": "Memory cgroup limit exceeded"
  }'
```

---

## 🔒 Security & Data Sanitization

Before cluster logs or resource descriptions leave the cluster or are processed by OpenAI, the `DataSanitizer` middleware scrubs:
- **Private Keys** (`-----BEGIN PRIVATE KEY-----`)
- **Bearer & Authorization Tokens** (`Bearer eyJ...`, `token=...`)
- **JWTs** (`eyJhbGci...`)
- **Cloud & LLM API Keys** (`sk-...`, `AKIA...`)
- **Credentials & Passwords** (`password=...`, `db_password=...`)
- **Base64 Payloads** (long base64 strings)
- **Internal RFC 1918 IP Addresses** (`10.x.x.x`, `172.16-31.x.x`, `192.168.x.x`)
- **Email Addresses**

Redactions are replaced with structured security placeholders (e.g. `[REDACTED_INTERNAL_IP]`, `[REDACTED_JWT]`) and the total scrub count is tracked in cluster metrics.

---

## ☸️ Production Kubernetes Deployment (`/k8s`)

Deploy the Watchdog to your Kubernetes cluster (EKS, GKE, AKS, or local Kind/Minikube):

```bash
# 1. Create secret with OpenAI API Key
kubectl apply -f k8s/secret-template.yaml

# 2. Apply Least-Privilege RBAC
kubectl apply -f k8s/rbac.yaml

# 3. Deploy Persistent Backend StatefulSet
kubectl apply -f k8s/backend-statefulset.yaml

# 4. Deploy Frontend Nginx & Service
kubectl apply -f k8s/frontend-deployment.yaml
kubectl apply -f k8s/service.yaml

# 5. Access the Dashboard
kubectl port-forward svc/watchdog-frontend -n watchdog-system 8080:80
```

Open `http://localhost:8080` in your browser.

---

## 📊 REST & SSE API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/healthz` | Kubernetes liveness and readiness probe |
| `POST` | `/api/v1/webhook/event` | Ingests K8s alert payloads & spawns LangGraph thread |
| `GET` | `/api/v1/pending-approvals` | Lists all threads paused at `interrupt()` |
| `POST` | `/api/v1/approve/{thread_id}` | Resumes paused thread with `{ approved: bool, comment: str }` |
| `GET` | `/api/v1/events` | Lists all tracked alerts and their statuses |
| `GET` | `/api/v1/audit-logs` | Retrieves full historical audit trails |
| `GET` | `/api/v1/stream` | Global Server-Sent Events (SSE) real-time feed |
| `GET` | `/api/v1/stream/{thread_id}` | Thread-specific SSE stream |
| `POST` | `/api/v1/simulate/alert` | Triggers high-fidelity alert simulations (`oom`, `crashloop`, `imagepull`, `diskpressure`) |

---

## 🛡️ License
Apache 2.0. Built for production Kubernetes reliability engineering.
