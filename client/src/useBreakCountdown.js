import { useEffect, useState } from "react";

// EM-56: обратный отсчёт break-блока (payload.duration — в минутах).
// Сервер сам переключает блок по своему таймеру — по нулевой секунде
// клиент просто держит 0:00 до прихода следующего блока.
export default function useBreakCountdown(block) {
  const active = Boolean(block && !block.to && block.blockType === "break" && block.duration > 0);
  const total = active ? block.duration * 60 : 0;
  const [left, setLeft] = useState(total);

  useEffect(() => {
    setLeft(total);
    if (!active) return undefined;
    const iv = setInterval(() => setLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(iv);
    // blockIndex в зависимостях: рестарт отсчёта при повторе того же блока
  }, [active, total, block?.blockIndex]);

  return { left: active ? left : null, total };
}
