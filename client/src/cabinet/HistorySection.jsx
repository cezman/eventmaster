import React, { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { useToast } from "../components/Toast";
import { QuizIcon, PollIcon } from "../components/icons";
import { plural } from "../plural";

// CSV с BOM — чтобы Excel из РФ открывал кириллицу без танцев; разделитель ; для RU-локали
function downloadCsv(result) {
  // экранизация + защита от CSV-инъекции: Excel исполняет ячейки, начинающиеся с = + - @
  const esc = (v) => {
    let s = String(v).replaceAll('"', '""');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/[\r\n]+/g, " ")}"`;
  };
  const fmtDate = (d) => new Date(String(d).replace(" ", "T") + "Z").toLocaleString("ru-RU");
  const lines = [
    [esc(`Викторина: ${result.quiz_title}`), esc(`Дата: ${fmtDate(result.played_at)}`)].join(";"),
    ["Место", "Имя", "Очки"].map(esc).join(";"),
    ...result.results.map((r, i) => [esc(i + 1), esc(r.name), esc(r.score)].join(";")),
  ];
  const safeTitle = result.quiz_title.replace(/[^\wа-яА-ЯёЁ -]/g, "").trim().slice(0, 50);
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `eventmaster-${safeTitle || "game"}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function HistorySkeleton() {
  return (
    <div className="quiz-list">
      {[0, 1, 2].map((i) => (
        <div className="card quiz-card" key={i}>
          <div className="skeleton-stack">
            <div className="skeleton" style={{ width: "50%" }} />
            <div className="skeleton" style={{ width: "30%" }} />
          </div>
          <div className="skeleton skeleton-btn" />
        </div>
      ))}
    </div>
  );
}

// кеш между монтированиями вкладки, привязан к userId: повторный заход открывает
// историю мгновенно, свежие данные тихо догружаются в фоне
let resultsCache = null; // { userId, data }

// Раздел «История игр»: сыгранные партии + экспорт CSV
export default function HistorySection() {
  const { user } = useAuth();
  const showToast = useToast();
  const cached = resultsCache && resultsCache.userId === user?.id ? resultsCache.data : null;
  const [results, setResults] = useState(cached);

  useEffect(() => {
    api("/results", { token: localStorage.getItem("token") })
      .then((d) => {
        resultsCache = { userId: user?.id, data: d.results };
        setResults(d.results);
      })
      .catch((e) => {
        if (cached === null) setResults([]);
        showToast(`Не удалось загрузить историю: ${e.message}`, "error");
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const exportCsv = async (id) => {
    try {
      const d = await api(`/results/${id}`, { token: localStorage.getItem("token") });
      downloadCsv(d.result);
    } catch (e) {
      showToast(`Не удалось экспортировать: ${e.message}`, "error");
    }
  };

  return (
    <>
      <div className="dashboard-head">
        <h1>История игр</h1>
      </div>

      {results === null ? (
        <HistorySkeleton />
      ) : results.length === 0 ? (
        <p className="muted">
          Пока пусто. Запишите сыгранную партию — и её результаты появятся здесь (экспорт в CSV).
        </p>
      ) : (
        <div className="quiz-list">
          {results.map((r) => (
            <div className="card quiz-card" key={r.id}>
              <div>
                <h3>{r.quiz_title}</h3>
                <p className="muted">
                  {r.quiz_type === "quiz" ? <QuizIcon className="inline-icon" /> : <PollIcon className="inline-icon" />}{" "}
                  {r.quiz_type === "quiz" ? "Викторина" : "Голосование"} · {r.players_count}{" "}
                  {plural(r.players_count, ["игрок", "игрока", "игроков"])} ·{" "}
                  {new Date(String(r.played_at).replace(" ", "T") + "Z").toLocaleString("ru-RU")}
                </p>
              </div>
              <div className="quiz-card-actions">
                <button className="btn btn-outline" onClick={() => exportCsv(r.id)}>
                  Экспорт CSV
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
