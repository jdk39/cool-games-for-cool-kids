#!/bin/bash
# start.sh — loads secrets from AWS Secrets Manager (using the server's IAM role)
# and starts the CoolGames API. No keys or passwords are stored in any file.
set -e
cd "$(dirname "$0")"

REGION=us-east-2

# ---- Fill these in ----
export DB_HOST="coolgames-db.c7iuui24c2wc.us-east-2.rds.amazonaws.com"   # RDS -> coolgames-db -> Connectivity & security -> Endpoint
DB_SECRET_ID="coolgames-db-credentials"
# -----------------------

export DB_NAME=coolgames
export MOCK=0

get_secret() {
  aws secretsmanager get-secret-value --region "$REGION" \
    --secret-id "$1" --query SecretString --output text
}
field() { node -e 'console.log(JSON.parse(process.argv[1])[process.argv[2]])' "$1" "$2"; }

IGDB=$(get_secret coolgames/igdb/API)
export TWITCH_CLIENT_ID=$(field "$IGDB" client_id)
export TWITCH_CLIENT_SECRET=$(field "$IGDB" client_secret)

DB=$(get_secret "$DB_SECRET_ID")
export DB_USER=$(field "$DB" username)
export DB_PASSWORD=$(field "$DB" password)

exec node server.js