import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { useToast } from "../components/Toast";
import ConfirmDialog from "../components/ConfirmDialog";
import Logo from "../components/Logo";
import ThemeToggle from "../components/ThemeToggle";

export default function AdminPage() {
  const { user, token } = useAuth();
  const showToast = useToast();
  const [users, setUsers] = useState(null);
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState({ email: "", name: "", surname: "" });
  const [deleteId, setDeleteId] = useState(null);

  const load = () => {
    api("/admin/users", { token })
      .then((d) => setUsers(d.users))
      .catch((e) => {
        setUsers([]);
        showToast(`Не удалось загрузить пользователей: ${e.message}`, "error");
      });
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveUser = async (id) => {
    try {
      await api(`/admin/users/${id}`, { method: "PUT", token, body: editForm });
      setEditId(null);
      showToast("Сохранено", "ok");
      load();
    } catch (e) {
      showToast(`Не сохранено: ${e.message}`, "error");
    }
  };

  const resetPassword = async (id) => {
    try {
      const d = await api(`/admin/users/${id}/password`, { method: "PUT", token });
      showToast(`Новый пароль: ${d.password} (покажется один раз)`, "ok");
    } catch (e) {
      showToast(`Не удалось: ${e.message}`, "error");
    }
  };

  const setStatus = async (id, status) => {
    try {
      await api(`/admin/users/${id}/status`, { method: "PUT", token, body: { status } });
      showToast(status === "blocked" ? "Заблокирован" : "Разблокирован", "ok");
      load();
    } catch (e) {
      showToast(`Не удалось: ${e.message}`, "error");
    }
  };

  const deleteUser = async (id) => {
    setDeleteId(null);
    try {
      await api(`/admin/users/${id}`, { method: "DELETE", token });
      showToast("Пользователь удалён", "ok");
      load();
    } catch (e) {
      showToast(`Не удалось: ${e.message}`, "error");
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <Link to="/dashboard" className="btn btn-outline">
          ← В кабинет
        </Link>
        <Link to="/" className="logo-link">
          <Logo />
        </Link>
        <div className="spacer" />
        <ThemeToggle />
      </header>

      <div className="page-body">
        <div className="dashboard-head">
          <h1>Админка · Пользователи</h1>
        </div>

        {/* user ещё грузится (/me) — ждём, иначе на своей строке мигнут чужие кнопки */}
        {users === null || !user ? (
          <div className="quiz-list">
            {[0, 1, 2].map((i) => (
              <div className="card quiz-card" key={i}>
                <div className="skeleton-stack">
                  <div className="skeleton" style={{ width: "45%" }} />
                  <div className="skeleton" style={{ width: "25%" }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="quiz-list">
            {users.map((u) => (
              <div className="card quiz-card" key={u.id}>
                {editId === u.id ? (
                  <div className="admin-edit">
                    <input
                      value={editForm.email}
                      onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                      placeholder="email"
                      aria-label="Email"
                    />
                    <input
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      placeholder="Имя"
                      aria-label="Имя"
                    />
                    <input
                      value={editForm.surname}
                      onChange={(e) => setEditForm({ ...editForm, surname: e.target.value })}
                      placeholder="Фамилия"
                      aria-label="Фамилия"
                    />
                  </div>
                ) : (
                  <div>
                    <h3>
                      {u.email}{" "}
                      {u.role === "admin" && <span className="badge">Админ</span>}
                      {u.status === "blocked" && <span className="badge badge-muted">Заблокирован</span>}
                    </h3>
                    <p className="muted">
                      {[u.name, u.surname].filter(Boolean).join(" ") || "без имени"} · квизов: {u.quiz_count} ·
                      с {new Date(String(u.created_at).replace(" ", "T") + "Z").toLocaleDateString("ru-RU")}
                    </p>
                  </div>
                )}
                <div className="quiz-card-actions">
                  {editId === u.id ? (
                    <>
                      <button className="btn btn-primary btn-sm" onClick={() => saveUser(u.id)}>
                        Сохранить
                      </button>
                      <button className="btn btn-outline btn-sm" onClick={() => setEditId(null)}>
                        Отмена
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={() => {
                          setEditId(u.id);
                          setEditForm({ email: u.email, name: u.name || "", surname: u.surname || "" });
                        }}
                      >
                        Изменить
                      </button>
                      <button className="btn btn-outline btn-sm" onClick={() => resetPassword(u.id)}>
                        Сбросить пароль
                      </button>
                      {u.id !== user?.id &&
                        (u.status === "blocked" ? (
                          <button className="btn btn-outline btn-sm" onClick={() => setStatus(u.id, "active")}>
                            Разблокировать
                          </button>
                        ) : (
                          <button className="btn btn-outline btn-sm" onClick={() => setStatus(u.id, "blocked")}>
                            Заблокировать
                          </button>
                        ))}
                      {u.id !== user?.id && (
                        <button className="btn btn-danger btn-sm" onClick={() => setDeleteId(u.id)}>
                          Удалить
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="muted small">
          Назначить администратора можно только вручную на сервере:
          <code> UPDATE users SET role='admin' WHERE email='...'</code>
        </p>
      </div>

      {deleteId != null && (
        <ConfirmDialog
          title="Удалить пользователя?"
          text="Аккаунт будет удалён безвозвратно вместе со всеми его квизами и результатами игр."
          onConfirm={() => deleteUser(deleteId)}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </div>
  );
}
