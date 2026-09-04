import React, { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { QuestionView } from "./QuestionPreviewModal";
import { plural } from "../plural";

// EM-54 (спека §3.6): полноэкранный предпросмотр сценария блок за блоком.
// quiz/poll — рамка телефона с первым вопросом (общий QuestionView),
// text/break/image — рамка проектора 16:9. Без сокета: только статика.
export default function ScenarioPreview({ blocks, token, onClose }) {
  const [idx, setIdx] = useState(0);
  // quizId → { status: "loading" | "ok" | "missing" | "empty", question, total }
  const [quizzes, setQuizzes] = useState({});
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onEsc = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onEsc);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onEsc);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const block = blocks[idx];

  // лениво тянем первый вопрос квиза текущего блока
  useEffect(() => {
    const b = blocks[idx];
    if (!b || (b.type !== "quiz" && b.type !== "poll")) return;
    const quizId = b.content.quizId;
    if (!Number.isInteger(quizId) || quizzes[quizId]) return;
    setQuizzes((m) => ({ ...m, [quizId]: { status: "loading" } }));
    api(`/quizzes/${quizId}`, { token })
      .then((d) => {
        const qs = d.quiz.questions || [];
        setQuizzes((m) => ({
          ...m,
          [quizId]: qs.length ? { status: "ok", question: qs[0], total: qs.length } : { status: "empty" },
        }));
      })
      .catch(() => setQuizzes((m) => ({ ...m, [quizId]: { status: "missing" } })));
  }, [idx]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!block) return null;

  const t = { quiz: "Викторина", poll: "Голосование", text: "Текст", image: "Картинка", audio: "Музыка", break: "Пауза", activity: "Активность" }[block.type] || "Блок";
  const title =
    block.type === "quiz" || block.type === "poll"
      ? block.quizTitle || t
      : block.type === "text"
        ? block.content.heading || t
        : block.type === "break"
          ? block.content.label || t
          : t;

  const phone = (q) => {
    if (!q) return null;
    if (q.status === "loading") return <div className="sp-phone-note">Загружаем вопрос…</div>;
    if (q.status === "missing") return <div className="sp-phone-note">Квиз недоступен — возможно, он удалён из библиотеки</div>;
    if (q.status === "empty") return <div className="sp-phone-note">В квизе пока нет вопросов</div>;
    return (
      <div className="sp-phone-box">
        <div className="preview-phone">
          <span className="preview-notch" aria-hidden="true" />
          <div className="preview-viewport">
            <QuestionView question={q.question} index={0} total={q.total} />
          </div>
        </div>
      </div>
    );
  };

  let stage;
  if (block.type === "quiz" || block.type === "poll") {
    if (!Number.isInteger(block.content.quizId)) {
      stage = (
        <div className="sp-screen">
          <span className="sp-emoji" aria-hidden="true">❓</span>
          <h2>Квиз ещё не выбран</h2>
          <p>Вернитесь в редактор и выберите квиз для этого блока</p>
        </div>
      );
    } else {
      stage = phone(quizzes[block.content.quizId]);
    }
  } else if (block.type === "text") {
    const layout = block.content.layout || "center";
    const img = block.content.imageUrl;
    stage = (
      <div
        className={`sp-screen ${layout === "left" ? "sp-screen--left" : ""} ${
          layout === "image-right" && img ? "sp-screen--split" : ""
        }`}
      >
        <div className="sp-text">
          {block.content.heading && <h2>{block.content.heading}</h2>}
          {block.content.body && <p>{block.content.body}</p>}
          {!block.content.heading && !block.content.body && <p>Пустой текстовый блок</p>}
        </div>
        {layout === "image-right" && img && <img className="sp-img" src={img} alt="" />}
      </div>
    );
  } else if (block.type === "break") {
    const dur = Number(block.content.duration) > 0 ? Number(block.content.duration) : 5;
    stage = (
      <div className="sp-screen">
        <span className="sp-emoji" aria-hidden="true">☕</span>
        <h2>{block.content.label || "Пауза"}</h2>
        <p>{`${dur} ${plural(dur, ["минута", "минуты", "минут"])} — перерыв с обратным отсчётом`}</p>
      </div>
    );
  } else if (block.type === "image") {
    stage = (
      <div className="sp-screen">
        {block.content.url ? (
          <img className="sp-img" src={block.content.url} alt={block.content.caption || ""} />
        ) : (
          <p>Картинка не задана</p>
        )}
        {block.content.caption && <p>{block.content.caption}</p>}
      </div>
    );
  } else {
    // audio/activity — полные редакторы появятся с rich-блоками (Phase 4)
    stage = (
      <div className="sp-screen">
        <span className="sp-emoji" aria-hidden="true">{block.type === "audio" ? "🎵" : "🎯"}</span>
        <h2>{block.content.title || t}</h2>
        <p>Этот блок появится на экране во время мероприятия</p>
      </div>
    );
  }

  return (
    <div className="sp-overlay" role="dialog" aria-modal="true" aria-label="Предпросмотр сценария">
      <header className="sp-top">
        <span className="sp-counter">
          Блок {idx + 1} / {blocks.length}
        </span>
        <button ref={closeRef} className="btn btn-ghost sp-close" onClick={onClose} aria-label="Закрыть предпросмотр">
          ×
        </button>
      </header>
      <div className="sp-stage">{stage}</div>
      <footer className="sp-nav">
        <button className="btn btn-outline" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>
          ← Предыдущий
        </button>
        <span className="sp-blockname">{title}</span>
        <button className="btn btn-outline" disabled={idx === blocks.length - 1} onClick={() => setIdx(idx + 1)}>
          Следующий →
        </button>
      </footer>
    </div>
  );
}
