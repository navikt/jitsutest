#!/bin/bash

# Construct DATABASE_URL with SSL configuration
export DATABASE_URL="postgresql://${NAIS_DATABASE_JITSUTEST_JITSUTEST_USERNAME}:${NAIS_DATABASE_JITSUTEST_JITSUTEST_PASSWORD}@${NAIS_DATABASE_JITSUTEST_JITSUTEST_HOST}:${NAIS_DATABASE_JITSUTEST_JITSUTEST_PORT}/${NAIS_DATABASE_JITSUTEST_JITSUTEST_DATABASE}?schema=newjitsu&sslmode=require"

echo "Starting application with DATABASE_URL configured..."
echo "DATABASE_URL: $DATABASE_URL"

# If arguments are passed, execute them
if [ $# -gt 0 ]; then
    exec "$@"
else
    # Try common Node.js startup commands
    if [ -f "/app/package.json" ]; then
        echo "Found package.json, trying npm start"
        exec npm start
    else
        echo "No startup command found, trying node server.js"
        exec node server.js
    fi
fi
