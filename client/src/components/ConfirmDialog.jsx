import React from "react";

// Стилизованная замена window.confirm: оверлей + карточка с двумя действиями.
export default function ConfirmDialog({ title, text, confirmLabel = "Удалить", danger = true, onConfirm, onCancel }) {
  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div
        className="card dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{title}</h3>
        {text && <p className="muted">{text}</p>}
        <div className="notfound-actions">
          <button className={`btn ${danger ? "btn-danger" : "btn-primary"}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button className="btn btn-outline" autoFocus onClick={onCancel}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}
