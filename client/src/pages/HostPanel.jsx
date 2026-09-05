import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { BLOCK_TYPES, blockDisplayTitle, mmss } from "../blocks";
import { plural } from "../plural";
import WordCloudDisplay from "../components/WordCloudDisplay";
import useBreakCountdown from "../useBreakCountdown";

// EM-36: пульт ведущего — управление идущей игрой. Зал (/screen/<pin>) показывает,
// пульт управляет. Работает на ноуте и телефоне (главное действие — sticky bottom).

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
  // EM-56: аудио-блок играет с устройства ведущего; у активности — свой секундомер
  const audioRef = useRef(null);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioVolume, setAudioVolume] = useState(0.8);
  const [activityStarted, setActivityStarted] = useState(false);
  const [activitySec, setActivitySec] = useState(0);
  // EM-57: live-статистика rating-блока (rating:state/update)
  const [ratingStats, setRatingStats] = useState(null);
  // EM-58: лента свободных ответов (openended:state/response)
  const [openended, setOpenended] = useState(null);
  // EM-59: облако слов (wordcloud:state/word)
  const [cloud, setCloud] = useState(null);
  // EM-67: состояние видео на зале (video:state) — единый источник и для второго пульта
  const [videoState, setVideoState] = useState(null);
  const breakTimer = useBreakCountdown(block);

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
      // EM-56: снапшот несёт block:{type,title} — BlockProgress жив сразу после attach
      setProgress(
        snap.blockTotal != null
          ? { index: snap.blockIndex, total: snap.blockTotal, type: snap.block?.type, title: snap.block?.title }
          : null
      );
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
      if (q.blockTotal != null)
        setProgress({ index: q.blockIndex, total: q.blockTotal, type: q.blockType, title: q.blockTitle });
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
      setRatingStats(null);
      setCloud(null);
      setOpenended(null);
      setVideoState(null); // новый блок — прежнее видео-состояние невалидно
      if (payload.blockTotal != null) setProgress({ index: payload.blockIndex, total: payload.blockTotal });
    };
    const onCount = (d) => setAnswered(d.answered);
    // EM-57: агрегат оценок — и снапшот при подключении (state), и каждый голос (update)
    const onRatingStats = (d) => setRatingStats(d);
    // EM-58: лента ответов — state при подключении, response — каждый новый ответ
    const onOpenendedState = (d) => setOpenended(d);
    const onWordcloudState = (d) => setCloud(d);
    // EM-67: состояние видео зала — и контрол-рассылки, и реплей при подключении пульта
    const onVideoState = (s) => setVideoState(s);
    const onWordcloudWord = (w) =>
      setCloud((cur) => {
        const words = cur ? cur.words.map((x) => ({ ...x })) : [];
        const found = words.find((x) => x.word === w.word);
        if (found) found.count = w.count;
        else words.push({ word: w.word, count: w.count });
        return { kind: "wordcloud", words, totalGuests: cur?.totalGuests ?? 0 };
      });
    const onOpenendedResponse = (r) =>
      setOpenended((cur) =>
        cur
          ? { ...cur, responses: [...cur.responses, r], totalResponses: cur.totalResponses + 1 }
          : { kind: "openended", responses: [r], totalResponses: 1, totalGuests: game?.players?.length || 0 }
      );
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
    for (const ev of ["block:text", "block:image", "block:audio", "block:break", "block:activity", "block:rating", "block:openended", "block:wordcloud", "block:video", "block:transition"])
      socket.on(ev, onBlock);
    socket.on("video:state", onVideoState);
    socket.on("answer-count", onCount);
    socket.on("rating:state", onRatingStats);
    socket.on("rating:update", onRatingStats);
    socket.on("openended:state", onOpenendedState);
    socket.on("openended:response", onOpenendedResponse);
    socket.on("wordcloud:state", onWordcloudState);
    socket.on("wordcloud:word", onWordcloudWord);
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
      for (const ev of ["block:text", "block:image", "block:audio", "block:break", "block:activity", "block:rating", "block:openended", "block:wordcloud", "block:video", "block:transition"])
        socket.off(ev, onBlock);
      socket.off("video:state", onVideoState);
      socket.off("answer-count", onCount);
      socket.off("rating:state", onRatingStats);
      socket.off("rating:update", onRatingStats);
      socket.off("openended:state", onOpenendedState);
      socket.off("openended:response", onOpenendedResponse);
      socket.off("wordcloud:state", onWordcloudState);
      socket.off("wordcloud:word", onWordcloudWord);
      socket.off("game:closed", onClosed);
    };
  }, [socket, token, quizId, eventId, navigate, claim]);

  // смена блока — сбрасываем локальные поверхности; элемент захватываем на входе:
  // React зануляет ref до запуска эффектов, поэтому гасить звук надо в cleanup
  useEffect(() => {
    const el = audioRef.current;
    setAudioPlaying(false);
    setActivityStarted(false);
    setActivitySec(0);
    return () => el?.pause();
  }, [block]);

  useEffect(() => {
    if (!activityStarted) return undefined;
    const iv = setInterval(() => setActivitySec((s) => s + 1), 1000);
    return () => clearInterval(iv);
  }, [activityStarted]);

  const toggleAudio = () => {
    const el = audioRef.current;
    if (!el) return;
    if (audioPlaying) {
      el.pause();
      setAudioPlaying(false);
    } else {
      el.volume = audioVolume;
      el.play().then(() => setAudioPlaying(true)).catch(() => setAudioPlaying(false));
    }
  };

  const changeVolume = (v) => {
    setAudioVolume(v);
    if (audioRef.current) audioRef.current.volume = v;
  };

  const phase = final
    ? "finished"
    : question
      ? reveal
        ? "reveal"
        : "question"
      : block
        ? "block"
        : game?.state;
  // EM-45: оверлей переподключения — только пока пульт подключён к партии.
  // EM-71: ретрай форсирует попытку — после «connect» доведёт reclaim (см. «connect» → claim)
  const reconnect = useReconnectStatus(socket, status === "connected");
  const reconnectOverlay = (
    <ReconnectOverlay
      state={reconnect.state}
      secondsLeft={reconnect.secondsLeft}
      retryLabel="Переподключить"
      onRetry={() => {
        if (socket.disconnected) socket.connect();
      }}
      onHome={() => navigate("/")}
    />
  );

  const hostAction = (event) => () => socket.emit(event);

  // EM-67: ▶/⏸/«Сначала»/громкость для видео на зале; истина — video:state от сервера
  const hostVideoControl = (action, value) =>
    socket.emit("host:video-control", { action, value }, (res) => {
      if (res?.error) showToast(res.error, "error");
    });

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

  // EM-56: данные BlockProgress в шапке (§4.5). В вопросных фазах название/тип
  // приходят в payload вопроса и снапшоте (blockTitle/blockType); на финале скрыт
  const currentBlockInfo =
    isEvent && progress && phase !== "finished"
      ? block
        ? { type: block.to ? block.to.type : block.blockType, title: blockDisplayTitle(block) }
        : phase === "question" || phase === "reveal"
          ? { type: progress.type, title: progress.title }
          : null
      : null;

  const header = (
    <div className="panel-head">
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
      {currentBlockInfo && (
        <div className="panel-blockprogress">
          <div className="panel-blockprogress-meta">
            Блок {progress.index + 1} / {progress.total}
            {currentBlockInfo.title && (
              <>
                {" · "}
                <span aria-hidden="true">{BLOCK_TYPES[currentBlockInfo.type]?.icon}</span>{" "}
                {currentBlockInfo.title}
              </>
            )}
          </div>
          <div
            className="panel-blockprogress-bar"
            role="progressbar"
            aria-label="Прогресс сценария"
            aria-valuemin={1}
            aria-valuemax={progress.total}
            aria-valuenow={progress.index + 1}
          >
            <div
              className="panel-blockprogress-fill"
              /* заполнение = позиция текущего блока, как в подписи «Блок N / M» */
              style={{ width: `${Math.round(((progress.index + 1) / progress.total) * 100)}%` }}
            />
          </div>
        </div>
      )}
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

      {/* EM-56: неигровые блоки сценария — макеты §4.5 (превью, отсчёт, аудио, активность) */}
      {phase === "block" && block && (
        <div className="panel-body">
          {block.to ? (
            <>
              <h2 className="panel-counter">Дальше: {block.to.title}</h2>
              <p className="muted">Автопереход…</p>
            </>
          ) : block.blockType === "break" ? (
            <>
              <h2 className="panel-counter">{block.label || "Перерыв"}</h2>
              {breakTimer.left != null ? (
                <>
                  <div className="panel-timer" role="timer">
                    <span className="panel-timer-digit">{mmss(breakTimer.left)}</span>
                  </div>
                  <p className="muted">Следующий блок включится автоматически</p>
                </>
              ) : (
                <p className="muted">Пауза без таймера</p>
              )}
              <div className="panel-main-action">
                <button className="btn btn-outline btn-block" onClick={hostAction("host:skip-block")}>
                  Пропустить паузу
                </button>
              </div>
            </>
          ) : (
            <>
              {(block.blockType === "text" || block.blockType === "image") && (
                <div className="panel-block-preview">
                  {block.blockType === "text" ? (
                    <>
                      <div className="panel-block-preview-title">{block.heading}</div>
                      {block.body && <p className="panel-block-preview-text">{block.body}</p>}
                      {block.imageUrl && <img className="panel-block-preview-image" src={block.imageUrl} alt="" />}
                    </>
                  ) : (
                    <>
                      {block.url && <img className="panel-block-preview-image" src={block.url} alt={block.caption || ""} />}
                      {block.caption && <p className="panel-block-preview-text">{block.caption}</p>}
                    </>
                  )}
                </div>
              )}
              {block.blockType === "audio" && (
                <>
                  <h2 className="panel-counter">{block.title || "Музыка"}</h2>
                  <div className="panel-audio">
                    <audio ref={audioRef} src={block.url || undefined} preload="none" onEnded={() => setAudioPlaying(false)} />
                    <button
                      className="btn btn-outline"
                      onClick={toggleAudio}
                      disabled={!block.url}
                      aria-label={audioPlaying ? "Пауза" : "Играть"}
                    >
                      {audioPlaying ? "⏸" : "▶"}
                    </button>
                    <label className="panel-audio-volume">
                      Громкость
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={audioVolume}
                        onChange={(e) => changeVolume(Number(e.target.value))}
                      />
                    </label>
                  </div>
                </>
              )}
              {block.blockType === "activity" && (
                <>
                  <h2 className="panel-counter">{block.title || "Активность"}</h2>
                  {block.description && <p className="muted">{block.description}</p>}
                  {activityStarted && (
                    <div className="panel-timer" role="timer">
                      <span className="panel-timer-digit">{mmss(activitySec)}</span>
                    </div>
                  )}
                </>
              )}
              {block.blockType === "video" && (
                <>
                  <h2 className="panel-counter">{block.title || "Видео"}</h2>
                  {block.source === "file" || block.source === "youtube" ? (
                    <div className="panel-audio">
                      <button
                        className="btn btn-outline"
                        onClick={() => hostVideoControl(videoState?.playing ? "pause" : "play")}
                        aria-label={videoState?.playing ? "Пауза" : "Играть"}
                      >
                        {videoState?.playing ? "⏸" : "▶"}
                      </button>
                      <button className="btn btn-outline panel-btn-wide" onClick={() => hostVideoControl("restart")}>
                        Сначала
                      </button>
                      <label className="panel-audio-volume">
                        Громкость
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={videoState?.volume ?? 0.8}
                          onChange={(e) => hostVideoControl("volume", Number(e.target.value))}
                        />
                      </label>
                    </div>
                  ) : (
                    <p className="muted">Видео открывается на экране зала — управление кнопками его плеера.</p>
                  )}
                </>
              )}
              {/* EM-57: rating — промпт, среднее, мини-распределение, счётчик */}
              {block.blockType === "rating" && (
                <div className="panel-rating">
                  <h2 className="panel-counter">{block.prompt || "Оценка"}</h2>
                  {block.showAverage !== false && ratingStats && (
                    <div className="panel-rating-avg">{ratingStats.average.toFixed(1)}</div>
                  )}
                  {ratingStats ? (
                    <>
                      <div className="panel-rating-bars">
                        {ratingStats.distribution.map((n, i) => (
                          <div className="panel-rating-row" key={i}>
                            <span className="panel-rating-num">{i + 1}</span>
                            <span className="panel-rating-bar">
                              <i
                                style={{
                                  width: `${ratingStats.totalResponses ? Math.round((n / ratingStats.totalResponses) * 100) : 0}%`,
                                }}
                              />
                            </span>
                            <span className="panel-rating-count">{n}</span>
                          </div>
                        ))}
                      </div>
                      <p className="muted">
                        Ответили: {ratingStats.totalResponses} / {ratingStats.totalGuests}
                      </p>
                    </>
                  ) : (
                    <p className="muted">Ждём первые оценки…</p>
                  )}
                </div>
              )}
              {/* EM-59: wordcloud — промпт, мини-облако, счётчик */}
              {block.blockType === "wordcloud" && (
                <div className="panel-openended">
                  <h2 className="panel-counter">{block.prompt || "Облако слов"}</h2>
                  {cloud && cloud.words.length > 0 ? (
                    <WordCloudDisplay words={cloud.words} colorScheme={block.colorScheme || "brand"} />
                  ) : (
                    <p className="muted">Ждём первые слова…</p>
                  )}
                  <p className="muted">
                    Слов: {cloud ? cloud.words.reduce((s, w) => s + w.count, 0) : 0} от{" "}
                    {cloud?.totalGuests ?? 0} {(cloud?.totalGuests ?? 0) === 1 ? "гостя" : "гостей"}
                  </p>
                </div>
              )}
              {/* EM-58: openended — промпт, лента последних ответов, счётчик */}
              {block.blockType === "openended" && (
                <div className="panel-openended">
                  <h2 className="panel-counter">{block.prompt || "Свободные ответы"}</h2>
                  {openended && openended.responses.length > 0 ? (
                    <div className="panel-openended-list">
                      {[...openended.responses].slice(-8).reverse().map((r) => (
                        <div className="panel-openended-item" key={r.id}>
                          <p className="panel-openended-text">{r.text}</p>
                          <span className="panel-openended-name">{r.guestName}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">Ждём ответы гостей…</p>
                  )}
                  <p className="muted">
                    {/* M — гости, а не лимит ответов: maxPerGuest>1 делает N > M валидным.
                        «от N» требует родительный падеж: «гостя» (M=1) / «гостей» (M≥2) */}
                    Ответов: {openended?.totalResponses || 0} от {openended?.totalGuests ?? 0}{" "}
                    {(openended?.totalGuests ?? 0) === 1 ? "гостя" : "гостей"}
                  </p>
                </div>
              )}
              <div className="panel-main-action">
                {/* активность: «Начать» запускает секундомер, дальше главное действие — «Далее →» */}
                {block.blockType === "activity" && !activityStarted ? (
                  <button className="btn btn-primary btn-xl btn-block" onClick={() => setActivityStarted(true)}>
                    Начать
                  </button>
                ) : (
                  <button className="btn btn-primary btn-xl btn-block" onClick={hostAction("host:next-block")}>
                    Далее →
                  </button>
                )}
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
          {/* прогресс блока теперь в шапке (BlockProgress, EM-56) */}
          <div className="q-meta">Вопрос {question.index + 1} / {question.total}</div>
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
