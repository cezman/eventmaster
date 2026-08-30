#!/usr/bin/env bash
# Одноразовая настройка свежей Ubuntu 24.04 на Yandex Cloud под EventMaster.
# Запускать от пользователя с sudo:  bash deploy/setup-server.sh <URL-репозитория>
set -euo pipefail

REPO_URL="${1:?Укажи URL репозитория: bash deploy/setup-server.sh https://github.com/.../eventmaster.git}"

echo "=== 1. Пакеты: Node 24, nginx, git, sqlite3 ==="
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg nginx git sqlite3
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --yes --dearmor -o /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list
sudo apt-get update
sudo apt-get install -y nodejs
node -v

echo "=== 2. Каталоги приложения и данных ==="
sudo mkdir -p /opt/eventmaster /var/lib/eventmaster
sudo chown -R www-data:www-data /opt/eventmaster /var/lib/eventmaster

echo "=== 3. Код и сборка клиента ==="
# скрипт можно перезапускать: если код уже склонён — обновляем вместо клона
if [ -d /opt/eventmaster/.git ]; then
  # pull тоже от www-data: git отказывается работать с чужой владельческой папкой (dubious ownership)
  sudo -u www-data git -C /opt/eventmaster pull --ff-only
else
  sudo git clone "$REPO_URL" /opt/eventmaster
fi
sudo chown -R www-data:www-data /opt/eventmaster
cd /opt/eventmaster
# npm от имени www-data: отдельный кеш, иначе падает с EACCES на /var/www/.npm
export NPM_CONFIG_CACHE=/tmp/npm-cache-www
sudo mkdir -p "$NPM_CONFIG_CACHE"
sudo chown -R www-data:www-data "$NPM_CONFIG_CACHE"
sudo -u www-data -E env "NPM_CONFIG_CACHE=$NPM_CONFIG_CACHE" npm run setup
sudo -u www-data -E env "NPM_CONFIG_CACHE=$NPM_CONFIG_CACHE" npm run build

echo "=== 4. systemd-юнит ==="
sudo cp deploy/eventmaster.service /etc/systemd/system/eventmaster.service
# секрет генерим один раз и вписываем в юнит
SECRET=$(openssl rand -hex 32)
sudo sed -i "s/__ЗАМЕНИ_НА_СВОЙ_СЕКРЕТ__/$SECRET/" /etc/systemd/system/eventmaster.service
sudo chmod 600 /etc/systemd/system/eventmaster.service
sudo systemctl daemon-reload
sudo systemctl enable --now eventmaster
sleep 2
systemctl --no-pager status eventmaster | head -5

echo "=== 5. nginx ==="
sudo cp deploy/nginx-eventmaster.conf /etc/nginx/sites-available/eventmaster
sudo ln -sf /etc/nginx/sites-available/eventmaster /etc/nginx/sites-enabled/eventmaster
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

echo "=== 6. Ежедневный бэкап SQLite (systemd timer) ==="
sudo cp deploy/backup-eventmaster.sh /opt/eventmaster/deploy/backup-eventmaster.sh
sudo chmod 755 /opt/eventmaster/deploy/backup-eventmaster.sh
sudo cp deploy/eventmaster-backup.service deploy/eventmaster-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now eventmaster-backup.timer
# прогоняем первый бэкап сразу, чтобы не ждать 04:00
sudo systemctl start eventmaster-backup.service
systemctl list-timers eventmaster-backup.timer --no-pager | head -3

echo
echo "Готово. Проверка: curl http://127.0.0.1:3001/api/health"
echo "Снаружи: http://<внешний-IP-ВМ>/  (порт 80 должен быть открыт в группе безопасности Yandex Cloud)"
