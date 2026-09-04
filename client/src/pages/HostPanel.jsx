import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import QRCode from "qrcode";
import { getSocket } from "../socket";
import { useAuth } from "../auth";
import { NAME_COLORS } from "../customize";
import Logo from "../components/Logo";
import { PlayerChip, PlayerName } from "../components/AudienceView";
import ConfirmDialog from "../components/ConfirmDialog";
import ReconnectOverlay, { useReconnectStatus } from "../components/ReconnectOverlay";
import { useToast } from "../components/Toast";

// EM-36: пульт ведущего — управление идущей игрой. Зал (/screen/<pin>) показывает,
// пульт управляет. Работает на ноуте и телефоне (главное действие — sticky bottom).

// подписи типов блоков сценария (EM-55)
const BLOCK_LABELS = {
  quiz: "Квиз",
  poll: "Опрос",
  text: "Текст",
  break: "Перерыв",
  image: "Изображение",
  audio: "Музыка",
  activity: "Активность",
};

export default function HostPanel() {
  // EM-55: один пульт на две сущности — /host/<quizId> (легаси-квиз) и
  // /host/event/<eventId> (мероприятие, движок сценария)
  const { quizId, eventId } = useParams();
  const isEvent = Boolean(eventId);
  const id = eventId || quizId;
  const { token } = useAuth();
  const navigate = useNavigate();
  const socket = getSocket();
  const showToast = useToast();

  // connecting — стучимся на сервер; connected — пульт управляет партией;
  // error — запуститься не удалось (например, квиз не найден)
  const [status, setStatus] = useState("connecting");
  const [attachError, setAttachError] = useState("");
  const [game, setGame] = useState(null); // {pin,title,type,state,qIndex,total,players,screenOpen,...}
  const [question, setQuestion] = useState(null);
  const [reveal, setReveal] = useState(null);
  const [final, setFinal] = useState(null);
  const [answered, setAnswered] = useState(0);
  const [online, setOnline] = useState(socket.connected);
  // EM-48: открыт ли экран зала (screen:presence) — им управляет сервер
  const [screenOpen, setScreenOpen] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  // EM-55: текущий неигровой блок (block:text/break/transition/…) и прогресс сценария
  const [block, setBlock] = useState(null);
  const [progress, setProgress] = useState(null);

  // EM-46: сервер сам подключает пульт к живой партии своего квиза, а при её
  // отсутствии создаёт новую — запуск в один клик, вторая партия не плодится.
  // На уровне компонента: кнопка «Попробовать снова» на экране ошибки зовёт её же.
  const claim = useCallback(() => {
    setOnline(true);
    const payload = { token };
    if (isEvent) payload.eventId = id;
    else payload.quizId = id;
    socket.emit("host:create-game", payload, (res) => {
      if (res.error) {
        setAttachError(res.error);
        setStatus("error");
      }
    });
  }, [socket, token, id, isEvent]);

  useEffect(() => {
    if (socket.connected) claim();
    socket.on("connect", claim);
    const onDisconnect = () => setOnline(false);
    socket.on("disconnect", onDisconnect);

    const onSnapshot = (snap) => {
      setStatus("connected");
      setAttachError("");
      setScreenOpen(!!snap.screenOpen);
      setGame(snap);
      setProgress(snap.blockTotal != null ? { index: snap.blockIndex, total: snap.blockTotal } : null);
      // в состоянии block сервер следом досылает текущий блок — не гасим его здесь
      if (snap.state !== "block") setBlock(null);
      if (snap.state === "lobby") {
        setQuestion(null);
        setReveal(null);
        setFinal(null);
      }
    };
    const onPlayers = (d) => setGame((g) => (g ? { ...g, players: d.players } : g));
    const onQuestion = (q) => {
      setQuestion(q);
      setReveal(null);
      setFinal(null);
      setAnswered(0);
      setBlock(null);
      if (q.blockTotal != null) setProgress({ index: q.blockIndex, total: q.blockTotal });
    };
    const onReveal = (r) => {
      setReveal(r);
    };
    const onFinished = (f) => {
      setFinal(f);
      setQuestion(null);
      setReveal(null);
      setBlock(null);
    };    // EM-55: неигровые блоки сценария; transition кладём в block до executeBlock
    const onBlock = (payload) => {
      setBlock(payload);
      setQuestion(null);
      setReveal(null);
      if (payload.blockTotal != null) setProgress({ index: payload.blockIndex, total: payload.blockTotal });
    };
    const onCount = (d) => setAnswered(d.answered);
    const onClosed = () => navigate("/dashboard");
    // зал открыли в новой вкладке или закрыли — лаунчпад лобби переключается (EM-48)
    const onScreenPresence = (d) => setScreenOpen(!!d.open);

    socket.on("host:game", onSnapshot);
    socket.on("screen:presence", onScreenPresence);
    socket.on("players", onPlayers);
    socket.on("question", onQuestion);
    socket.on("reveal", onReveal);
    // event:finished и finished приходят вместе на финале мероприятия — обработчик
    // срабатывает дважды, это идемпотентно; вешаем оба ради совместимости поверхностей
    socket.on("finished", onFinished);
    socket.on("event:finished", onFinished);
    for (const ev of ["block:text", "block:image", "block:audio", "block:break", "block:activity", "block:transition"])
      socket.on(ev, onBlock);
    socket.on("answer-count", onCount);
    socket.on("game:closed", onClosed);
    return () => {
      socket.off("connect", claim);
      socket.off("disconnect", onDisconnect);
      socket.off("host:game", onSnapshot);
      socket.off("screen:presence", onScreenPresence);
      socket.off("players", onPlayers);
      socket.off("question", onQuestion);
      socket.off("reveal", onReveal);
      socket.off("finished", onFinished);
      socket.off("event:finished", onFinished);
      for (const ev of ["block:text", "block:image", "block:audio", "block:break", "block:activity", "block:transition"])
        socket.off(ev, onBlock);
      socket.off("answer-count", onCount);
      socket.off("game:closed", onClosed);
    };
  }, [socket, token, quizId, eventId, navigate, claim]);

  const phase = final
    ? "finished"
    : question
      ? reveal
        ? "reveal"
        : "question"
      : block
        ? "block"
        : game?.state;
  // EM-45: оверлей переподключения — только пока пульт подключён к партии
  const reconnect = useReconnectStatus(socket, status === "connected");
  const reconnectOverlay = (
    <ReconnectOverlay
      state={reconnect.state}
      secondsLeft={reconnect.secondsLeft}
      retryLabel="Переподключить"
      onRetry={() => window.location.reload()}
      onHome={() => navigate("/")}
    />
  );

  const hostAction = (event) => () => socket.emit(event);

  const kickPlayer = (p) => {
    socket.emit("kick-player", { playerId: p.id }, (res) => {
      if (res?.ok) showToast(`${p.name} исключён(а)`, "info");
    });
  };

  const endGame = () => {
    socket.emit("host:end");
    navigate("/dashboard");
  };

  const openScreen = () => window.open(`${window.location.origin}/screen/${game.pin}`, "_blank");

  // EM-50: QR пульта в лобби — телефон сканирует с экрана десктопа и открывает
  // текущий адрес пульта (квиз или мероприятие, EM-55); при живой сессии пульт
  // сразу цепляется к этой партии.
  // Ref-callback: перерисовка при каждом монтировании canvas (возврат в лобби и т.п.)
  const qrRef = useCallback(
    (canvas) => {
      if (!canvas) return;
      QRCode.toCanvas(canvas, `${window.location.origin}${window.location.pathname}`, { width: 160, margin: 1 }, (e) => {
        if (e) console.warn("QR пульта не сгенерировался:", e);
      });
    },
    []
  );

  const onlinePlayers = game ? game.players.filter((p) => p.online !== false).length : 0;
  const allAnswered = question && answered >= onlinePlayers && onlinePlayers > 0;

  const header = (
    <div className="panel-header">
      <Logo>{game ? game.title : undefined}</Logo>
      <div className="panel-header-actions">
        {/* «Зал ↗» в шапке: когда зал открыт — переключиться; вне лобби при закрытом зале —
            единственный способ его вернуть (в лобби вместо неё лаунчпад, EM-51) */}
        {status === "connected" && game && (screenOpen || phase !== "lobby") && (
          <button className="btn btn-ghost btn-sm" onClick={openScreen}>
            Зал ↗
          </button>
        )}
        {status === "connected" && (
          <button className="btn btn-danger btn-sm" onClick={() => setConfirmEnd(true)}>
            Завершить
          </button>
        )}
      </div>
    </div>
  );

  const connectionStatus = (
    <div className="panel-status" role="status">
      <span className={`panel-status-dot ${online ? "on" : "off"}`} aria-hidden="true" />
      {online ? "Онлайн" : "Нет связи — переподключаемся…"}
    </div>
  );

  if (status === "error") {
    return (
      <div className="host-panel">
        {header}
        {connectionStatus}
        <div className="panel-body">
          <h1 className="panel-title">Пульт не подключён</h1>
          <div className="error" role="alert">
            {attachError}
          </div>
          <button className="btn btn-primary" onClick={claim}>
            Попробовать снова
          </button>
          <Link to="/dashboard" className="btn btn-outline">
            ← В кабинет
          </Link>
        </div>
      </div>
    );
  }
  if (status !== "connected" || !game) {
    return (
      <div className="host-panel">
        {header}
        {connectionStatus}
        <p className="muted">Подключение…</p>
      </div>
    );
  }

  return (
    <div className="host-panel">
      {reconnectOverlay}
      {header}
      {connectionStatus}
      {confirmEnd && (
        <ConfirmDialog
          title="Завершить игру?"
          // в мероприятии история партий не пишется — не обещаем лишнего
          text={
            game?.eventId
              ? "Партия завершится для всех игроков. Мероприятие можно будет запустить снова."
              : "Игра закончится для всех игроков, результаты сохранятся в истории."
          }
          confirmLabel="Завершить"
          onConfirm={() => {
            setConfirmEnd(false);
            endGame();
          }}
          onCancel={() => setConfirmEnd(false)}
        />
      )}

      {phase === "lobby" && (
        <div className="panel-body">
          <div className="panel-lobby-top">
            {/* EM-48: лаунчпад виден только пока зал не открыт; после — ghost «Зал ↗» в шапке */}
            {!screenOpen && (
              <div className="panel-launch">
                <div className="panel-launch-label">Экран зала для проектора:</div>
                <button className="btn btn-primary btn-block" onClick={openScreen}>
                  Открыть экран зала ↗
                </button>
                <div className="panel-launch-url">…/screen/{game.pin}</div>
              </div>
            )}
            {/* EM-50: QR — на приватном пульте, не на зале (зал остаётся без элементов ведущего) */}
            <div className="panel-qr">
              <div className="panel-qr-label">Пульт на телефоне</div>
              <canvas ref={qrRef} role="img" aria-label="QR-код: открыть пульт на телефоне" />
              <div className="panel-qr-hint">
                Отсканируйте камерой. На телефоне нужно один раз войти в тот же аккаунт ведущего.
              </div>
            </div>
          </div>
          <div className="panel-pin">
            PIN игроков: <b>{game.pin}</b>
          </div>
          <h2 className="panel-counter">Игроков: {game.players.length}</h2>
          {game.players.length === 0 && (
            <p className="muted small">
              Нужен хотя бы 1 игрок: пусть отсканирует QR на экране зала или введёт PIN на главной.
            </p>
          )}
          {game.players.length > 0 && (
            <div className="players-grid">
              {game.players.map((p) => (
                <PlayerChip p={p} key={p.id} onKick={kickPlayer} />
              ))}
            </div>
          )}
          <div className="panel-main-action">
            {/* EM-48: пустую игру начать нельзя — кнопка видима, но заблокирована */}
            <button
              className="btn btn-primary btn-xl btn-block"
              disabled={game.players.length === 0}
              onClick={hostAction("host:start")}
            >
              Начать игру
            </button>
          </div>
        </div>
      )}

      {/* EM-55: неигровые блоки сценария — переход, текст, пауза и др.
          (минимальные поверхности; макеты §4.5 — EM-56) */}
      {phase === "block" && block && (
        <div className="panel-body">
          {progress && (
            <div className="q-meta">
              Блок {progress.index + 1} / {progress.total}
              {!block.to && ` · ${BLOCK_LABELS[block.blockType] || ""}`}
            </div>
          )}
          {block.to ? (
            <>
              <h2 className="panel-counter">Дальше: {block.to.title}</h2>
              <p className="muted">Автопереход…</p>
            </>
          ) : block.blockType === "break" ? (
            <>
              <h2 className="panel-counter">{block.label || "Перерыв"}</h2>
              <p className="muted">
                {block.duration > 0
                  ? `Пауза ${block.duration} мин — следующий блок включится автоматически`
                  : "Пауза без таймера"}
              </p>
              <div className="panel-main-action">
                <button className="btn btn-primary btn-xl btn-block" onClick={hostAction("host:skip-block")}>
                  Пропустить паузу
                </button>
              </div>
            </>
          ) : (
            <>
              {block.blockType === "text" && (
                <>
                  <h2 className="panel-counter">{block.heading}</h2>
                  {block.body && <p className="muted">{block.body}</p>}
                </>
              )}
              {block.blockType === "image" && (
                <>
                  {block.url && <img className="panel-block-image" src={block.url} alt={block.caption || ""} />}
                  {block.caption && <p className="muted">{block.caption}</p>}
                </>
              )}
              {block.blockType === "audio" && (
                <>
                  <h2 className="panel-counter">{block.title || "Музыка"}</h2>
                  {block.url && <p className="muted small">{block.url}</p>}
                </>
              )}
              {block.blockType === "activity" && (
                <>
                  <h2 className="panel-counter">{block.title}</h2>
                  {block.description && <p className="muted">{block.description}</p>}
                </>
              )}
              <div className="panel-main-action">
                <button className="btn btn-primary btn-xl btn-block" onClick={hostAction("host:next-block")}>
                  Далее →
                </button>
              </div>
              <div className="panel-secondary-action">
                <button className="btn btn-outline btn-block" onClick={hostAction("host:skip-block")}>
                  Пропустить блок
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {phase === "question" && question && (
        <div className="panel-body">
          <div className="q-meta">
            {game?.eventId && progress && `Блок ${progress.index + 1} / ${progress.total} · `}
            Вопрос {question.index + 1} / {question.total}
          </div>
          <h2 className={`panel-counter ${allAnswered ? "brand" : ""}`}>
            Ответили: {answered} / {onlinePlayers}
          </h2>
          <div className="panel-main-action">
            <button className="btn btn-primary btn-xl btn-block" onClick={hostAction("host:reveal")}>
              Показать результаты
            </button>
          </div>
          <div className="panel-secondary-action">
            <button className="btn btn-outline btn-block" onClick={hostAction("host:skip")}>
              Пропустить вопрос
            </button>
          </div>
        </div>
      )}

      {phase === "reveal" && reveal && (
        <div className="panel-body">
          <div className="board mini">
            <h2>{game.type === "quiz" ? "Лидеры" : "Промежуточные результаты"}</h2>
            {reveal.leaderboard.slice(0, 3).map((p, i) => (
              <div className="board-row" key={p.name}>
                <span className="board-player">
                  {i + 1}. <PlayerName p={p} size={22} />
                </span>
                <b>{p.score}</b>
              </div>
            ))}
          </div>
          <div className="panel-main-action">
            <button className="btn btn-primary btn-xl btn-block" onClick={hostAction("host:next")}>
              {question && question.index + 1 < question.total
                ? "Следующий →"
                : game?.eventId
                  ? "Дальше →"
                  : "Финальные результаты"}
            </button>
          </div>
        </div>
      )}

      {phase === "finished" && final && (
        <div className="panel-body">
          <h2 className="panel-counter">{game?.eventId ? "Мероприятие завершено!" : "Игра завершена!"}</h2>
          <div className="board mini">
            {final.leaderboard.slice(0, 3).map((p, i) => (
              <div className="board-row" key={p.name}>
                <span className="board-player">
                  {["🥇", "🥈", "🥉"][i] || `${i + 1}.`} <PlayerName p={p} size={22} />
                </span>
                <b>{p.score}</b>
              </div>
            ))}
          </div>
          <div className="panel-main-action">
            <button className="btn btn-primary btn-xl btn-block" onClick={hostAction("host:play-again")}>
              Играть снова
            </button>
          </div>
          <div className="panel-secondary-action">
            <button className="btn btn-outline btn-block" onClick={endGame}>
              В кабинет
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
