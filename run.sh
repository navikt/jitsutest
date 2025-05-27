#!/bin/bash

# Create temp directory for certificates
mkdir -p /tmp/.cache

# Export the client identity file if SSL credentials are available
if [[ -n "$NAIS_DATABASE_JITSUTEST_JITSUTEST_PASSWORD" && -n "$NAIS_DATABASE_JITSUTEST_JITSUTEST_SSLKEY" && -n "$NAIS_DATABASE_JITSUTEST_JITSUTEST_SSLCERT" ]]; then
  openssl pkcs12 -password pass:$NAIS_DATABASE_JITSUTEST_JITSUTEST_PASSWORD -export -out /tmp/client-identity.p12 -inkey $NAIS_DATABASE_JITSUTEST_JITSUTEST_SSLKEY -in $NAIS_DATABASE_JITSUTEST_JITSUTEST_SSLCERT
fi

# Construct DATABASE_URL with SSL - all variables must be present
if [[ -n "$NAIS_DATABASE_JITSUTEST_JITSUTEST_USERNAME" && -n "$NAIS_DATABASE_JITSUTEST_JITSUTEST_PASSWORD" && -n "$NAIS_DATABASE_JITSUTEST_JITSUTEST_HOST" && -n "$NAIS_DATABASE_JITSUTEST_JITSUTEST_PORT" && -f "/tmp/client-identity.p12" ]]; then
  export DATABASE_URL="postgresql://$NAIS_DATABASE_JITSUTEST_JITSUTEST_USERNAME:$NAIS_DATABASE_JITSUTEST_JITSUTEST_PASSWORD@$NAIS_DATABASE_JITSUTEST_JITSUTEST_HOST:$NAIS_DATABASE_JITSUTEST_JITSUTEST_PORT/jitsutest?schema=newjitsu&sslidentity=/tmp/client-identity.p12&sslpassword=$NAIS_DATABASE_JITSUTEST_JITSUTEST_PASSWORD&sslcert=$NAIS_DATABASE_JITSUTEST_JITSUTEST_SSLROOTCERT"
  echo "DATABASE_URL set to: $DATABASE_URL"
else
  echo "Error: Missing required SSL environment variables or client certificate not created"
  exit 1
fi

# Start the application
exec "$@"
