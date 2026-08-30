import React from "react";

// Фирменный знак: молния в скруглённом квадрате (как на favicon) + словесная часть.
// children позволяет подставить название игры вместо «EventMaster» (экран ведущего).
export default function Logo({ children = "EventMaster" }) {
  return (
    <span className="logo">
      <svg className="logo-mark" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <rect width="64" height="64" rx="14" fill="#46178f" />
        <path d="M35 7 L15 36 h11 L27 57 L49 26 H36 Z" fill="#fff" />
      </svg>
      {children}
    </span>
  );
}
