import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import ConfirmDialog from "../components/ConfirmDialog";
import { useToast } from "../components/Toast";
import { plural } from "../plural";

// EM-60 (патч дизайнера design-create-flow-patches.md): создание — кнопка [+ ⬎] в шапке,
// dropdown на десктопе / bottom sheet на мобиле; фильтры по статусу; empty state с карточками.
const STATUS = {
  draft: { label: "Черновик", cls: "badge-muted" },
  ready: { label: "Готов", cls: "" },
  live: { label: "Live", cls: "badge-live" },
  completed: { label: "Завершён", cls: "badge-dim" },
};

const FILTERS = [
  ["all", "Все"],
  ["draft", "Черновики"],
  ["ready", "Готов"],
  ["live", "Live"],
  ["completed", "Архив"],
];

const CREATE_KINDS = {
  quiz: { icon: "❓", title: "Квиз", sub: "Вопросы с вариантами ответов и очками" },
  poll: { icon: "📊", title: "Опрос", sub: "Голосование зала без правильных ответов" },
  scenario: { icon: "🎪", title: "Сценарий", sub: "Пустое мероприятие из нескольких блоков" },
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

// кеш только для полного списка (фильтр «Все»), привязан к userId — как в GamesSection
let eventsCache = null; // { userId, data }

export default function EventsSection() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const showToast = useToast();
  const token = localStorage.getItem("token");
  const cached = eventsCache && eventsCache.userId === user?.id ? eventsCache.data : null;
  const [events, setEvents] = useState(cached);
  const [filter, setFilter] = useState("all");
  const [confirmId, setConfirmId] = useState(null);
  const [menuId, setMenuId] = useState(null); // ⋯-меню на карточке
  const [createOpen, setCreateOpen] = useState(false); // dropdown/bottom-sheet создания
  const [createKind, setCreateKind] = useState(null); // выбранный пункт → модалка названия
  const [createTitle, setCreateTitle] = useState("Новое мероприятие");
  const [busyKind, setBusyKind] = useState(null);
  const titleInputRef = useRef(null);

  // монотонный номер запроса: ответ устаревшего фильтра не перезапишет свежий
  const loadSeq = useRef(0);
  const load = (f = filter) => {
    const seq = ++loadSeq.current;
    api(`/events${f !== "all" ? `?status=${f}` : ""}`, { token })
      .then((d) => {
        if (seq !== loadSeq.current) return;
        // live всегда наверх независимо от фильтра (патч §2)
        const sorted = [...d.events].sort((a, b) => (b.status === "live") - (a.status === "live"));
        if (f === "all" && user?.id != null) eventsCache = { userId: user.id, data: sorted };
        setEvents(sorted);
      })
      .catch((e) => {
        if (seq !== loadSeq.current) return;
        if (cached === null) setEvents([]);
        showToast(`Не удалось загрузить мероприятия: ${e.message}`, "error");
      });
  };
  useEffect(() => { load(filter); }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!createOpen && menuId === null && !createKind) return;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      setCreateOpen(false);
      setMenuId(null);
      if (busyKind === null) setCreateKind(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [createOpen, menuId, createKind, busyKind]);

  // «Запустить» пока играет первый quiz/poll-блок; запуск сценария целиком — EM-55
  const run = async (id) => {
    try {
      const d = await api(`/events/${id}`, { token });
      const block = d.blocks.find((b) => (b.type === "quiz" || b.type === "poll") && Number.isInteger(b.content.quizId));
      if (!block) {
        showToast("В сценарии нет заполненных квизов", "error");
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

  // выбор пункта создания → модалка названия (патч §4)
  const pickCreate = (kind) => {
    setCreateOpen(false);
    setCreateKind(kind);
    setCreateTitle("Новое мероприятие");
  };

  useEffect(() => {
    if (createKind && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [createKind]);

  const submitCreate = async () => {
    if (busyKind) return; // Enter/повторный клик не должны плодить мероприятия
    const kind = createKind;
    const title = createTitle.trim() || "Новое мероприятие";
    setBusyKind(kind);
    try {
      const d = await api("/events", { method: "POST", token, body: { title } });
      // quiz/poll — сразу один пустой блок (quizId=null), заполнится с экрана сценария
      if (kind !== "scenario") {
        await api(`/events/${d.event.id}/blocks`, { method: "POST", token, body: { type: kind, content: { quizId: null } } });
      }
      navigate(`/event/${d.event.id}`);
    } catch (e) {
      showToast(`Не удалось создать: ${e.message}`, "error");
      setBusyKind(null);
    }
  };

  return (
    <>
      <div className="dashboard-head event-head-row">
        <h1>Мероприятия</h1>
        <div className="event-head-tools">
          <div className="event-filters" role="group" aria-label="Фильтр по статусу">
            {FILTERS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`filter-pill ${filter === id ? "active" : ""}`}
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="create-wrap">
            <button
              type="button"
              className="btn btn-primary"
              aria-haspopup="menu"
              aria-expanded={createOpen}
              aria-label="Создать мероприятие"
              onClick={() => setCreateOpen((v) => !v)}
            >
              Создать
            </button>
            {createOpen && (
              <>
                <div className="menu-backdrop" onClick={() => setCreateOpen(false)} />
                <div className="create-pop" role="menu">
                  {Object.entries(CREATE_KINDS).map(([kind, k]) => (
                    <button key={kind} role="menuitem" disabled={busyKind !== null} onClick={() => pickCreate(kind)}>
                      <span className="create-pop-icon" aria-hidden="true">{k.icon}</span>
                      <span>
                        <b>{k.title}</b>
                        <span className="create-pop-sub">{k.sub}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {events === null ? (
        <EventListSkeleton />
      ) : events.length === 0 ? (
        filter === "all" ? (
          <div className="empty-state">
            <span className="empty-state-emoji">🎪</span>
            <h2>У вас пока нет мероприятий</h2>
            <p>Создайте квиз или соберите сценарий из нескольких раундов</p>
            <div className="quick-start">
              {Object.entries(CREATE_KINDS).map(([kind, k]) => (
                <button key={kind} className="quick-start-card" disabled={busyKind !== null} onClick={() => pickCreate(kind)}>
                  <span className="qs-icon" aria-hidden="true">{k.icon}</span>
                  <b>{busyKind === kind ? "..." : k.title}</b>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <h2>Пусто</h2>
            <p>В этом фильтре мероприятий нет</p>
          </div>
        )
      ) : (
        <div className="event-list">
          {events.map((ev) => {
            const status = STATUS[ev.status] || STATUS.draft;
            const playable = ev.quiz_count + ev.poll_count > 0;
            // патч L2: неполные блоки (quizId=null) блокируют запуск
            const incomplete = ev.block_count === 0 || ev.broken_blocks > 0;
            return (
              <div className="card event-card" key={ev.id}>
                <div className="event-card-icon" aria-hidden="true">{eventIcon(ev)}</div>
                <div className="event-card-body">
                  <h2 className="event-card-title">{ev.title}</h2>
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
                        <button
                          className="btn btn-primary"
                          disabled={incomplete}
                          title={incomplete ? "Заполните все блоки вопросов" : undefined}
                          onClick={() => run(ev.id)}
                        >
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

      {createKind && (
        <div className="dialog-overlay" onClick={() => busyKind === null && setCreateKind(null)}>
          <div className="card dialog" role="dialog" aria-modal="true" aria-label="Новое мероприятие" onClick={(e) => e.stopPropagation()}>
            <h2>Новое мероприятие</h2>
            <label className="create-title-label">
              Название
              <input
                ref={titleInputRef}
                value={createTitle}
                maxLength={200}
                onChange={(e) => setCreateTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitCreate()}
              />
            </label>
            <div className="notfound-actions">
              <button className="btn btn-outline" disabled={busyKind !== null} onClick={() => setCreateKind(null)}>
                Отмена
              </button>
              <button className="btn btn-primary" disabled={busyKind !== null} onClick={submitCreate}>
                {busyKind ? "..." : "Создать"}
              </button>
            </div>
          </div>
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
