#!/bin/sh
set -e
# Run DB migrations then start the server
node dist/database/migrate.js
exec node dist/server.js
