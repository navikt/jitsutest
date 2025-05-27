FROM jitsucom/console:latest

EXPOSE 3000

# Set default environment variables that would typically come from docker-compose
ENV ROTOR_URL="http://rotor:3401" \
    BULKER_URL="http://bulker:3042" \
    MIT_COMPLIANT="false" \
    ENABLE_CREDENTIALS_LOGIN="true" \
    SYNCS_ENABLED="false" \
    FORCE_UPDATE_DB="true" \
    CLICKHOUSE_DATABASE="newjitsu_metrics" \
    MONGODB_NETWORK_COMPRESSION="none"

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/api/healthcheck || exit 1
