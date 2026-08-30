import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import Logo from "../components/Logo";

export default function AuthPage({ mode }) {
  const isRegister = mode === "register";
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [surname, setSurname] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const body = isRegister ? { email, password, name, surname } : { email, password };
      const data = await api(`/auth/${isRegister ? "register" : "login"}`, {
        method: "POST",
        body,
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
      <Link to="/" className="logo-link">
        <Logo />
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
        {isRegister && (
          <div className="picker-row">
            <label>
              Имя
              <input maxLength={30} value={name} onChange={(e) => setName(e.target.value)} placeholder="Анна" />
            </label>
            <label>
              Фамилия
              <input maxLength={30} value={surname} onChange={(e) => setSurname(e.target.value)} placeholder="Петрова" />
            </label>
          </div>
        )}
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
