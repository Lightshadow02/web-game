#!/usr/bin/env bash
# Met à jour Game Hub : récupère le code depuis GitHub puis reconstruit/relance le conteneur.
# Usage : ./update.sh
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || cp .env.example .env

git pull --ff-only
docker compose up -d --build
docker image prune -f >/dev/null

docker compose ps
