"use client";

import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Trash2, Play, ChevronRight, ChevronDown,
  Table2, Users, BarChart2, Terminal as TerminalIcon, RefreshCw, AlertTriangle,
  Fingerprint, KeyRound,
} from "lucide-react";
import { startAuthentication, type PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { apiClient, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { DbConnection, DbDatabase, DbTable, DbTableRows, DbQueryResult, DbStats, DbUser } from "@hostpanel/types";
import { MonacoEditor } from "@/components/editor/monaco-editor";

type Tab = "overview" | "browser" | "query" | "users";

const SQL_EDITOR_ELEVATION_KEY = "hp_sql_editor_elevation";

export default function DatabasesPage() {
  const { user, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");
  const [selectedConn, setSelectedConn] = useState("default");

  const showQueryTab = !authLoading && user?.role === "superadmin";

  useEffect(() => {
    if (!authLoading && !showQueryTab && tab === "query") {
      setTab("overview");
    }
  }, [authLoading, showQueryTab, tab]);

  const { data: connsData } = useQuery({
    queryKey: ["db-connections"],
    queryFn: () => apiClient.get<{ data: DbConnection[] }>("/databases/connections"),
  });
  const connections = connsData?.data ?? [];

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = useMemo(
    () =>
      showQueryTab
        ? [
            { id: "overview", label: "Overview", icon: BarChart2 },
            { id: "browser", label: "Table Browser", icon: Table2 },
            { id: "query", label: "Query Editor", icon: TerminalIcon },
            { id: "users", label: "Users", icon: Users },
          ]
        : [
            { id: "overview", label: "Overview", icon: BarChart2 },
            { id: "browser", label: "Table Browser", icon: Table2 },
            { id: "users", label: "Users", icon: Users },
          ],
    [showQueryTab],
  );

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold">Database Management</h2>
          <p className="text-sm text-muted-foreground">Browse tables, run queries, manage users and databases</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Connection:</label>
          <select
            value={selectedConn}
            onChange={(e) => setSelectedConn(e.target.value)}
            className="h-8 rounded-md border border-input bg-secondary/50 px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {connections.length === 0 && <option value="default">default</option>}
            {connections.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.engine})</option>)}
          </select>
        </div>
      </div>

      <div className="flex gap-1 bg-secondary/50 rounded-lg p-1 w-fit">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${tab === id ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Icon className="w-4 h-4" />{label}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab connectionId={selectedConn} />}
      {tab === "browser" && <BrowserTab connectionId={selectedConn} />}
      {tab === "query" && <QueryTab connectionId={selectedConn} />}
      {tab === "users" && <UsersTab connectionId={selectedConn} />}
    </div>
  );
}

// ─── Overview ─────────────────────────────────────────────────────────────────

function OverviewTab({ connectionId }: { connectionId: string }) {
  const queryClient = useQueryClient();

  const { data: statsData, isLoading, error } = useQuery({
    queryKey: ["db-stats", connectionId],
    queryFn: () => apiClient.get<{ data: DbStats }>(`/databases/stats?connectionId=${connectionId}`),
    retry: 1,
  });

  const { data: dbsData } = useQuery({
    queryKey: ["db-list", connectionId],
    queryFn: () => apiClient.get<{ data: DbDatabase[] }>(`/databases/list?connectionId=${connectionId}`),
    retry: 1,
  });

  const [showCreate, setShowCreate] = useState(false);
  const [newDbName, setNewDbName] = useState("");
  const createMutation = useMutation({
    mutationFn: (name: string) => apiClient.post("/databases/create", { name, engine: "postgresql", connectionId }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["db-list"] }); setShowCreate(false); setNewDbName(""); },
  });
  const dropMutation = useMutation({
    mutationFn: (name: string) => apiClient.delete(`/databases/${name}?engine=postgresql&connectionId=${connectionId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["db-list"] }),
  });

  const stats = statsData?.data;
  const dbs = dbsData?.data ?? [];

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-destructive text-sm">Could not connect to database</p>
          <p className="text-xs text-muted-foreground mt-1">{(error as Error).message}</p>
          <button onClick={() => queryClient.invalidateQueries({ queryKey: ["db-stats"] })} className="mt-2 text-xs text-primary hover:underline flex items-center gap-1"><RefreshCw className="w-3 h-3" /> Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Stats row */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="rounded-xl border bg-card p-5 h-24 animate-pulse bg-muted/30" />)}</div>
      ) : stats ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Version", value: stats.version, sub: "" },
            { label: "Databases", value: stats.totalDatabases, sub: "total" },
            { label: "Connections", value: `${stats.totalConnections} / ${stats.maxConnections}`, sub: "active" },
            { label: "Cache Hit Ratio", value: `${stats.cacheHitRatio}%`, sub: stats.cacheHitRatio > 90 ? "excellent" : "needs attention" },
          ].map(({ label, value, sub }) => (
            <div key={label} className="rounded-xl border bg-card p-5">
              <p className="text-xs text-muted-foreground mb-1">{label}</p>
              <p className="text-xl font-bold font-mono">{value}</p>
              {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
            </div>
          ))}
        </div>
      ) : null}

      {/* Database list */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h3 className="font-semibold">Databases</h3>
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors">
            <Plus className="w-3.5 h-3.5" /> New Database
          </button>
        </div>

        {showCreate && (
          <div className="flex items-center gap-3 px-5 py-3 border-b border-border bg-secondary/20">
            <input value={newDbName} onChange={(e) => setNewDbName(e.target.value.replace(/[^a-zA-Z0-9_]/g, ""))} placeholder="database_name" className="flex h-8 rounded-md border border-input bg-background px-3 text-sm font-mono w-48 focus:outline-none focus:ring-1 focus:ring-ring" />
            <button onClick={() => createMutation.mutate(newDbName)} disabled={!newDbName || createMutation.isPending} className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors">{createMutation.isPending ? "Creating..." : "Create"}</button>
            <button onClick={() => { setShowCreate(false); setNewDbName(""); }} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
          </div>
        )}

        <table className="w-full text-sm">
          <thead className="border-b border-border">
            <tr>
              {["Name", "Owner", "Encoding", "Size", "Connections", "Cache Hit", ""].map((h) => (
                <th key={h} className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {dbs.map((db) => {
              const dbStat = stats?.databases.find((d) => d.name === db.name);
              return (
                <tr key={db.name} className="hover:bg-muted/30 group">
                  <td className="px-5 py-3 font-mono font-medium text-sm">{db.name}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{db.owner}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{db.encoding}</td>
                  <td className="px-5 py-3 text-xs font-mono">{db.size}</td>
                  <td className="px-5 py-3 text-xs">{dbStat?.connections ?? "—"}</td>
                  <td className="px-5 py-3 text-xs">
                    <span className={dbStat ? (dbStat.cacheHit > 90 ? "text-emerald-400" : "text-amber-400") : "text-muted-foreground"}>
                      {dbStat ? `${dbStat.cacheHit}%` : "—"}
                    </span>
                  </td>
                  <td className="px-5 py-3 opacity-0 group-hover:opacity-100">
                    <button onClick={() => { if (confirm(`Drop database "${db.name}"? This is irreversible!`)) dropMutation.mutate(db.name); }} className="text-xs text-destructive hover:underline flex items-center gap-1">
                      <Trash2 className="w-3 h-3" /> Drop
                    </button>
                  </td>
                </tr>
              );
            })}
            {dbs.length === 0 && !isLoading && (
              <tr><td colSpan={7} className="px-5 py-8 text-center text-sm text-muted-foreground">No databases found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Table Browser ────────────────────────────────────────────────────────────

function BrowserTab({ connectionId }: { connectionId: string }) {
  const [selectedDb, setSelectedDb] = useState("");
  const [selectedTable, setSelectedTable] = useState("");
  const [expandedSchema, setExpandedSchema] = useState(new Set(["public"]));
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const { data: dbsData } = useQuery({
    queryKey: ["db-list", connectionId],
    queryFn: () => apiClient.get<{ data: DbDatabase[] }>(`/databases/list?connectionId=${connectionId}`),
  });

  const { data: tablesData } = useQuery({
    queryKey: ["db-tables", connectionId, selectedDb],
    queryFn: () => apiClient.get<{ data: DbTable[] }>(`/databases/${selectedDb}/tables?connectionId=${connectionId}`),
    enabled: !!selectedDb,
  });

  const { data: rowsData, isLoading: loadingRows } = useQuery({
    queryKey: ["db-rows", connectionId, selectedDb, selectedTable, page],
    queryFn: () => apiClient.get<{ data: DbTableRows }>(`/databases/${selectedDb}/tables/${encodeURIComponent(selectedTable)}/rows?connectionId=${connectionId}&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`),
    enabled: !!selectedDb && !!selectedTable,
  });

  const dbs = dbsData?.data ?? [];
  const tables = tablesData?.data ?? [];
  const rows = rowsData?.data;

  // Group tables by schema
  const tablesBySchema = tables.reduce<Record<string, DbTable[]>>((acc, t) => {
    if (!acc[t.schema]) acc[t.schema] = [];
    acc[t.schema]!.push(t);
    return acc;
  }, {});

  const totalPages = rows ? Math.ceil(rows.total / PAGE_SIZE) : 0;

  return (
    <div className="flex gap-4 h-[calc(100vh-20rem)] min-h-[500px]">
      {/* Left panel: DB + table tree */}
      <div className="w-56 rounded-xl border bg-card overflow-hidden flex flex-col shrink-0">
        <div className="p-3 border-b border-border">
          <select value={selectedDb} onChange={(e) => { setSelectedDb(e.target.value); setSelectedTable(""); setPage(0); }}
            className="w-full h-8 text-xs rounded-md border border-input bg-secondary/50 px-2 focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">Select database...</option>
            {dbs.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
          </select>
        </div>
        <div className="flex-1 overflow-auto py-1">
          {Object.entries(tablesBySchema).map(([schema, schemaTables]) => (
            <div key={schema}>
              <button
                onClick={() => setExpandedSchema((prev) => { const n = new Set(prev); if (n.has(schema)) n.delete(schema); else n.add(schema); return n; })}
                className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent transition-colors"
              >
                {expandedSchema.has(schema) ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                <span className="font-mono">{schema}</span>
                <span className="ml-auto text-muted-foreground/60">{schemaTables.length}</span>
              </button>
              {expandedSchema.has(schema) && schemaTables.map((table) => (
                <button
                  key={table.name}
                  onClick={() => { setSelectedTable(table.name); setPage(0); }}
                  className={`w-full flex items-center gap-2 px-5 py-1.5 text-xs hover:bg-accent transition-colors text-left ${selectedTable === table.name ? "bg-primary/10 text-primary" : "text-foreground"}`}
                >
                  <Table2 className="w-3 h-3 shrink-0 text-muted-foreground" />
                  <span className="truncate font-mono">{table.name}</span>
                </button>
              ))}
            </div>
          ))}
          {!selectedDb && <p className="px-4 py-3 text-xs text-muted-foreground">Select a database</p>}
          {selectedDb && tables.length === 0 && <p className="px-4 py-3 text-xs text-muted-foreground">No tables found</p>}
        </div>
      </div>

      {/* Right panel: table data */}
      <div className="flex-1 rounded-xl border bg-card overflow-hidden flex flex-col min-w-0">
        {!selectedTable ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Table2 className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Select a table to browse rows</p>
            </div>
          </div>
        ) : (
          <>
            {/* Table header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
              <div>
                <span className="font-mono font-semibold text-sm">{selectedTable}</span>
                {rows && <span className="ml-2 text-xs text-muted-foreground">{rows.total.toLocaleString()} rows</span>}
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {totalPages > 1 && (
                  <>
                    <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-2 py-1 border rounded hover:bg-accent disabled:opacity-40 transition-colors">←</button>
                    <span>Page {page + 1} / {totalPages}</span>
                    <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1} className="px-2 py-1 border rounded hover:bg-accent disabled:opacity-40 transition-colors">→</button>
                  </>
                )}
              </div>
            </div>

            {/* Table body */}
            {loadingRows ? (
              <div className="flex-1 flex items-center justify-center"><div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
            ) : rows && rows.columns.length > 0 ? (
              <div className="flex-1 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-card border-b border-border z-10">
                    <tr>
                      {rows.columns.map((col) => (
                        <th key={col} className="px-3 py-2 text-left font-mono font-medium text-muted-foreground whitespace-nowrap border-r border-border/50 last:border-r-0">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {rows.rows.map((row, i) => (
                      <tr key={i} className="hover:bg-muted/20 transition-colors">
                        {rows.columns.map((col) => {
                          const val = row[col];
                          const display = val === null ? <span className="text-muted-foreground/50 italic">NULL</span>
                            : typeof val === "object" ? <span className="text-violet-400 font-mono">{JSON.stringify(val)}</span>
                            : typeof val === "boolean" ? <span className={val ? "text-emerald-400" : "text-red-400"}>{String(val)}</span>
                            : <span className="font-mono">{String(val)}</span>;
                          return (
                            <td key={col} className="px-3 py-1.5 max-w-[200px] truncate border-r border-border/30 last:border-r-0" title={String(val)}>
                              {display}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">No rows</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Query Editor ─────────────────────────────────────────────────────────────

function QueryTab({ connectionId }: { connectionId: string }) {
  const [sql, setSql] = useState(
    "-- Write your SQL query here\n-- Ctrl+Enter to execute\n\nSELECT table_name, table_type\nFROM information_schema.tables\nWHERE table_schema = 'public'\nORDER BY table_name;",
  );
  const [result, setResult] = useState<DbQueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [elevationToken, setElevationToken] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [elevateError, setElevateError] = useState<string | null>(null);
  const [elevating, setElevating] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const t = sessionStorage.getItem(SQL_EDITOR_ELEVATION_KEY);
    if (t) setElevationToken(t);
  }, []);

  function persistElevation(token: string) {
    sessionStorage.setItem(SQL_EDITOR_ELEVATION_KEY, token);
    setElevationToken(token);
  }

  function clearElevation() {
    sessionStorage.removeItem(SQL_EDITOR_ELEVATION_KEY);
    setElevationToken(null);
  }

  async function confirmWithTotp() {
    setElevateError(null);
    const code = totpCode.trim();
    if (!code) {
      setElevateError("Enter your 6-digit authenticator code.");
      return;
    }
    setElevating(true);
    try {
      const res = await apiClient.post<{
        success: boolean;
        data?: { elevationToken: string; expiresInSec: number };
        error?: string;
      }>("/auth/sql-editor/elevate", { totpCode: code });
      if (res.success && res.data?.elevationToken) {
        persistElevation(res.data.elevationToken);
        setTotpCode("");
      } else {
        setElevateError(res.error ?? "Confirmation failed");
      }
    } catch (e: unknown) {
      setElevateError(e instanceof Error ? e.message : "Confirmation failed");
    } finally {
      setElevating(false);
    }
  }

  async function confirmWithPasskey() {
    setElevateError(null);
    setElevating(true);
    try {
      const optRes = await apiClient.get<{ success: boolean; data: Record<string, unknown> & { challengeId: string } }>(
        "/auth/sql-editor/passkey/options",
      );
      const { challengeId, ...options } = optRes.data;
      const credential = await startAuthentication({
        optionsJSON: options as unknown as PublicKeyCredentialRequestOptionsJSON,
      });
      const res = await apiClient.post<{
        success: boolean;
        data?: { elevationToken: string; expiresInSec: number };
        error?: string;
      }>("/auth/sql-editor/elevate", {
        ...credential,
        challengeId,
      });
      if (res.success && res.data?.elevationToken) {
        persistElevation(res.data.elevationToken);
      } else {
        setElevateError(res.error ?? "Passkey confirmation failed");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Passkey confirmation failed";
      if (!msg.toLowerCase().includes("cancelled") && !msg.toLowerCase().includes("aborted")) {
        setElevateError(msg);
      }
    } finally {
      setElevating(false);
    }
  }

  const queryMutation = useMutation({
    mutationFn: (payload: { sql: string; connectionId: string }) => {
      const headers: Record<string, string> = {};
      if (elevationToken) {
        headers["X-SQL-Editor-Elevation"] = elevationToken;
      }
      return apiClient.post<{ success: boolean; data?: DbQueryResult; error?: string; durationMs?: number }>(
        "/databases/query",
        payload,
        { headers },
      );
    },
    onSuccess: (res) => {
      setError(null);
      if (res.success && res.data) {
        setResult(res.data);
        setHistory((prev) => [sql, ...prev.slice(0, 19)]);
      } else {
        setError(res.error ?? "Query failed");
        setResult(null);
      }
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        if (err.code === "SQL_EDITOR_STEP_UP_REQUIRED" || (err.status === 403 && /sql editor|elevate|confirmation/i.test(err.message))) {
          clearElevation();
          setElevateError("Confirm again with 2FA or your passkey before running SQL.");
        }
        setError(err.message);
      } else {
        setError((err as Error).message);
      }
      setResult(null);
    },
  });

  function runQuery() {
    const trimmed = sql.trim();
    if (!trimmed) return;
    if (!elevationToken) {
      setError("Confirm with 2FA or passkey above before running queries.");
      return;
    }
    queryMutation.mutate({ sql: trimmed, connectionId });
  }

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-20rem)] min-h-[600px]">
      <div className="rounded-xl border border-border bg-card/80 p-4 space-y-3">
        <div className="flex items-start gap-2">
          <KeyRound className="w-4 h-4 shrink-0 text-muted-foreground mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">SQL editor access</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Each session requires a short step-up with your authenticator code or a passkey. The confirmation lasts about 10 minutes.
            </p>
          </div>
        </div>

        {elevationToken ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-emerald-500 font-medium">Step-up active</span>
            <button
              type="button"
              onClick={clearElevation}
              className="text-muted-foreground underline hover:text-foreground"
            >
              Clear and confirm again
            </button>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6-digit code"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="flex h-9 w-36 rounded-md border border-input bg-background px-3 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                type="button"
                disabled={elevating}
                onClick={() => void confirmWithTotp()}
                className="px-3 py-1.5 text-xs bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 disabled:opacity-50"
              >
                Confirm with 2FA
              </button>
            </div>
            <button
              type="button"
              disabled={elevating}
              onClick={() => void confirmWithPasskey()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-md hover:bg-accent disabled:opacity-50"
            >
              <Fingerprint className="w-3.5 h-3.5" />
              Confirm with passkey
            </button>
          </div>
        )}

        {elevateError && (
          <p className="text-xs text-destructive">{elevateError}</p>
        )}
      </div>

      {/* Editor */}
      <div className="rounded-xl border bg-card overflow-hidden flex flex-col" style={{ height: "50%" }}>
        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-secondary/30 shrink-0">
          <span className="text-xs font-medium text-muted-foreground">SQL Query</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Ctrl+Enter to run</span>
            <button
              onClick={runQuery}
              disabled={queryMutation.isPending || !elevationToken}
              className="flex items-center gap-1.5 px-3 py-1 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              <Play className="w-3 h-3" />
              {queryMutation.isPending ? "Running..." : "Run Query"}
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <MonacoEditor
            value={sql}
            language="sql"
            onChange={(v) => setSql(v ?? "")}
            onSave={runQuery}
          />
        </div>
      </div>

      {/* Results */}
      <div className="rounded-xl border bg-card overflow-hidden flex flex-col flex-1 min-h-0">
        {error ? (
          <div className="p-5 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-destructive">Query Error</p>
              <pre className="text-xs text-muted-foreground mt-1 font-mono whitespace-pre-wrap">{error}</pre>
            </div>
          </div>
        ) : result ? (
          <>
            <div className="flex items-center gap-4 px-5 py-2 border-b border-border bg-secondary/30 shrink-0">
              <span className="text-xs text-muted-foreground">
                <span className="text-emerald-400 font-semibold">{result.rowCount}</span> row{result.rowCount !== 1 ? "s" : ""}
              </span>
              <span className="text-xs text-muted-foreground">{result.durationMs}ms</span>
              {result.fields.length > 0 && <span className="text-xs text-muted-foreground">{result.fields.length} columns</span>}
            </div>
            {result.rows.length > 0 ? (
              <div className="flex-1 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-card border-b border-border z-10">
                    <tr>
                      {result.fields.map((f) => (
                        <th key={f.name} className="px-3 py-2 text-left font-mono font-medium text-muted-foreground whitespace-nowrap border-r border-border/50 last:border-r-0">{f.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {result.rows.map((row, i) => (
                      <tr key={i} className="hover:bg-muted/20">
                        {result.fields.map((f) => {
                          const val = row[f.name];
                          return (
                            <td key={f.name} className="px-3 py-1.5 font-mono max-w-[240px] truncate border-r border-border/30 last:border-r-0" title={String(val)}>
                              {val === null ? <span className="text-muted-foreground/50 italic">NULL</span> : String(val)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                Query executed successfully — {result.rowCount} rows affected
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <TerminalIcon className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Run a query to see results</p>
            </div>
          </div>
        )}
      </div>

      {/* History */}
      {history.length > 0 && (
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground mb-2">Recent Queries</p>
          <div className="space-y-1">
            {history.slice(0, 5).map((q, i) => (
              <button key={i} onClick={() => setSql(q)} className="w-full text-left text-xs font-mono text-muted-foreground hover:text-foreground hover:bg-accent px-2 py-1 rounded truncate block">
                {q.trim().split("\n")[0]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Users ────────────────────────────────────────────────────────────────────

function UsersTab({ connectionId }: { connectionId: string }) {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ username: "", password: "", database: "", privileges: "ALL" });

  const { data, error } = useQuery({
    queryKey: ["db-users", connectionId],
    queryFn: () => apiClient.get<{ data: DbUser[] }>(`/databases/users?connectionId=${connectionId}`),
    retry: 1,
  });

  const createMutation = useMutation({
    mutationFn: (payload: typeof form) => apiClient.post("/databases/users", { ...payload, connectionId }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["db-users"] }); setShowCreate(false); setForm({ username: "", password: "", database: "", privileges: "ALL" }); },
  });

  const dropMutation = useMutation({
    mutationFn: (username: string) => apiClient.delete(`/databases/users/${username}?connectionId=${connectionId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["db-users"] }),
  });

  const users = data?.data ?? [];

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="flex items-center justify-between p-5 border-b border-border">
        <h3 className="font-semibold">Database Users</h3>
        <button onClick={() => setShowCreate(!showCreate)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors">
          <Plus className="w-3.5 h-3.5" /> Add User
        </button>
      </div>

      {showCreate && (
        <div className="p-5 border-b border-border bg-secondary/20 grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { key: "username", placeholder: "db_user", label: "Username" },
            { key: "password", placeholder: "••••••••", label: "Password", type: "password" },
            { key: "database", placeholder: "my_database", label: "Database" },
          ].map(({ key, placeholder, label, type }) => (
            <div key={key} className="space-y-1">
              <label className="text-xs font-medium">{label}</label>
              <input type={type ?? "text"} value={(form as Record<string, string>)[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} placeholder={placeholder}
                className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring font-mono" />
            </div>
          ))}
          <div className="space-y-1">
            <label className="text-xs font-medium">Privileges</label>
            <select value={form.privileges} onChange={(e) => setForm({ ...form, privileges: e.target.value })}
              className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring">
              <option value="ALL">ALL</option>
              <option value="SELECT">SELECT only</option>
              <option value="SELECT,INSERT,UPDATE,DELETE">Read/Write</option>
            </select>
          </div>
          <div className="col-span-full flex gap-2">
            <button onClick={() => createMutation.mutate(form)} disabled={!form.username || !form.password || createMutation.isPending} className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors">
              {createMutation.isPending ? "Creating..." : "Create User"}
            </button>
            <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-sm border rounded-md hover:bg-accent transition-colors">Cancel</button>
            {createMutation.isError && <p className="text-xs text-destructive self-center">{(createMutation.error as Error).message}</p>}
          </div>
        </div>
      )}

      {error ? (
        <div className="p-8 text-center text-sm text-muted-foreground">Could not load users: {(error as Error).message}</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b border-border">
            <tr>
              {["Username", "Can Create DB", "Superuser", "Expires", ""].map((h) => (
                <th key={h} className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.map((user) => (
              <tr key={user.username} className="hover:bg-muted/30 group">
                <td className="px-5 py-3 font-mono font-medium text-sm">{user.username}</td>
                <td className="px-5 py-3 text-xs"><span className={user.can_create_db ? "text-emerald-400" : "text-muted-foreground"}>{user.can_create_db ? "Yes" : "No"}</span></td>
                <td className="px-5 py-3 text-xs"><span className={user.is_superuser ? "text-amber-400 font-semibold" : "text-muted-foreground"}>{user.is_superuser ? "Yes" : "No"}</span></td>
                <td className="px-5 py-3 text-xs text-muted-foreground">{user.expires_at ?? "Never"}</td>
                <td className="px-5 py-3 opacity-0 group-hover:opacity-100">
                  <button onClick={() => { if (confirm(`Drop user "${user.username}"?`)) dropMutation.mutate(user.username); }} className="text-xs text-destructive hover:underline flex items-center gap-1">
                    <Trash2 className="w-3 h-3" /> Drop
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-sm text-muted-foreground">No users found</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
