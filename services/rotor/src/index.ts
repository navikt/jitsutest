import { checkHash, checkRawToken, disableService, getLog, setServerJsonFormat, isTruish } from "juava";
import { destinationMessagesTopic, getCredentialsFromEnv, rotorConsumerGroupId } from "./lib/kafka-config";
import { kafkaRotor } from "./lib/rotor";
import { createClickhouseLogger, DummyEventsStore, EventsStore, mongodb } from "@jitsu/core-functions";
import express from "express";
import { UDFRunHandler } from "./http/udf";
import Prometheus from "prom-client";
import { FunctionsHandler, FunctionsHandlerMulti } from "./http/functions";
import { initMaxMindClient, GeoResolver } from "./lib/maxmind";
import { MessageHandlerContext, rotorMessageHandler } from "./lib/message-handler";
import { createMetrics } from "./lib/metrics";
import { connectionsStore, functionsStore, streamsStore } from "./lib/repositories";
import { Server } from "node:net";
import { getApplicationVersion, getDiagnostics } from "./lib/version";
import { Redis } from "ioredis";
import { createRedis } from "./lib/redis";
import * as util from "util";
import { getHeapSnapshot } from "node:v8";
import { ProfileUDFRunHandler } from "./http/profiles-udf";
const log = getLog("rotor");

disableService("prisma");
disableService("pg");

setServerJsonFormat(process.env.LOG_FORMAT === "json");

const http = express();
http.use(express.json({ limit: "20mb" }));
http.use(express.urlencoded({ limit: "20mb" }));

const metricsHttp = express();

const rotorHttpPort = process.env.ROTOR_HTTP_PORT || process.env.PORT || 3401;
const rotorMetricsPort = process.env.ROTOR_METRICS_PORT || 9091;

let started = false;

async function main() {
  const errorTypes = ["unhandledRejection", "uncaughtException"];
  const signalTraps = ["SIGTERM", "SIGINT", "SIGUSR2"];

  errorTypes.forEach(type => {
    process.on(type, err => {
      log.atError().withCause(err).log(`process.on ${type}`);
    });
  });

  process.on("exit", code => {
    log.atInfo().log(`Process exited with code ${code}`);
  });

  let httpServer: Server;
  let metricsServer: Server | undefined;
  let geoResolver: GeoResolver;
  let eventsLogger: EventsStore;
  let redisClient: Redis | undefined;
  try {
    Prometheus.collectDefaultMetrics();
    try {
      await mongodb.waitInit();
    } catch (e: any) {
      log.atWarn().log("Failed to connect to mongodb. Functions Persistent Store won't work: " + e.message);
    }
    if (process.env.CLICKHOUSE_HOST || process.env.CLICKHOUSE_URL) {
      eventsLogger = createClickhouseLogger();
    } else {
      eventsLogger = DummyEventsStore;
    }
    if (process.env.REDIS_URL) {
      redisClient = createRedis();
    }

    const connStore = await connectionsStore.get();
    if (!connStore.enabled) {
      log.atError().log("Connection store is not configured. Rotor will not work");
      process.exit(1);
    }
    const funcStore = await functionsStore.get();
    if (!funcStore.enabled) {
      log.atError().log("Functions store is not configured. Rotor will not work");
      process.exit(1);
    }

    geoResolver = await initMaxMindClient({
      licenseKey: process.env.MAXMIND_LICENSE_KEY,
      url: process.env.MAXMIND_URL,
      s3Bucket: process.env.MAXMIND_S3_BUCKET,
    });
    metricsServer = initMetricsServer();
  } catch (e) {
    log.atError().withCause(e).log("Failed to start");
    process.exit(1);
  }

  const gracefulShutdown = async () => {
    if (httpServer) {
      httpServer.close();
    }
    connectionsStore.stop();
    functionsStore.stop();
    eventsLogger.close();
    mongodb.close();
    if (redisClient) {
      redisClient.disconnect();
    }
    const extraDelay = process.env.SHUTDOWN_EXTRA_DELAY_SEC
      ? 1000 * parseInt(process.env.SHUTDOWN_EXTRA_DELAY_SEC)
      : 5000;
    if (extraDelay > 0) {
      log.atInfo().log(`Giving extra ${extraDelay / 1000}s. to flush logs and scrape metrics...`);
      //extra time to flush logs
      setTimeout(() => {
        if (metricsServer) {
          metricsServer.close();
        }
        process.exit(started ? 0 : 1);
      }, extraDelay);
    }
  };

  if (process.env.KAFKA_BOOTSTRAP_SERVERS && !isTruish(process.env.HTTP_ONLY)) {
    //kafka consumer mode
    const kafkaTopics = [destinationMessagesTopic()];
    const consumerGroupId = rotorConsumerGroupId();
    const rotor = kafkaRotor({
      credentials: getCredentialsFromEnv(),
      kafkaTopics: kafkaTopics,
      consumerGroupId,
      rotorContext: { geoResolver, eventsLogger, redisClient },
      handle: rotorMessageHandler,
    });
    log.atInfo().log("Starting kafka processing");
    rotor
      .start()
      .then(chMetrics => {
        log.atInfo().log(`Kafka processing started. Listening for topics ${kafkaTopics} with group ${consumerGroupId}`);
        httpServer = initHTTP({ eventsLogger, metrics: chMetrics, geoResolver, redisClient });
      })
      .catch(async e => {
        log.atError().withCause(e).log("Failed to start rotor processing");
        await rotor.close();
        process.exit(1);
      });

    signalTraps.forEach(type => {
      process.once(type, () => {
        log.atInfo().log(`Signal ${type} received. Closing rotor`);
        rotor.close().then(gracefulShutdown);
      });
    });
  } else {
    const metrics = createMetrics();
    httpServer = initHTTP({ eventsLogger, metrics: metrics, geoResolver, redisClient });
    signalTraps.forEach(type => {
      process.once(type, () => {
        gracefulShutdown();
        metrics.close();
      });
    });
  }
}

function initHTTP(rotorContext: Omit<MessageHandlerContext, "connectionStore" | "functionsStore" | "streamsStore">) {
  http.use((req, res, next) => {
    if (req.path === "/health" || req.path === "/version") {
      return next();
    }
    let token = req.headers.authorization || "";
    if (token) {
      if (token.startsWith("Bearer ")) {
        token = token.substring("Bearer ".length);
      } else {
        res.status(401).json({ error: "Authorization header with Bearer token is required" });
        return;
      }
    }
    if (!checkAuth(token)) {
      if (token) {
        res.status(401).json({ error: `Invalid token: ${token}` });
      } else {
        res.status(401).json({ error: "Authorization header with Bearer token is required" });
      }
      return;
    }
    next();
  });
  http.get("/version", (req, res) => {
    res.json({
      ...getApplicationVersion(),
      node: {
        version: process.version,
        platform: process.platform,
        arch: process.arch,
        env: process.env.NODE_ENV,
      },
      diagnostics: isTruish(process.env.__DANGEROUS_ENABLE_FULL_DIAGNOSTICS) ? getDiagnostics() : undefined,
    });
  });
  http.get("/health", async (req, res) => {
    const mongoRequired = (process.env.REQUIRED_STORES ?? "").split(",").includes("mongodb");
    if (mongoRequired) {
      try {
        await pingMongo();
      } catch (e: any) {
        log.atError().withCause(e).log("MongoDB is not healthy");
        res.status(500).json({ error: "MongoDB is not healthy" });
        return;
      }
    }
    res.json({
      status: "pass",
      connectionsStore: {
        enabled: connectionsStore.getCurrent()?.enabled || "loading",
        status: connectionsStore.status(),
        lastUpdated: connectionsStore.lastRefresh(),
        lastModified: connectionsStore.lastModified(),
      },
      functionsStore: {
        enabled: functionsStore.getCurrent()?.enabled || "loading",
        status: functionsStore.status(),
        lastUpdated: functionsStore.lastRefresh(),
        lastModified: functionsStore.lastModified(),
      },
      streamsStore: {
        enabled: streamsStore.getCurrent()?.enabled || "loading",
        status: streamsStore.status(),
        lastUpdated: streamsStore.lastRefresh(),
        lastModified: streamsStore.lastModified(),
      },
    });
  });
  http.post("/udfrun", UDFRunHandler);
  http.post("/profileudfrun", ProfileUDFRunHandler);
  http.post("/func", FunctionsHandler(rotorContext));
  http.get("/wtf", async (req, res) => {
    res.setHeader("Content-Type", "text/plain");
    res.write(util.inspect(process["_getActiveHandles"]()));
    res.end();
  });
  http.get("/wtfheap", async (req, res) => {
    const snapshot = getHeapSnapshot();
    log.atInfo().log("snapshot");
    snapshot.pipe(res);
    log.atInfo().log("snapshot2");
  });
  http.post("/func/multi", FunctionsHandlerMulti(rotorContext));
  const httpServer = http.listen(rotorHttpPort, () => {
    log.atInfo().log(`Listening on port ${rotorHttpPort}`);
    started = true;
  });
  httpServer.on("error", e => {
    log.atError().withCause(e).log("Failed to start http server. Exiting...");
    process.kill(process.pid, "SIGTERM");
  });
  return httpServer;
}

function initMetricsServer() {
  metricsHttp.get("/metrics", async (req, res) => {
    res.writeHead(200, { "Content-Type": Prometheus.register.contentType });
    const result = await Prometheus.register.metrics();
    res.end(result);
  });
  const metricsServer = metricsHttp.listen(parseInt(rotorMetricsPort + ""), () => {
    log.atInfo().log(`Listening metrics on port ${rotorMetricsPort}`);
  });
  metricsServer.on("error", e => {
    log.atError().withCause(e).log("Failed to start metrics server");
  });
  return metricsServer;
}

async function pingMongo() {
  await mongodb.waitInit().then(c => c.connect().then(c => c.db().admin().ping()));
}

function checkAuth(token: string): boolean {
  let tokens: string[] = [];
  let checkFunction: (token: string, secret: string) => boolean = () => false;
  if (process.env.ROTOR_AUTH_TOKENS) {
    tokens = process.env.ROTOR_AUTH_TOKENS.split(",");
    checkFunction = checkHash;
  } else if (process.env.ROTOR_RAW_AUTH_TOKENS) {
    tokens = process.env.ROTOR_RAW_AUTH_TOKENS.split(",");
    checkFunction = checkRawToken;
  } else {
    log.atWarn().log("No auth tokens are configured. Rotor is open for everyone.");
    return true;
  }
  if (tokens.length > 0) {
    for (const tokenHashOrPlain of tokens) {
      if (checkFunction(tokenHashOrPlain, token)) {
        return true;
      }
    }
  }
  return false;
}

main();

export {};
