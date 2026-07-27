import { supabase } from "./supabaseClient";
import { ACCOUNT_STATUS_EVENT } from "./accountStatus";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

async function authHeader(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");
  return `Bearer ${session.access_token}`;
}

// The backend's enforceAccountStatus gate returns 403 with an `account_status`
// field when a user is frozen/suspended/banned. Surface that to the app so the
// AuthProvider can refresh the profile and show the banner/lockout — the call
// still rejects with the human-readable message for the page's own error UI.
function notifyIfAccountRestricted(json: unknown): void {
  if (json && typeof json === "object" && typeof (json as { account_status?: unknown }).account_status === "string") {
    window.dispatchEvent(new CustomEvent(ACCOUNT_STATUS_EVENT, { detail: json }));
  }
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: await authHeader(),
    },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    notifyIfAccountRestricted(json);
    throw new Error(json.error || `Request failed (${res.status})`);
  }
  return json as T;
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: await authHeader(),
    },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    notifyIfAccountRestricted(json);
    throw new Error(json.error || `Request failed (${res.status})`);
  }
  return json as T;
}

// Triggers a browser download for a CSV (or other file) export route.
// A plain <a href> can't carry the bearer token, so this fetches the file
// with the same auth header as every other admin call, then hands the
// browser a blob URL to click through.
export async function apiDownload(path: string, filename: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "GET",
    headers: {
      Authorization: await authHeader(),
    },
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    notifyIfAccountRestricted(json);
    throw new Error(json.error || `Request failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: await authHeader(),
    },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    notifyIfAccountRestricted(json);
    throw new Error(json.error || `Request failed (${res.status})`);
  }
  return json as T;
}

export async function apiGetText(path: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "GET",
    headers: {
      Authorization: await authHeader(),
    },
    signal,
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    notifyIfAccountRestricted(json);
    throw new Error((json as { error?: string }).error || `Request failed (${res.status})`);
  }
  return res.text();
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "GET",
    headers: {
      Authorization: await authHeader(),
    },
    signal,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    notifyIfAccountRestricted(json);
    throw new Error(json.error || `Request failed (${res.status})`);
  }
  return json as T;
}
