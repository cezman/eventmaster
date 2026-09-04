import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import AppHeader from "../components/AppHeader";
import { UserIcon, HistoryIcon, ShieldIcon, GamepadIcon, QuizIcon, LogoutIcon } from "../components/icons";
import EventsSection from "../cabinet/EventsSection";
import GamesSection from "../cabinet/GamesSection";
import ProfileSection from "../cabinet/ProfileSection";
import PasswordSection from "../cabinet/PasswordSection";
import HistorySection from "../cabinet/HistorySection";

// EM-53 (спека §2.1–2.2): Мероприятия / Библиотека / История / Настройки
const TABS = [
  { id: "events", label: "Мероприятия", icon: GamepadIcon },
  { id: "library", label: "Библиотека", icon: QuizIcon },
  { id: "history", label: "История", icon: HistoryIcon },
  { id: "settings", label: "Настройки", icon: UserIcon },
];
// старые ссылки вида ?tab=games|profile|password ведут в новые разделы
const TAB_ALIASES = { games: "library", profile: "settings", password: "settings" };

// Кабинет ведущего: сайдбар с разделами + контент выбранной вкладки (?tab=, по умолчанию «Мероприятия»).
// Новые разделы добавляются в TABS и рендер-переключатель ниже.
export default function CabinetPage() {
  const { user, signOut } = useAuth();
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab = TABS.some((t) => t.id === raw) ? raw : TAB_ALIASES[raw] || "events";

  const select = (id) => {
    if (id === tab) return; // без повторного пуша в историю
    setParams(id === "events" ? {} : { tab: id });
  };

  return (
    <div className="page">
      <AppHeader />

      <div className="page-body cabinet">
        <nav className="cabinet-nav" aria-label="Разделы кабинета">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={`cabinet-nav-item ${tab === id ? "active" : ""}`}
              aria-current={tab === id ? "true" : undefined}
              onClick={() => select(id)}
            >
              <Icon className="cabinet-nav-icon" /> {label}
            </button>
          ))}
          {user?.role === "admin" && (
            <Link className="cabinet-nav-item" to="/admin">
              <ShieldIcon className="cabinet-nav-icon" /> Админка
            </Link>
          )}
          {/* выход — внизу сайдбара, отдельным блоком: в шапке ему не место */}
          <button type="button" className="cabinet-nav-item cabinet-nav-logout" onClick={signOut}>
            <LogoutIcon className="cabinet-nav-icon" /> Выйти
          </button>
        </nav>

        <section className="cabinet-content">
          {tab === "events" && <EventsSection />}
          {tab === "library" && <GamesSection />}
          {tab === "history" && <HistorySection />}
          {tab === "settings" && (
            <>
              {/* у секций свои заголовки «Личные данные»/«Смена пароля» — дубли не нужны */}
              <ProfileSection />
              <PasswordSection />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
