import React from "react";

// Переключатель тёмной/светлой темы: пишет data-theme на <html> и в localStorage.
export default function ThemeToggle() {
  const theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("theme", next);
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
