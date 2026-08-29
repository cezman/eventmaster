import React from "react";
import { Link } from "react-router-dom";

// Ловит ошибки рендера всего приложения — без него любое исключение даёт белый экран
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Ошибка рендера:", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="notfound">
        <div className="notfound-code">⚠️</div>
        <h1>Что-то сломалось</h1>
        <p className="muted">
          Произошла непредвиденная ошибка. Попробуйте обновить страницу —
          активная игра восстановится по PIN в течение пары минут.
        </p>
        <div className="notfound-actions">
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Обновить страницу
          </button>
          <Link className="btn btn-outline" to="/">
            На главную
          </Link>
        </div>
      </div>
    );
  }
}
