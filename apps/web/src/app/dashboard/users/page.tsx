"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  UserPlus, Pencil, Trash2, Loader2, Check, X, ShieldCheck, Shield, Eye, Users,
  KeyRound, AlertTriangle,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { apiClient, ApiError } from "@/lib/api";

type Role = "superadmin" | "admin" | "editor" | "viewer";

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  dockerAccess: boolean;
  twoFactorEnabled?: boolean;
  createdAt: string;
  updatedAt?: string;
  siteCount?: number;
}

const ROLE_META: Record<Role, { label: string; color: string; icon: React.ElementType; desc: string }> = {
  superadmin: {
    label: "Superadmin",
    color: "text-violet-400 bg-violet-500/10 border-violet-500/20",
    icon: ShieldCheck,
    desc: "Full panel access, SQL editor, passkeys, all sites",
  },
  admin: {
    label: "Admin",
    color: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    icon: Shield,
    desc: "Manage sites, templates, users (editor/viewer only), databases",
  },
  editor: {
    label: "Editor",
    color: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    icon: Pencil,
    desc: "Own sites only; optional Docker access",
  },
  viewer: {
    label: "Viewer",
    color: "text-slate-400 bg-slate-500/10 border-slate-500/20",
    icon: Eye,
    desc: "Read-only access to own sites",
  },
};

function assignableRoles(actorRole: Role | undefined): Role[] {
  if (actorRole === "superadmin") return ["superadmin", "admin", "editor", "viewer"];
  if (actorRole === "admin") return ["editor", "viewer"];
  return [];
}

function canEditUser(actorRole: Role | undefined, actorId: string, target: UserRow): boolean {
  if (!actorRole || (actorRole !== "superadmin" && actorRole !== "admin")) return false;
  if (actorId === target.id) return false;
  if (actorRole === "superadmin") return true;
  return target.role === "editor" || target.role === "viewer";
}

function canDeleteUser(actorRole: Role | undefined, actorId: string, target: UserRow): boolean {
  if (!actorRole || (actorRole !== "superadmin" && actorRole !== "admin")) return false;
  if (actorId === target.id) return false;
  if (actorRole === "superadmin") return true;
  return target.role === "editor" || target.role === "viewer";
}

function RoleBadge({ role }: { role: Role }) {
  const m = ROLE_META[role];
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${m.color}`}>
      <Icon className="w-3 h-3" />{m.label}
    </span>
  );
}

export default function UsersPage() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const isSuperadmin = me?.role === "superadmin";
  const isStaff = me?.role === "superadmin" || me?.role === "admin";

  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [deleting, setDeleting] = useState<UserRow | null>(null);

  const { data, isLoading, error } = useQuery<{ data: UserRow[] }>({
    queryKey: ["users"],
    queryFn: () => apiClient.get("/auth/users"),
    enabled: isStaff,
  });

  const users = data?.data ?? [];

  const deleteMutation = useMutation({
    mutationFn: ({ id, transferSitesTo }: { id: string; transferSitesTo?: string }) => {
      const q = transferSitesTo ? `?transferSitesTo=${encodeURIComponent(transferSitesTo)}` : "";
      return apiClient.delete(`/auth/users/${id}${q}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setDeleting(null);
    },
  });

  if (!isStaff) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        You need admin permissions to manage users.
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Users</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Panel accounts, roles, and site ownership. Admins manage editors and viewers only.
          </p>
        </div>
        <button
          onClick={() => { setEditing(null); setShowCreate(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors shrink-0"
        >
          <UserPlus className="w-4 h-4" />
          New user
        </button>
      </div>

      <div className="rounded-xl border bg-card/50 p-4 grid sm:grid-cols-2 gap-3 text-xs">
        {(Object.keys(ROLE_META) as Role[])
          .filter((r) => isSuperadmin || r === "editor" || r === "viewer")
          .map((r) => (
            <div key={r} className="flex gap-2">
              <RoleBadge role={r} />
              <span className="text-muted-foreground leading-snug">{ROLE_META[r].desc}</span>
            </div>
          ))}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          {(error as Error).message}
        </div>
      )}

      {(showCreate || editing) && (
        <UserForm
          initial={editing}
          actorRole={me?.role}
          onClose={() => { setShowCreate(false); setEditing(null); }}
          onSaved={() => { qc.invalidateQueries({ queryKey: ["users"] }); setShowCreate(false); setEditing(null); }}
        />
      )}

      {deleting && (
        <DeleteUserDialog
          user={deleting}
          allUsers={users.filter((u) => u.id !== deleting.id)}
          isPending={deleteMutation.isPending}
          error={deleteMutation.error as Error | null}
          onClose={() => setDeleting(null)}
          onConfirm={(transferSitesTo) =>
            deleteMutation.mutate({ id: deleting.id, transferSitesTo })
          }
        />
      )}

      <div className="rounded-xl border bg-card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
            <Users className="w-8 h-8 opacity-30" />
            <p className="text-sm">No users yet</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-secondary/30">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">User</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Role</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Sites</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Docker</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Security</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((u) => {
                const canEdit = canEditUser(me?.role, me?.id ?? "", u);
                const canDelete = canDeleteUser(me?.role, me?.id ?? "", u);
                const isSelf = u.id === me?.id;
                return (
                  <tr key={u.id} className="hover:bg-secondary/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                          <span className="text-xs font-semibold text-primary">
                            {(u.name?.[0] ?? u.email[0]).toUpperCase()}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium truncate flex items-center gap-2">
                            {u.name ?? <span className="text-muted-foreground italic">No name</span>}
                            {isSelf && <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary">you</span>}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                    <td className="px-4 py-3 hidden md:table-cell text-xs font-mono">
                      {u.siteCount ?? 0}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      {u.role === "superadmin" || u.role === "admin" ? (
                        <span className="text-xs text-muted-foreground">Always</span>
                      ) : u.dockerAccess ? (
                        <Check className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <X className="w-4 h-4 text-muted-foreground/40" />
                      )}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground">
                      {u.twoFactorEnabled ? "2FA on" : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        {canEdit && (
                          <button
                            title="Edit user"
                            onClick={() => { setShowCreate(false); setEditing(u); }}
                            className="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            title="Delete user"
                            onClick={() => setDeleting(u)}
                            className="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function DeleteUserDialog({
  user,
  allUsers,
  isPending,
  error,
  onClose,
  onConfirm,
}: {
  user: UserRow;
  allUsers: UserRow[];
  isPending: boolean;
  error: Error | null;
  onClose: () => void;
  onConfirm: (transferSitesTo?: string) => void;
}) {
  const siteCount = user.siteCount ?? 0;
  const [transferTo, setTransferTo] = useState("");
  const staffTargets = allUsers.filter((u) => u.role === "superadmin" || u.role === "admin");

  return (
    <div className="rounded-xl border border-destructive/30 bg-card p-6 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-destructive">Delete user</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Remove <span className="font-mono text-foreground">{user.email}</span> permanently.
          </p>
        </div>
        <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>

      {siteCount > 0 && (
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/25 px-4 py-3 text-sm">
          <p className="font-medium text-amber-200">This user owns {siteCount} site(s)</p>
          <p className="text-xs text-muted-foreground mt-1">
            Choose another account to receive site ownership, or cancel and reassign sites from the Sites page first.
          </p>
          <label className="block mt-3 text-xs font-medium">Transfer sites to</label>
          <select
            value={transferTo}
            onChange={(e) => setTransferTo(e.target.value)}
            className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Select user…</option>
            {staffTargets.map((u) => (
              <option key={u.id} value={u.id}>{u.name ?? u.email} ({ROLE_META[u.role].label})</option>
            ))}
            {allUsers
              .filter((u) => u.role !== "superadmin" && u.role !== "admin")
              .map((u) => (
                <option key={u.id} value={u.id}>{u.name ?? u.email} ({ROLE_META[u.role].label})</option>
              ))}
          </select>
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive">
          {error instanceof ApiError ? error.message : error.message}
        </p>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => onConfirm(siteCount > 0 ? transferTo || undefined : undefined)}
          disabled={isPending || (siteCount > 0 && !transferTo)}
          className="px-4 py-2 rounded-lg text-sm bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
        >
          {isPending ? "Deleting…" : "Delete user"}
        </button>
        <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm border hover:bg-accent">
          Cancel
        </button>
      </div>
    </div>
  );
}

interface UserFormProps {
  initial: UserRow | null;
  actorRole?: Role;
  onClose: () => void;
  onSaved: () => void;
}

function UserForm({ initial, actorRole, onClose, onSaved }: UserFormProps) {
  const isEdit = !!initial;
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    email: initial?.email ?? "",
    password: "",
    newPassword: "",
    role: initial?.role ?? ("viewer" as Role),
    dockerAccess: initial?.dockerAccess ?? false,
  });
  const [error, setError] = useState("");

  const availableRoles = useMemo(() => assignableRoles(actorRole), [actorRole]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (isEdit) {
        const payload: Record<string, unknown> = {};
        if (form.name.trim() && form.name !== (initial?.name ?? "")) payload.name = form.name.trim();
        if (form.email.trim() !== initial?.email) payload.email = form.email.trim();
        if (form.role !== initial?.role) payload.role = form.role;
        if (form.dockerAccess !== initial?.dockerAccess) payload.dockerAccess = form.dockerAccess;
        if (form.newPassword.length >= 8) payload.password = form.newPassword;
        if (Object.keys(payload).length === 0) {
          throw new Error("Change at least one field before saving");
        }
        return apiClient.patch(`/auth/users/${initial!.id}`, payload);
      }
      return apiClient.post("/auth/users", {
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        role: form.role,
        dockerAccess: form.dockerAccess,
      });
    },
    onSuccess: onSaved,
    onError: (e: Error) => setError(e instanceof ApiError ? e.message : e.message),
  });

  const canSubmit = isEdit
    ? true
    : form.name.trim().length > 0 && form.email.trim().length > 0 && form.password.length >= 8;

  return (
    <div className="rounded-xl border bg-card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{isEdit ? `Edit ${initial?.name ?? initial?.email}` : "Create new user"}</h3>
        <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">{error}</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Name</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Full name"
            className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Email</label>
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="user@example.com"
            className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        {!isEdit && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Password <span className="text-muted-foreground font-normal">(min 8)</span></label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="••••••••"
              className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        )}
        {isEdit && (
          <div className="space-y-1.5 sm:col-span-2">
            <label className="text-sm font-medium flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5" />
              Reset password <span className="text-muted-foreground font-normal">(optional, min 8)</span>
            </label>
            <input
              type="password"
              value={form.newPassword}
              onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
              placeholder="Leave blank to keep current password"
              className="flex h-9 w-full max-w-md rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        )}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Role</label>
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
            className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {availableRoles.map((r) => (
              <option key={r} value={r}>{ROLE_META[r].label}</option>
            ))}
          </select>
        </div>
      </div>

      {form.role !== "superadmin" && form.role !== "admin" && (
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <div
            onClick={() => setForm({ ...form, dockerAccess: !form.dockerAccess })}
            className={`w-10 h-5 rounded-full transition-colors relative ${form.dockerAccess ? "bg-primary" : "bg-secondary border border-input"}`}
          >
            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.dockerAccess ? "translate-x-5" : "translate-x-0.5"}`} />
          </div>
          <span className="text-sm font-medium">Docker access</span>
          <span className="text-xs text-muted-foreground">Panel → Docker + tenant sidecar actions</span>
        </label>
      )}

      <div className="flex gap-2 pt-1">
        <button
          onClick={() => mutation.mutate()}
          disabled={!canSubmit || mutation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {isEdit ? "Save changes" : "Create user"}
        </button>
        <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm border hover:bg-accent transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
}
