#!/usr/bin/env bash

# ==============================================================================
# K8s Agentic Watchdog - Local Cluster & Dev Environment Manager
# ==============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

function print_header() {
    echo -e "${CYAN}${BOLD}"
    echo "=========================================================="
    echo "  🐾 K8s Agentic Watchdog Dev Manager"
    echo "=========================================================="
    echo -e "${NC}"
}

function start_cluster() {
    print_header
    echo -e "${BLUE}▶ Starting Minikube cluster...${NC}"
    minikube start --driver=docker || minikube start

    echo -e "${BLUE}▶ Ensuring namespace 'watchdog-demo' exists...${NC}"
    kubectl create namespace watchdog-demo --dry-run=client -o yaml | kubectl apply -f -

    echo -e "${BLUE}▶ Applying baseline demo manifests...${NC}"
    kubectl apply -f "$SCRIPT_DIR/gitops-manifests/auth-gateway.yaml"
    kubectl apply -f "$SCRIPT_DIR/gitops-manifests/payment-processor.yaml"
    kubectl apply -f "$SCRIPT_DIR/gitops-manifests/storefront-web.yaml"

    echo -e "${GREEN}${BOLD}✔ Cluster is up and running!${NC}"
    echo ""
    kubectl get pods -n watchdog-demo
    echo ""
    echo -e "${YELLOW}To start the backend and frontend:${NC}"
    echo -e "  Terminal 1: cd backend && source .venv/bin/activate && uvicorn main:app --reload --port 8000"
    echo -e "  Terminal 2: cd frontend && npm run dev"
}

function stop_cluster() {
    print_header
    echo -e "${YELLOW}▶ Stopping Minikube to save laptop CPU/RAM...${NC}"
    minikube stop
    echo -e "${GREEN}${BOLD}✔ Minikube stopped! 0 compute/RAM is being used now.${NC}"
}

function pause_workloads() {
    print_header
    echo -e "${YELLOW}▶ Scaling down demo workloads to 0 replicas (keeping Minikube alive)...${NC}"
    kubectl scale deployment auth-gateway -n watchdog-demo --replicas=0
    kubectl scale deployment payment-processor -n watchdog-demo --replicas=0
    kubectl scale deployment storefront-web -n watchdog-demo --replicas=0
    echo -e "${GREEN}${BOLD}✔ All demo pods scaled down to 0!${NC}"
}

function resume_workloads() {
    print_header
    echo -e "${BLUE}▶ Scaling demo workloads back up...${NC}"
    kubectl scale deployment auth-gateway -n watchdog-demo --replicas=1
    kubectl scale deployment payment-processor -n watchdog-demo --replicas=2
    kubectl scale deployment storefront-web -n watchdog-demo --replicas=2
    echo -e "${GREEN}${BOLD}✔ Demo pods restored!${NC}"
    kubectl get pods -n watchdog-demo
}

function status_check() {
    print_header
    echo -e "${BLUE}▶ Minikube Status:${NC}"
    minikube status || true
    echo ""
    echo -e "${BLUE}▶ Demo Pods in 'watchdog-demo':${NC}"
    kubectl get pods -n watchdog-demo 2>/dev/null || echo "Cluster not running."
}

case "$1" in
    start)
        start_cluster
        ;;
    stop)
        stop_cluster
        ;;
    pause)
        pause_workloads
        ;;
    resume)
        resume_workloads
        ;;
    status)
        status_check
        ;;
    *)
        print_header
        echo -e "${BOLD}Usage:${NC} ./dev.sh [start | stop | pause | resume | status]"
        echo ""
        echo -e "  ${GREEN}start${NC}   : Start Minikube & spin up all demo workloads"
        echo -e "  ${RED}stop${NC}    : Completely shut down Minikube (saves 100% CPU/RAM)"
        echo -e "  ${YELLOW}pause${NC}   : Scale demo pods to 0 replicas without stopping Minikube"
        echo -e "  ${CYAN}resume${NC}  : Restore demo pods back to active replicas"
        echo -e "  ${BLUE}status${NC}  : Check current cluster and pod statuses"
        echo ""
        exit 1
        ;;
esac
