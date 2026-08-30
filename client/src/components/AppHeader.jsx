import React from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import Logo from "./Logo";
import ThemeToggle from "./ThemeToggle";

// Единая шапка внутренних страниц: логотип всегда первый слева,
// служебные ссылки («назад» и пр.) — в .subnav под шапкой, не рядом с лого,
// иначе при переходах лого прыгает. Справа — тема, имя пользователя, выход.
export default function AppHeader() {
  const { user, signOut } = useAuth();
  const displayName = [user?.name, user?.surname].filter(Boolean).join(" ");
  return (
    <header className="page-header">
      <Link to="/" className="logo-link">
        <Logo />
      </Link>
      <div className="spacer" />
      <ThemeToggle />
      <span className="cabinet-user">
        <b>{displayName || user?.email}</b>
        {displayName && <span className="muted">{user?.email}</span>}
      </span>
      <button className="btn btn-outline" onClick={signOut}>
        Выйти
      </button>
    </header>
  );
}
