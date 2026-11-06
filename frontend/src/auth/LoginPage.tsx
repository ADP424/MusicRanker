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

export function LoginPage() {
  const { me, loading } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [f, setF] = useState({ identifier: "", password: "" });

  const login = useMutation({
    mutationFn: () => api.post<Me>("/auth/login", f),
    meta: { errorToast: false },
    onSuccess: (user) => {
      qc.setQueryData(ak("me"), user);
      navigate("/guilds", { replace: true });
    },
  });

  if (loading) return <LoadingState label="Checking your session…" />;
  if (me) return <Navigate to="/guilds" replace />;

  return (
    <AuthLayout title="Sign in" description="Welcome back. Sign in with your username or email.">
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); login.mutate(); }}>
        <Field label="Username or email" htmlFor="identifier">
          <Input id="identifier" required autoFocus autoComplete="username" value={f.identifier}
                 onChange={(e) => setF({ ...f, identifier: e.target.value })} />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" required type="password" autoComplete="current-password" value={f.password}
                 onChange={(e) => setF({ ...f, password: e.target.value })} />
        </Field>
        {login.isError && <p className="text-sm text-destructive">{(login.error as Error).message}</p>}
        <Button type="submit" disabled={login.isPending} className="w-full">
          {login.isPending && <Spinner size="sm" />}
          {login.isPending ? "Signing in…" : "Sign in"}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          New here? <Link to="/register" className="font-medium text-foreground underline">Create an account</Link>
        </p>
      </form>
    </AuthLayout>
  );
}
