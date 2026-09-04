import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getSocket } from "../socket";
import AudienceView from "../components/AudienceView";
import Logo from "../components/Logo";
import { ExpandIcon } from "../components/icons";
import confetti from "canvas-confetti";

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
      setSecondsLeft(null);
      if (d?.title) setGame((g) => (g ? { ...g, state: "lobby", title: d.title } : g));
    };
    const onClosed = () => setStatus("closed");

    socket.on("players", onPlayers);
    socket.on("question", onQuestion);
    socket.on("reveal", onReveal);
    socket.on("finished", onFinished);
    socket.on("answer-count", onCount);
    socket.on("reaction", onReaction);
    socket.on("game:lobby", onLobby);
    socket.on("game:closed", onClosed);
    return () => {
      socket.off("connect", join);
      socket.off("players", onPlayers);
      socket.off("question", onQuestion);
      socket.off("reveal", onReveal);
      socket.off("finished", onFinished);
      socket.off("answer-count", onCount);
      socket.off("reaction", onReaction);
      socket.off("game:lobby", onLobby);
      socket.off("game:closed", onClosed);
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

  return (
    <div className="screen-page">
      <header className="screen-header">
        <Logo>{game.title}</Logo>
        <div className="screen-header-actions">
          {isFullscreen && <span className="screen-fullscreen-hint">Esc — выйти из полноэкрана</span>}
          <Link className="btn btn-ghost" to={`/host/${game.quizId}`}>
            Пульт
          </Link>
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
