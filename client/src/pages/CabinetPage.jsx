import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import AppHeader from "../components/AppHeader";
import { UserIcon, LockIcon, HistoryIcon, ShieldIcon, GamepadIcon } from "../components/icons";
import GamesSection from "../cabinet/GamesSection";
import ProfileSection from "../cabinet/ProfileSection";
import PasswordSection from "../cabinet/PasswordSection";
import HistorySection from "../cabinet/HistorySection";

const TABS = [
  { id: "games", label: "Мероприятия", icon: GamepadIcon },
  { id: "profile", label: "Личные данные", icon: UserIcon },
  { id: "password", label: "Смена пароля", icon: LockIcon },
  { id: "history", label: "История игр", icon: HistoryIcon },
];

// Кабинет ведущего: сайдбар с разделами + контент выбранной вкладки (?tab=, по умолчанию «Мероприятия»).
// Новые разделы добавляются в TABS и рендер-переключатель ниже.
export default function CabinetPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.id === params.get("tab")) ? params.get("tab") : "games";

  const select = (id) => {
    if (id === tab) return; // без повторного пуша в историю
    setParams(id === "games" ? {} : { tab: id });
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
        </nav>

        <section className="cabinet-content">
          {tab === "games" && <GamesSection />}
          {tab === "profile" && <ProfileSection />}
          {tab === "password" && <PasswordSection />}
          {tab === "history" && <HistorySection />}
        </section>
      </div>
    </div>
  );
}
