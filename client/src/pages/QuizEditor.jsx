import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { TIME_OPTIONS } from "../customize";
import Dropdown from "../components/Dropdown";
import AppHeader from "../components/AppHeader";
import ConfirmDialog from "../components/ConfirmDialog";
import QuestionPreviewModal from "../components/QuestionPreviewModal";
import { useToast } from "../components/Toast";
import { QuizIcon, PollIcon, ClockIcon, TrophyIcon } from "../components/icons";

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
  const navigate = useNavigate();
  const showToast = useToast();
  const [quiz, setQuiz] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false); // идёт запрос сохранения
  const [leaveTarget, setLeaveTarget] = useState(null); // путь, с которого спросили подтверждение
  const [showErrors, setShowErrors] = useState(false); // подсветка проблем включается первой попыткой запуска
  const [deleteTarget, setDeleteTarget] = useState(null); // индекс вопроса в диалоге удаления (EM-29)
  const [previewIdx, setPreviewIdx] = useState(null); // индекс вопроса в модалке предпросмотра (EM-31)

  // ref-копии для сохранения без устаревших замыканий (автосейв, beforeunload)
  const quizRef = useRef(null);
  const savedRef = useRef(null); // сериализованная последняя сохранённая версия
  const timerRef = useRef(null);
  const savingRef = useRef(false);
  const savingPromiseRef = useRef(null); // текущий in-flight запрос — его await-ят launch/confirmLeave
  const rerunRef = useRef(false); // изменение пришло, пока шёл запрос
  const rerunSilentRef = useRef(false);

  const serialize = (q) => JSON.stringify({ title: q.title, questions: q.questions, settings: q.settings });
  const isDirty = () => !!quizRef.current && serialize(quizRef.current) !== savedRef.current;

  useEffect(() => {
    api(`/quizzes/${id}`, { token: localStorage.getItem("token") })
      .then((d) => {
        quizRef.current = d.quiz;
        savedRef.current = serialize(d.quiz);
        setQuiz(d.quiz);
        // старые квизы могут не проходить валидацию (EM-28) — показываем проблемы сразу
        setShowErrors(validateQuiz(d.quiz).length > 0);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  // ref идёт в ногу с состоянием — сохранение и beforeunload видят последние правки
  useEffect(() => {
    if (quiz) quizRef.current = quiz;
  }, [quiz]);

  // предупреждение браузера при закрытии/обновлении вкладки с несохранённым
  useEffect(() => {
    const onUnload = (e) => {
      if (isDirty()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // EM-28: валидация перед запуском — текст, ≥2 варианта, верный ответ у квизов
  const validateQuiz = (qz) => {
    const problems = [];
    qz.questions.forEach((q, qi) => {
      if (!q.text || !q.text.trim()) return problems.push({ qi, reason: "заполните текст вопроса" });
      const filled = q.answers.filter((a) => a.text && a.text.trim());
      if (filled.length < 2) return problems.push({ qi, reason: "нужно минимум 2 варианта ответа" });
      if (qz.type === "quiz" && q.mode !== "tf" && !filled.some((a) => a.is_correct)) {
        problems.push({ qi, reason: "отметьте верный ответ" });
      }
    });
    return problems;
  };
  const problems = showErrors && quiz ? validateQuiz(quiz) : [];

  // скролл к первой битой карточке — после ре-рендера, когда класс уже в DOM;
  // без behavior:"smooth" — при prefers-reduced-motion анимация скролла подавляется
  useEffect(() => {
    if (showErrors) {
      document.querySelector(".question-invalid")?.scrollIntoView({ block: "center" });
    }
  }, [showErrors]);

  // сохраняет сейчас; если запрос уже идёт — возвращает его промис (дождётся и отложенный прогон).
  // silent: автосейв не тостит об ошибке — о ней говорит индикатор «Несохранённые изменения»
  const saveNow = (silent = false) => {
    if (savingRef.current) {
      rerunRef.current = true;
      rerunSilentRef.current = silent;
      return savingPromiseRef.current;
    }
    if (!isDirty()) return Promise.resolve(); // таймер сработал впустую (правки откатились/уже сохранено)
    savingRef.current = true;
    clearTimeout(timerRef.current);
    setBusy(true);
    // снимок на момент запроса: если пользователь печатает во время сохранения,
    // локальные правки не перетираются ответом сервера
    const payload = { title: quizRef.current.title, questions: quizRef.current.questions, settings: quizRef.current.settings };
    const attempted = serialize(payload);
    const p = (async () => {
      try {
        const d = await api(`/quizzes/${id}`, {
          method: "PUT",
          token: localStorage.getItem("token"),
          body: payload,
        });
        // эталон — нормализованный сервером ответ: иначе trim/clamp сервера
        // вечно расходятся с локальным снимком и статус не доходит до «Сохранено»
        const editedWhileSaving = serialize(quizRef.current) !== attempted;
        savedRef.current = serialize(d.quiz);
        if (!editedWhileSaving) setQuiz(d.quiz);
      } catch (e) {
        if (!silent) showToast(`Не сохранено: ${e.message}`, "error");
      } finally {
        savingRef.current = false;
        savingPromiseRef.current = null;
        setBusy(false);
        if (rerunRef.current) {
          rerunRef.current = false;
          await saveNow(rerunSilentRef.current); // внутри p — вызывающий дождёт и отложенный прогон
        } else if (serialize(quizRef.current) !== attempted) {
          scheduleSave(); // правки во время запроса — сохраняем следом по таймеру
        }
        // при провале тот же payload не ретраим по кругу: ждём новых правок (markDirty)
      }
    })();
    savingPromiseRef.current = p;
    return p;
  };

  const scheduleSave = () => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => saveNow(true), 5000);
  };

  // каждое изменение контента откладывает автосейв на 5 с (грязность проверится при срабатывании)
  const markDirty = scheduleSave;

  // переход по внутренним ссылкам: сначала диалог про несохранённые изменения
  const tryLeave = (path) => (e) => {
    if (e) e.preventDefault();
    if (isDirty()) setLeaveTarget(path);
    else navigate(path);
  };

  const confirmLeave = async () => {
    const target = leaveTarget;
    setLeaveTarget(null);
    await saveNow();
    // ушли только если изменения ушли на сервер; при ошибке остаёмся с тостом
    if (!isDirty()) navigate(target);
  };

  // шапка общая для всех состояний — лого не мигает, пока данные грузятся
  if (error)
    return (
      <div className="page">
        <AppHeader />
        <p className="error">{error}</p>
        <Link to="/dashboard">Назад</Link>
      </div>
    );
  if (!quiz) {
    return (
      <div className="page">
        <AppHeader />
        <div className="page-body">
          <div className="card">
            <div className="skeleton-stack">
              <div className="skeleton" style={{ width: "35%" }} />
              <div className="skeleton" style={{ width: "80%" }} />
              <div className="skeleton" style={{ width: "80%" }} />
              <div className="skeleton" style={{ width: "60%" }} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const patchQuestion = (qi, patch) => {
    markDirty();
    setQuiz((cur) => {
      const questions = cur.questions.map((q, i) => (i === qi ? { ...q, ...patch } : q));
      return { ...cur, questions };
    });
  };

  const addQuestion = () => {
    markDirty();
    setQuiz((cur) => ({ ...cur, questions: [...cur.questions, emptyQuestion()] }));
  };

  const removeQuestion = (qi) => {
    markDirty();
    setQuiz((cur) => ({ ...cur, questions: cur.questions.filter((_, i) => i !== qi) }));
  };

  // EM-29: перестановка вопроса и дублирование — работают с массивом questions
  const moveQuestion = (qi, dir) => {
    const to = qi + dir;
    if (to < 0 || to >= quiz.questions.length) return;
    markDirty();
    setQuiz((cur) => {
      const questions = [...cur.questions];
      [questions[qi], questions[to]] = [questions[to], questions[qi]];
      return { ...cur, questions };
    });
  };

  const duplicateQuestion = (qi) => {
    markDirty();
    setQuiz((cur) => {
      const copy = {
        ...cur.questions[qi],
        answers: cur.questions[qi].answers.map((a) => ({ ...a })),
      };
      const questions = [...cur.questions];
      questions.splice(qi + 1, 0, copy);
      return { ...cur, questions };
    });
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

  // переключение формата вопроса: правда/ложь фиксирует два варианта
  const switchMode = (qi, mode) => {
    if (mode === "tf") {
      const was = quiz.questions[qi].answers;
      patchQuestion(qi, {
        mode: "tf",
        answers: [
          { text: "Правда", is_correct: was[0]?.is_correct ?? true },
          { text: "Ложь", is_correct: false },
        ],
      });
    } else {
      patchQuestion(qi, { mode: "choice" });
    }
  };

  const save = () => {
    clearTimeout(timerRef.current);
    void saveNow();
  };

  return (
    <div className="page">
      <AppHeader
        onNav={() => {
          if (isDirty()) {
            setLeaveTarget("/");
            return false;
          }
        }}
      />
      <div className="subnav">
        <Link to="/dashboard" className="btn btn-outline" onClick={tryLeave("/dashboard")}>
          ← К списку
        </Link>
        <span className="badge">
          {quiz.type === "quiz" ? <QuizIcon /> : <PollIcon />}
          {quiz.type === "quiz" ? "Викторина" : "Голосование"}
        </span>
        {/* dirty считаем от состояния рендера: quizRef догоняет его только в effect */}
        <span
          className={`save-status ${busy ? "saving" : serialize(quiz) !== savedRef.current ? "dirty" : "saved"}`}
          role="status"
          aria-live="polite"
        >
          {busy ? "Сохранение…" : serialize(quiz) !== savedRef.current ? "Несохранённые изменения" : "Сохранено"}
        </span>
      </div>

      <div className="page-body editor">
        <label className="title-label">
          Название
          <input
            value={quiz.title}
            onChange={(e) => {
              markDirty();
              setQuiz({ ...quiz, title: e.target.value });
            }}
          />
        </label>

        {quiz.type === "poll" && (
          <label className="live-check">
            <input
              type="checkbox"
              checked={!!quiz.settings?.showLiveResults}
              onChange={() => {
                markDirty();
                setQuiz({
                  ...quiz,
                  settings: { ...quiz.settings, showLiveResults: !quiz.settings?.showLiveResults },
                });
              }}
            />
            Показывать распределение ответов в реальном времени
          </label>
        )}

        {quiz.questions.length === 0 && (
          <p className="muted">
            {quiz.type === "quiz"
              ? "Добавьте первый вопрос: текст и 2–4 варианта ответа, один из них правильный."
              : "Добавьте первый вопрос: текст и 2–4 варианта для голосования."}
          </p>
        )}

        {quiz.questions.map((q, qi) => (
          <div
            className={`card question-card${problems.some((p) => p.qi === qi) ? " question-invalid" : ""}`}
            key={qi}
          >
            <div className="question-head">
              <b>Вопрос {qi + 1}</b>
              <div className="question-settings">
                <label className="time-label">
                  Формат:
                  <Dropdown
                    value={q.mode || "choice"}
                    onChange={(v) => switchMode(qi, v)}
                    options={[
                      ["choice", "Варианты"],
                      ["tf", "Правда / Ложь"],
                    ]}
                  />
                </label>
                <label className="time-label">
                  <ClockIcon className="inline-icon" /> Время:
                  <Dropdown
                    value={String(q.time_limit || 20)}
                    onChange={(v) => patchQuestion(qi, { time_limit: Number(v) })}
                    options={TIME_OPTIONS.map((t) => [String(t), `${t} сек`])}
                  />
                </label>
                <label className="time-label">
                  <TrophyIcon className="inline-icon" /> Очки:
                  <input
                    type="number"
                    className="points-input"
                    min={1}
                    step={1}
                    value={q.points ?? 1}
                    onChange={(e) => patchQuestion(qi, { points: Math.round(Number(e.target.value)) || 1 })}
                  />
                </label>
                <div className="q-tools">
                  <button
                    className="btn btn-outline btn-sm" type="button"
                    onClick={() => setPreviewIdx(qi)}
                    aria-label={`Предпросмотр вопроса ${qi + 1}`}
                    title="Предпросмотр на телефоне"
                  >
                    👁 Превью
                  </button>
                  <button
                    className="btn btn-outline btn-sm icon-btn" type="button"
                    onClick={() => moveQuestion(qi, -1)}
                    disabled={qi === 0}
                    aria-label="Переместить вопрос выше"
                    title="Выше"
                  >
                    ↑
                  </button>
                  <button
                    className="btn btn-outline btn-sm icon-btn" type="button"
                    onClick={() => moveQuestion(qi, 1)}
                    disabled={qi === quiz.questions.length - 1}
                    aria-label="Переместить вопрос ниже"
                    title="Ниже"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => duplicateQuestion(qi)}
                    aria-label="Дублировать вопрос"
                  >
                    Дублировать
                  </button>
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => setDeleteTarget(qi)}>
                    Удалить
                  </button>
                </div>
              </div>
            </div>
            <input
              className="question-text"
              placeholder="Текст вопроса"
              value={q.text}
              onChange={(e) => patchQuestion(qi, { text: e.target.value })}
            />
            {quiz.type === "quiz" && (
              <div className="answers-hint">Отметьте один верный ответ</div>
            )}
            {q.mode === "tf" ? (
              <div className="answers-grid">
                {["Правда", "Ложь"].map((label, ai) => (
                  <div className={`answer-edit c${ai}`} key={label}>
                    <input value={label} readOnly aria-label={label} />
                    {quiz.type === "quiz" && (
                      <label
                        className={`correct-toggle${q.answers[ai]?.is_correct ? " on" : ""}`}
                        title="Правильный ответ"
                      >
                        <input
                          type="radio"
                          name={`correct-${qi}`}
                          checked={!!q.answers[ai]?.is_correct}
                          onChange={() => setCorrect(qi, ai)}
                          aria-label={`${label} — отметить правильным`}
                        />
                        ✓ Верный
                      </label>
                    )}
                  </div>
                ))}
              </div>
            ) : (
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
                      <label
                        className={`correct-toggle${a.is_correct ? " on" : ""}`}
                        title="Правильный ответ"
                      >
                        <input
                          type="radio"
                          name={`correct-${qi}`}
                          checked={!!a.is_correct}
                          onChange={() => setCorrect(qi, ai)}
                          aria-label={`Вариант ${ai + 1} — отметить правильным`}
                        />
                        ✓ Верный
                      </label>
                    )}
                    {q.answers.length > 2 && (
                      <button
                        className="answer-remove"
                        title="Убрать вариант"
                        aria-label={`Убрать вариант ${ai + 1}`}
                        onClick={() => removeAnswer(qi, ai)}
                      >
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
            )}
          </div>
        ))}

        <div className="editor-actions">
          <button className="btn btn-outline btn-lg" onClick={addQuestion}>
            + Вопрос
          </button>
          <button className="btn btn-primary btn-lg" onClick={save} disabled={busy}>
            {busy ? "Сохраняю…" : "Сохранить"}
          </button>
        </div>

        {quiz.questions.length > 0 && (
          <button
            className="btn btn-primary btn-lg launch"
            onClick={async () => {
              const errs = validateQuiz(quiz);
              if (errs.length) {
                setShowErrors(true);
                showToast(`Вопрос ${errs[0].qi + 1}: ${errs[0].reason}`, "error");
                return;
              }
              setShowErrors(false);
              // игра идёт по сохранённым данным — сохраняем перед запуском
              clearTimeout(timerRef.current);
              await saveNow();
              if (!isDirty()) navigate(`/host/${quiz.id}`);
            }}
          >
            ▶ Запустить игру
          </button>
        )}
      </div>

      {previewIdx != null && quiz.questions[previewIdx] && (
        <QuestionPreviewModal
          question={quiz.questions[previewIdx]}
          index={previewIdx}
          total={quiz.questions.length}
          onClose={() => setPreviewIdx(null)}
        />
      )}

      {leaveTarget && (
        <ConfirmDialog
          title="Несохранённые изменения"
          text="Сохранить изменения перед выходом? При ошибке сохранения вы останетесь в редакторе."
          confirmLabel="Сохранить и выйти"
          danger={false}
          onConfirm={confirmLeave}
          onCancel={() => setLeaveTarget(null)}
        />
      )}

      {deleteTarget != null && quiz && (
        <ConfirmDialog
          title="Удалить вопрос?"
          text={`«${quiz.questions[deleteTarget]?.text?.trim() || "Без названия"}» будет удалён из редактора. Изменение применится при сохранении.`}
          confirmLabel="Удалить"
          danger
          onConfirm={() => {
            removeQuestion(deleteTarget);
            setDeleteTarget(null);
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
