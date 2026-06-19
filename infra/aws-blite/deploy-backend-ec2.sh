#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/nt219/NT219-Secure-Payment"
ENV_FILE="/opt/nt219/backend.env"
MATERIAL_DIR="/opt/nt219/security-material"
IMAGE_NAME="nt219-backend:latest"
CONTAINER_NAME="nt219-backend"

cd "$APP_DIR"

git pull

docker build -t "$IMAGE_NAME" .

docker stop "$CONTAINER_NAME" || true
docker rm "$CONTAINER_NAME" || true

docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  --env-file "$ENV_FILE" \
  -v "$MATERIAL_DIR/certs/ca:/run/certs/ca:ro" \
  -v "$MATERIAL_DIR/certs/backend:/run/certs/backend:ro" \
  -v "$MATERIAL_DIR/keys/public:/run/public:ro" \
  -p 3000:3000 \
  "$IMAGE_NAME"

sudo mkdir -p /var/log/nt219-backend
sudo touch /var/log/nt219-backend/docker.log
sudo chmod 0644 /var/log/nt219-backend/docker.log
pgrep -f "docker logs -f $CONTAINER_NAME" | xargs -r kill || true
nohup sh -c "docker logs -f $CONTAINER_NAME >> /var/log/nt219-backend/docker.log 2>&1" >/dev/null 2>&1 &

docker ps --filter "name=$CONTAINER_NAME"

cat <<'NOTE'
If database migrations are needed, run them separately after reviewing the target RDS instance:
  docker exec nt219-backend npm run migrate:deploy

Do not place production secrets in this script.
The private Security Service must already be reachable at SECURITY_SERVICE_BASE_URL:9443.
NOTE
