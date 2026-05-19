"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  UserPlus, Pencil, Trash2, Loader2, Check, X, ShieldCheck, Shield, Eye, Users,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { apiClient } from "@/lib/api";

type Role = "superadmin" | "admin" | "editor" | "viewer";

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  dockerAccess: boolean;
  createdAt: string;
}

const ROLE_META: Record<Role, { label: string; color: string; icon: React.ElementType }> = {
  superadmin: { label: "Superadmin", color: "text-violet-400 bg-violet-500/10 border-violet-500/20", icon: ShieldCheck },
  admin:      { label: "Admin",      color: "text-blue-400  bg-blue-500/10  border-blue-500/20",  icon: Shield },
  editor:     { label: "Editor",     color: "text-amber-400 bg-amber-500/10 border-amber-500/20", icon: Pencil },
  viewer:     { label: "Viewer",     color: "text-slate-400 bg-slate-500/10 border-slate-500/20", icon: Eye },
};

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

  const { data, isLoading } = useQuery<{ data: UserRow[] }>({
    queryKey: ["users"],
    queryFn: () => apiClient.get("/auth/users"),
  });

  const users = data?.data ?? [];

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/auth/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  if (!isStaff) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        You need admin permissions to manage users.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Users</h2>
          <p className="text-sm text-muted-foreground">Manage panel accounts and permissions</p>
        </div>
        <button
          onClick={() => { setEditing(null); setShowCreate(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <UserPlus className="w-4 h-4" />
          New user
        </button>
      </div>

      {(showCreate || editing) && (
        <UserForm
          initial={editing}
          isSuperadmin={isSuperadmin}
          onClose={() => { setShowCreate(false); setEditing(null); }}
          onSaved={() => { qc.invalidateQueries({ queryKey: ["users"] }); setShowCreate(false); setEditing(null); }}
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
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Docker</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((u) => {
                const canEdit = isSuperadmin || (u.role !== "superadmin" && u.role !== "admin");
                const canDelete = u.id !== me?.id && (isSuperadmin || u.role !== "superadmin");
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
                          <p className="font-medium truncate">{u.name ?? <span className="text-muted-foreground italic">No name</span>}</p>
                          <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      {u.role === "superadmin" || u.role === "admin" ? (
                        <span className="text-xs text-muted-foreground">Always</span>
                      ) : u.dockerAccess ? (
                        <Check className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <X className="w-4 h-4 text-muted-foreground/40" />
                      )}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground text-xs">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        {canEdit && (
                          <button
                            onClick={() => { setShowCreate(false); setEditing(u); }}
                            className="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            onClick={() => {
                              if (confirm(`Delete user ${u.email}? This cannot be undone.`)) {
                                deleteMutation.mutate(u.id);
                              }
                            }}
                            disabled={deleteMutation.isPending}
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

interface UserFormProps {
  initial: UserRow | null;
  isSuperadmin: boolean;
  onClose: () => void;
  onSaved: () => void;
}

function UserForm({ initial, isSuperadmin, onClose, onSaved }: UserFormProps) {
  const isEdit = !!initial;
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    email: initial?.email ?? "",
    password: "",
    role: initial?.role ?? ("viewer" as Role),
    dockerAccess: initial?.dockerAccess ?? false,
  });
  const [error, setError] = useState("");

  const availableRoles: Role[] = isSuperadmin
    ? ["superadmin", "admin", "editor", "viewer"]
    : ["admin", "editor", "viewer"];

  const mutation = useMutation({
    mutationFn: () => {
      if (isEdit) {
        const payload: Record<string, unknown> = {};
        if (form.name !== (initial?.name ?? "")) payload.name = form.name;
        if (form.email !== initial?.email) payload.email = form.email;
        if (form.role !== initial?.role) payload.role = form.role;
        if (form.dockerAccess !== initial?.dockerAccess) payload.dockerAccess = form.dockerAccess;
        return apiClient.patch(`/auth/users/${initial!.id}`, payload);
      }
      return apiClient.post("/auth/users", {
        name: form.name,
        email: form.email,
        password: form.password,
        role: form.role,
      });
    },
    onSuccess: onSaved,
    onError: (e: Error) => setError(e.message),
  });

  const canSubmit = isEdit
    ? true
    : form.name.trim() && form.email.trim() && form.password.length >= 8;

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
            type="text"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="user@example.com"
            className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        {!isEdit && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Password <span className="text-muted-foreground font-normal">(min 8 chars)</span></label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="••••••••"
              className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
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
