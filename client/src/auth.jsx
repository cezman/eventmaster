import React, { createContext, useContext, useEffect, useState } from "react";
import { api } from "./api";

const AuthContext = createContext(null);

// Пользователь кешируется в localStorage, чтобы при рефреше шапка сразу
// рендерила «Кабинет» без промаргивания кнопок «Вход/Регистрация».
// /auth/me в фоне подтверждает токен: обновляет данные или разлогинивает.
function cachedUser() {
  try {
    const raw = localStorage.getItem("user");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    localStorage.removeItem("user"); // битый JSON — не оставляем мусор
    return null;
  }
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem("token"));
  const [user, setUser] = useState(cachedUser);

  useEffect(() => {
    if (!token) {
      setUser(null);
      localStorage.removeItem("user");
      return;
    }
    api("/auth/me", { token })
      .then((d) => {
        setUser(d.user);
        localStorage.setItem("user", JSON.stringify(d.user));
      })
      .catch(() => {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        setToken(null);
        setUser(null);
      });
  }, [token]);

  const signIn = (t, u) => {
    localStorage.setItem("token", t);
    if (u) localStorage.setItem("user", JSON.stringify(u));
    setToken(t);
    setUser(u);
  };

  // после сохранения профиля — обновляем пользователя на месте, без перелогина
  const updateUser = (u) => {
    localStorage.setItem("user", JSON.stringify(u));
    setUser(u);
  };

  const signOut = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setToken(null);
    setUser(null);
  };

  return <AuthContext.Provider value={{ token, user, signIn, signOut, updateUser }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
