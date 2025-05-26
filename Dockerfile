FROM node:22.8-bookworm as base

WORKDIR /app
RUN apt-get update -y
RUN apt-get install nano curl cron bash netcat-traditional procps jq -y

FROM base as builder

RUN apt-get update -y
RUN apt-get install git openssl procps python3 make g++ -y
RUN npm -g install pnpm@^9.0.0

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
COPY . .

ENV NEXTJS_STANDALONE_BUILD=1
RUN pnpm install --no-frozen-lockfile
RUN pnpm build

FROM base as console

ARG JITSU_BUILD_VERSION=dev
ARG JITSU_BUILD_DOCKER_TAG=dev
ARG JITSU_BUILD_COMMIT_SHA=unknown

WORKDIR /app
RUN npm -g install prisma@latest
COPY --from=builder /app/docker-start-console.sh ./
COPY --from=builder /app/webapps/console/prisma/schema.prisma ./
COPY --from=builder /app/webapps/console/.next/standalone ./
COPY --from=builder /app/webapps/console/.next/static ./webapps/console/.next/static
COPY --from=builder /app/webapps/console/public ./webapps/console/public

COPY --from=builder /app/console.cron /etc/cron.d/console.cron
RUN chmod 0644 /etc/cron.d/console.cron
RUN crontab /etc/cron.d/console.cron

EXPOSE 3000

HEALTHCHECK CMD curl --fail http://localhost:3000/api/healthcheck || exit 1

ENV NODE_ENV=production
ENV JITSU_VERSION_COMMIT_SHA=${JITSU_BUILD_COMMIT_SHA}
ENV JITSU_VERSION_DOCKER_TAG=${JITSU_BUILD_DOCKER_TAG}
ENV JITSU_VERSION_STRING=${JITSU_BUILD_VERSION}

ENTRYPOINT ["sh", "-c", "/app/docker-start-console.sh"]
