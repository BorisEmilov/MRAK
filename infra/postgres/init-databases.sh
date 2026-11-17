#!/bin/sh
# Creates the two isolated databases with distinct owners on first container start.
# Credentials come from environment variables (see .env.example); nothing is hardcoded.
set -eu

: "${ONLINE_DB_NAME:?}" "${ONLINE_DB_USER:?}" "${ONLINE_DB_PASSWORD:?}"
: "${STUDIO_DB_NAME:?}" "${STUDIO_DB_USER:?}" "${STUDIO_DB_PASSWORD:?}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v online_db="$ONLINE_DB_NAME" -v online_user="$ONLINE_DB_USER" -v online_pw="$ONLINE_DB_PASSWORD" \
  -v studio_db="$STUDIO_DB_NAME" -v studio_user="$STUDIO_DB_USER" -v studio_pw="$STUDIO_DB_PASSWORD" <<'SQL'
CREATE ROLE :"online_user" LOGIN PASSWORD :'online_pw';
CREATE DATABASE :"online_db" OWNER :"online_user";
REVOKE ALL ON DATABASE :"online_db" FROM PUBLIC;

CREATE ROLE :"studio_user" LOGIN PASSWORD :'studio_pw';
CREATE DATABASE :"studio_db" OWNER :"studio_user";
REVOKE ALL ON DATABASE :"studio_db" FROM PUBLIC;
SQL
