import React, { useState } from "react";

// цвет мета theme-color должен совпадать с фоном страницы, иначе краска браузера не совпадает с UI
const THEME_COLORS = { dark: "#0b1120", light: "#ffffff" };

function applyThemeColor(theme) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLORS[theme]);
}

// Переключатель тёмной/светлой темы: пишет data-theme на <html> и в localStorage.
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
  return (
    <button
      type="button"
      className="btn btn-outline theme-toggle"
      onClick={toggle}
      aria-label={theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"}
      title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
    >
      {theme === "dark" ? "☀" : "🌙"}
    </button>
  );
}
