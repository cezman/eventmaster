import React, { useMemo } from "react";

// EM-59: облако слов без внешних библиотек. Слова (топ-N по частоте) раскладываются
// эллиптической спиралью с проверкой прямоугольников — детерминированно, поэтому кадр
// на зале/пульте стабилен, а новые слова анимируются только у себя (key = слово).
const W = 1200;
const H = 600;

const tierOf = (t) => (t >= 0.66 ? "big" : t >= 0.33 ? "mid" : "small");

export default function WordCloudDisplay({ words, colorScheme = "brand" }) {
  const placed = useMemo(() => {
    const sorted = [...(words || [])].sort((a, b) => b.count - a.count).slice(0, 100);
    if (!sorted.length) return [];
    const maxCount = sorted[0].count;
    const boxes = [];
    const out = [];
    sorted.forEach(({ word, count }, idx) => {
      // при облаке из одинаковых частот (все count=1) иначе все слова «big» —
      // затухаем по рангу, чтобы ранняя стадия облака не разваливала спираль
      const t =
        maxCount === 1
          ? Math.max(0.15, 1 - idx / Math.max(sorted.length, 8))
          : (count - 1) / (maxCount - 1);
      const size = Math.round(18 + t * 46); // 18..64 в координатах viewBox
      const wpx = Math.round(word.length * size * 0.6) + size * 0.4;
      const hpx = size;
      let pos = null;
      for (let step = 0; step < 900 && !pos; step++) {
        const angle = step * 0.35;
        const radius = 7 * Math.sqrt(step);
        const cx = W / 2 + radius * Math.cos(angle) * 1.55; // эллипс под широкий экран
        const cy = H / 2 + radius * Math.sin(angle) * 0.8;
        const x0 = cx - wpx / 2;
        const y0 = cy - hpx / 2;
        if (x0 < 4 || y0 < 4 || x0 + wpx > W - 4 || y0 + hpx > H - 4) continue;
        const hits = boxes.some((b) => x0 < b.x1 && x0 + wpx > b.x0 && y0 < b.y1 && y0 + hpx > b.y0);
        if (!hits) pos = { x: cx, y: cy };
      }
      if (!pos) return; // не влезло — пропускаем, спека разрешает топ-100
      boxes.push({ x0: pos.x - wpx / 2, y0: pos.y - hpx / 2, x1: pos.x + wpx / 2, y1: pos.y + hpx / 2 });
      const hue = [...word].reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) % 997, 7) % 360;
      out.push({
        word,
        size,
        x: pos.x,
        y: pos.y,
        tier: tierOf(t),
        fill: colorScheme === "rainbow" ? `hsl(${hue} 72% 58%)` : undefined,
      });
    });
    return out;
  }, [words, colorScheme]);

  return (
    <svg className="wc-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Облако слов">
      {placed.map((w) => (
        <text
          key={w.word}
          className={`wc-word wc-word--${w.tier}`}
          x={w.x}
          y={w.y}
          textAnchor="middle"
          fontSize={w.size}
          fill={w.fill}
        >
          {w.word}
        </text>
      ))}
    </svg>
  );
}
