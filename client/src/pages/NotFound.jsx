import React from "react";
import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="notfound">
      <div className="notfound-code">404</div>
      <h1>Такой страницы нет</h1>
      <p className="muted">Проверьте адрес или вернитесь на главную — оттуда можно войти в игру по PIN.</p>
      <div className="notfound-actions">
        <Link className="btn btn-primary" to="/">
          На главную
        </Link>
      </div>
    </div>
  );
}
