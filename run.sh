#!/bin/bash

# Create temp directory for certificates
mkdir -p /tmp/.cache

# Export the client identity file if SSL credentials are available
if [[ -n "$NAIS_DATABASE_JITSUTEST_JITSUTEST_PASSWORD" && -n "$NAIS_DATABASE_JITSUTEST_JITSUTEST_SSLKEY" && -n "$NAIS_DATABASE_JITSUTEST_JITSUTEST_SSLCERT" ]]; then
  openssl pkcs12 -password pass:$NAIS_DATABASE_JITSUTEST_JITSUTEST_PASSWORD -export -out /tmp/client-identity.p12 -inkey $NAIS_DATABASE_JITSUTEST_JITSUTEST_SSLKEY -in $NAIS_DATABASE_JITSUTEST_JITSUTEST_SSLCERT
fi

# Construct DATABASE_URL from NAIS environment variables
if [[ -n "$NAIS_DATABASE_JITSUTEST_JITSUTEST_USERNAME" && -n "$NAIS_DATABASE_JITSUTEST_JITSUTEST_PASSWORD" && -n "$NAIS_DATABASE_JITSUTEST_JITSUTEST_HOST" && -n "$NAIS_DATABASE_JITSUTEST_JITSUTEST_PORT" ]]; then
  if [ -f "/tmp/client-identity.p12" ]; then
    # Use SSL connection with certificates
    export DATABASE_URL="postgresql://$NAIS_DATABASE_JITSUTEST_JITSUTEST_USERNAME:$NAIS_DATABASE_JITSUTEST_JITSUTEST_PASSWORD@$NAIS_DATABASE_JITSUTEST_JITSUTEST_HOST:$NAIS_DATABASE_JITSUTEST_JITSUTEST_PORT/jitsutest?schema=newjitsu&sslidentity=/tmp/client-identity.p12&sslpassword=$NAIS_DATABASE_JITSUTEST_JITSUTEST_PASSWORD&sslcert=$NAIS_DATABASE_JITSUTEST_JITSUTEST_SSLROOTCERT"
  else
    # Fallback to basic connection
    export DATABASE_URL="postgresql://$NAIS_DATABASE_JITSUTEST_JITSUTEST_USERNAME:$NAIS_DATABASE_JITSUTEST_JITSUTEST_PASSWORD@$NAIS_DATABASE_JITSUTEST_JITSUTEST_HOST:$NAIS_DATABASE_JITSUTEST_JITSUTEST_PORT/jitsutest?schema=newjitsu"
  fi
else
  # Use the original NAIS_DATABASE_URL as fallback
  export DATABASE_URL="$(NAIS_DATABASE_JITSUTEST_JITSUTEST_URL)&schema=newjitsu"
fi

echo "DATABASE_URL set to: $DATABASE_URL"

# Start the application
exec "$@"
