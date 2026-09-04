import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import Logo from "../components/Logo";
import ThemeToggle from "../components/ThemeToggle";
import { QuizIcon, PollIcon, QrPhoneIcon, GamepadIcon, ImageIcon, ChartIcon } from "../components/icons";

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
        <Logo />
        <nav>
          <ThemeToggle />
          {user ? (
            <Link className="btn btn-outline" to="/dashboard">
              Кабинет
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
            <div className="feature-icon"><QuizIcon /></div>
            <h2>Викторины</h2>
            <p>Создавайте вопросы с вариантами ответов, отмечайте правильные и следите за таблицей лидеров.</p>
            <span className="badge">Готово в MVP</span>
          </div>
          <div className="feature-card">
            <div className="feature-icon"><PollIcon /></div>
            <h2>Живые голосования</h2>
            <p>Задайте вопрос залу — результаты появятся на экране в реальном времени.</p>
            <span className="badge">Готово в MVP</span>
          </div>
          <div className="feature-card">
            <div className="feature-icon"><QrPhoneIcon /></div>
            <h2>Подключение по QR</h2>
            <p>Никаких установок: гости сканируют QR-код и сразу попадают в игру.</p>
            <span className="badge">Готово в MVP</span>
          </div>
          <div className="feature-card placeholder">
            <div className="feature-icon"><GamepadIcon /></div>
            <h2>Больше игр</h2>
            <p>Гонки на реакцию, «Правда или ложь», блиц-опросы и другие форматы.</p>
            <span className="badge badge-muted">Скоро</span>
          </div>
          <div className="feature-card placeholder">
            <div className="feature-icon"><ImageIcon /></div>
            <h2>Картинки и видео</h2>
            <p>Вопросы с изображениями и медиафайлами для более ярких викторин.</p>
            <span className="badge badge-muted">Скоро</span>
          </div>
          <div className="feature-card placeholder">
            <div className="feature-icon"><ChartIcon /></div>
            <h2>Статистика мероприятий</h2>
            <p>История игр, отчёты по вовлечённости и экспорт результатов.</p>
            <span className="badge badge-muted">Скоро</span>
          </div>
        </div>
      </main>
    </div>
  );
}
