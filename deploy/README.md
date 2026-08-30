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

Скрипт сам: поставит Node 24 + nginx + sqlite3, склоняет код, соберёт клиент (`client/dist`),
сгенерирует `JWT_SECRET`, поставит systemd-юнит и конфиг nginx, включит ежедневный бэкап
SQLite (таймер `eventmaster-backup.timer`, копии в `/var/backups/eventmaster/`, хранятся 14 дней)
и запустит всё.

Проверка: `curl http://<внешний-IP>/api/health` → `{"ok":true,...}`, и открыть `http://<внешний-IP>/` в браузере.

## 3a. Бэкапы (после обновления репозитория на уже настроенной ВМ)

Если сервер настраивался до появления блока бэкапов, один раз доустановить:

```bash
sudo apt install -y sqlite3
sudo cp deploy/backup-eventmaster.sh /opt/eventmaster/deploy/ && sudo chmod 755 /opt/eventmaster/deploy/backup-eventmaster.sh
sudo cp deploy/eventmaster-backup.service deploy/eventmaster-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now eventmaster-backup.timer
sudo systemctl start eventmaster-backup.service   # первый бэкап сразу
```

Восстановление (сначала сохрани текущую БД, затем убери journal-файлы — иначе при старте риск рассинхрона):

```bash
sudo systemctl stop eventmaster
sudo cp /var/lib/eventmaster/app.db /var/lib/eventmaster/app.db.broken-$(date +%s)
sudo cp /var/backups/eventmaster/app-<дата>.db /var/lib/eventmaster/app.db
sudo rm -f /var/lib/eventmaster/app.db-journal /var/lib/eventmaster/app.db-wal /var/lib/eventmaster/app.db-shm
sudo systemctl start eventmaster
```

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
- **Порт 3001 наружу не открывать** (только 80/443): сервер ходит за nginx с `trust proxy`, прямые запросы мимо nginx могут подделать `X-Forwarded-For` и обойти rate-limit.
- Секрет юнита: `sudo systemctl cat eventmaster` (файл с правами 600).
