const API = "/api";

export async function api(path, { method = "GET", body, token } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || "Что-то пошло не так");
    err.payload = data; // структурированные детали (напр. 409 удаления live-мероприятия: {live, pin})
    throw err;
  }
  return data;
}

// загрузка файла в /api/media (EM-66): тело запроса — сам файл, Content-Type — его MIME.
// Отдельно от api(), которая умеет только JSON; contentType — для файлов без MIME от
// браузера; endpoint — маршрут загрузки: видео идёт на /media/video (стрим на диск, EM-67)
export async function uploadMedia(file, token, contentType, endpoint = "/media") {
  const res = await fetch(`${API}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": contentType || file.type || "application/octet-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Не удалось загрузить файл");
  return data;
}
