import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/lib/auth";

export type CollaborationEditing = {
  entityId: number;
  recordId: number;
  fieldKey: string;
  source: "entity" | "page";
};

export type CollaborationFailure = "network" | "access_denied" | "session_expired";

export type CollaborationPresence = {
  clientId?: string;
  userId: number;
  name: string;
  color: string;
  editing: CollaborationEditing | null;
};

export type CollaborationMessage =
  | { type: "snapshot"; presence: CollaborationPresence[] }
  | { type: "presence"; presence: CollaborationPresence[] }
  | { type: "record_changed"; recordId: number; entityId?: number; changedFieldKeys?: string[]; version?: number }
  | { type: "page_changed"; pageId: number; recordId: number; changedFieldKeys?: string[]; version?: number }
  | { type: "delete"; recordId: number; entityId?: number; pageId?: number }
  | { type: "table_changed" };

function getClientId() {
  const existing = sessionStorage.getItem("erp_client_id");
  if (existing) return existing;
  const newId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  sessionStorage.setItem("erp_client_id", newId);
  return newId;
}

export function useCollaboration(pageId?: number | null, onPageConfigChange?: () => void) {
  const onPageConfigChangeRef = useRef(onPageConfigChange);
  onPageConfigChangeRef.current = onPageConfigChange;
  const { user, isGuest } = useAuth();
  const userId = user?.id;
  const [users, setUsers] = useState<CollaborationPresence[]>([]);
  const [connected, setConnected] = useState(false);
  const [connectedPageId, setConnectedPageId] = useState<number | null>(null);
  const [subscriptionGeneration, setSubscriptionGeneration] = useState(0);
  const [accessRetry, setAccessRetry] = useState(0);
  const [failure, setFailure] = useState<{ pageId: number; userId: number; reason: CollaborationFailure } | null>(null);
  const [connectionAttempt, setConnectionAttempt] = useState<{
    pageId: number | null;
    state: "connecting" | "connected" | "unavailable";
  }>({ pageId: null, state: "unavailable" });
  const clientId = useRef(getClientId());
  const [lastMessage, setLastMessage] = useState<CollaborationMessage | null>(null);
  const currentEditing = useRef<CollaborationEditing | null>(null);
  const deniedScope = useRef<{ pageId: number; userId: number } | null>(null);
  const activeScope = useRef<{
    pageId: number; userId: number; denied: boolean; deny: (retryAccess?: boolean) => void;
  } | null>(null);

  const publishPresence = useCallback((editing: CollaborationEditing | null) => {
    if (!pageId || userId == null || isGuest) return;
    const scope = activeScope.current;
    if (!scope || scope.pageId !== pageId || scope.userId !== userId || scope.denied) return;
    if (deniedScope.current?.pageId === pageId && deniedScope.current?.userId === userId) return;
    currentEditing.current = editing;
    const token = localStorage.getItem("erp_token");
    if (!token) return;
    fetch(`/api/collaboration/pages/${pageId}/presence`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ clientId: clientId.current, editing }),
    }).then((response) => {
      if (activeScope.current !== scope) return;
      if (response.status === 401 || response.status === 403) {
        scope.deny(response.status === 403);
        return;
      }
      if (!response.ok && !isGuest) {
        console.warn(`Collaboration presence failed: ${response.status}`);
      }
    }).catch((error) => {
      if (!isGuest) console.warn("Collaboration presence failed", error);
    });
  }, [isGuest, pageId, userId]);

  useEffect(() => {
    if (!pageId || userId == null || isGuest) {
      setUsers([]);
      setConnected(false);
      setConnectedPageId(null);
      setConnectionAttempt({ pageId: null, state: "unavailable" });
      setLastMessage(null);
      currentEditing.current = null;
      return;
    }

    const controller = new AbortController();
    const id = clientId.current;
    let stopped = false;
    let reconnectTimer: number | undefined;
    let connectionFallbackTimer: number | undefined;
    let heartbeatTimer: number | undefined;
    let accessRetryTimer: number | undefined;
    let retry = 0;
    const scope = {
      pageId, userId, denied: false,
      deny: (retryAccess = true) => {
        if (stopped || activeScope.current !== scope) return;
        scope.denied = true;
        deniedScope.current = { pageId, userId };
        stopped = true;
        controller.abort();
        if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
        if (connectionFallbackTimer !== undefined) window.clearTimeout(connectionFallbackTimer);
        if (heartbeatTimer !== undefined) window.clearInterval(heartbeatTimer);
        currentEditing.current = null;
        setConnected(false);
        setConnectedPageId(null);
        setUsers([]);
        setLastMessage(null);
        setConnectionAttempt({ pageId, state: "unavailable" });
        setFailure({ pageId, userId, reason: retryAccess ? "access_denied" : "session_expired" });
        // Denial ends this transport and all presence writes. A separate,
        // bounded-rate authorization attempt can discover restored access.
        // Invalid credentials (401) require login, not automatic polling.
        if (retryAccess) accessRetryTimer = window.setTimeout(() => {
          if (activeScope.current === scope) setAccessRetry(value => value + 1);
        }, 30_000);
      },
    };
    activeScope.current = scope;
    setUsers([]);
    setLastMessage(null);
    currentEditing.current = null;
    setConnectionAttempt({ pageId, state: "connecting" });
    connectionFallbackTimer = window.setTimeout(() => {
      setConnectionAttempt((current) =>
        current.pageId === pageId && current.state === "connecting"
          ? { pageId, state: "unavailable" }
          : current,
      );
    }, 1_500);

    const handleEvent = (eventName: string, rawData: string) => {
      if (stopped || !rawData) return;
      try {
        retry = 0;
        const data = JSON.parse(rawData) as Record<string, unknown>;
        if (eventName === "access_denied") {
          scope.deny();
          return;
        }
        const type = (eventName || data.type) as CollaborationMessage["type"];
        // Refresh metadata on reconnect too: notifications missed while offline
        // are not replayed. Call directly so a following table event cannot
        // overwrite this invalidation in React's batched lastMessage state.
        if (eventName === "page_config_changed" || type === "snapshot") {
          onPageConfigChangeRef.current?.();
        }
        const message = { ...data, type } as CollaborationMessage;
        if (type === "snapshot" || type === "presence") {
          const presence = data.presence;
          setUsers(Array.isArray(presence) ? presence as CollaborationPresence[] : []);
        } else if (
          type === "record_changed" ||
          type === "page_changed" ||
          type === "delete" ||
          type === "table_changed"
        ) {
          setLastMessage(message);
        }
      } catch (error) {
        console.warn("Failed to parse collaboration event", error);
      }
    };

    const connect = async () => {
      const token = localStorage.getItem("erp_token");
      if (stopped || !token) return;
      try {
        const response = await fetch(
          `/api/collaboration/pages/${pageId}/stream?clientId=${encodeURIComponent(id)}`,
          {
            headers: {
              Accept: "text/event-stream",
              Authorization: `Bearer ${token}`,
            },
            cache: "no-store",
            signal: controller.signal,
          },
        );
        if (response.status === 401 || response.status === 403) {
          scope.deny(response.status === 403);
          return;
        }
        if (!response.ok || !response.body) throw new Error(`SSE request failed: ${response.status}`);
        if (stopped) return;
        setConnectedPageId(pageId);
        setSubscriptionGeneration((generation) => generation + 1);
        setConnectionAttempt({ pageId, state: "connected" });
        setConnected(true);
        deniedScope.current = null;
        setFailure(null);
        publishPresence(currentEditing.current);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!stopped) {
          const { done, value } = await reader.read();
          buffer = `${buffer}${decoder.decode(value, { stream: !done })}`.replace(/\r\n/g, "\n");
          let boundary = buffer.indexOf("\n\n");
          while (boundary >= 0) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            let eventName = "";
            const dataLines: string[] = [];
            for (const line of block.split("\n")) {
              if (line.startsWith("event:")) eventName = line.slice(6).trim();
              else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
            }
            handleEvent(eventName, dataLines.join("\n"));
            boundary = buffer.indexOf("\n\n");
          }
          if (done) break;
        }
        if (!stopped) throw new Error("Collaboration stream ended");
      } catch (error) {
        if (stopped || controller.signal.aborted) return;
        setConnected(false);
        setConnectedPageId(null);
        // Presence belongs to the live authorized subscription. Never retain
        // identities/edit coordinates after a disconnect or denied reconnect.
        setUsers([]);
        setLastMessage(null);
        setConnectionAttempt({ pageId, state: "unavailable" });
        // A failed probe is not renewed authorization. Retain the denial and
        // withheld snapshot until a successful stream explicitly clears it.
        setFailure(current =>
          current?.pageId === pageId && current.userId === userId && current.reason !== "network"
            ? current
            : { pageId, userId, reason: "network" });
        const stillDenied = deniedScope.current?.pageId === pageId && deniedScope.current?.userId === userId;
        const delay = stillDenied ? 30_000 : Math.min(30_000, 1_000 * 2 ** retry++);
        reconnectTimer = window.setTimeout(() => void connect(), delay);
      }
    };

    void connect();
    heartbeatTimer = window.setInterval(
      () => publishPresence(currentEditing.current),
      15_000,
    );

    return () => {
      stopped = true;
      controller.abort();
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      if (connectionFallbackTimer !== undefined) window.clearTimeout(connectionFallbackTimer);
      if (accessRetryTimer !== undefined) window.clearTimeout(accessRetryTimer);
      window.clearInterval(heartbeatTimer);
      if (activeScope.current === scope) activeScope.current = null;
      setConnected(false);
      setConnectedPageId(null);
    };
  }, [isGuest, pageId, publishPresence, userId, accessRetry]);

  return {
    failureReason: !isGuest && failure && failure.pageId === pageId && failure.userId === userId ? failure.reason : null,
    users,
    clientId: clientId.current,
    connected,
    subscriptionKey:
      connected && connectedPageId === pageId
        ? `${connectedPageId}:${subscriptionGeneration}`
        : null,
    subscriptionPending:
      pageId != null &&
      userId != null &&
      !isGuest &&
      (connectionAttempt.pageId !== pageId || connectionAttempt.state === "connecting"),
    publishPresence,
    lastMessage,
  };
}
