import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import ConfirmDialog from "../components/ConfirmDialog";
import { useToast } from "../components/Toast";
import { plural } from "../plural";

// EM-53 (спека §2.3): статус мероприятия → подпись и класс бейджа
const STATUS = {
  draft: { label: "Черновик", cls: "badge-muted" },
  ready: { label: "Готов", cls: "" },
  live: { label: "Live", cls: "badge-live" },
  completed: { label: "Завершён", cls: "badge-dim" },
};

// иконка типа: одноцелевое мероприятие (один quiz/poll-блок) показывает его тип
function eventIcon(ev) {
  if (ev.block_count === 1 && ev.quiz_count === 1) return "❓";
  if (ev.block_count === 1 && ev.poll_count === 1) return "📊";
  return "🎪";
}

function EventListSkeleton() {
  return (
    <div className="event-list">
      {[0, 1, 2].map((i) => (
        <div className="card event-card" key={i}>
          <div className="skeleton event-card-icon" />
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

// кеш между монтированиями вкладки, привязан к userId — как в GamesSection
let eventsCache = null; // { userId, data }

// Раздел «Мероприятия»: карточки мероприятий + quick-start
export default function EventsSection() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const showToast = useToast();
  const cached = eventsCache && eventsCache.userId === user?.id ? eventsCache.data : null;
  const [events, setEvents] = useState(cached);
  const [confirmId, setConfirmId] = useState(null);
  const [menuId, setMenuId] = useState(null); // id события с открытым ⋯-меню
  const [busyKind, setBusyKind] = useState(null); // быстрое создание: quiz | poll | scenario

  const token = localStorage.getItem("token");

  const load = () => {
    api("/events", { token })
      .then((d) => {
        if (user?.id == null) { setEvents(d.events); return; } // user не загружен — не кешируем
        eventsCache = { userId: user.id, data: d.events };
        setEvents(d.events);
      })
      .catch((e) => {
        if (cached === null) setEvents([]);
        showToast(`Не удалось загрузить мероприятия: ${e.message}`, "error");
      });
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (menuId === null) return;
    const onKey = (e) => e.key === "Escape" && setMenuId(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuId]);

  // «Запустить» пока работает по-старому: играем первый quiz/poll-блок (EM-55 добавит запуск сценария)
  const run = async (id) => {
    try {
      const d = await api(`/events/${id}`, { token });
      const block = d.blocks.find((b) => b.type === "quiz" || b.type === "poll");
      if (!block) {
        showToast("В сценарии нет квизов для запуска", "error");
        return;
      }
      navigate(`/host/${block.content.quizId}`);
    } catch (e) {
      showToast(`Не удалось открыть мероприятие: ${e.message}`, "error");
    }
  };

  const clone = async (id) => {
    setMenuId(null);
    try {
      await api(`/events/${id}/clone`, { method: "POST", token });
      showToast("Мероприятие склонировано", "ok");
    } catch (e) {
      showToast(`Не удалось клонировать: ${e.message}`, "error");
    }
    load();
  };

  const remove = async (id) => {
    setConfirmId(null);
    try {
      await api(`/events/${id}`, { method: "DELETE", token });
      showToast("Мероприятие удалено", "ok");
    } catch (e) {
      showToast(`Не удалось удалить: ${e.message}`, "error");
    }
    load();
  };

  // quick-start (спека §2.3): сразу создаём и переходим в редактор
  const quickStart = async (kind) => {
    setBusyKind(kind);
    try {
      if (kind === "scenario") {
        const d = await api("/events", { method: "POST", token, body: { title: "Новое мероприятие" } });
        navigate(`/event/${d.event.id}`);
      } else {
        const d = await api("/quizzes", {
          method: "POST",
          token,
          body: { title: kind === "quiz" ? "Новый квиз" : "Новый опрос", type: kind, questions: [] },
        });
        navigate(`/quiz/${d.quiz.id}`);
      }
    } catch (e) {
      showToast(`Не удалось создать: ${e.message}`, "error");
      setBusyKind(null);
    }
  };

  return (
    <>
      <div className="dashboard-head">
        <h1>Мероприятия</h1>
      </div>

      {events === null ? (
        <EventListSkeleton />
      ) : events.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-emoji">🎪</span>
          <h3>У вас пока нет мероприятий</h3>
          <p>Создайте квиз или соберите сценарий из нескольких раундов</p>
          <div className="quick-start">
            <button className="quick-start-card" disabled={busyKind !== null} onClick={() => quickStart("quiz")}>
              <span className="qs-icon">❓</span>
              <b>{busyKind === "quiz" ? "..." : "Квиз"}</b>
            </button>
            <button className="quick-start-card" disabled={busyKind !== null} onClick={() => quickStart("poll")}>
              <span className="qs-icon">📊</span>
              <b>{busyKind === "poll" ? "..." : "Опрос"}</b>
            </button>
            <button className="quick-start-card" disabled={busyKind !== null} onClick={() => quickStart("scenario")}>
              <span className="qs-icon">🎪</span>
              <b>{busyKind === "scenario" ? "..." : "Сценарий"}</b>
            </button>
          </div>
        </div>
      ) : (
        <div className="event-list">
          {events.map((ev) => {
            const status = STATUS[ev.status] || STATUS.draft;
            const playable = ev.quiz_count + ev.poll_count > 0;
            return (
              <div className="card event-card" key={ev.id}>
                <div className="event-card-icon" aria-hidden="true">{eventIcon(ev)}</div>
                <div className="event-card-body">
                  <h3 className="event-card-title">{ev.title}</h3>
                  <p className="event-card-meta">
                    {ev.block_count > 0
                      ? `${ev.block_count} ${plural(ev.block_count, ["раунд", "раунда", "раундов"])} · ${ev.question_count} ${plural(ev.question_count, ["вопрос", "вопроса", "вопросов"])}`
                      : "Пустой сценарий"}
                  </p>
                </div>
                <div className="event-card-side">
                  <span className={`badge ${status.cls}`}>
                    {ev.status === "live" && <span className="live-dot" aria-hidden="true" />}
                    {status.label}
                  </span>
                  <div className="event-card-actions">
                    {/* live выставит движок сценария (EM-55); /host/<eventId> заработает тогда же */}
                    {ev.status === "live" ? (
                      <Link className="btn btn-danger" to={`/host/${ev.id}`}>
                        Перейти к пульту
                      </Link>
                    ) : (
                      playable && (
                        <button className="btn btn-primary" onClick={() => run(ev.id)}>
                          ▶ Запустить
                        </button>
                      )
                    )}
                    <Link className="btn btn-outline" to={`/event/${ev.id}`}>
                      Редактировать
                    </Link>
                    <div className="event-menu">
                      <button
                        type="button"
                        className="event-menu-btn"
                        aria-label="Ещё действия"
                        aria-haspopup="menu"
                        aria-expanded={menuId === ev.id}
                        onClick={() => setMenuId(menuId === ev.id ? null : ev.id)}
                      >
                        ⋯
                      </button>
                      {menuId === ev.id && (
                        <>
                          {/* прозрачная подложка на весь экран — закрытие меню кликом мимо */}
                          <div className="menu-backdrop" onClick={() => setMenuId(null)} />
                          <div className="menu-pop" role="menu">
                            <button role="menuitem" onClick={() => clone(ev.id)}>
                              Клонировать
                            </button>
                            <button role="menuitem" className="menu-danger" onClick={() => { setMenuId(null); setConfirmId(ev.id); }}>
                              Удалить
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {confirmId != null && (
        <ConfirmDialog
          title="Удалить мероприятие?"
          text="Мероприятие будет удалено вместе со сценарием. Квизы библиотеки останутся."
          onConfirm={() => remove(confirmId)}
          onCancel={() => setConfirmId(null)}
        />
      )}
    </>
  );
}
