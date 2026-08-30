import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import Logo from "../components/Logo";
import { QuizIcon, PollIcon } from "../components/icons";

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [quizzes, setQuizzes] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState("quiz");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    api("/quizzes", { token: localStorage.getItem("token") })
      .then((d) => setQuizzes(d.quizzes))
      .catch(() => setQuizzes([]));
  };
  useEffect(load, []);

  const create = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const d = await api("/quizzes", {
        method: "POST",
        token: localStorage.getItem("token"),
        body: { title, type, questions: [] },
      });
      navigate(`/quiz/${d.quiz.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const remove = async (id) => {
    if (!confirm("Удалить безвозвратно?")) return;
    await api(`/quizzes/${id}`, { method: "DELETE", token: localStorage.getItem("token") });
    load();
  };

  return (
    <div className="page">
      <header className="page-header">
        <Link to="/" className="logo-link">
          <Logo />
        </Link>
        <div className="spacer" />
        <span className="muted">{user?.email}</span>
        <button className="btn btn-outline" onClick={signOut}>
          Выйти
        </button>
      </header>

      <div className="page-body">
        <div className="dashboard-head">
          <h1>Мои игры</h1>
          <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Отмена" : "+ Создать"}
          </button>
        </div>

        {showForm && (
          <form className="card create-form" onSubmit={create}>
            <label>
              Название
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Например: Квиз про кино"
                required
              />
            </label>
            <div className="type-choice">
              <label className={`type-option ${type === "quiz" ? "selected" : ""}`}>
                <input type="radio" name="type" checked={type === "quiz"} onChange={() => setType("quiz")} />
                <b><QuizIcon className="inline-icon" /> Викторина</b>
                <span>Вопросы с правильными ответами и очками</span>
              </label>
              <label className={`type-option ${type === "poll" ? "selected" : ""}`}>
                <input type="radio" name="type" checked={type === "poll"} onChange={() => setType("poll")} />
                <b><PollIcon className="inline-icon" /> Голосование</b>
                <span>Живой опрос зала без правильных ответов</span>
              </label>
            </div>
            {error && <div className="error">{error}</div>}
            <button className="btn btn-primary" disabled={busy}>
              {busy ? "..." : "Создать и добавить вопросы"}
            </button>
          </form>
        )}

        {quizzes === null ? (
          <p className="muted">Загрузка…</p>
        ) : quizzes.length === 0 ? (
          <p className="muted">Пока пусто. Создайте первую викторину или голосование!</p>
        ) : (
          <div className="quiz-list">
            {quizzes.map((q) => (
              <div className="card quiz-card" key={q.id}>
                <div>
                  <h3>{q.title}</h3>
                  <p className="muted">
                    {q.type === "quiz" ? <QuizIcon className="inline-icon" /> : <PollIcon className="inline-icon" />}{" "}
                    {q.type === "quiz" ? "Викторина" : "Голосование"} · вопросов: {q.question_count}
                  </p>
                </div>
                <div className="quiz-card-actions">
                  {q.question_count > 0 && (
                    <Link className="btn btn-primary" to={`/host/${q.id}`}>
                      Запустить
                    </Link>
                  )}
                  <Link className="btn btn-outline" to={`/quiz/${q.id}`}>
                    Редактировать
                  </Link>
                  <button className="btn btn-danger" onClick={() => remove(q.id)}>
                    Удалить
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
