# EventMaster — инструкции для агента

Realtime-приложение для мероприятий: квизы и живые опросы. Хост запускает игру с большого экрана, игроки подключаются с телефонов по 6-значному PIN-коду. MVP, деплой на Render.

## Стек

- **Клиент**: React 18 + Vite, `react-router-dom`, `socket.io-client`, `qrcode`. Без UI-библиотек, стили в `client/src/styles.css`.
- **Сервер**: Express + Socket.IO + SQLite (`node:sqlite`, встроенный модуль Node 24), JWT (`jsonwebtoken`), `bcryptjs`. ESM (`"type": "module"`).
- **Деплой**: Render (`render.yaml`), один web-сервис: Express раздаёт собранный клиент из `client/dist`. SQLite-файл живёт на примонтированном диске (`DATA_DIR=/data`).

## Команды

```bash
npm run setup        # установить зависимости server/ и client/
npm run dev:server   # сервер на :3001, node --watch (сам перезапускается при правках)
npm run dev:client   # Vite dev-server (проксирует API на :3001)
npm run build        # сборка клиента в client/dist
npm start            # прод-режим: сервер раздаёт client/dist
```

## Архитектура

**Сервер (`server/src/`)**
- `index.js` — HTTP + Socket.IO, статика из `client/dist`, админка Socket.IO в dev (`/admin`, логин `admin` / `eventmaster-dev`, отключается `NODE_ENV=production`).
- `auth.js` — регистрация/логин, JWT, middleware `authRequired`, `verifyToken`.
- `quizzes.js` — CRUD квизов/опросов (`/api/quizzes`), всё под `authRequired`, проверка `host_id` на владельца.
- `game.js` — **игровая логика и состояние. Состояние игр в памяти (`Map` по PIN) — при рестарте сервера активные игры пропадают, это осознанное решение MVP.**
- `db.js` — схема: `users`, `quizzes` (`type: 'quiz' | 'poll'`), `questions` (с `time_limit`), `answers` (`is_correct`). Миграции — простые `ALTER TABLE` в try/catch.

**Клиент (`client/src/`)**
- `pages/HostGame.jsx` — экран хоста (PIN, лидерборд, управление игрой), `pages/PlayGame.jsx` — экран игрока, `pages/QuizEditor.jsx` — редактор квизов, `pages/Dashboard.jsx`, `pages/Landing.jsx`, `pages/AuthPage.jsx`.
- `socket.js` / `api.js` / `auth.jsx` — обёртки над Socket.IO, fetch и JWT-контекстом.
- `customize.js` — кастомизация внешнего вида игры.

## События Socket.IO (клиент ↔ сервер)

Комнаты: `game:<pin>`. Хост-события: `host:create-game` (с JWT в payload), `host:start`, `host:reveal`, `host:next`, `host:play-again`, `host:end`. Игрок: `player:join`, `player:answer` (один ответ на вопрос), `player:reaction`. Сервер шлёт: `players`, `question`, `answer-count` (только хосту), `reveal`, `finished`, `reaction`, `game:closed`. Многие события используют ack-колбэки для ошибок.

Тайминги: на вопрос 20 сек по умолчанию (`time_limit` вопроса), очки 1000 за правильный + до 500 бонуса за скорость.

## Конвенции

- Комментарии в коде — на русском, по-короткому и только для неочевидного.
- **Мультиагентный режим по умолчанию**: разведку по кодовой базе, параллельные исследования и ревью больших объёмов кода делегировать субагентам (Explore для поиска, general-purpose для многошаговых задач). Правки кода и финальные выводы — только в основном агенте. Браузерные/computer-use скиллы субагентам недоступны.
- Не коммитить в `main` — рабочие ветки (например, `EM-1`) и PR. Hook в `.zcode/hooks/guard.js` блокирует пуш в `main` и правки `.env`.
- Секреты — только в переменных окружения (`JWT_SECRET` генерится на Render), в репозитории не хранить.
- При правках `game.js` держать в голове гонки: игрок может ответить после `reveal`, отключиться в любой момент, отправить второй ответ.

## Что важно не сломать

- Обратная совместимость схем БД: миграции в `db.js` идемпотентные (`CREATE TABLE IF NOT EXISTS` + try/catch на `ALTER`).
- `app.get("*")` в `index.js` не должен перехватывать `/api` и `/socket.io`.
- На Render один процесс: масштабирование в несколько инстансов сломает in-memory `games`.
