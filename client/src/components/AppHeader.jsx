import React from "react";
import { Link } from "react-router-dom";
import Logo from "./Logo";
import ThemeToggle from "./ThemeToggle";

// Единая шапка внутренних страниц: логотип всегда первый слева, справа — только тема.
// Выход и данные пользователя живут в кабинете (сайдбар и «Личные данные»),
// служебные ссылки («назад» и пр.) — в .subnav под шапкой, не рядом с лого,
// иначе при переходах лого прыгает.
export default function AppHeader() {
  return (
    <header className="page-header">
      <Link to="/" className="logo-link">
        <Logo />
      </Link>
      <div className="spacer" />
      <ThemeToggle />
    </header>
  );
}
