import React, { useRef, useState } from "react";
import { uploadMedia } from "../api";
import { useToast } from "./Toast";

// EM-66/EM-68: поле «ссылка + загрузка файла» (спека §3.5). Файл уходит в POST /api/media
// (видео — /media/video, стрим на диск), в content храним короткий url вида /media/<uuid>.<ext>;
// превью сразу под полем. Общий для BlockEditor (rich-блоки) и QuizEditor (картинка вопроса).
export const MEDIA_KINDS = {
  image: {
    accept: ".jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif",
    hint: "JPG, PNG, WebP или GIF, до 10 МБ",
    mbs: 10,
    ok: (file) => (file.type ? file.type.startsWith("image/") : /\.(jpe?g|png|webp|gif)$/i.test(file.name)),
    mimeByExt: { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" },
    wrong: "Поддерживаются JPG, PNG, WebP и GIF",
  },
  audio: {
    accept: ".mp3,.ogg,.wav,.m4a,audio/mpeg,audio/ogg,audio/wav,audio/mp4",
    hint: "MP3, WAV, OGG или M4A, до 25 МБ",
    mbs: 25,
    ok: (file) => (file.type ? file.type.startsWith("audio/") : /\.(mp3|ogg|wav|m4a)$/i.test(file.name)),
    mimeByExt: { mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", m4a: "audio/mp4" },
    wrong: "Поддерживаются MP3, WAV, OGG и M4A",
  },
  video: {
    accept: "video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov",
    hint: "MP4, WebM или MOV, до 200 МБ",
    mbs: 200,
    endpoint: "/media/video", // стриминговый маршрут: тело не буферизуем в памяти
    ok: (file) => (file.type ? file.type.startsWith("video/") : /\.(mp4|webm|mov)$/i.test(file.name)),
    mimeByExt: { mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" },
    wrong: "Поддерживаются MP4, WebM и MOV",
  },
};

export function MediaField({ id, label, kind, value, onUrl }) {
  const showToast = useToast();
  const token = localStorage.getItem("token");
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const spec = MEDIA_KINDS[kind];

  const pick = async (file) => {
    if (!file) return;
    if (!spec.ok(file)) {
      showToast(spec.wrong, "error");
      return;
    }
    if (file.size > spec.mbs * 1024 * 1024) {
      showToast(`Файл больше ${spec.mbs} МБ — выберите поменьше`, "error");
      return;
    }
    setBusy(true);
    try {
      // у части файлов (m4a и др.) браузер отдаёт пустой type — добираем MIME по расширению
      const ext = file.name.split(".").pop().toLowerCase();
      const mime = file.type || spec.mimeByExt[ext];
      const d = await uploadMedia(file, token, mime, spec.endpoint);
      onUrl(d.url);
    } catch (e) {
      showToast(`Не удалось загрузить файл: ${e.message}`, "error");
    }
    setBusy(false);
  };

  return (
    <div className="be-field">
      <label htmlFor={id}>{label}</label>
      <div className="be-upload">
        <input
          id={id}
          type="url"
          maxLength={500}
          value={value}
          placeholder="или вставьте ссылку"
          onChange={(e) => onUrl(e.target.value)}
        />
        <input
          ref={fileRef}
          type="file"
          accept={spec.accept}
          hidden
          onChange={(e) => {
            pick(e.target.files[0]);
            e.target.value = ""; // повторный выбор того же файла тоже сработает
          }}
        />
        <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => fileRef.current.click()}>
          {busy ? "Загружаю…" : "Загрузить"}
        </button>
      </div>
      {kind === "image" && value ? (
        <img className="be-thumb" src={value} alt="" />
      ) : kind === "audio" && value ? (
        <audio className="be-audio" controls preload="none" src={value} />
      ) : kind === "video" && value ? (
        <video className="be-video" controls preload="metadata" src={value} />
      ) : null}
      <span className="be-hint be-hint--field">{spec.hint}</span>
    </div>
  );
}
