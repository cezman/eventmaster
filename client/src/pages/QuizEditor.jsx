import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { TIME_OPTIONS } from "../customize";
import Dropdown from "../components/Dropdown";

const ANSWER_COLORS = ["🔴", "🔵", "🟡", "🟢"];

function emptyQuestion() {
  return {
    text: "",
    time_limit: 20,
    points: 1,
    answers: [
      { text: "", is_correct: true },
      { text: "", is_correct: false },
    ],
  };
}

export default function QuizEditor() {
  const { id } = useParams();
  const [quiz, setQuiz] = useState(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api(`/quizzes/${id}`, { token: localStorage.getItem("token") })
      .then((d) => setQuiz(d.quiz))
      .catch((e) => setError(e.message));
  }, [id]);

  if (error) return <div className="page"><p className="error">{error}</p><Link to="/dashboard">Назад</Link></div>;
  if (!quiz) return <div className="page"><p className="muted">Загрузка…</p></div>;

  const patchQuestion = (qi, patch) => {
    setQuiz((cur) => {
      const questions = cur.questions.map((q, i) => (i === qi ? { ...q, ...patch } : q));
      return { ...cur, questions };
    });
    setSaved(false);
  };

  const addQuestion = () => {
    setQuiz((cur) => ({ ...cur, questions: [...cur.questions, emptyQuestion()] }));
    setSaved(false);
  };

  const removeQuestion = (qi) => {
    setQuiz((cur) => ({ ...cur, questions: cur.questions.filter((_, i) => i !== qi) }));
    setSaved(false);
  };

  const patchAnswer = (qi, ai, patch) => {
    patchQuestion(qi, {
      answers: quiz.questions[qi].answers.map((a, i) => (i === ai ? { ...a, ...patch } : a)),
    });
  };

  const addAnswer = (qi) => {
    if (quiz.questions[qi].answers.length >= 4) return;
    patchQuestion(qi, { answers: [...quiz.questions[qi].answers, { text: "", is_correct: false }] });
  };

  const removeAnswer = (qi, ai) => {
    if (quiz.questions[qi].answers.length <= 2) return;
    patchQuestion(qi, { answers: quiz.questions[qi].answers.filter((_, i) => i !== ai) });
  };

  const setCorrect = (qi, ai) => {
    patchQuestion(qi, {
      answers: quiz.questions[qi].answers.map((a, i) => ({ ...a, is_correct: i === ai })),
    });
  };

  const save = async () => {
    setError("");
    setBusy(true);
    try {
      const d = await api(`/quizzes/${id}`, {
        method: "PUT",
        token: localStorage.getItem("token"),
        body: { title: quiz.title, questions: quiz.questions },
      });
      setQuiz(d.quiz);
      setSaved(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <Link to="/dashboard" className="btn btn-outline">
          ← К списку
        </Link>
        <span className="badge">{quiz.type === "quiz" ? "🧠 Викторина" : "🗳️ Голосование"}</span>
      </header>

      <div className="page-body editor">
        <label className="title-label">
          Название
          <input
            value={quiz.title}
            onChange={(e) => {
              setQuiz({ ...quiz, title: e.target.value });
              setSaved(false);
            }}
          />
        </label>

        {quiz.questions.length === 0 && (
          <p className="muted">
            {quiz.type === "quiz"
              ? "Добавьте первый вопрос: текст и 2–4 варианта ответа, один из них правильный."
              : "Добавьте первый вопрос: текст и 2–4 варианта для голосования."}
          </p>
        )}

        {quiz.questions.map((q, qi) => (
          <div className="card question-card" key={qi}>
            <div className="question-head">
              <b>Вопрос {qi + 1}</b>
              <div className="question-settings">
                <label className="time-label">
                  ⏱ Время:
                  <Dropdown
                    value={String(q.time_limit || 20)}
                    onChange={(v) => patchQuestion(qi, { time_limit: Number(v) })}
                    options={TIME_OPTIONS.map((t) => [String(t), `${t} сек`])}
                  />
                </label>
                <label className="time-label">
                  🏆 Очки:
                  <input
                    type="number"
                    className="points-input"
                    min={1}
                    step={1}
                    value={q.points ?? 1}
                    onChange={(e) => patchQuestion(qi, { points: Math.round(Number(e.target.value)) || 1 })}
                  />
                </label>
                <button className="btn btn-danger btn-sm" onClick={() => removeQuestion(qi)}>
                  Удалить вопрос
                </button>
              </div>
            </div>
            <input
              className="question-text"
              placeholder="Текст вопроса"
              value={q.text}
              onChange={(e) => patchQuestion(qi, { text: e.target.value })}
            />
            <div className="answers-grid">
              {q.answers.map((a, ai) => (
                <div className={`answer-edit c${ai}`} key={ai}>
                  <span className="answer-dot">{ANSWER_COLORS[ai]}</span>
                  <input
                    placeholder={`Вариант ${ai + 1}`}
                    value={a.text}
                    onChange={(e) => patchAnswer(qi, ai, { text: e.target.value })}
                  />
                  {quiz.type === "quiz" && (
                    <label className="correct-check" title="Правильный ответ">
                      <input type="radio" name={`correct-${qi}`} checked={!!a.is_correct} onChange={() => setCorrect(qi, ai)} />
                      ✓
                    </label>
                  )}
                  {q.answers.length > 2 && (
                    <button className="answer-remove" title="Убрать вариант" onClick={() => removeAnswer(qi, ai)}>
                      ×
                    </button>
                  )}
                </div>
              ))}
              {q.answers.length < 4 && (
                <button className="btn btn-outline add-answer" onClick={() => addAnswer(qi)}>
                  + Вариант
                </button>
              )}
            </div>
          </div>
        ))}

        <div className="editor-actions">
          <button className="btn btn-outline btn-lg" onClick={addQuestion}>
            + Вопрос
          </button>
          <button className="btn btn-primary btn-lg" onClick={save} disabled={busy}>
            {busy ? "Сохраняю…" : "Сохранить"}
          </button>
          {saved && <span className="ok">Сохранено ✓</span>}
          {error && <span className="error">{error}</span>}
        </div>

        {quiz.questions.length > 0 && (
          <Link className="btn btn-primary btn-lg launch" to={`/host/${quiz.id}`}>
            ▶ Запустить игру
          </Link>
        )}
      </div>
    </div>
  );
}
