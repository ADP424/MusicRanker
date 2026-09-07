import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { ak } from "../api/keys";
import { BusyButton, LoadingState } from "../components/Spinner";
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
    onSuccess: (user) => {
      // Registration also creates the user's personal guild server-side (B2).
      qc.setQueryData(ak("me"), user);
      qc.invalidateQueries({ queryKey: ak("guilds") });
      navigate("/guilds", { replace: true });
    },
  });

  if (loading) return <div className="home-page"><LoadingState label="Checking your session…" /></div>;
  if (me) return <Navigate to="/guilds" replace />;

  return (
    <div className="home-page">
      <h1 className="home-title">Ranker</h1>
      <form className="modal" style={{ minWidth: "20rem" }}
            onSubmit={(e) => { e.preventDefault(); register.mutate(); }}>
        <h2>Create an account</h2>
        <label>Username <small>(letters, digits, <code>_ . -</code>)</small>
          <input required autoFocus minLength={3} maxLength={32} pattern="[A-Za-z0-9_.\-]+"
                 value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
        </label>
        <label>Email
          <input required type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </label>
        <label>Password <small>(at least {MIN_PASSWORD} characters)</small>
          <input required type="password" minLength={MIN_PASSWORD}
                 value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        </label>
        <label>Confirm password
          <input required type="password" value={f.confirm}
                 onChange={(e) => setF({ ...f, confirm: e.target.value })} />
        </label>
        {tooShort && <p className="err">Password must be at least {MIN_PASSWORD} characters.</p>}
        {mismatch && <p className="err">Passwords don't match.</p>}
        {register.isError && <p className="err">{(register.error as Error).message}</p>}
        <footer>
          <Link to="/login" className="plain-link" style={{ marginRight: "auto", opacity: 0.7 }}>
            I already have an account
          </Link>
          <BusyButton type="submit" busy={register.isPending} busyLabel="Creating account…" disabled={mismatch || tooShort}>
            Create account
          </BusyButton>
        </footer>
      </form>
    </div>
  );
}
