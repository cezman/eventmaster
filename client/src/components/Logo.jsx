import React from "react";

// Фирменный знак: молния в скруглённом квадрате (как на favicon) + словесная часть.
// children позволяет подставить название игры вместо «EventMaster» (экран ведущего).
export default function Logo({ children = "EventMaster" }) {
  return (
    <span className="logo">
      <svg className="logo-mark" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <defs><linearGradient id="logo-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#2e6bff"/><stop offset="1" stopColor="#1d3fb8"/></linearGradient></defs>
        <rect width="64" height="64" rx="14" fill="url(#logo-bg)" />
        <path d="M35 7 L15 36 h11 L27 57 L49 26 H36 Z" fill="#fff" />
      </svg>
      {/* текст в отдельном span — чтобы шапка пульта могла зажать название в 2 строки */}
      <span className="logo-text">{children}</span>
    </span>
  );
}
