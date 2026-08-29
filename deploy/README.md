# Деплой EventMaster на Yandex Cloud (тест)

Целевая конфигурация: Ubuntu 24.04 ВМ + nginx + systemd + SQLite на диске ВМ.
Все нужные файлы лежат в этой папке: `setup-server.sh`, `eventmaster.service`, `nginx-eventmaster.conf`.

## 1. Создать ВМ в консоли Yandex Cloud

- Сервис **Compute Cloud → Виртуальные машины → Создать**.
- ОС: **Ubuntu 24.04**.
- Конфигурация: 2 vCPU (50% достаточно) / 2 ГБ RAM / HDD 10 ГБ — для теста с запасом.
- Доступ: SSH-ключ (создать/добавить свой публичный ключ в консоли).
- Публичный IPv4: **Автоматический**.
- В **группе безопасности** ВМ разрешить входящий **TCP 80** (и 22 для SSH). Порт 3001 наружу не открываем — наружу смотрит только nginx.

## 2. Залить код в git-репозиторий

Скрипт клонирует репозиторий на ВМ, так что код должен быть доступен по https (GitHub/GitVerse/GitLab — что доступно). Не забудь закоммитить папку `deploy/`.

## 3. Настроить сервер (одна команда по SSH)

```bash
ssh <user>@<внешний-IP>
git clone <url-этого-репозитория> && cd eventmaster   # или просто закинуть deploy/ через scp
bash deploy/setup-server.sh <URL-репозитория>
```

Скрипт сам: поставит Node 24 + nginx, склоняет код, соберёт клиент (`client/dist`),
сгенерирует `JWT_SECRET`, поставит systemd-юнит и конфиг nginx, запустит всё.

Проверка: открыть `http://<внешний-IP>/` в браузере — должна открыться лендинг-страница.

## 4. Для игры по HTTPS (рекомендуется)

Свой домен → A-запись на внешний IP ВМ, затем:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d <домен>
```

Certbot сам допишет 443 в конфиг nginx. Для чистого теста по IP можно сначала жить на http.

## 5. Обновление после правок кода

```bash
ssh <user>@<IP>
cd /opt/eventmaster
sudo -u www-data git pull
sudo -u www-data npm run build
sudo systemctl restart eventmaster
```

(можно завернуть в `deploy/update.sh`, когда надоест копировать)

## Важно знать для теста

- **Состояние игр в памяти** — рестарт `eventmaster.service` (или ВМ) убивает активные игры. Для тестов это ок, осознанное решение MVP.
- **SQLite** лежит в `/var/lib/eventmaster/` — переживает перезапуски, пользователи и квизы сохраняются.
- Секрет юнита: `sudo systemctl cat eventmaster` (файл с правами 600).
