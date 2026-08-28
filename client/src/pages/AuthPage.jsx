import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";

export default function AuthPage({ mode }) {
  const isRegister = mode === "register";
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const data = await api(`/auth/${isRegister ? "register" : "login"}`, {
        method: "POST",
        body: { email, password },
      });
      signIn(data.token, data.user);
      navigate(location.state?.from || "/dashboard");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <Link to="/" className="logo logo-link">
        EventMaster
      </Link>
      <form className="card auth-card" onSubmit={submit}>
        <h1>{isRegister ? "Регистрация ведущего" : "Вход для ведущего"}</h1>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="host@example.com"
            required
          />
        </label>
        <label>
          Пароль
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Минимум 6 символов"
            required
          />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="btn btn-primary btn-lg" disabled={busy}>
          {busy ? "..." : isRegister ? "Создать аккаунт" : "Войти"}
        </button>
        <p className="muted">
          {isRegister ? "Уже есть аккаунт? " : "Нет аккаунта? "}
          <Link to={isRegister ? "/login" : "/register"}>
            {isRegister ? "Войти" : "Зарегистрироваться"}
          </Link>
        </p>
      </form>
    </div>
  );
}
