import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import ConfirmDialog from "../components/ConfirmDialog";
import { useToast } from "../components/Toast";
import { QuizIcon, PollIcon } from "../components/icons";
import { plural } from "../plural";

// 3 карточки-заглушки на время загрузки списка
function QuizListSkeleton() {
  return (
    <div className="quiz-list">
      {[0, 1, 2].map((i) => (
        <div className="card quiz-card" key={i}>
          <div className="skeleton-stack">
            <div className="skeleton" style={{ width: "45%" }} />
            <div className="skeleton" style={{ width: "70%" }} />
          </div>
          <div className="skeleton skeleton-btn" />
        </div>
      ))}
    </div>
  );
}

// кеш между монтированиями вкладки, привязан к userId (после выхода чужой список не показать):
// повторный заход показывает список сразу, свежие данные тихо догружаются в фоне
let quizzesCache = null; // { userId, data }

// Раздел «Мероприятия»: список квизов/опросов + создание
export default function GamesSection() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const showToast = useToast();
  const cached = quizzesCache && quizzesCache.userId === user?.id ? quizzesCache.data : null;
  const [quizzes, setQuizzes] = useState(cached);
  const [showForm, setShowForm] = useState(false);
  const [confirmId, setConfirmId] = useState(null);
  const [title, setTitle] = useState("");
  const [type, setType] = useState("quiz");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    api("/quizzes", { token: localStorage.getItem("token") })
      .then((d) => {
        quizzesCache = { userId: user?.id, data: d.quizzes };
        setQuizzes(d.quizzes);
      })
      .catch((e) => {
        if (cached === null) setQuizzes([]);
        showToast(`Не удалось загрузить квизы: ${e.message}`, "error");
      });
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
    setConfirmId(null);
    try {
      await api(`/quizzes/${id}`, { method: "DELETE", token: localStorage.getItem("token") });
      showToast("Квиз удалён", "ok");
    } catch (e) {
      showToast(`Не удалось удалить: ${e.message}`, "error");
    }
    load();
  };

  return (
    <>
      <div className="dashboard-head">
        <h1>Мои мероприятия</h1>
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
        <QuizListSkeleton />
      ) : quizzes.length === 0 ? (
        <div className="empty-state">
          <QuizIcon />
          <h3>Здесь пока пусто</h3>
          <p>Создайте первую викторину или голосование — это пара минут. Гости подключатся по QR-коду или PIN.</p>
          {!showForm && (
            <button className="btn btn-primary btn-lg" onClick={() => setShowForm(true)}>
              + Создать игру
            </button>
          )}
        </div>
      ) : (
        <div className="quiz-list">
          {quizzes.map((q) => (
            <div className="card quiz-card" key={q.id}>
              <div>
                <h3>{q.title}</h3>
                <p className="muted">
                  {q.type === "quiz" ? <QuizIcon className="inline-icon" /> : <PollIcon className="inline-icon" />}{" "}
                  {q.type === "quiz" ? "Викторина" : "Голосование"} · {q.question_count}{" "}
                  {plural(q.question_count, ["вопрос", "вопроса", "вопросов"])}
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
                <button className="btn btn-danger" onClick={() => setConfirmId(q.id)}>
                  Удалить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmId != null && (
        <ConfirmDialog
          title="Удалить квиз?"
          text="Квиз будет удалён безвозвратно, вместе со всеми вопросами."
          onConfirm={() => remove(confirmId)}
          onCancel={() => setConfirmId(null)}
        />
      )}
    </>
  );
}
