import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "../api/client";
import { ak } from "../api/keys";
import { LoadingState, Spinner } from "../components/Spinner";
import { AuthLayout, Field } from "./AuthLayout";
import { useAuth, type Me } from "./AuthProvider";

const MIN_PASSWORD = 10;

export function RegisterPage() {
  const { me, loading } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [f, setF] = useState({ username: "", email: "", password: "", confirm: "" });

  const mismatch = f.confirm.length > 0 && f.confirm !== f.password;
  const tooShort = f.password.length > 0 && f.password.length < MIN_PASSWORD;

  const register = useMutation({
    mutationFn: () => api.post<Me>("/auth/register", { username: f.username, email: f.email, password: f.password }),
    meta: { errorToast: false },
    onSuccess: (user) => {
      // Registration also creates the user's personal guild server-side (B2).
      qc.setQueryData(ak("me"), user);
      navigate("/guilds", { replace: true });
    },
  });

  if (loading) return <LoadingState label="Checking your session…" />;
  if (me) return <Navigate to="/guilds" replace />;

  return (
    <AuthLayout title="Create an account" description="You'll get a personal guild to start ranking in right away.">
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); register.mutate(); }}>
        <Field label="Username" htmlFor="username" hint="3–32 letters, digits, or _ . -">
          <Input id="username" required autoFocus autoComplete="username" minLength={3} maxLength={32}
                 pattern="[A-Za-z0-9_.\-]+" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
        </Field>
        <Field label="Email" htmlFor="email">
          <Input id="email" required type="email" autoComplete="email" value={f.email}
                 onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        <Field label="Password" htmlFor="password" hint={`At least ${MIN_PASSWORD} characters`}
               error={tooShort && `Password must be at least ${MIN_PASSWORD} characters.`}>
          <Input id="password" required type="password" autoComplete="new-password" minLength={MIN_PASSWORD}
                 value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        </Field>
        <Field label="Confirm password" htmlFor="confirm" error={mismatch && "Passwords don't match."}>
          <Input id="confirm" required type="password" autoComplete="new-password" value={f.confirm}
                 onChange={(e) => setF({ ...f, confirm: e.target.value })} />
        </Field>
        {register.isError && <p className="text-sm text-destructive">{(register.error as Error).message}</p>}
        <Button type="submit" disabled={register.isPending || mismatch || tooShort} className="w-full">
          {register.isPending && <Spinner size="sm" />}
          {register.isPending ? "Creating account…" : "Create account"}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          Already have an account? <Link to="/login" className="font-medium text-foreground underline">Sign in</Link>
        </p>
      </form>
    </AuthLayout>
  );
}
