import { useEffect, useRef, useState } from "react";

// стилизованный дропдаун: нативный <select> не позволяет оформить список
// options — массив пар [значение, подпись]
export default function Dropdown({ value, onChange, options }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = options.find(([v]) => v === value) || options[0];

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={`dd ${open ? "open" : ""}`} ref={ref}>
      <button type="button" className="dd-toggle" onClick={() => setOpen((o) => !o)}>
        <span className="dd-label">{current?.[1]}</span>
        <span className="dd-arrow">▾</span>
      </button>
      {open && (
        <div className="dd-menu" role="listbox">
          {options.map(([v, l]) => (
            <button
              type="button"
              key={v}
              role="option"
              aria-selected={v === value}
              className={`dd-item ${v === value ? "selected" : ""}`}
              onClick={() => {
                onChange(v);
                setOpen(false);
              }}
            >
              {l}
              {v === value && <span className="dd-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
