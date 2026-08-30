import React, { useState } from "react";
import { MoonIcon, SunIcon } from "./icons";

// цвет мета theme-color должен совпадать с фоном страницы, иначе краска браузера не совпадает с UI
const THEME_COLORS = { dark: "#0b1120", light: "#ffffff" };

function applyThemeColor(theme) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLORS[theme]);
}

// Переключатель тёмной/светлой темы: пишет data-theme на <html> и в localStorage.
// Иконки — SVG одного размера: эмодзи ☀/🌙 рендерятся разными кеглями и «прыгают».
export default function ThemeToggle() {
  const [theme, setTheme] = useState(() => {
    const current = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    applyThemeColor(current);
    return current;
  });
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("theme", next);
    applyThemeColor(next);
    setTheme(next);
  };
  const dark = theme === "dark";
  return (
    <button
      type="button"
      className="btn btn-outline theme-toggle"
      onClick={toggle}
      aria-label={dark ? "Включить светлую тему" : "Включить тёмную тему"}
      title={dark ? "Светлая тема" : "Тёмная тема"}
    >
      {dark ? <SunIcon className="theme-icon" /> : <MoonIcon className="theme-icon" />}
    </button>
  );
}
