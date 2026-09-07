import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { ak } from "../api/keys";
import { BusyButton, LoadingState } from "../components/Spinner";
import { useAuth, type Me } from "./AuthProvider";

export function LoginPage() {
  const { me, loading } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [f, setF] = useState({ identifier: "", password: "" });

  const login = useMutation({
    mutationFn: () => api.post<Me>("/auth/login", f),
    onSuccess: (user) => {
      qc.setQueryData(ak("me"), user);
      navigate("/guilds", { replace: true });
    },
  });

  if (loading) return <div className="home-page"><LoadingState label="Checking your session…" /></div>;
  if (me) return <Navigate to="/guilds" replace />;

  return (
    <div className="home-page">
      <h1 className="home-title">Ranker</h1>
      <form className="modal" style={{ minWidth: "20rem" }}
            onSubmit={(e) => { e.preventDefault(); login.mutate(); }}>
        <h2>Sign in</h2>
        <label>Username or email
          <input required autoFocus value={f.identifier}
                 onChange={(e) => setF({ ...f, identifier: e.target.value })} />
        </label>
        <label>Password
          <input required type="password" value={f.password}
                 onChange={(e) => setF({ ...f, password: e.target.value })} />
        </label>
        {login.isError && <p className="err">{(login.error as Error).message}</p>}
        <footer>
          <Link to="/register" className="plain-link" style={{ marginRight: "auto", opacity: 0.7 }}>
            Create an account
          </Link>
          <BusyButton type="submit" busy={login.isPending} busyLabel="Signing in…">Sign in</BusyButton>
        </footer>
      </form>
    </div>
  );
}
