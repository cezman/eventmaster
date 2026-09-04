import React, { useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { useToast } from "../components/Toast";

// Раздел «Смена пароля» — отдельный пункт меню, чтобы безопасность не мешалась с профилем
export default function PasswordSection() {
  const { token } = useAuth();
  const showToast = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passBusy, setPassBusy] = useState(false);

  const savePassword = async (e) => {
    e.preventDefault();
    setPassBusy(true);
    try {
      await api("/auth/password", {
        method: "PUT",
        token,
        body: { currentPassword, newPassword },
      });
      setCurrentPassword("");
      setNewPassword("");
      showToast("Пароль изменён", "ok");
    } catch (err) {
      showToast(`Не изменено: ${err.message}`, "error");
    } finally {
      setPassBusy(false);
    }
  };

  return (
    <>
      <div className="dashboard-head">
        <h2>Смена пароля</h2>
      </div>
      <form className="card auth-card cabinet-card" onSubmit={savePassword}>
        <label>
          Текущий пароль
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
        </label>
        <label>
          Новый пароль
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Минимум 6 символов"
            minLength={6}
            required
          />
        </label>
        <button className="btn btn-primary" disabled={passBusy}>
          {passBusy ? "Меняю…" : "Изменить пароль"}
        </button>
      </form>
    </>
  );
}
