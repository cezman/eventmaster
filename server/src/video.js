// EM-67 (мини-спека §4): конверсия ссылки на страницу видео в embed-URL плеера.
// null = ссылка не распознана — такие отклоняются при сохранении блока.

const YT_ID = "([\\w-]{6,20})";
const VK_HOST = "https?://(?:m\\.)?(?:vk\\.com|vkvideo\\.ru)/";
const RT_HASH = "([a-f0-9]{32})";

export function parseVideoEmbed(source, url) {
  const raw = String(url || "").trim();
  if (!raw) return null;
  let m;
  if (source === "youtube") {
    if (
      (m = raw.match(new RegExp(`^https?://(?:www\\.)?youtube\\.com/watch\\?(?:[^#]*&)?v=${YT_ID}`, "i"))) ||
      (m = raw.match(new RegExp(`^https?://(?:www\\.)?youtube\\.com/shorts/${YT_ID}`, "i"))) ||
      (m = raw.match(new RegExp(`^https?://(?:www\\.)?youtube\\.com/embed/${YT_ID}`, "i"))) ||
      (m = raw.match(new RegExp(`^https?://youtu\\.be/${YT_ID}`, "i")))
    )
      return `https://www.youtube.com/embed/${m[1]}?enablejsapi=1&rel=0&modestbranding=1`;
    return null;
  }
  if (source === "vk") {
    if (
      (m = raw.match(new RegExp(`^${VK_HOST}(?:video|clip)(-?\\d+)_(\\d+)`, "i"))) ||
      // z= параметр валиден только на доменах VK: «видео N» копируется как …?z=video-1_2
      (m = raw.match(new RegExp(`^${VK_HOST}[^\\s]*[?&]z=(?:video|clip)(-?\\d+)_(\\d+)`, "i")))
    )
      return `https://vk.com/video_ext.php?oid=${m[1]}&id=${m[2]}&hd=2`;
    return null;
  }
  if (source === "rutube") {
    if (
      (m = raw.match(new RegExp(`^https?://rutube\\.ru/video/${RT_HASH}/?`, "i"))) ||
      (m = raw.match(new RegExp(`^https?://rutube\\.ru/play/embed/${RT_HASH}/?`, "i")))
    )
      return `https://rutube.ru/play/embed/${m[1]}`;
    return null;
  }
  return null;
}
