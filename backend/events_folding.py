"""
Event Delta Folding & Categorization Engine
Implements the OpenTelemetry k8s_events pattern:
- Categorizes Kubernetes events into 4 debugging buckets:
  1. Deploy/Scale
  2. Image
  3. Crash/Error
  4. Health
- Tracks native event.metadata.uid and computes true occurrence deltas (current_count - last_seen_count)
- Handles counter resets (Kubelet restarts) and event TTL renewals via composite logical keys
- Extracts container name from field_path (e.g. spec.containers{sidecar})
"""

import re
import hashlib
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime, timezone

# The 4 primary debugging categories from the OpenTelemetry Kubernetes architecture
CATEGORY_DEPLOY_SCALE = "Deploy/Scale"
CATEGORY_IMAGE = "Image"
CATEGORY_CRASH_ERROR = "Crash/Error"
CATEGORY_HEALTH = "Health"

# Event reason classification mappings
EVENT_CLASSIFICATIONS: Dict[str, Tuple[str, str]] = {
    # Deploy / Scale (Normal lifecycle & scaling operations)
    "ScalingReplicaSet": (CATEGORY_DEPLOY_SCALE, "Info"),
    "SuccessfulCreate": (CATEGORY_DEPLOY_SCALE, "Info"),
    "SuccessfulDelete": (CATEGORY_DEPLOY_SCALE, "Info"),
    "Started": (CATEGORY_DEPLOY_SCALE, "Info"),
    "Created": (CATEGORY_DEPLOY_SCALE, "Info"),
    "Killing": (CATEGORY_DEPLOY_SCALE, "Info"),
    "PodDeleted": (CATEGORY_DEPLOY_SCALE, "Info"),
    "Preempting": (CATEGORY_DEPLOY_SCALE, "Info"),

    # Image (Pulling and Registry failure states)
    "Pulling": (CATEGORY_IMAGE, "Info"),
    "Pulled": (CATEGORY_IMAGE, "Info"),
    "ErrImagePull": (CATEGORY_IMAGE, "Critical"),
    "ImagePullBackOff": (CATEGORY_IMAGE, "Critical"),
    "InvalidImageName": (CATEGORY_IMAGE, "Critical"),
    "RegistryUnavailable": (CATEGORY_IMAGE, "Warning"),

    # Crash / Error (Runtime execution and memory faults)
    "OOMKilled": (CATEGORY_CRASH_ERROR, "Critical"),
    "BackOff": (CATEGORY_CRASH_ERROR, "Critical"),
    "CrashLoopBackOff": (CATEGORY_CRASH_ERROR, "Critical"),
    "Failed": (CATEGORY_CRASH_ERROR, "Critical"),
    "ContainerCannotRun": (CATEGORY_CRASH_ERROR, "Critical"),
    "Error": (CATEGORY_CRASH_ERROR, "Critical"),
    "Evicted": (CATEGORY_CRASH_ERROR, "Critical"),
    "ExceededGracePeriod": (CATEGORY_CRASH_ERROR, "Warning"),

    # Health (Probes, Node pressure, and Scheduling constraints)
    "Unhealthy": (CATEGORY_HEALTH, "Warning"),
    "ProbeWarning": (CATEGORY_HEALTH, "Warning"),
    "NodeDiskPressure": (CATEGORY_HEALTH, "Critical"),
    "NodeMemoryPressure": (CATEGORY_HEALTH, "Critical"),
    "NodeNotReady": (CATEGORY_HEALTH, "Critical"),
    "FailedScheduling": (CATEGORY_HEALTH, "Warning"),
    "NetworkNotReady": (CATEGORY_HEALTH, "Critical"),
    "FailedMount": (CATEGORY_HEALTH, "Warning"),
    "FailedAttachVolume": (CATEGORY_HEALTH, "Warning"),
}


def categorize_event(reason: str, message: str, event_type: str = "Normal") -> Tuple[str, str]:
    """
    Categorizes a Kubernetes event into one of the 4 debugging categories and determines severity.
    Returns: (category, severity)
    """
    if reason in EVENT_CLASSIFICATIONS:
        return EVENT_CLASSIFICATIONS[reason]

    reason_lower = (reason or "").lower()
    msg_lower = (message or "").lower()

    # Deploy/Scale checks
    if any(k in reason_lower or k in msg_lower for k in ["scale", "replica", "rollout", "killing", "delete"]):
        return (CATEGORY_DEPLOY_SCALE, "Info" if event_type == "Normal" else "Warning")

    # Image checks
    if any(k in reason_lower or k in msg_lower for k in ["image", "pull", "registry"]):
        return (CATEGORY_IMAGE, "Critical" if "backoff" in msg_lower or "err" in msg_lower else "Info")

    # Crash/Error checks
    if any(k in reason_lower or k in msg_lower for k in ["oom", "crash", "exit code", "backoff", "evict", "kill"]):
        return (CATEGORY_CRASH_ERROR, "Critical")

    # Health checks
    if any(k in reason_lower or k in msg_lower for k in ["unhealthy", "probe", "pressure", "schedule", "mount", "node"]):
        return (CATEGORY_HEALTH, "Critical" if "pressure" in msg_lower or "notready" in msg_lower else "Warning")

    # Fallback based on event_type
    if event_type == "Warning":
        return (CATEGORY_HEALTH, "Warning")
    return (CATEGORY_DEPLOY_SCALE, "Info")


def extract_container_name(field_path: str) -> Optional[str]:
    """
    Extracts the container name from event.involvedObject.fieldPath
    e.g. 'spec.containers{sidecar-proxy}' -> 'sidecar-proxy'
         'spec.initContainers{vault-init}' -> 'vault-init'
    """
    if not field_path:
        return None
    match = re.search(r'(?:containers|initContainers)\{([A-Za-z0-9._-]+)\}', field_path)
    if match:
        return match.group(1)
    return None


class EventDeltaFolder:
    """
    Tracks native event.metadata.uid and computes true counter deltas (current_count - last_seen_count).
    Folds repeated occurrences into a multiplier string (e.g. ×14 or ×312).
    Safeguards against counter resets (Kubelet restarts) and 1-hour TTL renewals.
    """

    def __init__(self):
        # event_uid -> last_count observed
        self._seen_event_uids: Dict[str, int] = {}
        # logical_key -> accumulated total occurrences
        self._logical_accumulators: Dict[str, int] = {}

    def process_event(self, event_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Processes a raw or parsed Kubernetes Event object, folds counter deltas,
        and returns a normalized FoldedEvent payload.
        """
        metadata = event_data.get("metadata", {})
        event_uid = metadata.get("uid") or event_data.get("event_uid") or f"evt-{hashlib.sha256(str(event_data).encode()).hexdigest()[:12]}"
        
        raw_count = int(event_data.get("count") or 1)
        reason = event_data.get("reason", "Unknown")
        message = event_data.get("message", "")
        event_type = event_data.get("type", "Normal")
        
        involved_obj = event_data.get("involved_object", {}) or event_data.get("involvedObject", {})
        involved_kind = involved_obj.get("kind", "Pod")
        involved_name = involved_obj.get("name", "unknown")
        involved_uid = involved_obj.get("uid", "")
        field_path = involved_obj.get("field_path") or involved_obj.get("fieldPath") or ""
        container_name = extract_container_name(field_path)

        category, severity = categorize_event(reason, message, event_type)

        # Composite logical key to bridge across K8s 1-hour event TTL renewals
        msg_prefix = message[:32] if message else ""
        logical_key = f"{involved_uid or involved_name}:{reason}:{msg_prefix}"

        # Calculate Delta:
        last_count = self._seen_event_uids.get(event_uid)
        if last_count is None:
            # First time observing this specific Event UID
            delta = raw_count
        elif raw_count < last_count:
            # Kubelet restart / counter reset detected!
            delta = raw_count
        else:
            delta = raw_count - last_count

        self._seen_event_uids[event_uid] = raw_count

        # Update accumulated occurrences for this logical event chain
        accumulated = self._logical_accumulators.get(logical_key, 0) + max(0, delta)
        self._logical_accumulators[logical_key] = accumulated

        multiplier_str = f"×{accumulated}" if accumulated > 1 else ""

        first_ts = (
            event_data.get("first_timestamp") or 
            event_data.get("firstTimestamp") or 
            metadata.get("creation_timestamp") or 
            metadata.get("creationTimestamp") or 
            datetime.now(timezone.utc).isoformat()
        )
        last_ts = (
            event_data.get("last_timestamp") or 
            event_data.get("lastTimestamp") or 
            first_ts
        )

        return {
            "event_uid": event_uid,
            "logical_key": logical_key,
            "reason": reason,
            "category": category,
            "severity": severity,
            "message": message,
            "count": raw_count,
            "delta_count": max(1, delta),
            "accumulated_count": accumulated,
            "multiplier_str": multiplier_str,
            "container_name": container_name,
            "involved_kind": involved_kind,
            "involved_name": involved_name,
            "involved_uid": involved_uid,
            "namespace": metadata.get("namespace") or event_data.get("namespace", "default"),
            "first_timestamp": str(first_ts),
            "last_timestamp": str(last_ts)
        }

    def clear(self):
        """Clears memory caches."""
        self._seen_event_uids.clear()
        self._logical_accumulators.clear()


# Global Singleton Folder Instance
events_folder = EventDeltaFolder()
