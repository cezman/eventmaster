// EM-56: общая карта типов блоков сценария для игровых поверхностей
// (пульт /host/event/<id>, зал /screen/<pin>, телефон /play/<pin>).
// Редактор сценария (EventPage) держит свои подписи по спеке дизайнера §3
// («Викторина», «Пауза») — это осознанное расхождение, не дрейф.
export const BLOCK_TYPES = {
  quiz: { icon: "❓", label: "Квиз" },
  poll: { icon: "📊", label: "Голосование" },
  text: { icon: "📝", label: "Текст" },
  image: { icon: "🖼️", label: "Изображение" },
  audio: { icon: "🎵", label: "Музыка" },
  break: { icon: "☕", label: "Перерыв" },
  activity: { icon: "🎯", label: "Активность" },
  rating: { icon: "⭐", label: "Оценка" },
  openended: { icon: "💬", label: "Ответы" },
  wordcloud: { icon: "☁️", label: "Облако слов" },
};

// человекочитаемое название текущего блока из payload block:*;
// transition-пейлоад показывает следующий блок (to)
export function blockDisplayTitle(b) {
  if (!b) return "";
  if (b.to) return b.to.title || "";
  switch (b.blockType) {
    case "text":
      return b.heading || "Текст";
    case "break":
      return b.label || "Перерыв";
    case "image":
      return b.caption || "Изображение";
    case "audio":
      return b.title || "Музыка";
    case "activity":
      return b.title || "Активность";
    case "rating":
      return b.prompt || "Оценка";
    case "openended":
      return b.prompt || "Свободный ответ";
    case "wordcloud":
      return b.prompt || "Облако слов";
    default:
      return "";
  }
}

// минуты:секунды для отсчётов паузы и секундомера активности
export function mmss(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
