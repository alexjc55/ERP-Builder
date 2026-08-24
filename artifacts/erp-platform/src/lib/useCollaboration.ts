import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/lib/auth";

export type CollaborationEditing = {
  entityId: number;
  recordId: number;
  fieldKey: string;
  source: "entity" | "page";
};

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

export function useCollaboration(pageId?: number | null) {
  const { user, isGuest } = useAuth();
  const userId = user?.id;
  const [users, setUsers] = useState<CollaborationPresence[]>([]);
  const [connected, setConnected] = useState(false);
  const clientId = useRef(getClientId());
  const [lastMessage, setLastMessage] = useState<CollaborationMessage | null>(null);
  const currentEditing = useRef<CollaborationEditing | null>(null);

  const publishPresence = useCallback((editing: CollaborationEditing | null) => {
    if (!pageId || userId == null || isGuest) return;
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
      return;
    }

    const controller = new AbortController();
    const id = clientId.current;
    let stopped = false;
    let reconnectTimer: number | undefined;
    let retry = 0;

    const handleEvent = (eventName: string, rawData: string) => {
      if (stopped || !rawData) return;
      try {
        retry = 0;
        const data = JSON.parse(rawData) as Record<string, unknown>;
        const type = (eventName || data.type) as CollaborationMessage["type"];
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
        if (!response.ok || !response.body) throw new Error(`SSE request failed: ${response.status}`);
        if (stopped) return;
        setConnected(true);
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
        const delay = Math.min(30_000, 1_000 * 2 ** retry++);
        reconnectTimer = window.setTimeout(() => void connect(), delay);
      }
    };

    void connect();
    const heartbeatTimer = window.setInterval(
      () => publishPresence(currentEditing.current),
      15_000,
    );

    return () => {
      stopped = true;
      controller.abort();
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      window.clearInterval(heartbeatTimer);
      setConnected(false);
    };
  }, [isGuest, pageId, publishPresence, userId]);

  return {
    users,
    clientId: clientId.current,
    connected,
    publishPresence,
    lastMessage,
  };
}
