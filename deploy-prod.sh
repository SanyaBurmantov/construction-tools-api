#!/usr/bin/env sh
set -eu

ENV_FILE="${ENV_FILE:-.env.prod}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE. Copy .env.prod.example to $ENV_FILE and fill secrets first." >&2
  exit 1
fi

docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml up -d --build

echo "Production stack is starting. Check status with:"
echo "docker compose --env-file $ENV_FILE -f docker-compose.prod.yml ps"
