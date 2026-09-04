import React, { useEffect, useRef } from "react";

const ANSWER_SHAPES = ["▲", "◆", "●", "■"];

// EM-54: содержимое рамки телефона вынесено, чтобы переиспользовать в предпросмотре сценария.
export function QuestionView({ question, index, total }) {
  const isTf = question.mode === "tf";
  const answers = (question.answers || []).filter((a) => a.text && a.text.trim());

  return (
    <>
      <div className="q-meta">
        Вопрос {index + 1} / {total}
      </div>
      {/* заглушка таймера: цифра time_limit без кольца и анимаций */}
      <span className="timer-digit preview-timer" aria-hidden="true">
        {question.time_limit || 20}
      </span>
      <h2 className="q-text-sm">{question.text || "Текст вопроса…"}</h2>
      {/* раскладка как у настоящего телефона 390px (≤480 → одна колонка) */}
      <div className="preview-answers">
        {answers.map((a, i) => (
          <div
            className={`answer-btn ${isTf ? (i === 0 ? "tf-yes" : "tf-no") : `c${i}`}`}
            key={i}
            aria-hidden="true"
          >
            {isTf ? (i === 0 ? "✓ " : "✕ ") : `${ANSWER_SHAPES[i]} `}
            {a.text}
          </div>
        ))}
      </div>
    </>
  );
}

// EM-31 (addendum §2.7): статичный предпросмотр вопрос-фазы игрока в рамке телефона.
// Без сокета и анимаций: цифра time_limit стоит на месте, ответы не кликаются,
// пустые варианты не рендерятся, длинный вопрос скроллится внутри viewport.
export default function QuestionPreviewModal({ question, index, total, onClose }) {
  const closeRef = useRef(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onEsc = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  return (
    <div className="preview-overlay" onClick={onClose}>
      <div
        className="preview-shell"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Предпросмотр вопроса на телефоне"
      >
        <button ref={closeRef} className="btn btn-ghost preview-close" onClick={onClose} aria-label="Закрыть предпросмотр">
          ×
        </button>
        <div className="preview-phone">
          <span className="preview-notch" aria-hidden="true" />
          <div className="preview-viewport">
            <QuestionView question={question} index={index} total={total} />
          </div>
        </div>
      </div>
    </div>
  );
}
