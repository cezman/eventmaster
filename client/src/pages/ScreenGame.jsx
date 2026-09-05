import React, { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { getSocket } from "../socket";
import AudienceView from "../components/AudienceView";
import Logo from "../components/Logo";
import { ExpandIcon } from "../components/icons";
import confetti from "canvas-confetti";
import { BLOCK_TYPES, mmss } from "../blocks";
import { plural } from "../plural";
import useBreakCountdown from "../useBreakCountdown";
import WordCloudDisplay from "../components/WordCloudDisplay";

const RING_CIRC = 2 * Math.PI * 34; // длина окружности ring-таймера (r=34, как в AudienceView)

// эмодзи паузы по подписи блока (спека §4.6: ☕/🎵/🧘)
function breakEmoji(label = "") {
  if (/муз|песн|танц/i.test(label)) return "🎵";
  if (/йог|спорт|разминк|зарядк/i.test(label)) return "🧘";
  return "☕";
}

// EM-36: зал — полноэкранный показ игры на проекторе, ноль управляющих элементов
// (кроме «Во весь экран»). Управляет пульт на /host/<quizId>.
export default function ScreenGame() {
  const { pin: pinParam } = useParams();
  const socket = getSocket();

  const [status, setStatus] = useState("connecting"); // connecting | live | not-found | closed
  const [game, setGame] = useState(null);
  const [question, setQuestion] = useState(null);
  const [reveal, setReveal] = useState(null);
  const [final, setFinal] = useState(null);
  const [answered, setAnswered] = useState(0);
  const [counts, setCounts] = useState([]);
  const [live, setLive] = useState(false); // распределение до reveal — только при showLiveResults
  const [secondsLeft, setSecondsLeft] = useState(null);
  const [reactions, setReactions] = useState([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // EM-55: текущий неигровой блок сценария (переход/текст/пауза/…)
  const [block, setBlock] = useState(null);
  // EM-57: live-статистика rating-блока (rating:state/update)
  const [ratingStats, setRatingStats] = useState(null);
  // EM-58: лента свободных ответов (openended:state/response)
  const [openended, setOpenended] = useState(null);
  // EM-59: облако слов (wordcloud:state/word)
  const [cloud, setCloud] = useState(null);
  // EM-67: видео-блок — состояние управления с пульта и фолбэк autoplay-политики
  const [videoState, setVideoState] = useState(null);
  const [videoBlocked, setVideoBlocked] = useState(false);
  const videoRef = useRef(null);
  const embedRef = useRef(null);
  const ytPosRef = useRef(0);
  const ytPlayingRef = useRef(false);
  // EM-56: отсчёт паузы на BreakScreen
  const breakTimer = useBreakCountdown(block);

  // EM-67: применяем состояние пульта к видео зала; YouTube — postMessage в iframe API.
  // seek для embed — только на переходах play/pause и рестарте (иначе volume-команда
  // во время игры утащила бы позицию вперёд)
  useEffect(() => {
    if (!videoState || block?.blockType !== "video") return;
    if (block.source === "file") {
      const v = videoRef.current;
      if (!v) return;
      if (Number.isFinite(videoState.position) && Math.abs((v.currentTime || 0) - videoState.position) > 1.5)
        v.currentTime = videoState.position;
      if (Number.isFinite(videoState.volume)) v.volume = videoState.volume;
      if (videoState.playing) v.play().catch(() => setVideoBlocked(true));
      else v.pause();
    } else if (block.source === "youtube" && embedRef.current?.contentWindow) {
      const cmd = (func, args = []) =>
        embedRef.current.contentWindow.postMessage(JSON.stringify({ event: "command", func, args }), "https://www.youtube.com");
      cmd("setVolume", [Math.round((videoState.volume ?? 0.8) * 100)]);
      const transition = ytPlayingRef.current !== videoState.playing;
      const restart = videoState.playing && (videoState.position || 0) < 1;
      if (transition || restart || Math.abs(ytPosRef.current - (videoState.position || 0)) > 30) {
        ytPosRef.current = videoState.position || 0;
        cmd("seekTo", [ytPosRef.current, true]);
      }
      cmd(videoState.playing ? "playVideo" : "pauseVideo");
      ytPlayingRef.current = videoState.playing;
    }
  }, [videoState, block]);

  useEffect(() => {
    const join = () => {
      // идемпотентно: при тёплом переподключении транспорта сокет возвращается в комнату
      socket.emit("screen:join", { pin: pinParam }, (res) => {
        if (res?.error) return setStatus("not-found");
        setStatus("live");
        setGame((g) => ({
          pin: res.pin,
          title: res.title,
          type: res.type,
          quizId: res.quizId,
          state: res.state,
          players: g?.players || [],
        }));
      });
    };
    if (socket.connected) join();
    socket.on("connect", join);

    const onPlayers = (d) => setGame((g) => (g ? { ...g, players: d.players } : g));
    const onQuestion = (q) => {
      setQuestion(q);
      setReveal(null);
      setFinal(null);
      setAnswered(0);
      setCounts(q.answers.map(() => 0));
      setLive(q.showLiveResults === true);
      setSecondsLeft(q.timeLimit);
    };
    const onReveal = (r) => {
      setReveal(r);
      setSecondsLeft(null);
      setCounts(r.counts);
    };
    const onFinished = (f) => {
      setFinal(f);
      setQuestion(null);
      setReveal(null);
      setSecondsLeft(null);
    };
    const onCount = (d) => {
      setAnswered(d.answered);
      if (d.counts) setCounts(d.counts);
    };
    const onReaction = (r) => {
      const item = { ...r, id: Date.now() + Math.random(), left: 8 + Math.random() * 84 };
      setReactions((cur) => [...cur.slice(-15), item]);
      setTimeout(() => setReactions((cur) => cur.filter((x) => x.id !== item.id)), 3000);
    };
    const onLobby = (d) => {
      setQuestion(null);
      setReveal(null);
      setFinal(null);
      setBlock(null);
      setSecondsLeft(null);
      if (d?.title) setGame((g) => (g ? { ...g, state: "lobby", title: d.title } : g));
    };
    const onClosed = () => setStatus("closed");
    // EM-55: неигровые блоки — зал показывает карточку блока (макеты §4.6 — EM-56)
    const onBlock = (payload) => {
      setBlock(payload);
      setQuestion(null);
      setReveal(null);
      setFinal(null);
      setSecondsLeft(null);
      setRatingStats(null);
      setOpenended(null);
      setCloud(null);
      if (payload.blockType === "video") {
        // новый video-блок: чистое состояние, фолбэк autoplay сброшен
        setVideoState(null);
        setVideoBlocked(false);
        ytPosRef.current = 0;
      }
    };
    // EM-67: состояние управления видео (контролы пульта и реплей при подключении)
    const onVideoState = (s) => setVideoState(s);
    // EM-57: агрегат оценок — и снапшот при подключении (state), и каждый голос (update)
    const onRatingStats = (d) => setRatingStats(d);
    // EM-58: лента ответов — state при подключении, response — каждый новый ответ
    const onOpenendedState = (d) => setOpenended(d);
    const onOpenendedResponse = (r) =>
      setOpenended((cur) =>
        cur ? { ...cur, responses: [...cur.responses, r], totalResponses: cur.totalResponses + 1 } : { kind: "openended", responses: [r], totalResponses: 1, totalGuests: 0 }
      );
    // EM-59: облако — state при подключении/старте, word — каждое новое слово
    const onWordcloudState = (d) => setCloud(d);
    const onWordcloudWord = (w) =>
      setCloud((cur) => {
        const words = cur ? cur.words.map((x) => ({ ...x })) : [];
        const found = words.find((x) => x.word === w.word);
        if (found) found.count = w.count;
        else words.push({ word: w.word, count: w.count });
        return { kind: "wordcloud", words, totalGuests: cur?.totalGuests ?? 0 };
      });

    socket.on("players", onPlayers);
    socket.on("question", onQuestion);
    socket.on("reveal", onReveal);
    socket.on("finished", onFinished);
    socket.on("event:finished", onFinished);
    socket.on("answer-count", onCount);
    socket.on("reaction", onReaction);
    socket.on("game:lobby", onLobby);
    socket.on("game:closed", onClosed);
    socket.on("rating:state", onRatingStats);
    socket.on("rating:update", onRatingStats);
    socket.on("openended:state", onOpenendedState);
    socket.on("openended:response", onOpenendedResponse);
    socket.on("wordcloud:state", onWordcloudState);
    socket.on("wordcloud:word", onWordcloudWord);
    for (const ev of ["block:text", "block:image", "block:audio", "block:break", "block:activity", "block:rating", "block:openended", "block:wordcloud", "block:video", "block:transition"])
      socket.on(ev, onBlock);
    socket.on("video:state", onVideoState);    return () => {
      socket.off("connect", join);
      socket.off("players", onPlayers);
      socket.off("question", onQuestion);
      socket.off("reveal", onReveal);
      socket.off("finished", onFinished);
      socket.off("event:finished", onFinished);
      socket.off("answer-count", onCount);
      socket.off("reaction", onReaction);
      socket.off("game:lobby", onLobby);
      socket.off("game:closed", onClosed);
      socket.off("rating:state", onRatingStats);
      socket.off("rating:update", onRatingStats);
      socket.off("openended:state", onOpenendedState);
      socket.off("openended:response", onOpenendedResponse);
      socket.off("wordcloud:state", onWordcloudState);
      socket.off("wordcloud:word", onWordcloudWord);
      for (const ev of ["block:text", "block:image", "block:audio", "block:break", "block:activity", "block:rating", "block:openended", "block:wordcloud", "block:video", "block:transition"])
        socket.off(ev, onBlock);
      socket.off("video:state", onVideoState);
    };
  }, [socket, pinParam]);

  // обратный отсчёт на вопросе
  useEffect(() => {
    if (secondsLeft == null || secondsLeft <= 0) return undefined;
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft]);

  // салют на финале
  useEffect(() => {
    if (!final) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    confetti({ particleCount: 160, spread: 110, origin: { y: 0.5 } });
  }, [final]);

  useEffect(() => {
    const sync = () => setIsFullscreen(Boolean(document.fullscreenElement));
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      // уход со страницы зала — гасим fullscreen
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, []);

  const toggleFullscreen = () => {
    // iPhone Safari: API для не-видео элементов нет — без guard будет синхронный TypeError
    if (!document.documentElement.requestFullscreen) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  };

  if (status === "not-found") {
    return (
      <div className="screen-stage">
        <h1>Игра не найдена</h1>
        <p className="muted">Проверьте PIN в адресе страницы или откройте игру заново из пульта.</p>
      </div>
    );
  }
  if (status === "closed") {
    return (
      <div className="screen-stage">
        <h1>Игра закрыта</h1>
        <p className="muted">Ведущий завершил игру. Чтобы начать новую — откройте её из пульта.</p>
      </div>
    );
  }
  if (status !== "live" || !game) {
    return (
      <div className="screen-stage">
        <p className="muted">Подключение…</p>
      </div>
    );
  }

  const joinUrl = `${window.location.origin}/play/${game.pin}`;

  // EM-55: карточка неигрового блока на проекторе — переход, текст, пауза и др.
  if (block && !question && !reveal && !final) {
    return (
      <div className="screen-page">
        <header className="screen-header">
          <Logo>{game.title}</Logo>
          <div className="screen-header-actions">
            {isFullscreen && <span className="screen-fullscreen-hint">Esc — выйти из полноэкрана</span>}
            {!isFullscreen && (
              <button className="btn btn-ghost" onClick={toggleFullscreen} aria-label="Во весь экран">
                <ExpandIcon className="inline-icon" />
                Во весь экран
              </button>
            )}
          </div>
        </header>
        <div className="screen-stage">
          {block.to ? (
            // TransitionScreen (§4.6): эмодзи + название + тип следующего блока
            <div className="screen-block" key={`t${block.blockIndex}`}>
              <div className="screen-block-emoji screen-block-emoji--transition" aria-hidden="true">
                {BLOCK_TYPES[block.to.type]?.icon}
              </div>
              <h1>{block.to.title}</h1>
              <p className="screen-block-type">{BLOCK_TYPES[block.to.type]?.label}</p>
            </div>
          ) : block.blockType === "text" ? (
            // TextScreen (§4.6): display-заголовок + body xl + опциональная картинка
            <div className="screen-block" key={`b${block.blockIndex}`}>
              <h1>{block.heading}</h1>
              {block.body && <p className="screen-block-body">{block.body}</p>}
              {block.imageUrl && <img className="screen-block-image" src={block.imageUrl} alt="" />}
            </div>
          ) : block.blockType === "break" ? (
            // BreakScreen (§4.6): иконка по подписи, ring-отсчёт 120×120
            <div className="screen-block" key={`b${block.blockIndex}`}>
              <div className="screen-block-emoji" aria-hidden="true">{breakEmoji(block.label)}</div>
              <h1>{block.label || "Перерыв"}</h1>
              {breakTimer.left != null && (
                <div className="timer-wrap screen-break-ring">
                  <svg className="timer-ring" viewBox="0 0 80 80" aria-hidden="true">
                    <circle className="timer-ring-track" cx="40" cy="40" r="34" />
                    <circle
                      className="timer-ring-fill"
                      cx="40"
                      cy="40"
                      r="34"
                      strokeDasharray={RING_CIRC}
                      strokeDashoffset={
                        RING_CIRC * (1 - Math.max(0, Math.min(1, breakTimer.left / breakTimer.total)))
                      }
                    />
                  </svg>
                  <span className="timer-digit screen-break-digit">{mmss(breakTimer.left)}</span>
                </div>
              )}
              <p className="screen-block-body">
                {block.duration > 0 ? `Вернёмся через ${block.duration} мин` : "Скоро продолжим"}
              </p>
            </div>
          ) : block.blockType === "image" ? (
            <div
              className={`screen-block${block.fullscreen ? " screen-block--imagefull" : ""}`}
              key={`b${block.blockIndex}`}
            >
              {block.url && <img className="screen-block-image" src={block.url} alt={block.caption || ""} />}
              {block.caption && <p className="screen-block-body">{block.caption}</p>}
            </div>
          ) : block.blockType === "audio" ? (
            // «Сейчас играет: [title]» + визуальный мини-плеер; сам звук — у ведущего (§4.2)
            <div className="screen-block" key={`b${block.blockIndex}`}>
              <p className="screen-block-eyebrow">Сейчас играет</p>
              <div className="screen-block-emoji" aria-hidden="true">🎵</div>
              <h1>{block.title || "Музыка"}</h1>
              <div className="audio-bars" aria-hidden="true"><i /><i /><i /><i /><i /></div>
            </div>
          ) : block.blockType === "video" ? (
            // EM-67 (мини-спека §3): ролик играет на зале, управление с пульта;
            // оверлей разблокировки — фолбэк autoplay-политики браузера, не элемент ведущего
            <div className="screen-block screen-block--video" key={`b${block.blockIndex}`}>
              {block.source === "file" && !block.url ? (
                // пустой блок (автосейв допускает) — тихая карточка вместо чёрного плеера
                <>
                  <div className="screen-block-emoji" aria-hidden="true">🎬</div>
                  <h1>{block.title || "Видео"}</h1>
                </>
              ) : block.source === "file" ? (
                <div className="screen-video-wrap">
                  <video
                    ref={videoRef}
                    className="screen-video"
                    src={block.url || undefined}
                    preload="auto"
                    playsInline
                  />
                  {videoBlocked && (
                    <button
                      type="button"
                      className="screen-video-unlock"
                      onClick={() => {
                        setVideoBlocked(false);
                        videoRef.current?.play()?.catch(() => setVideoBlocked(true));
                      }}
                    >
                      ▶ Нажмите, чтобы включить видео
                    </button>
                  )}
                </div>
              ) : block.embedUrl ? (
                <div className="screen-video-wrap">
                  <iframe
                    ref={embedRef}
                    className="screen-video"
                    src={block.embedUrl}
                    title={block.title || "Видео"}
                    allow="autoplay; fullscreen; picture-in-picture; encrypted-media; screen-wake-lock"
                    allowFullScreen
                    // iframe догрузился — повторяем команды, ушедшие в пустое окно до загрузки
                    onLoad={() => setVideoState((s) => (s ? { ...s } : s))}
                  />
                </div>
              ) : (
                <>
                  <div className="screen-block-emoji" aria-hidden="true">🎬</div>
                  <h1>{block.title || "Видео"}</h1>
                </>
              )}
              {block.title && <p className="screen-block-body">{block.title}</p>}
            </div>
          ) : block.blockType === "wordcloud" ? (
            // WordCloudDisplay (спека активностей §1.3): облако растёт в реальном времени
            <div className="screen-block screen-block--cloud" key={`b${block.blockIndex}`}>
              <h1>{block.prompt || "Ваши слова"}</h1>
              {cloud && cloud.words.length > 0 ? (
                <WordCloudDisplay words={cloud.words} colorScheme={block.colorScheme || "brand"} />
              ) : (
                <p className="screen-block-body">Отправляйте слова с телефона</p>
              )}
              <p className="screen-openended-count">
                {cloud
                  ? `${cloud.words.reduce((s, w) => s + w.count, 0)} ${plural(cloud.words.reduce((s, w) => s + w.count, 0), ["слово", "слова", "слов"])} от ${cloud.totalGuests} ${cloud.totalGuests === 1 ? "гостя" : "гостей"}`
                  : "Собираем слова…"}
              </p>
            </div>
          ) : block.blockType === "openended" ? (
            // OpenEndedScreen (спека активностей §7.4): промпт + лента последних 5
            <div className="screen-block" key={`b${block.blockIndex}`}>
              <h1>{block.prompt || "Ваши ответы"}</h1>
              {openended && openended.responses.length > 0 ? (
                <div className="screen-openended-list">
                  {[...openended.responses].slice(-5).map((r, i) => (
                    <div className="screen-openended-item" key={r.id} style={{ animationDelay: `${i * 150}ms` }}>
                      <span className="screen-openended-text">{r.text}</span>
                      <span className="screen-openended-name">— {r.guestName}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="screen-block-body">Пишите ответы на телефоне</p>
              )}
              <p className="screen-openended-count">
                {openended?.totalResponses
                  ? `${openended.totalResponses} ${plural(openended.totalResponses, ["ответ", "ответа", "ответов"])}`
                  : "Пока нет ответов"}
              </p>
            </div>
          ) : block.blockType === "rating" ? (
            // RatingScreen (спека активностей §5.4): промпт + среднее крупно + распределение
            <div className="screen-block" key={`b${block.blockIndex}`}>
              <h1>{block.prompt || "Оцените"}</h1>
              <div className="screen-rating">
                {block.showAverage !== false && (
                  <>
                    {/* без aria-live: среднее обновляется на каждый голос, скринридер бы захлёбался */}
                    <div className="screen-rating-avg">
                      {ratingStats && ratingStats.totalResponses > 0 ? ratingStats.average.toFixed(1) : "—"}
                    </div>
                    <p className="screen-rating-caption">средняя оценка</p>
                  </>
                )}
                <div className="screen-rating-bars">
                  {(ratingStats?.distribution ||
                    Array.from({ length: block.scale || 10 }, () => 0)).map((n, i) => {
                      const pct = ratingStats && ratingStats.totalResponses ? Math.round((n / ratingStats.totalResponses) * 100) : 0;
                      return (
                        <div className="screen-rating-row" key={i}>
                          <span className="screen-rating-num">{i + 1}</span>
                          <span className="screen-rating-bar">
                            <i
                              style={{
                                width: `${pct}%`,
                                opacity: pct === 0 ? 0 : 1,
                              }}
                            />
                          </span>
                          <span className="screen-rating-count">{n}</span>
                        </div>
                      );
                    })}
                </div>
                <p className="screen-block-body">
                  {ratingStats && ratingStats.totalGuests > 0
                    ? `${ratingStats.totalResponses} из ${ratingStats.totalGuests} гостей`
                    : ratingStats
                      ? "Пока нет оценок"
                      : "Оценивайте на телефоне"}
                </p>
              </div>
            </div>
          ) : (
            <div className="screen-block" key={`b${block.blockIndex}`}>
              <div className="screen-block-emoji" aria-hidden="true">{BLOCK_TYPES.activity.icon}</div>
              <h1>{block.title || "Активность"}</h1>
              {block.description && <p className="screen-block-body">{block.description}</p>}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="screen-page">
      <header className="screen-header">
        <Logo>{game.title}</Logo>
        <div className="screen-header-actions">
          {isFullscreen && <span className="screen-fullscreen-hint">Esc — выйти из полноэкрана</span>}
          {!isFullscreen && (
            <button className="btn btn-ghost" onClick={toggleFullscreen} aria-label="Во весь экран">
              <ExpandIcon className="inline-icon" />
              Во весь экран
            </button>
          )}
        </div>
      </header>
      <div className="screen-stage">
        <AudienceView
          game={game}
          question={question}
          reveal={reveal}
          final={final}
          answered={answered}
          counts={counts}
          live={live}
          secondsLeft={secondsLeft}
          reactions={reactions}
          joinUrl={joinUrl}
        />
      </div>
    </div>
  );
}
