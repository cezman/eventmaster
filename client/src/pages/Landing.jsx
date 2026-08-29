import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";

export default function Landing() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [pin, setPin] = useState("");

  const join = (e) => {
    e.preventDefault();
    const clean = pin.replace(/\D/g, "");
    if (clean.length === 6) navigate(`/play/${clean}`);
  };

  return (
    <div className="landing">
      <header className="landing-header">
        <span className="logo">EventMaster</span>
        <nav>
          {user ? (
            <Link className="btn btn-outline" to="/dashboard">
              Мои игры
            </Link>
          ) : (
            <>
              <Link className="btn btn-outline" to="/login">
                Вход
              </Link>
              <Link className="btn btn-primary" to="/register">
                Регистрация для ведущих
              </Link>
            </>
          )}
        </nav>
      </header>

      <main className="landing-main">
        <h1>
          Игры и викторины <span className="accent">для ваших мероприятий</span>
        </h1>
        <p className="subtitle">
          Покажите QR-код на экране — гости подключатся со своих телефонов и будут играть вместе с вами в реальном
          времени.
        </p>

        <form className="join-form" onSubmit={join}>
          <input
            className="pin-input"
            placeholder="PIN игры"
            aria-label="PIN игры"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
          />
          <button className="btn btn-primary btn-lg" type="submit" disabled={pin.replace(/\D/g, "").length !== 6}>
            Играть
          </button>
        </form>

        <div className="features">
          <div className="feature-card">
            <div className="feature-emoji">🧠</div>
            <h3>Викторины</h3>
            <p>Создавайте вопросы с вариантами ответов, отмечайте правильные и следите за таблицей лидеров.</p>
            <span className="badge">Готово в MVP</span>
          </div>
          <div className="feature-card">
            <div className="feature-emoji">🗳️</div>
            <h3>Живые голосования</h3>
            <p>Задайте вопрос залу — результаты появятся на экране в реальном времени.</p>
            <span className="badge">Готово в MVP</span>
          </div>
          <div className="feature-card">
            <div className="feature-emoji">📱</div>
            <h3>Подключение по QR</h3>
            <p>Никаких установок: гости сканируют QR-код и сразу попадают в игру.</p>
            <span className="badge">Готово в MVP</span>
          </div>
          <div className="feature-card placeholder">
            <div className="feature-emoji">🎮</div>
            <h3>Больше игр</h3>
            <p>Гонки на реакцию, «Правда или ложь», блиц-опросы и другие форматы.</p>
            <span className="badge badge-muted">Скоро</span>
          </div>
          <div className="feature-card placeholder">
            <div className="feature-emoji">🖼️</div>
            <h3>Картинки и видео</h3>
            <p>Вопросы с изображениями и медиафайлами для более ярких викторин.</p>
            <span className="badge badge-muted">Скоро</span>
          </div>
          <div className="feature-card placeholder">
            <div className="feature-emoji">📊</div>
            <h3>Статистика мероприятий</h3>
            <p>История игр, отчёты по вовлечённости и экспорт результатов.</p>
            <span className="badge badge-muted">Скоро</span>
          </div>
        </div>
      </main>
    </div>
  );
}
