#!/bin/bash

# Enable Prisma debugging
export DEBUG="prisma:*:info"

# Set Prisma CLI cache directory to a writable location
export PRISMA_CLI_CACHE_DIR="/tmp/.cache"

# Create the cache directory if it doesn't exist
mkdir -p $PRISMA_CLI_CACHE_DIR

# Export the client identity file if SSL credentials are available
if [[ -n "$NAIS_DATABASE_JITSUTEST_JITSUTEST_PASSWORD" && -n "$NAIS_DATABASE_JITSUTEST_JITSUTEST_SSLKEY" && -n "$NAIS_DATABASE_JITSUTEST_JITSUTEST_SSLCERT" ]]; then
  openssl pkcs12 -password pass:$NAIS_DATABASE_JITSUTEST_JITSUTEST_PASSWORD -export -out /tmp/client-identity.p12 -inkey $NAIS_DATABASE_JITSUTEST_JITSUTEST_SSLKEY -in $NAIS_DATABASE_JITSUTEST_JITSUTEST_SSLCERT
  
  # Convert the client identity file to PEM format
  openssl pkcs12 -in /tmp/client-identity.p12 -out /tmp/client-identity.pem -nodes -password pass:$NAIS_DATABASE_JITSUTEST_JITSUTEST_PASSWORD
  
  # Extract client certificate and key separately for PostgreSQL
  openssl pkcs12 -in /tmp/client-identity.p12 -out /tmp/client-cert.pem -clcerts -nokeys -password pass:$NAIS_DATABASE_JITSUTEST_JITSUTEST_PASSWORD
  openssl pkcs12 -in /tmp/client-identity.p12 -out /tmp/client-key.pem -nocerts -nodes -password pass:$NAIS_DATABASE_JITSUTEST_JITSUTEST_PASSWORD
  
  # Check the contents of the PEM file
  openssl x509 -in /tmp/client-cert.pem -text -noout
  
  # Verify the certificates
  openssl verify -CAfile $NAIS_DATABASE_JITSUTEST_JITSUTEST_SSLROOTCERT /tmp/client-cert.pem
  VERIFY_EXIT_CODE=$?
  
  if [ $VERIFY_EXIT_CODE -eq 0 ]; then
    echo "Certificate verification successful."
  else
    echo "Certificate verification failed."
    if [ $VERIFY_EXIT_CODE -eq 20 ]; then
      echo "Error: unable to get local issuer certificate."
    fi
  fi
  
  # Check if the root certificate file exists
  if [ ! -f "$NAIS_DATABASE_JITSUTEST_JITSUTEST_SSLROOTCERT" ]; then
    echo "Root certificate file not found at $NAIS_DATABASE_JITSUTEST_JITSUTEST_SSLROOTCERT" >> /tmp/run_error.log
  fi
  
  # Check if the client certificate files exist
  if [ ! -f "/tmp/client-cert.pem" ]; then
    echo "Client certificate file not found at /tmp/client-cert.pem" >> /tmp/run_error.log
  fi
  
  if [ ! -f "/tmp/client-key.pem" ]; then
    echo "Client key file not found at /tmp/client-key.pem" >> /tmp/run_error.log
  fi
fi

# Construct DATABASE_URL with standard PostgreSQL SSL parameters
if [[ -n "$NAIS_DATABASE_JITSUTEST_JITSUTEST_USERNAME" && -n "$NAIS_DATABASE_JITSUTEST_JITSUTEST_PASSWORD" && -n "$NAIS_DATABASE_JITSUTEST_JITSUTEST_HOST" && -n "$NAIS_DATABASE_JITSUTEST_JITSUTEST_PORT" && -f "/tmp/client-cert.pem" ]]; then
  export DATABASE_URL="postgresql://$NAIS_DATABASE_JITSUTEST_JITSUTEST_USERNAME:$NAIS_DATABASE_JITSUTEST_JITSUTEST_PASSWORD@$NAIS_DATABASE_JITSUTEST_JITSUTEST_HOST:$NAIS_DATABASE_JITSUTEST_JITSUTEST_PORT/jitsutest?sslmode=require&sslcert=/tmp/client-cert.pem&sslkey=/tmp/client-key.pem&sslrootcert=$NAIS_DATABASE_JITSUTEST_JITSUTEST_SSLROOTCERT" || echo "Failed to set DATABASE_URL" >> /tmp/run_error.log
  echo "DATABASE_URL set to: $DATABASE_URL"
else
  echo "Error: Missing required SSL environment variables or client certificate not created"
  exit 1
fi

# Start the application
yarn start-docker