import type { MultilingualText } from "@workspace/api-client-react";

/** Loose response shape retained for the shared status-tag picker. */
export type GlobalTag = {
  id: number;
  nameJson: Record<string, string> | null;
  color?: string | null;
  sortOrder?: number | null;
  applicableTo?: string[] | null;
};

export const tagsQueryKey = ["/api/tags"] as const;

export class TagsApiError extends Error {
  readonly status: number;
  readonly data: unknown;

  constructor(status: number, data: unknown) {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : `Request failed (${status})`;
    super(message);
    this.name = "TagsApiError";
    this.status = status;
    this.data = data;
  }
}

/** Lightweight authenticated wrapper retained by the shared status picker. */
export async function tagsRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem("erp_token");
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(path, { ...init, headers });
  const text = await response.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) throw new TagsApiError(response.status, data);
  return data as T;
}

export function listTags(): Promise<GlobalTag[]> {
  return tagsRequest<GlobalTag[]>("/api/tags");
}

export type TagWrite = {
  nameJson: MultilingualText;
  applicableTo: ["statuses"];
  color?: string;
  sortOrder?: number;
};

export function createTag(data: TagWrite): Promise<GlobalTag> {
  return tagsRequest<GlobalTag>("/api/tags", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateTag(id: number, data: TagWrite): Promise<GlobalTag> {
  return tagsRequest<GlobalTag>(`/api/tags/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function deleteTag(id: number): Promise<unknown> {
  return tagsRequest<unknown>(`/api/tags/${id}`, { method: "DELETE" });
}

export function reorderTags(items: { id: number; sortOrder: number }[]): Promise<unknown> {
  return tagsRequest<unknown>("/api/tags/reorder", {
    method: "POST",
    body: JSON.stringify({ items }),
  });
}