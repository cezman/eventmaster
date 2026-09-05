import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api } from "../api";
import BlockEditor from "../components/BlockEditor";
import ConfirmDialog from "../components/ConfirmDialog";
import QuestionPreviewModal from "../components/QuestionPreviewModal";
import ScenarioPreview from "../components/ScenarioPreview";
import { useToast } from "../components/Toast";
import { QuizIcon, PollIcon } from "../components/icons";
import { plural } from "../plural";
import { resetEventsCache } from "../cabinet/EventsSection";

// EM-54 (спека §3, Phase 2 п.8–12): редактор сценария — таймлайн с drag-and-drop,
// AddBlockMenu (текст/пауза/квизы), inline BlockEditor, предпросмотр сценария.
// image/audio/activity — rich-блоки EM-66: формы в BlockEditor, файлы через POST /api/media.
const BLOCK_TYPES = {
  quiz: { icon: "❓", label: "Викторина" },
  poll: { icon: "📊", label: "Голосование" },
  text: { icon: "📝", label: "Текст" },
  image: { icon: "🖼️", label: "Картинка" },
  audio: { icon: "🎵", label: "Музыка" },
  break: { icon: "☕", label: "Пауза" },
  activity: { icon: "🎯", label: "Активность" },
  rating: { icon: "⭐", label: "Оценка" },
  openended: { icon: "💬", label: "Свободный ответ" },
  wordcloud: { icon: "☁️", label: "Облако слов" },
  video: { icon: "🎬", label: "Видео" },
};

const ADD_ITEMS = [
  { type: "quiz", icon: "❓", name: "Вопросы", sub: "Квиз или голосование с вариантами ответов" },
  { type: "text", icon: "📝", name: "Текст", sub: "Заголовок и текст на экране" },
  { type: "image", icon: "🖼️", name: "Изображение", sub: "Полноэкранная картинка на проекторе" },
  { type: "audio", icon: "🎵", name: "Музыка", sub: "Фоновый трек во время паузы" },
  { type: "break", icon: "☕", name: "Пауза", sub: "Перерыв с обратным отсчётом" },
  { type: "video", icon: "🎬", name: "Видео", sub: "Ролик на большом экране — файл или ссылка" },
  { type: "activity", icon: "🎯", name: "Активность", sub: "Нетворкинг, мозговой штурм, разминка" },
  { type: "rating", icon: "⭐", name: "Оценка", sub: "Шкала 1–10, среднее в реальном времени" },
  { type: "openended", icon: "💬", name: "Свободный ответ", sub: "Идеи и отзывы гостей лентой" },
  { type: "wordcloud", icon: "☁️", name: "Облако слов", sub: "Слова гостей растут на проекторе" },
];

// стартовый content новых блоков: редактор сразу открывается с валидными полями
const DEFAULT_CONTENT = {
  text: { layout: "center" },
  break: { duration: 5 },
  rating: { prompt: "", scale: 10, showAverage: true, labels: { low: "Плохо", mid: "Нормально", high: "Отлично" } },
  openended: { prompt: "", maxLength: 500, displayAs: "feed", filterProfanity: true, maxPerGuest: 3 },
  wordcloud: { prompt: "", maxWordsPerGuest: 3, maxLength: 30, filterProfanity: true, suggestedWords: [], allowCustom: true, colorScheme: "brand" },
  image: { url: "", caption: "", fullscreen: false },
  audio: { url: "", title: "", autoplay: false },
  activity: { type: "standup", title: "", description: "" },
  video: { source: "file", url: "", title: "" },
};

// подписи-близнецы для тоста с согласованием рода («Пауза добавлена»)
const ADDED_TOAST = {
  text: "Текстовый блок добавлен",
  break: "Пауза добавлена",
  rating: "Блок оценки добавлен",
  openended: "Блок свободных ответов добавлен",
  wordcloud: "Блок облака слов добавлен",
  image: "Картинка добавлена",
  audio: "Музыка добавлена",
  activity: "Активность добавлена",
  video: "Видео-блок добавлен",
};

const STATUS = {
  draft: { label: "Черновик", cls: "badge-muted" },
  ready: { label: "Готов", cls: "" },
  live: { label: "Live", cls: "badge-live" },
  completed: { label: "Завершён", cls: "badge-dim" },
};

function blockTitle(b) {
  if (b.type === "quiz" || b.type === "poll") {
    if (!Number.isInteger(b.content.quizId)) return b.type === "quiz" ? "Квиз ещё не выбран" : "Голосование ещё не выбрано";
    return b.quizTitle || "Квиз недоступен";
  }
  if (b.type === "text") return b.content.heading || "Текст";
  if (b.type === "break") return b.content.label || "Пауза";
  if (b.type === "rating") return b.content.prompt || "Оценка";
  if (b.type === "openended") return b.content.prompt || "Свободный ответ";
  if (b.type === "wordcloud") return b.content.prompt || "Облако слов";
  return (BLOCK_TYPES[b.type] || {}).label || "Блок";
}

function blockMeta(b, lib) {
  const label = (BLOCK_TYPES[b.type] || {}).label || "Блок";
  if (b.type === "quiz" || b.type === "poll") {
    if (!Number.isInteger(b.content.quizId)) return "Выберите квиз из библиотеки или создайте новый";
    if (!b.quizTitle) return `${label} · квиз недоступен`;
    const q = lib[b.content.quizId];
    return q
      ? `${label} · ${q.question_count} ${plural(q.question_count, ["вопрос", "вопроса", "вопросов"])}`
      : label;
  }
  if (b.type === "break") {
    const d = Number(b.content.duration) > 0 ? Number(b.content.duration) : 5;
    return `Пауза · ${d} ${plural(d, ["минута", "минуты", "минут"])}`;
  }
  return label;
}

// строка таймлайна (спека §3.3): drag-handle | номер | контент | действия
function SortableBlock({ block, index, lib, busy, menuOpen, onMenuToggle, menuItems, onMenuRun, onPick, onCreate, onEye, canEye }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const t = BLOCK_TYPES[block.type] || BLOCK_TYPES.text;
  const isQuiz = block.type === "quiz" || block.type === "poll";
  const needsQuiz = isQuiz && !Number.isInteger(block.content.quizId);

  return (
    <div
      className={`card tl-row${isDragging ? " tl-row--drag" : ""}`}
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <button type="button" className="tl-drag" aria-label={`Переместить блок ${index + 1}`} {...attributes} {...listeners}>
        ≡
      </button>
      <span className="block-num" aria-hidden="true">{index + 1}</span>
      <div className="tl-body">
        <span className="event-card-icon" aria-hidden="true">{t.icon}</span>
        <div className="tl-text">
          <b className="tl-title">{blockTitle(block)}</b>
          <p className="event-card-meta tl-meta">{blockMeta(block, lib)}</p>
        </div>
      </div>
      <div className="tl-actions">
        {canEye && (
          <button type="button" className="icon-btn" aria-label={`Предпросмотр блока ${index + 1}`} onClick={onEye}>
            👁
          </button>
        )}
        <div className="event-menu">
          <button
            type="button"
            className="event-menu-btn"
            aria-label={`Меню блока ${index + 1}`}
            aria-expanded={menuOpen}
            onClick={onMenuToggle}
          >
            ⋮
          </button>
          {menuOpen && (
            <>
              <div className="menu-backdrop" onClick={onMenuToggle} />
              <div className="menu-pop" role="menu">
                {menuItems.map((it) => (
                  <button
                    key={it.key}
                    type="button"
                    role="menuitem"
                    className={it.danger ? "menu-danger" : undefined}
                    disabled={it.disabled}
                    onClick={() => onMenuRun(it.key)}
                  >
                    {it.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      {needsQuiz && (
        <div className="tl-extra">
          <span className="event-card-meta">Выберите квиз из библиотеки или создайте новый:</span>
          <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={onPick}>
            Выбрать из библиотеки
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={onCreate}>
            Создать новый
          </button>
        </div>
      )}
    </div>
  );
}

// пункты меню «⋮» — зависят от типа блока
function menuItemsFor(block, index, total) {
  const isQuiz = block.type === "quiz" || block.type === "poll";
  const items = [];
  if (isQuiz) {
    // у удалённого квиза пункт-ссылка скрыт: /quiz/:id дал бы 404
    if (Number.isInteger(block.content.quizId) && block.quizTitle) {
      items.push({ key: "questions", label: "Редактировать вопросы" });
    }
    if (Number.isInteger(block.content.quizId)) {
      items.push({ key: "pick", label: "Другой квиз из библиотеки" });
    } else {
      items.push({ key: "edit", label: "Редактировать" });
    }
  } else {
    items.push({ key: "edit", label: "Редактировать" });
  }
  items.push({ key: "up", label: "↑ Переместить выше", disabled: index === 0 });
  items.push({ key: "down", label: "↓ Переместить ниже", disabled: index === total - 1 });
  items.push({ key: "dup", label: "Дублировать" });
  items.push({ key: "del", label: "Удалить", danger: true });
  return items;
}

// AddBlockMenu (спека §3.4): переиспользуем поповер создания (белый, на мобиле — bottom sheet);
// у нижнего триггера раскрывается вверх, иначе menus уходят за край страницы
function AddPop({ up, onPick }) {
  return (
    <div className={`create-pop${up ? " create-pop--up" : ""}`} role="menu" aria-label="Тип нового блока">
      {ADD_ITEMS.map((it) => (
        <button key={it.type} type="button" role="menuitem" disabled={it.soon} onClick={() => onPick(it)}>
          <span className="create-pop-icon" aria-hidden="true">{it.icon}</span>
          <span className="create-pop-name">
            {it.name}
            {it.soon && <span className="badge badge-muted abm-soon">Скоро</span>}
            <span className="create-pop-sub">{it.sub}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

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
  const [pickerList, setPickerList] = useState(null); // список в пикере — отдельно от quizzes, чтобы не ронять мета-данные строк
  const pickerTargetRef = useRef(null); // null — «добавить блок», число — заполнить конкретный блок
  const [quizzes, setQuizzes] = useState(null);
  const [confirmBlockId, setConfirmBlockId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [menuId, setMenuId] = useState(null); // блок с открытым ⋮-меню
  const [addOpen, setAddOpen] = useState(null); // AddBlockMenu: "bottom" | "head"
  const [editorId, setEditorId] = useState(null); // блок с открытым BlockEditor
  const [eye, setEye] = useState(null); // {question, total} для превью вопроса
  const [previewOpen, setPreviewOpen] = useState(false); // предпросмотр всего сценария
  const [showHeadAdd, setShowHeadAdd] = useState(false); // sticky «+ Блок» (патч U3)
  const bottomAddRef = useRef(null);

  const lib = useMemo(() => Object.fromEntries((quizzes || []).map((q) => [q.id, q])), [quizzes]);

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

  // библиотека — для мета строк («N вопросов») и пикера
  useEffect(() => {
    api("/quizzes", { token })
      .then((d) => setQuizzes(d.quizzes))
      .catch(() => setQuizzes([]));
  }, [token]);

  // sticky «+ Блок» в шапке — когда нижняя кнопка ушла из виду (патч U3)
  useEffect(() => {
    const el = bottomAddRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setShowHeadAdd(!entry.isIntersecting), {
      rootMargin: "0px 0px -40px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [event === null, blocks.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pickerOpen && menuId == null && !addOpen) return;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      setPickerOpen(false);
      setMenuId(null);
      setAddOpen(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pickerOpen, menuId, addOpen]);

  const saveTitle = async () => {
    const next = title.trim();
    if (!next || next === titleRef.current) return;
    try {
      await api(`/events/${id}`, { method: "PUT", token, body: { title: next } });
      titleRef.current = next;
      resetEventsCache();
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
      resetEventsCache();
    } catch (e) {
      showToast(`Не удалось изменить статус: ${e.message}`, "error");
    }
  };

  const run = () => {
    // запуск с EM-55: партия идёт по всему сценарию (движок блоков), а не по первому квизу
    if (!blocks.length) {
      showToast("Добавьте блоки в сценарий", "error");
      return;
    }
    const broken = blocks.some(
      (b) => (b.type === "quiz" || b.type === "poll") && !Number.isInteger(b.content.quizId)
    );
    if (broken) {
      showToast("Заполните квизы во всех блоках сценария", "error");
      return;
    }
    navigate(`/host/event/${id}`);
  };

  // target: null — пикер «добавить блок», blockId — заменить квиз в конкретном блоке
  const openPicker = (target) => {
    pickerTargetRef.current = target;
    setPickerList(null);
    setPickerOpen(true);
    api("/quizzes", { token })
      .then((d) => setPickerList(d.quizzes))
      .catch((e) => {
        setPickerOpen(false);
        showToast(`Не удалось загрузить библиотеку: ${e.message}`, "error");
      });
  };

  const pickerType = (() => {
    const t = pickerTargetRef.current;
    if (typeof t !== "number") return null;
    const b = blocks.find((x) => x.id === t);
    return b ? b.type : null;
  })();
  const pickerQuizzes = pickerList && (pickerType ? pickerList.filter((q) => q.type === pickerType) : pickerList);

  const afterBlocks = (d) => {
    setBlocks(d.blocks);
    resetEventsCache();
  };

  // выбор квиза из пикера: с целью — заполняем этот блок, без — пустой блок этого типа или новый в конец
  const addQuizBlock = async (q) => {
    if (busy) return;
    setBusy(true);
    try {
      const target = pickerTargetRef.current;
      const d =
        typeof target === "number"
          ? await api(`/events/${id}/blocks/${target}`, { method: "PUT", token, body: { content: { quizId: q.id } } })
          : await (() => {
              const nullBlock = blocks.find((b) => b.type === q.type && !Number.isInteger(b.content.quizId));
              return nullBlock
                ? api(`/events/${id}/blocks/${nullBlock.id}`, { method: "PUT", token, body: { content: { quizId: q.id } } })
                : api(`/events/${id}/blocks`, { method: "POST", token, body: { type: q.type, content: { quizId: q.id } } });
            })();
      afterBlocks(d);
      setPickerOpen(false);
      setEditorId(null);
      showToast("Квиз добавлен в сценарий", "ok");
    } catch (e) {
      showToast(`Не удалось добавить: ${e.message}`, "error");
      // квиз могли удалить, пока пикер открыт — убираем мёртвую строку
      if (/не найден/i.test(e.message)) setPickerList((list) => (list || []).filter((x) => x.id !== q.id));
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
      const r = await api(`/events/${id}/blocks/${block.id}`, { method: "PUT", token, body: { content: { quizId: d.quiz.id } } });
      afterBlocks(r);
      navigate(`/quiz/${d.quiz.id}`);
    } catch (e) {
      showToast(`Не удалось создать квиз: ${e.message}`, "error");
      setBusy(false);
    }
  };

  const addSimple = async (type) => {
    if (busy) return;
    setBusy(true);
    try {
      const d = await api(`/events/${id}/blocks`, { method: "POST", token, body: { type, content: DEFAULT_CONTENT[type] || {} } });
      afterBlocks(d);
      // новый блок добавлен в конец — открываем у него редактор
      const known = new Set(blocks.map((b) => b.id));
      const created = d.blocks.find((b) => !known.has(b.id));
      if (created) setEditorId(created.id);
      showToast(ADDED_TOAST[type] || `${(ADD_ITEMS.find((i) => i.type === type) || {}).name || "Блок"} добавлен`, "ok");
    } catch (e) {
      showToast(`Не удалось добавить блок: ${e.message}`, "error");
    }
    setBusy(false);
  };

  const persistOrder = async (next) => {
    if (busy) return; // add/dup/delete уже в полёте — их ответ придёт с финальным порядком
    setBlocks(next); // оптимистично — dnd не мигает
    try {
      const d = await api(`/events/${id}/reorder`, { method: "POST", token, body: { blockIds: next.map((b) => b.id) } });
      afterBlocks(d);
    } catch (e) {
      showToast(`Не удалось переставить блоки: ${e.message}`, "error");
      load();
    }
  };

  const moveBlock = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= blocks.length || busy) return;
    persistOrder(arrayMove(blocks, i, j));
  };

  const duplicateBlock = async (block, i) => {
    if (busy) return;
    setBusy(true);
    try {
      // вставляем копию сразу после оригинала
      const d = await api(`/events/${id}/blocks`, {
        method: "POST",
        token,
        body: { type: block.type, content: block.content, settings: block.settings, position: i + 1 },
      });
      afterBlocks(d);
      showToast("Блок продублирован", "ok");
    } catch (e) {
      showToast(`Не удалось дублировать: ${e.message}`, "error");
    }
    setBusy(false);
  };

  const removeBlock = async (blockId) => {
    setConfirmBlockId(null);
    if (editorId === blockId) setEditorId(null);
    try {
      const d = await api(`/events/${id}/blocks/${blockId}`, { method: "DELETE", token });
      afterBlocks(d);
    } catch (e) {
      showToast(`Не удалось убрать блок: ${e.message}`, "error");
    }
  };

  const openEye = async (block) => {
    try {
      const d = await api(`/quizzes/${block.content.quizId}`, { token });
      const qs = d.quiz.questions || [];
      if (qs.length === 0) {
        showToast("В квизе пока нет вопросов", "info");
        return;
      }
      setEye({ question: qs[0], total: qs.length });
    } catch (e) {
      showToast(`Квиз недоступен: ${e.message}`, "error");
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const oldI = blocks.findIndex((b) => b.id === active.id);
    const newI = blocks.findIndex((b) => b.id === over.id);
    if (oldI < 0 || newI < 0) return;
    persistOrder(arrayMove(blocks, oldI, newI));
  };

  const onMenuRun = (block, index) => (key) => {
    setMenuId(null);
    if (key === "edit") setEditorId(block.id);
    else if (key === "questions") navigate(`/quiz/${block.content.quizId}`);
    else if (key === "pick") openPicker(block.id);
    else if (key === "up") moveBlock(index, -1);
    else if (key === "down") moveBlock(index, 1);
    else if (key === "dup") duplicateBlock(block, index);
    else if (key === "del") setConfirmBlockId(block.id);
  };

  const onAddPick = (it) => {
    setAddOpen(null);
    if (it.type === "quiz") openPicker(null);
    else addSimple(it.type);
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
            <h2>Мероприятие не найдено</h2>
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
          <Link to="/dashboard">← Мероприятия</Link>
        </nav>
        <h1 className="sr-only">{title || "Мероприятие"}</h1>

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
            {showHeadAdd && (
              <div className="create-wrap">
                <button
                  className="btn btn-outline btn-sm"
                  aria-expanded={addOpen === "head"}
                  onClick={() => setAddOpen(addOpen === "head" ? null : "head")}
                >
                  + Блок
                </button>
                {addOpen === "head" && (
                  <>
                    <div className="menu-backdrop" onClick={() => setAddOpen(null)} />
                    <AddPop onPick={onAddPick} />
                  </>
                )}
              </div>
            )}
            <button
              className="btn btn-outline"
              disabled={blocks.length === 0}
              title={blocks.length === 0 ? "Сначала добавьте блоки" : "Как сценарий увидит зал и игроки"}
              onClick={() => setPreviewOpen(true)}
            >
              👁 Предпросмотр
            </button>
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
        </div>

        {blocks.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state-emoji">🎪</span>
            <h2>Сценарий пуст</h2>
            <p>Добавьте первый блок: вопросы из библиотеки, текст или паузу</p>
            <button className="btn btn-primary btn-lg" onClick={() => setAddOpen("bottom")}>
              + Добавить блок
            </button>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
              <div className="blocks-list">
                {blocks.map((b, i) => (
                  <React.Fragment key={b.id}>
                    {i > 0 && <div className="tl-sep" aria-hidden="true" />}
                    <SortableBlock
                      block={b}
                      index={i}
                      lib={lib}
                      busy={busy}
                      menuOpen={menuId === b.id}
                      onMenuToggle={() => setMenuId(menuId === b.id ? null : b.id)}
                      menuItems={menuItemsFor(b, i, blocks.length)}
                      onMenuRun={onMenuRun(b, i)}
                      onPick={() => openPicker(b.id)}
                      onCreate={() => createQuizForBlock(b)}
                      onEye={() => openEye(b)}
                      canEye={(b.type === "quiz" || b.type === "poll") && Number.isInteger(b.content.quizId)}
                    />
                    {editorId === b.id && (
                      <BlockEditor
                        eventId={Number(id)}
                        block={b}
                        onSaved={afterBlocks}
                        onClose={() => setEditorId(null)}
                        onPickQuiz={() => openPicker(b.id)}
                        onCreateQuiz={() => createQuizForBlock(b)}
                      />
                    )}
                  </React.Fragment>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}

        {/* триггер AddBlockMenu внизу сценария (спека §3.4); sticky-копия — в шапке */}
        <div className="create-wrap tl-add-wrap" ref={bottomAddRef}>
          <button
            className="tl-add"
            aria-expanded={addOpen === "bottom"}
            onClick={() => setAddOpen(addOpen === "bottom" ? null : "bottom")}
          >
            + Добавить блок
          </button>
          {addOpen === "bottom" && (
            <>
              <div className="menu-backdrop" onClick={() => setAddOpen(null)} />
              <AddPop up onPick={onAddPick} />
            </>
          )}
        </div>
      </div>

      {pickerOpen && (
        <div className="dialog-overlay" onClick={() => setPickerOpen(false)}>
          {/* клик по оверлею закрывает, клики внутри — нет */}
          <div className="card picker-card" role="dialog" aria-modal="true" aria-label="Библиотека квизов" onClick={(e) => e.stopPropagation()}>
            <div className="picker-head">
              <h2>{pickerType ? "Выберите квиз для блока" : "Библиотека квизов"}</h2>
              <button type="button" className="picker-close" aria-label="Закрыть" onClick={() => setPickerOpen(false)}>
                ×
              </button>
            </div>
            {pickerQuizzes === null ? (
              <div className="skeleton-stack">
                <div className="skeleton" style={{ width: "70%" }} />
                <div className="skeleton" style={{ width: "55%" }} />
              </div>
            ) : pickerQuizzes.length === 0 ? (
              <p className="event-card-meta">
                {pickerType
                  ? "В библиотеке нет квизов этого типа"
                  : "Библиотека пуста — создайте квиз во вкладке «Библиотека»"}
              </p>
            ) : (
              <div className="picker-list">
                {pickerQuizzes.map((q) => (
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

      {eye && <QuestionPreviewModal question={eye.question} index={0} total={eye.total} onClose={() => setEye(null)} />}

      {previewOpen && <ScenarioPreview blocks={blocks} token={token} onClose={() => setPreviewOpen(false)} />}

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
