// EM-58 (спека активностей §7.2): фильтр нецензурности для свободного ввода.
// russian-bad-words — только словарь (flatWords), без готового матчера.
// 1) точное совпадение нормализованного слова; 2) слова 4+ букв — по 4-буквенному
// префиксу (ловит словоформы «хуёвый» по «хуево»). Подстрочный поиск целиком
// не используем: он ловил бы «нах» внутри «находка».
import { flatWords } from "russian-bad-words";

const norm = (w) => String(w).toLowerCase().replace(/ё/g, "е");
const bannedSet = new Set((flatWords || []).map(norm));
const bannedPrefixes = new Set(
  [...bannedSet].filter((w) => w.length >= 4).map((w) => w.slice(0, 4))
);

export function containsProfanity(text) {
  const words = norm(text).split(/[^a-z0-9а-я]+/).filter(Boolean);
  return words.some((w) => {
    if (bannedSet.has(w)) return true;
    return w.length >= 4 && bannedPrefixes.has(w.slice(0, 4));
  });
}
