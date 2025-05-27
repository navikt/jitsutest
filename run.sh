#!/bin/bash

# Construct DATABASE_URL with SSL configuration
export DATABASE_URL="postgresql://${NAIS_DATABASE_JITSUTEST_JITSUTEST_USERNAME}:${NAIS_DATABASE_JITSUTEST_JITSUTEST_PASSWORD}@${NAIS_DATABASE_JITSUTEST_JITSUTEST_HOST}:${NAIS_DATABASE_JITSUTEST_JITSUTEST_PORT}/${NAIS_DATABASE_JITSUTEST_JITSUTEST_DATABASE}?schema=newjitsu&sslmode=require"

echo "Starting application with DATABASE_URL configured..."

# Execute the original container's command
exec "$@"
