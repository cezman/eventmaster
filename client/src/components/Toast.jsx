import React, { createContext, useCallback, useContext, useRef, useState } from "react";

// Минимальная система тостов: useToast() → showToast(текст, "ok" | "error" | "info").
// Живёт поверх всего интерфейса, исчезает сам через 4 секунды.
const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const showToast = useCallback((message, type = "info") => {
    const id = ++idRef.current;
    setToasts((cur) => [...cur, { id, message, type }]);
    setTimeout(() => setToasts((cur) => cur.filter((t) => t.id !== id)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`} role="status">
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
