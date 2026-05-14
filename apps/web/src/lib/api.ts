function resolveApiBase(): string {
  if (typeof window !== "undefined") {
    return "";
  }
  return (
    process.env.INTERNAL_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://127.0.0.1:4000"
  );
}

const API_BASE = resolveApiBase();

/** Thrown on non-2xx API responses; `code` is set when the JSON body includes it (e.g. SQL editor step-up). */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private getToken(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("hp_token");
  }

  private async request<T>(
    method: string,
    path: string,
    options: { body?: unknown; token?: string | null; headers?: Record<string, string> } = {},
  ): Promise<T> {
    const token = options.token !== undefined ? options.token : this.getToken();
    const headers: Record<string, string> = { ...options.headers };
    if (token) headers.Authorization = `Bearer ${token}`;
    // Do not send Content-Type: application/json without a body — Fastify rejects
    // empty JSON bodies with 400 (breaks DELETE /api/sites/:id/isolation, etc.).
    const bodyJson =
      options.body !== undefined ? JSON.stringify(options.body) : undefined;
    if (bodyJson !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const res = await fetch(`${this.baseUrl}/api${path}`, {
      method,
      headers,
      body: bodyJson,
      credentials: typeof window !== "undefined" ? "include" : undefined,
    });

    if (res.status === 401) {
      if (typeof window !== "undefined") {
        localStorage.removeItem("hp_token");
        window.location.href = "/login";
      }
      throw new Error("Unauthorized");
    }

    const raw = await res.text();
    let parsed: Record<string, unknown> | undefined;
    try {
      parsed = raw.trim() ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      parsed = undefined;
    }

    if (!res.ok) {
      const msg =
        (parsed && typeof parsed.error === "string" && parsed.error) ||
        (parsed && typeof parsed.message === "string" && parsed.message) ||
        (res.statusText ? `${res.statusText} (${res.status})`.trim() : `HTTP ${res.status}`);
      const code =
        parsed && typeof parsed.code === "string" ? parsed.code : undefined;
      throw new ApiError(msg, res.status, code);
    }

    if (parsed === undefined) throw new Error("Invalid JSON response from API");
    return parsed as T;
  }

  get<T>(path: string, tokenOverride?: string | null) {
    return this.request<T>("GET", path, { token: tokenOverride });
  }

  post<T>(path: string, body?: unknown, opts?: { headers?: Record<string, string> }) {
    return this.request<T>("POST", path, { body, ...opts });
  }

  put<T>(path: string, body?: unknown) {
    return this.request<T>("PUT", path, { body });
  }

  patch<T>(path: string, body?: unknown) {
    return this.request<T>("PATCH", path, { body });
  }

  delete<T>(path: string) {
    return this.request<T>("DELETE", path);
  }
}

export const apiClient = new ApiClient(API_BASE);
