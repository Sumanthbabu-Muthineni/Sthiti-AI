# 💥 Kubernetes Chaos Engineering & Testing Playbook

This playbook contains ready-to-use `kubectl` commands to inject real chaos scenarios into your Minikube / Kubernetes cluster (`watchdog-demo` namespace) to test the **Autonomous K8s Agentic Watchdog** pipeline.

---

## 🛠️ Cluster Lifecycle Management (`./dev.sh`)

Before starting your chaos tests, make sure your cluster is running. When finished, stop it to save battery and compute:

```bash
# Start Minikube & deploy clean demo workloads
./dev.sh start

# Check pod & cluster status
./dev.sh status

# Stop Minikube completely when done testing (saves 100% CPU/RAM)
./dev.sh stop
```

---

## 📋 Table of Contents
1. [Scenario 1: Image Pull Failure (ErrImagePull / ImagePullBackOff)](#-scenario-1-image-pull-failure-errimagepull--imagepullbackoff)
2. [Scenario 2: Out-Of-Memory Crash (OOMKilled - Exit Code 137)](#-scenario-2-out-of-memory-crash-oomkilled)
3. [Scenario 3: Application Crash & Probe Failure (CrashLoopBackOff)](#-scenario-3-application-crash--probe-failure-crashloopbackoff)
4. [Scenario 4: Missing Secret / Config (CreateContainerConfigError)](#-scenario-4-missing-secret--configmap-createcontainerconfigerror)
5. [Scenario 5: CPU Starvation & Throttling](#-scenario-5-cpu-starvation--throttling)
6. [🌿 Reset Cluster to 100% Healthy State](#-reset-cluster-to-100-healthy-state)

---

## 🔴 Scenario 1: Image Pull Failure (`ErrImagePull` / `ImagePullBackOff`)

Simulates a bad CI/CD deployment where a non-existent container tag is pushed.

### ⚡ Inject Chaos
```bash
kubectl patch deployment storefront-web -n watchdog-demo -p '{
  "spec": {
    "template": {
      "spec": {
        "containers": [{
          "name": "storefront-web",
          "image": "nginx:v999.0.0-nonexistent-tag"
        }]
      }
    }
  }
}'
```

### 🔍 Observe in Terminal
```bash
kubectl get pods -n watchdog-demo -l app=storefront-web -w
```
*(Watchdog will consolidate alerts into a single incident and propose a GitOps PR rollback to `nginx:alpine`)*

### 🟢 Heal / Restore
```bash
kubectl patch deployment storefront-web -n watchdog-demo -p '{
  "spec": {
    "template": {
      "spec": {
        "containers": [{
          "name": "storefront-web",
          "image": "nginx:alpine"
        }]
      }
    }
  }
}'
```

---

## 🔴 Scenario 2: Out-Of-Memory Crash (`OOMKilled`)

Simulates memory starvation by choking container memory limits to 16Mi so the process immediately dies with exit code `137`.

### ⚡ Inject Chaos
```bash
kubectl patch deployment payment-processor -n watchdog-demo -p '{
  "spec": {
    "template": {
      "spec": {
        "containers": [{
          "name": "payment-processor",
          "resources": {
            "limits": {
              "memory": "16Mi"
            },
            "requests": {
              "memory": "8Mi"
            }
          }
        }]
      }
    }
  }
}'
```

### 🔍 Observe in Terminal
```bash
kubectl get pods -n watchdog-demo -l app=payment-processor -w
```
*(Watchdog will investigate exit code 137, analyze memory limits, and propose increasing limits to `512Mi` / `1Gi`)*

### 🟢 Heal / Restore
```bash
kubectl patch deployment payment-processor -n watchdog-demo -p '{
  "spec": {
    "template": {
      "spec": {
        "containers": [{
          "name": "payment-processor",
          "resources": {
            "limits": {
              "memory": "512Mi",
              "cpu": "500m"
            },
            "requests": {
              "memory": "256Mi",
              "cpu": "100m"
            }
          }
        }]
      }
    }
  }
}'
```

---

## 🔴 Scenario 3: Application Crash & Probe Failure (`CrashLoopBackOff`)

Simulates a faulty startup script or misconfigured health probe.

### ⚡ Inject Chaos
```bash
kubectl patch deployment auth-gateway -n watchdog-demo -p '{
  "spec": {
    "template": {
      "spec": {
        "containers": [{
          "name": "auth-gateway",
          "command": ["sh", "-c", "echo 'Fatal authentication startup error' && exit 1"]
        }]
      }
    }
  }
}'
```

### 🔍 Observe in Terminal
```bash
kubectl get pods -n watchdog-demo -l app=auth-gateway -w
```
*(Watchdog will scrub error logs, pinpoint the fatal exit, and propose an imperative restart or rollout undo)*

### 🟢 Heal / Restore
```bash
kubectl patch deployment auth-gateway -n watchdog-demo --type='json' -p='[
  {"op": "remove", "path": "/spec/template/spec/containers/0/command"}
]'
```

---

## 🔴 Scenario 4: Missing Secret / ConfigMap (`CreateContainerConfigError`)

Simulates a broken deployment that references a non-existent secret key.

### ⚡ Inject Chaos
```bash
kubectl patch deployment storefront-web -n watchdog-demo -p '{
  "spec": {
    "template": {
      "spec": {
        "containers": [{
          "name": "storefront-web",
          "env": [{
            "name": "DB_PASSWORD",
            "valueFrom": {
              "secretKeyRef": {
                "name": "non-existent-secret",
                "key": "password"
              }
            }
          }]
        }]
      }
    }
  }
}'
```

### 🔍 Observe in Terminal
```bash
kubectl get pods -n watchdog-demo -l app=storefront-web
```

### 🟢 Heal / Restore
```bash
kubectl patch deployment storefront-web -n watchdog-demo --type='json' -p='[
  {"op": "remove", "path": "/spec/template/spec/containers/0/env"}
]'
```

---

## 🔴 Scenario 5: CPU Starvation & Throttling

Simulates extreme CPU throttling (10 millicores) causing health check timeouts.

### ⚡ Inject Chaos
```bash
kubectl patch deployment payment-processor -n watchdog-demo -p '{
  "spec": {
    "template": {
      "spec": {
        "containers": [{
          "name": "payment-processor",
          "resources": {
            "limits": {
              "cpu": "10m"
            }
          }
        }]
      }
    }
  }
}'
```

### 🟢 Heal / Restore
```bash
kubectl patch deployment payment-processor -n watchdog-demo -p '{
  "spec": {
    "template": {
      "spec": {
        "containers": [{
          "name": "payment-processor",
          "resources": {
            "limits": {
              "cpu": "500m",
              "memory": "512Mi"
            }
          }
        }]
      }
    }
  }
}'
```

---

## 🌿 Reset Cluster to 100% Healthy State

Run this all-in-one command to restore all workloads in `watchdog-demo` to pristine health:

```bash
# 1. Reset storefront-web
kubectl patch deployment storefront-web -n watchdog-demo -p '{
  "spec": {
    "replicas": 2,
    "template": {
      "spec": {
        "containers": [{
          "name": "storefront-web",
          "image": "nginx:alpine",
          "ports": [{"containerPort": 80}],
          "resources": {"limits": {"memory": "256Mi", "cpu": "100m"}}
        }]
      }
    }
  }
}'

# 2. Reset payment-processor
kubectl patch deployment payment-processor -n watchdog-demo -p '{
  "spec": {
    "replicas": 2,
    "template": {
      "spec": {
        "containers": [{
          "name": "payment-processor",
          "image": "nginx:alpine",
          "resources": {"limits": {"memory": "512Mi", "cpu": "500m"}}
        }]
      }
    }
  }
}'

# 3. Reset auth-gateway
kubectl patch deployment auth-gateway -n watchdog-demo -p '{
  "spec": {
    "replicas": 1,
    "template": {
      "spec": {
        "containers": [{
          "name": "auth-gateway",
          "image": "nginx:alpine"
        }]
      }
    }
  }
}'

# 4. Remove any residual commands/env
kubectl patch deployment storefront-web -n watchdog-demo --type='json' -p='[{"op": "remove", "path": "/spec/template/spec/containers/0/env"}]' 2>/dev/null || true
kubectl patch deployment auth-gateway -n watchdog-demo --type='json' -p='[{"op": "remove", "path": "/spec/template/spec/containers/0/command"}]' 2>/dev/null || true

# 5. Verify all pods are 1/1 Running
kubectl get pods -n watchdog-demo
```
