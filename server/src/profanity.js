// EM-58 (спека активностей §7.2): фильтр нецензурности для свободного ввода.
// russian-bad-words — только словарь (flatWords), без готового матчера.
// 1) точное совпадение нормализованного слова; 2) слова 4+ букв — по 4-буквенному
// префиксу (ловит словоформы «хуёвый» по «хуево»). Подстрочный поиск целиком
// не используем: он ловил бы «нах» внутри «находка».
//
// Известные компромиссы MVP (не баги): транслит и дефис/цифры внутри слова
// обходят фильтр (словарь чисто кириллический, токены дробятся по не-буквам).
import { flatWords } from "russian-bad-words";

const norm = (w) => String(w).toLowerCase().replace(/ё/g, "е");

// flatWords тянет за собой ярлыки частей речи пакета («noun», «perfective verb», …) —
// берём только кириллические слова, иначе префиксы «perf»/«qual» режут «performance»
const bannedSet = new Set((flatWords || []).map(norm).filter((w) => /^[а-я]+$/.test(w)));
const bannedPrefixes = new Set(
  [...bannedSet].filter((w) => w.length >= 4).map((w) => w.slice(0, 4))
);
// слова, чей 4-буквенный префикс совпал с мат-стемом («проект» vs «прое…» из
// «проебать») — вежливая лексика не должна ловиться префиксным правилом
const safeWords = new Set(
  [
    "проект", "проекты", "проекта", "проекте", "проектом", "проекту", "проектов", "проектам",
    "проекция", "проекции", "проекцию", "проекцией", "проектиров",
    "проезд", "проезда", "проезде", "проездом", "проезду",
    "проехали", "проехать", "проедем", "проеду",
  ].map(norm)
);

export function containsProfanity(text) {
  const words = norm(text).split(/[^a-z0-9а-я]+/).filter(Boolean);
  return words.some((w) => {
    if (safeWords.has(w)) return false;
    if (bannedSet.has(w)) return true;
    return w.length >= 4 && bannedPrefixes.has(w.slice(0, 4));
  });
}
