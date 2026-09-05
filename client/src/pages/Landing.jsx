import React from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import Logo from "../components/Logo";
import ThemeToggle from "../components/ThemeToggle";

/* Декоративный QR-паттерн 17×17 для макета экрана: угловые Finder-квадраты + шум.
   Не сканируется и не должен — настоящий QR хост показывает на экране зала. */
const QR_ROWS = [
  "11111110101111111",
  "10000010011000001",
  "10111010111101110",
  "10111010000101110",
  "10111010101101110",
  "10000010111000001",
  "11111110001111111",
  "00000000100000000",
  "10110011011001101",
  "01101010100101010",
  "11111110111011011",
  "10000010010100101",
  "10111010111101010",
  "10111010000110110",
  "10111010101101001",
  "10000010111011011",
  "11111110001110100",
];

const BARS = [
  { label: "Сидней", n: 6, w: 23, cls: "c0" },
  { label: "Канберра", n: 11, w: 42, cls: "c1" },
  { label: "Мельбурн", n: 6, w: 23, cls: "c2" },
  { label: "Перт", n: 3, w: 12, cls: "c3" },
];

/* Макет экрана зала: PIN + QR + вопрос с живыми барами — один кадр продукта */
function ScreenMock() {
  return (
    <div className="screen-mock" aria-hidden="true">
      <div className="screen-top">
        <span className="live-chip">Идёт игра</span>
        <span className="screen-guests">26 гостей</span>
      </div>
      <div className="screen-pin-row">
        <div className="screen-pin">
          <span className="screen-pin-label">PIN</span>
          <span className="screen-pin-value">482913</span>
        </div>
        <svg className="screen-qr" viewBox="0 0 17 17" shapeRendering="crispEdges">
          {QR_ROWS.flatMap((row, y) =>
            row
              .split("")
              .map((ch, x) => (ch === "1" ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} /> : null))
          )}
        </svg>
      </div>
      <div className="screen-q">Столица Австралии?</div>
      <div className="screen-bars">
        {BARS.map((b, i) => (
          <div className="screen-bar" key={b.label}>
            <span className="screen-bar-label">{b.label}</span>
            <span className="screen-bar-track">
              <span
                className={`screen-bar-fill ${b.cls}`}
                style={{ "--w": `${b.w}%`, animationDelay: `${0.15 * i + 0.1}s` }}
              />
            </span>
            <span className="screen-bar-n">{b.n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* Макет телефона гостя: тот же вопрос, кнопки как в игре, одна выбрана */
function PhoneMock() {
  return (
    <div className="phone-mock" aria-hidden="true">
      <div className="phone-screen">
        <div className="phone-q">Столица Австралии?</div>
        <div className="phone-answers">
          <span className="phone-answer c0 chosen">Сидней</span>
          <span className="phone-answer c1">Канберра</span>
          <span className="phone-answer c2">Мельбурн</span>
          <span className="phone-answer c3">Перт</span>
        </div>
      </div>
    </div>
  );
}

export default function Landing() {
  const { user } = useAuth();

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
        <section className="hero">
          <div className="hero-copy">
            <h1>Экран показывает вопрос — зал отвечает с телефонов</h1>
            <p className="subtitle">
              EventMaster — викторины и живые голосования для мероприятий. Покажите PIN и QR-код на большом
              экране: гости заходят без установки приложений, результаты растут в реальном времени.
            </p>
            {user ? (
              <Link className="btn btn-primary btn-lg" to="/dashboard">
                Открыть кабинет
              </Link>
            ) : (
              <Link className="btn btn-primary btn-lg" to="/register">
                Создать игру
              </Link>
            )}
            {/* гостевой вход — на отдельной странице игрока: там PIN, имя и аватар */}
            <Link className="guest-link" to="/play">
              Гость? <span>Войти по PIN-коду</span>
            </Link>
          </div>
          <div className="hero-visual">
            <ScreenMock />
            <PhoneMock />
          </div>
        </section>

        <section className="steps">
          <h2>Три шага до первого раунда</h2>
          <ol className="steps-list">
            <li>
              <span className="step-num">1</span>
              <div>
                <h3>Создайте игру</h3>
                <p>Викторина или голосование собирается в редакторе за пару минут.</p>
              </div>
            </li>
            <li>
              <span className="step-num">2</span>
              <div>
                <h3>Покажите QR на экране</h3>
                <p>Гости сканируют код и заходят по PIN — без установки приложений и аккаунтов.</p>
              </div>
            </li>
            <li>
              <span className="step-num">3</span>
              <div>
                <h3>Играйте вживую</h3>
                <p>Вопросы, живые результаты и лидерборд — на большом экране, телефон гостя как пульт.</p>
              </div>
            </li>
          </ol>
        </section>
      </main>
    </div>
  );
}
