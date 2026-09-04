import React, { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useToast } from "./Toast";

const LAYOUTS = [
  ["center", "По центру"],
  ["left", "Слева"],
  ["image-right", "Картинка справа"],
];

// EM-54 (спека §3.5): inline-редактор блока сценария. text/break — поля content,
// quiz/poll — только выбор квиза (пикер и создание живут в EventPage).
// Автосейв как в QuizEditor — debounce 5с после последней правки; «Сохранить» сохраняет и сворачивает,
// «Отмена» отбрасывает несохранённое (уже автосохранённое не откатываем).
// draft живёт в ref-зеркале: таймер автосейва обязан видеть последние правки,
// иначе debounce сохраняет состояние «на один ввод назад» (найдено тестом EM-54).
export default function BlockEditor({ eventId, block, onSaved, onClose, onPickQuiz, onCreateQuiz }) {
  const showToast = useToast();
  const token = localStorage.getItem("token");
  const isQuiz = block.type === "quiz" || block.type === "poll";
  const c = block.content || {};

  const draftRef = useRef({
    heading: c.heading || "",
    body: c.body || "",
    layout: c.layout || "center",
    imageUrl: c.imageUrl || "",
    label: c.label || "",
    duration: Number(c.duration) > 0 ? Number(c.duration) : 5,
  });
  const [draft, setDraftState] = useState(draftRef.current);
  const savedRef = useRef(JSON.stringify(draftRef.current));
  const timerRef = useRef(null);
  const liveRef = useRef(true); // компонент размонтирован — тихо игнорируем ответ автосейва
  const [saving, setSaving] = useState(false);

  const updateDraft = (patch) => {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraftState(next);
  };

  const dirty = JSON.stringify(draftRef.current) !== savedRef.current;

  const save = async (silent) => {
    const cur = draftRef.current;
    if (JSON.stringify(cur) === savedRef.current) {
      if (!silent) onClose();
      return;
    }
    setSaving(true);
    clearTimeout(timerRef.current);
    try {
      // мержим поверх сохранённого content, чтобы не потерять незнакомые редактору ключи
      const content =
        block.type === "text"
          ? { ...c, heading: cur.heading.trim(), body: cur.body, layout: cur.layout, imageUrl: cur.imageUrl.trim() }
          : { ...c, label: cur.label.trim(), duration: Number(cur.duration) > 0 ? Number(cur.duration) : 5 };
      const d = await api(`/events/${eventId}/blocks/${block.id}`, { method: "PUT", token, body: { content } });
      savedRef.current = JSON.stringify(cur);
      if (liveRef.current) {
        onSaved(d); // родитель ждёт весь ответ {blocks}
        if (!silent) onClose();
        else showToast("Изменения сохранены", "ok");
      }
    } catch (e) {
      if (liveRef.current) showToast(`Не удалось сохранить блок: ${e.message}`, "error");
      // автосейв повторит попытку при следующей правке; явное «Сохранить» остаётся доступным
    }
    if (liveRef.current) setSaving(false);
  };

  const scheduleSave = () => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => save(true), 5000);
  };

  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
      clearTimeout(timerRef.current);
    };
  }, []);

  // несохранённые правки — предупреждение при закрытии вкладки (как в QuizEditor)
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  if (isQuiz) {
    // контент quiz/poll-блока — только квиз; полей для автосохранения нет
    const hasQuiz = Number.isInteger(c.quizId);
    return (
      <div className="be" role="group" aria-label="Редактирование блока">
        <p className="be-hint">
          {hasQuiz ? `В блоке: ${block.quizTitle || "квиз недоступен"}` : "Квиз ещё не выбран"}
        </p>
        <div className="be-actions be-actions--start">
          <button className="btn btn-outline btn-sm" onClick={onPickQuiz}>
            Выбрать из библиотеки
          </button>
          <button className="btn btn-primary btn-sm" onClick={onCreateQuiz}>
            Создать новый
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Готово
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="be" role="group" aria-label="Редактирование блока">
      {block.type === "text" && (
        <>
          <label className="be-field">
            Заголовок
            <input
              value={draft.heading}
              maxLength={200}
              placeholder="Заголовок"
              onChange={(e) => {
                updateDraft({ heading: e.target.value });
                scheduleSave();
              }}
            />
          </label>
          <label className="be-field">
            Текст
            <textarea
              rows={4}
              value={draft.body}
              placeholder="Текст…"
              onChange={(e) => {
                updateDraft({ body: e.target.value });
                scheduleSave();
              }}
            />
          </label>
          <div className="be-field">
            Раскладка на экране
            <div className="be-seg" role="group" aria-label="Раскладка на экране">
              {LAYOUTS.map(([val, name]) => (
                <button
                  key={val}
                  type="button"
                  aria-pressed={draft.layout === val}
                  onClick={() => {
                    updateDraft({ layout: val });
                    scheduleSave();
                  }}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
          <label className="be-field">
            Картинка (ссылка, необязательно)
            <input
              type="url"
              value={draft.imageUrl}
              placeholder="https://…"
              onChange={(e) => {
                updateDraft({ imageUrl: e.target.value });
                scheduleSave();
              }}
            />
          </label>
        </>
      )}
      {block.type === "break" && (
        <div className="be-grid">
          <label className="be-field">
            Надпись на экране
            <input
              value={draft.label}
              maxLength={200}
              placeholder="Кофе-брейк"
              onChange={(e) => {
                updateDraft({ label: e.target.value });
                scheduleSave();
              }}
            />
          </label>
          <label className="be-field be-field--num">
            Длительность, мин
            <input
              type="number"
              min={1}
              max={120}
              value={draft.duration}
              onChange={(e) => {
                updateDraft({ duration: e.target.value });
                scheduleSave();
              }}
            />
          </label>
        </div>
      )}
      <div className="be-actions">
        <button className="btn btn-ghost btn-sm" disabled={saving} onClick={onClose}>
          Отмена
        </button>
        <button className="btn btn-primary btn-sm" disabled={saving} onClick={() => save(false)}>
          {saving ? "Сохраняем…" : "Сохранить"}
        </button>
      </div>
    </div>
  );
}
