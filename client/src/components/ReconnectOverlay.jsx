import React, { useEffect, useRef, useState } from "react";

// EM-45 (addendum §2.6): оверлей переподключения для игрока (PlayGame) и пульта (HostPanel).
// Состояния: reconnecting (спиннер + обратный отсчёт 30с) → reconnected (auto-hide 1.5с)
// или failed (кнопки). Хватается за события сокета, поэтому живёт здесь же.
const TIMEOUT_SEC = 30;

export function useReconnectStatus(socket, enabled) {
  const [state, setState] = useState(null); // null | "reconnecting" | "reconnected" | "failed"
  const [secondsLeft, setSecondsLeft] = useState(null);
  const hideTimer = useRef(null);
  const failTimer = useRef(null);
  const secsRef = useRef(TIMEOUT_SEC);

  useEffect(() => {
    if (!enabled) {
      setState(null);
      setSecondsLeft(null);
      return undefined;
    }
    const onDisconnect = () => {
      // гасим «восстановлено»-таймер: на флапающем соединении disconnect может
      // прийти раньше, чем hideTimer спрятал оверлей
      clearTimeout(hideTimer.current);
      setState("reconnecting");
      secsRef.current = TIMEOUT_SEC;
      setSecondsLeft(TIMEOUT_SEC);
      clearInterval(failTimer.current);
      failTimer.current = setInterval(() => {
        secsRef.current -= 1;
        setSecondsLeft(secsRef.current);
        if (secsRef.current <= 0) {
          clearInterval(failTimer.current);
          setState("failed");
        }
      }, 1000);
    };
    const onConnect = () => {
      clearInterval(failTimer.current);
      // транспорт восстановился — фазу доедет rejoin/reclaim; короткий «восстановлено»
      setState("reconnected");
      setSecondsLeft(null);
      clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setState(null), 1500);
    };
    socket.on("disconnect", onDisconnect);
    socket.on("connect", onConnect);
    return () => {
      socket.off("disconnect", onDisconnect);
      socket.off("connect", onConnect);
      clearInterval(failTimer.current);
      clearTimeout(hideTimer.current);
    };
  }, [socket, enabled]);

  return { state, secondsLeft };
}

export default function ReconnectOverlay({ state, secondsLeft, retryLabel = "В лобби", onRetry, onHome }) {
  if (!state) return null;
  return (
    <div className="reconnect-overlay" role="alert">
      <div className="reconnect-card">
        {state === "reconnecting" && (
          <>
            <div className="reconnect-spinner" aria-hidden="true" />
            <span className="reconnect-spinner-alt" aria-hidden="true">…</span>
            <p className="reconnect-title">Потеряно соединение. Переподключаемся…</p>
            {secondsLeft != null && <p className="reconnect-sub">Осталось ~{secondsLeft} с</p>}
          </>
        )}
        {state === "reconnected" && (
          <>
            <span className="reconnect-icon ok" aria-hidden="true">✓</span>
            <p className="reconnect-title ok">Соединение восстановлено</p>
          </>
        )}
        {state === "failed" && (
          <>
            <span className="reconnect-icon bad" aria-hidden="true">✗</span>
            <p className="reconnect-title">Не удалось подключиться. Проверьте интернет.</p>
            <div className="reconnect-actions">
              <button type="button" className="btn btn-outline" onClick={onRetry}>
                {retryLabel}
              </button>
              <button type="button" className="btn btn-ghost" onClick={onHome}>
                На главную
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
