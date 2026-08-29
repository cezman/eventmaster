#!/usr/bin/env bash
# Одноразовая настройка свежей Ubuntu 24.04 на Yandex Cloud под EventMaster.
# Запускать от пользователя с sudo:  bash deploy/setup-server.sh <URL-репозитория>
set -euo pipefail

REPO_URL="${1:?Укажи URL репозитория: bash deploy/setup-server.sh https://github.com/.../eventmaster.git}"

echo "=== 1. Пакеты: Node 24, nginx, git ==="
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg nginx git
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list
sudo apt-get update
sudo apt-get install -y nodejs
node -v

echo "=== 2. Каталоги приложения и данных ==="
sudo mkdir -p /opt/eventmaster /var/lib/eventmaster
sudo chown -R www-data:www-data /opt/eventmaster /var/lib/eventmaster

echo "=== 3. Код и сборка клиента ==="
sudo git clone "$REPO_URL" /opt/eventmaster
sudo chown -R www-data:www-data /opt/eventmaster
cd /opt/eventmaster
sudo -u www-data npm run setup
sudo -u www-data npm run build

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

echo
echo "Готово. Проверка: curl http://127.0.0.1:3001/api/auth/me"
echo "Снаружи: http://<внешний-IP-ВМ>/  (порт 80 должен быть открыт в группе безопасности Yandex Cloud)"
