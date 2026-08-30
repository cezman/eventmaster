import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { useToast } from "../components/Toast";
import Logo from "../components/Logo";
import ThemeToggle from "../components/ThemeToggle";
import PlayerAvatar, { parseAvatar } from "../components/PlayerAvatar";
import { AVATAR_PRESETS, randomAvatarProps } from "../customize";

export default function ProfilePage() {
  const { user, token, updateUser } = useAuth();
  const showToast = useToast();
  const [name, setName] = useState("");
  const [surname, setSurname] = useState("");
  const [avatar, setAvatar] = useState(AVATAR_PRESETS[0].props);
  const [busy, setBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passBusy, setPassBusy] = useState(false);
  // user приходит асинхронно (/me) — заполняем форму, когда он загрузился
  const [loadedId, setLoadedId] = useState(null);
  useEffect(() => {
    if (user && user.id !== loadedId) {
      setName(user.name || "");
      setSurname(user.surname || "");
      setAvatar(parseAvatar(user.avatar) || AVATAR_PRESETS[0].props);
      setLoadedId(user.id);
    }
  }, [user, loadedId]);

  if (!user) {
    return (
      <div className="page page-body">
        <div className="card">
          <div className="skeleton-stack">
            <div className="skeleton" style={{ width: "40%" }} />
            <div className="skeleton" style={{ width: "80%" }} />
            <div className="skeleton" style={{ width: "60%" }} />
          </div>
        </div>
      </div>
    );
  }

  const saveProfile = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const d = await api("/auth/profile", {
        method: "PUT",
        token,
        body: { name, surname, avatar: JSON.stringify(avatar) },
      });
      updateUser(d.user);
      showToast("Профиль сохранён", "ok");
    } catch (err) {
      showToast(`Не сохранено: ${err.message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const savePassword = async (e) => {
    e.preventDefault();
    setPassBusy(true);
    try {
      await api("/auth/password", {
        method: "PUT",
        token,
        body: { currentPassword, newPassword },
      });
      setCurrentPassword("");
      setNewPassword("");
      showToast("Пароль изменён", "ok");
    } catch (err) {
      showToast(`Не изменено: ${err.message}`, "error");
    } finally {
      setPassBusy(false);
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <Link to="/dashboard" className="btn btn-outline">
          ← В кабинет
        </Link>
        <Link to="/" className="logo-link">
          <Logo />
        </Link>
        <div className="spacer" />
        <ThemeToggle />
      </header>

      <div className="page-body profile-body">
        <form className="card auth-card" onSubmit={saveProfile}>
          <h2>Профиль ведущего</h2>
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
          <div className="customize">
            <div className="avatar-preview-row">
              <div className="avatar-preview">
                <PlayerAvatar avatar={JSON.stringify(avatar)} size={110} />
              </div>
              <div className="preset-grid">
                {AVATAR_PRESETS.map((p) => (
                  <button
                    type="button"
                    key={p.label}
                    title={p.label}
                    aria-label={`Пресет аватара: ${p.label}`}
                    aria-pressed={JSON.stringify(avatar) === JSON.stringify(p.props)}
                    className={`preset-choice ${JSON.stringify(avatar) === JSON.stringify(p.props) ? "selected" : ""}`}
                    onClick={() => setAvatar(p.props)}
                  >
                    <PlayerAvatar avatar={JSON.stringify(p.props)} size={44} />
                  </button>
                ))}
              </div>
            </div>
            <button type="button" className="btn btn-outline" onClick={() => setAvatar(randomAvatarProps())}>
              🎲 Случайный аватар
            </button>
          </div>
          <p className="muted small">Имя и аватар увидят игроки в лобби: «Ведущий: {name || surname || "…"}»</p>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? "Сохраняю…" : "Сохранить профиль"}
          </button>
        </form>

        <form className="card auth-card" onSubmit={savePassword}>
          <h2>Смена пароля</h2>
          <label>
            Текущий пароль
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </label>
          <label>
            Новый пароль
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Минимум 6 символов"
              minLength={6}
              required
            />
          </label>
          <button className="btn btn-primary" disabled={passBusy}>
            {passBusy ? "Меняю…" : "Изменить пароль"}
          </button>
        </form>

        <p className="muted">Аккаунт: {user.email}</p>
      </div>
    </div>
  );
}
