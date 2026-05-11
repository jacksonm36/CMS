const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

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
    options: { body?: unknown; token?: string | null } = {}
  ): Promise<T> {
    const token = options.token !== undefined ? options.token : this.getToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${this.baseUrl}/api${path}`, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (res.status === 401) {
      if (typeof window !== "undefined") {
        localStorage.removeItem("hp_token");
        window.location.href = "/login";
      }
      throw new Error("Unauthorized");
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    return data;
  }

  get<T>(path: string, tokenOverride?: string | null) {
    return this.request<T>("GET", path, { token: tokenOverride });
  }

  post<T>(path: string, body?: unknown) {
    return this.request<T>("POST", path, { body });
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
