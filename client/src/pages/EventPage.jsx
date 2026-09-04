import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import ConfirmDialog from "../components/ConfirmDialog";
import { useToast } from "../components/Toast";
import { QuizIcon, PollIcon } from "../components/icons";
import { plural } from "../plural";

// EM-53 (спека §2.1, Phase 1 п.4): экран мероприятия с простым сценарием.
// Полный редактор сценария (AddBlockMenu/BlockEditor/dnd) — EM-54; здесь каркас:
// название, статус, список блоков, добавление квиза из библиотеки, запуск первого квиза.
const BLOCK_TYPES = {
  quiz: { icon: "❓", label: "Викторина" },
  poll: { icon: "📊", label: "Голосование" },
  text: { icon: "📝", label: "Текст" },
  image: { icon: "🖼️", label: "Картинка" },
  audio: { icon: "🎵", label: "Музыка" },
  break: { icon: "☕", label: "Перерыв" },
  activity: { icon: "🎯", label: "Активность" },
};

const STATUS = {
  draft: { label: "Черновик", cls: "badge-muted" },
  ready: { label: "Готов", cls: "" },
  live: { label: "Live", cls: "badge-live" },
  completed: { label: "Завершён", cls: "badge-dim" },
};

export default function EventPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const showToast = useToast();
  const token = localStorage.getItem("token");

  const [event, setEvent] = useState(null); // null — грузится, false — не найдено
  const [blocks, setBlocks] = useState([]);
  const [title, setTitle] = useState("");
  const titleRef = useRef(""); // последнее сохранённое название — чтобы не сохранять без изменений
  const [pickerOpen, setPickerOpen] = useState(false);
  const [quizzes, setQuizzes] = useState(null);
  const [confirmBlockId, setConfirmBlockId] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api(`/events/${id}`, { token })
      .then((d) => {
        setEvent(d.event);
        setBlocks(d.blocks);
        setTitle(d.event.title);
        titleRef.current = d.event.title;
      })
      .catch((e) => {
        setEvent(false);
        // чужой/удалённый id сервер отдаёт 404 «не найден» — это штатная страница,
        // сетевой сбой дополнительно ругаем тостом
        if (!/не найден/i.test(e.message)) showToast(`Не удалось загрузить мероприятие: ${e.message}`, "error");
      });
  }, [id, token]);
  useEffect(load, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pickerOpen) return;
    const onKey = (e) => e.key === "Escape" && setPickerOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pickerOpen]);

  const saveTitle = async () => {
    const next = title.trim();
    if (!next || next === titleRef.current) return;
    try {
      await api(`/events/${id}`, { method: "PUT", token, body: { title: next } });
      titleRef.current = next;
      showToast("Название сохранено", "ok");
    } catch (e) {
      setTitle(titleRef.current);
      showToast(`Не удалось сохранить: ${e.message}`, "error");
    }
  };

  const setStatus = async (status) => {
    try {
      await api(`/events/${id}`, { method: "PUT", token, body: { status } });
      setEvent((ev) => ({ ...ev, status }));
    } catch (e) {
      showToast(`Не удалось изменить статус: ${e.message}`, "error");
    }
  };

  const run = () => {
    const block = blocks.find((b) => (b.type === "quiz" || b.type === "poll") && Number.isInteger(b.content.quizId));
    if (!block) {
      showToast("В сценарии нет квизов для запуска", "error");
      return;
    }
    navigate(`/host/${block.content.quizId}`);
  };

  const openPicker = () => {
    setPickerOpen(true);
    setQuizzes(null);
    api("/quizzes", { token })
      .then((d) => setQuizzes(d.quizzes))
      .catch((e) => {
        setPickerOpen(false);
        showToast(`Не удалось загрузить библиотеку: ${e.message}`, "error");
      });
  };

  // выбор квиза из пикера: если в сценарии уже есть пустой блок этого типа — заполняем его
  const addQuizBlock = async (q) => {
    if (busy) return;
    setBusy(true);
    try {
      const nullBlock = blocks.find((b) => b.type === q.type && !Number.isInteger(b.content.quizId));
      const d = nullBlock
        ? await api(`/events/${id}/blocks/${nullBlock.id}`, { method: "PUT", token, body: { content: { quizId: q.id } } })
        : await api(`/events/${id}/blocks`, { method: "POST", token, body: { type: q.type, content: { quizId: q.id } } });
      setBlocks(d.blocks);
      setPickerOpen(false);
      showToast("Квиз добавлен в сценарий", "ok");
    } catch (e) {
      showToast(`Не удалось добавить: ${e.message}`, "error");
      // квиз могли удалить, пока пикер открыт — убираем мёртвую строку
      if (/не найден/i.test(e.message)) setQuizzes((list) => list.filter((x) => x.id !== q.id));
    }
    setBusy(false);
  };

  // «Создать новый» у пустого блока: квиз → сразу в блок → редактор вопросов
  const createQuizForBlock = async (block) => {
    if (busy) return;
    setBusy(true);
    try {
      const kind = block.type;
      const d = await api("/quizzes", {
        method: "POST",
        token,
        // wrap:false — квиз для текущего мероприятия, обёртка-дубликат не нужна
        body: { title: kind === "quiz" ? "Новый квиз" : "Новый опрос", type: kind, questions: [], wrap: false },
      });
      await api(`/events/${id}/blocks/${block.id}`, { method: "PUT", token, body: { content: { quizId: d.quiz.id } } });
      navigate(`/quiz/${d.quiz.id}`);
    } catch (e) {
      showToast(`Не удалось создать квиз: ${e.message}`, "error");
      setBusy(false);
    }
  };

  const removeBlock = async (blockId) => {
    setConfirmBlockId(null);
    try {
      const d = await api(`/events/${id}/blocks/${blockId}`, { method: "DELETE", token });
      setBlocks(d.blocks);
    } catch (e) {
      showToast(`Не удалось убрать блок: ${e.message}`, "error");
    }
  };

  if (event === null) {
    return (
      <div className="page">
        <div className="page-body">
          <div className="card skeleton-stack" style={{ padding: 24 }}>
            <div className="skeleton" style={{ width: "50%" }} />
            <div className="skeleton" style={{ width: "80%" }} />
            <div className="skeleton" style={{ width: "65%" }} />
          </div>
        </div>
      </div>
    );
  }
  if (event === false) {
    return (
      <div className="page">
        <div className="page-body">
          <div className="empty-state">
            <h3>Мероприятие не найдено</h3>
            <p>Возможно, оно было удалено</p>
            <Link className="btn btn-primary" to="/dashboard">
              В кабинет
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const status = STATUS[event.status] || STATUS.draft;
  // патч L2: «Запустить» заблокирован, пока есть quiz/poll-блоки без квиза
  const hasQuizBlocks = blocks.some((b) => b.type === "quiz" || b.type === "poll");
  const incomplete = blocks.some((b) => (b.type === "quiz" || b.type === "poll") && !Number.isInteger(b.content.quizId));

  return (
    <div className="page">
      <div className="page-body">
        <nav className="subnav" aria-label="Навигация">
          <Link to="/dashboard">← Кабинет</Link>
        </nav>

        <div className="card event-head">
          <div className="event-head-main">
            {/* название — инпут на card-поверхности: сохраняется по блюру/Enter */}
            <input
              className="event-title-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
              maxLength={200}
              placeholder="Название мероприятия"
              aria-label="Название мероприятия"
            />
            <p className="event-card-meta">
              {blocks.length > 0
                ? `${blocks.length} ${plural(blocks.length, ["блок", "блока", "блоков"])} в сценарии`
                : "Сценарий пуст"}
            </p>
          </div>
          <div className="event-head-actions">
            <span className={`badge ${status.cls}`}>
              {event.status === "live" && <span className="live-dot" aria-hidden="true" />}
              {status.label}
            </span>
            {event.status === "draft" ? (
              <button className="btn btn-outline" onClick={() => setStatus("ready")}>
                Отметить готовым
              </button>
            ) : event.status === "ready" ? (
              <button className="btn btn-outline" onClick={() => setStatus("draft")}>
                Вернуть в черновик
              </button>
            ) : null}
            {hasQuizBlocks && (
              <button
                className="btn btn-primary"
                disabled={incomplete}
                title={incomplete ? "Заполните все блоки вопросов" : undefined}
                onClick={run}
              >
                ▶ Запустить
              </button>
            )}
          </div>
        </div>

        <div className="blocks-head">
          <h2>Сценарий</h2>
          <button className="btn btn-outline" onClick={openPicker}>
            + Добавить квиз из библиотеки
          </button>
        </div>

        {blocks.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state-emoji">🎪</span>
            <h3>Сценарий пуст</h3>
            <p>Добавьте первый раунд — квиз или голосование из библиотеки</p>
            <button className="btn btn-primary btn-lg" onClick={openPicker}>
              + Добавить раунд
            </button>
          </div>
        ) : (
          <div className="blocks-list">
            {blocks.map((b, i) => {
              const t = BLOCK_TYPES[b.type] || BLOCK_TYPES.text;
              const isQuiz = b.type === "quiz" || b.type === "poll";
              const quizId = b.content.quizId;
              const needsQuiz = isQuiz && !Number.isInteger(quizId);
              return (
                <div className="card block-row" key={b.id}>
                  <span className="block-num" aria-hidden="true">{i + 1}</span>
                  <div className="event-card-icon" aria-hidden="true">{t.icon}</div>
                  <div className="block-row-body">
                    <b>{isQuiz ? (Number.isInteger(quizId) ? b.quizTitle || "Квиз удалён" : "Квиз ещё не выбран") : b.content.heading || t.label}</b>
                    <p className="event-card-meta">
                      {isQuiz
                        ? needsQuiz
                          ? "Выберите квиз из библиотеки или создайте новый"
                          : t.label
                        : b.type === "break" && b.content.duration
                          ? `${t.label}: ${b.content.duration} мин`
                          : t.label}
                    </p>
                  </div>
                  <div className="quiz-card-actions">
                    {needsQuiz ? (
                      <>
                        <button className="btn btn-outline btn-sm" disabled={busy} onClick={openPicker}>
                          Выбрать из библиотеки
                        </button>
                        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => createQuizForBlock(b)}>
                          Создать новый
                        </button>
                      </>
                    ) : isQuiz && quizId ? (
                      <Link className="btn btn-outline" to={`/quiz/${quizId}`}>
                        Редактировать квиз
                      </Link>
                    ) : null}
                    <button className="btn btn-danger" onClick={() => setConfirmBlockId(b.id)}>
                      Убрать
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {pickerOpen && (
        <div className="dialog-overlay" onClick={() => setPickerOpen(false)}>
          {/* клик по оверлею закрывает, клики внутри — нет */}
          <div className="card picker-card" role="dialog" aria-modal="true" aria-label="Библиотека квизов" onClick={(e) => e.stopPropagation()}>
            <div className="picker-head">
              <h3>Библиотека квизов</h3>
              <button type="button" className="picker-close" aria-label="Закрыть" onClick={() => setPickerOpen(false)}>
                ×
              </button>
            </div>
            {quizzes === null ? (
              <div className="skeleton-stack">
                <div className="skeleton" style={{ width: "70%" }} />
                <div className="skeleton" style={{ width: "55%" }} />
              </div>
            ) : quizzes.length === 0 ? (
              <p className="event-card-meta">Библиотека пуста — создайте квиз во вкладке «Библиотека»</p>
            ) : (
              <div className="picker-list">
                {quizzes.map((q) => (
              <div className="event-picker-row" key={q.id}>
                {q.type === "quiz" ? <QuizIcon className="inline-icon" /> : <PollIcon className="inline-icon" />}{" "}
                <span className="picker-row-title">{q.title}</span>
                    <span className="event-card-meta">
                      {q.question_count} {plural(q.question_count, ["вопрос", "вопроса", "вопросов"])}
                    </span>
                    <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => addQuizBlock(q)}>
                      Добавить
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {confirmBlockId != null && (
        <ConfirmDialog
          title="Убрать блок из сценария?"
          text="Блок будет удалён из сценария мероприятия. Сам квиз останется в библиотеке."
          onConfirm={() => removeBlock(confirmBlockId)}
          onCancel={() => setConfirmBlockId(null)}
        />
      )}
    </div>
  );
}
