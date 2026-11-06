import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, Laptop, LogOut, Trophy, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserMenu } from "@/shell/AppShell";
import { API_BASE, api } from "../api/client";
import { ak } from "../api/keys";
import { Spinner } from "../components/Spinner";
import { useAuth, useMe } from "./AuthProvider";

interface SessionRow {
  id: number; created_at: string; last_seen_at: string; expires_at: string;
  user_agent: string | null; ip: string | null; current: boolean;
}

/** "Edge on Windows" from a user-agent string; good enough to tell devices apart. */
function device(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS"
    : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function AccountPage() {
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { logout } = useAuth();

  const [username, setUsername] = useState(me.username);
  const [email, setEmail] = useState(me.email);
  const [profilePassword, setProfilePassword] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmNext, setConfirmNext] = useState("");
  const [deletePassword, setDeletePassword] = useState("");

  const sessions = useQuery({ queryKey: ak("sessions"), queryFn: () => api.get<SessionRow[]>("/account/sessions") });

  const profile = useMutation({
    mutationFn: () => api.patch("/account", {
      username: username !== me.username ? username : undefined,
      email: email !== me.email ? email : undefined,
      current_password: email !== me.email ? profilePassword : undefined,
    }),
    meta: { errorToast: false },
    onSuccess: () => { setProfilePassword(""); toast.success("Saved"); return qc.invalidateQueries({ queryKey: ak("me") }); },
  });
  const password = useMutation({
    mutationFn: () => api.post("/account/password", { current_password: current, new_password: next }),
    meta: { errorToast: false },
    onSuccess: () => {
      setCurrent(""); setNext(""); setConfirmNext("");
      toast.success("Password changed. Every other device was signed out.");
      return qc.invalidateQueries({ queryKey: ak("sessions") });
    },
  });
  const revoke = useMutation({ mutationFn: (id: number) => api.delete(`/account/sessions/${id}`) });
  const revokeOthers = useMutation({
    mutationFn: () => api.post("/account/sessions/revoke-others"),
    onSuccess: () => toast.success("Signed out everywhere else"),
  });
  const remove = useMutation({
    mutationFn: () => api.post("/account/delete", { password: deletePassword }),
    meta: { errorToast: false },
    onSuccess: async () => { await logout(); navigate("/login"); },
  });

  const submit = (fn: () => void) => (e: FormEvent) => { e.preventDefault(); fn(); };
  const emailChanged = email !== me.email;
  const mismatch = confirmNext.length > 0 && next !== confirmNext;

  return (
    <div className="min-h-svh bg-muted/30">
      <header className="flex h-14 items-center gap-3 border-b bg-background px-4 md:px-8">
        <Button asChild variant="ghost" size="sm"><Link to="/guilds"><ArrowLeft /> Guilds</Link></Button>
        <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground"><Trophy className="size-4" /></span>
        <span className="font-semibold">Account settings</span>
        <div className="ml-auto"><UserMenu compact /></div>
      </header>

      <div className="mx-auto grid max-w-2xl gap-6 px-4 py-10">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Profile</CardTitle>
            <CardDescription>Your username is what other members see.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4" onSubmit={submit(() => profile.mutate())}>
              <div className="grid gap-1.5">
                <Label htmlFor="username">Username</Label>
                <Input id="username" value={username} minLength={3} maxLength={32} onChange={(e) => setUsername(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              {emailChanged && (
                <div className="grid gap-1.5">
                  <Label htmlFor="profile-password">Current password (to change your email)</Label>
                  <Input id="profile-password" type="password" autoComplete="current-password" value={profilePassword}
                         onChange={(e) => setProfilePassword(e.target.value)} />
                </div>
              )}
              {profile.isError && <p className="text-sm text-destructive">{(profile.error as Error).message}</p>}
              <Button type="submit" className="w-fit"
                      disabled={profile.isPending || (username === me.username && !emailChanged) || (emailChanged && !profilePassword)}>
                {profile.isPending && <Spinner size="sm" />} Save profile
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Password</CardTitle>
            <CardDescription>Changing it signs out every other device.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4" onSubmit={submit(() => password.mutate())}>
              <div className="grid gap-1.5">
                <Label htmlFor="current">Current password</Label>
                <Input id="current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="new">New password <span className="text-muted-foreground">(at least 10 characters)</span></Label>
                <Input id="new" type="password" autoComplete="new-password" minLength={10} value={next} onChange={(e) => setNext(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="confirm">Repeat new password</Label>
                <Input id="confirm" type="password" autoComplete="new-password" value={confirmNext} aria-invalid={mismatch}
                       onChange={(e) => setConfirmNext(e.target.value)} />
                {mismatch && <p className="text-sm text-destructive">The passwords don't match.</p>}
              </div>
              {password.isError && <p className="text-sm text-destructive">{(password.error as Error).message}</p>}
              <Button type="submit" className="w-fit"
                      disabled={password.isPending || !current || next.length < 10 || next !== confirmNext}>
                {password.isPending && <Spinner size="sm" />} Change password
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="grid gap-1.5">
              <CardTitle className="text-base">Where you're signed in</CardTitle>
              <CardDescription>Sign out a device you don't recognise or no longer use.</CardDescription>
            </div>
            <Button variant="outline" size="sm" disabled={revokeOthers.isPending || (sessions.data ?? []).length < 2}
                    onClick={() => revokeOthers.mutate()}>
              <LogOut /> Sign out everywhere else
            </Button>
          </CardHeader>
          <CardContent className="grid gap-2">
            {(sessions.data ?? []).map((s) => (
              <div key={s.id} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
                <Laptop className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{device(s.user_agent)} {s.current && <Badge variant="secondary" className="ml-1">This device</Badge>}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    Signed in {when(s.created_at)} · last active {when(s.last_seen_at)}{s.ip && ` · ${s.ip}`}
                  </p>
                </div>
                {!s.current && (
                  <Button variant="ghost" size="icon-sm" aria-label="Sign out this device"
                          disabled={revoke.isPending && revoke.variables === s.id} onClick={() => revoke.mutate(s.id)}>
                    {revoke.isPending && revoke.variables === s.id ? <Spinner size="sm" /> : <X />}
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your data</CardTitle>
            <CardDescription>Every list you keep in every guild, best first, with your notes and counts.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild variant="outline"><a href={`${API_BASE}/account/export?format=csv`} download><Download /> Download CSV</a></Button>
            <Button asChild variant="outline"><a href={`${API_BASE}/account/export?format=json`} download><Download /> Download JSON</a></Button>
          </CardContent>
        </Card>

        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base text-destructive">Delete account</CardTitle>
            <CardDescription>
              Deletes your account, your rankings everywhere, and any guild where you're the only member. If you own a
              guild other people are in, transfer it to someone first.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex flex-wrap items-end gap-2" onSubmit={submit(() => remove.mutate())}>
              <div className="grid min-w-56 flex-1 gap-1.5">
                <Label htmlFor="delete-password">Password</Label>
                <Input id="delete-password" type="password" autoComplete="current-password" value={deletePassword}
                       onChange={(e) => setDeletePassword(e.target.value)} />
              </div>
              <Button type="submit" variant="destructive" disabled={!deletePassword || remove.isPending}>
                {remove.isPending && <Spinner size="sm" />} Delete my account
              </Button>
            </form>
            {remove.isError && <p className="mt-2 text-sm text-destructive">{(remove.error as Error).message}</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
