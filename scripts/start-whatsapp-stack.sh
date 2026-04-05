#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NETWORK_NAME="clinical_app_net"
POSTGRES_CONTAINER="clinical-postgres"
REDIS_CONTAINER="clinical-redis"
AGENT_CONTAINER="clinical-agent-service"
AGENT_IMAGE="clinical-agent-service"

cd "$ROOT_DIR"

if [[ ! -f ".env" ]]; then
  echo "Missing .env file in $ROOT_DIR"
  exit 1
fi

docker network inspect "$NETWORK_NAME" >/dev/null 2>&1 || docker network create "$NETWORK_NAME" >/dev/null

docker build -t "$AGENT_IMAGE" ./agent_service >/dev/null

if ! docker ps -a --format '{{.Names}}' | grep -Fxq "$POSTGRES_CONTAINER"; then
  docker run -d \
    --name "$POSTGRES_CONTAINER" \
    --network "$NETWORK_NAME" \
    -e POSTGRES_DB=clinical_app \
    -e POSTGRES_USER=postgres \
    -e POSTGRES_PASSWORD=postgres \
    -p 5433:5432 \
    -v clinical_pgdata:/var/lib/postgresql/data \
    postgres:16 >/dev/null
else
  docker start "$POSTGRES_CONTAINER" >/dev/null
fi

if ! docker ps -a --format '{{.Names}}' | grep -Fxq "$REDIS_CONTAINER"; then
  docker run -d \
    --name "$REDIS_CONTAINER" \
    --network "$NETWORK_NAME" \
    redis:7 >/dev/null
else
  docker start "$REDIS_CONTAINER" >/dev/null
fi

if docker ps -a --format '{{.Names}}' | grep -Fxq "$AGENT_CONTAINER"; then
  docker rm -f "$AGENT_CONTAINER" >/dev/null
fi

docker run -d \
  --name "$AGENT_CONTAINER" \
  --network "$NETWORK_NAME" \
  --env-file .env \
  -e APP_ENV=development \
  -e APP_PORT=8010 \
  -e DATABASE_URL=postgresql://postgres:postgres@"$POSTGRES_CONTAINER":5432/clinical_app \
  -e REDIS_URL=redis://"$REDIS_CONTAINER":6379/0 \
  -p 8010:8010 \
  "$AGENT_IMAGE" >/dev/null

echo "Waiting for PostgreSQL on localhost:5433..."
until pg_isready -h localhost -p 5433 -U postgres >/dev/null 2>&1; do
  sleep 1
done

echo "Waiting for agent service on http://127.0.0.1:8010/health..."
until curl -fsS http://127.0.0.1:8010/health >/dev/null 2>&1; do
  sleep 1
done

echo
echo "WhatsApp stack is running:"
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep -E "NAMES|$POSTGRES_CONTAINER|$REDIS_CONTAINER|$AGENT_CONTAINER"
