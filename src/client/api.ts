import type { Board, LogResult, Me } from "../types.ts";

async function request<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: options?.method ?? "GET",
      credentials: "same-origin",
      headers: options?.body ? { "Content-Type": "application/json" } : undefined,
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new Error("The board could not be reached.");
  }
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "The board could not be reached.");
  return data;
}

export const api = {
  me: () => request<Me>("/api/me"),
  signUp: (body: { name: string; email: string; password: string }) =>
    request<Me>("/api/auth/sign-up", { method: "POST", body }),
  signIn: (body: { email: string; password: string }) =>
    request<Me>("/api/auth/sign-in", { method: "POST", body }),
  signOut: () => request<{ ok: true }>("/api/auth/sign-out", { method: "POST", body: {} }),
  createGroup: (name: string) =>
    request<{ group: { id: string; name: string; joinToken: string } }>("/api/groups", {
      method: "POST",
      body: { name },
    }),
  board: (groupId: string) => request<Board>(`/api/groups/${groupId}`),
  previewJoin: (token: string) => request<{ groupId: string; name: string }>(`/api/join/${token}`),
  join: (token: string) => request<{ groupId: string }>(`/api/join/${token}`, { method: "POST", body: {} }),
  log: (groupId: string, text: string) =>
    request<LogResult>(`/api/groups/${groupId}/logs`, { method: "POST", body: { text } }),
};
