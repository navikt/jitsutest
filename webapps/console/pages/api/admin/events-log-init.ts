import { createRoute, getUser, verifyAdmin } from "../../../lib/api";
import { checkRawToken } from "juava";
import { clickhouse } from "../../../lib/server/clickhouse";
import { z } from "zod";
import { getServerLog } from "../../../lib/server/log";

const log = getServerLog("events-log-init");

export default createRoute()
  .GET({
    query: z.object({
      token: z.string().optional(),
    }),
  })
  .handler(async ({ req, res, query }) => {
    let initTokenUsed = false;
    if (process.env.CONSOLE_INIT_TOKEN && query.token) {
      if (checkRawToken(process.env.CONSOLE_INIT_TOKEN, query.token)) {
        process.env.CONSOLE_INIT_TOKEN = undefined;
        initTokenUsed = true;
      }
    }
    if (!initTokenUsed) {
      const user = await getUser(res, req);
      if (!user) {
        res.status(401).send({ error: "Authorization Required" });
        return;
      }
      await verifyAdmin(user);
    }
    log.atInfo().log(`Init events log`);
    const metricsSchema =
      process.env.CLICKHOUSE_METRICS_SCHEMA || process.env.CLICKHOUSE_DATABASE || "newjitsu_metrics";
    const metricsCluster = process.env.CLICKHOUSE_METRICS_CLUSTER || process.env.CLICKHOUSE_CLUSTER;
    const onCluster = metricsCluster ? ` ON CLUSTER ${metricsCluster}` : "";
    const createDbQuery: string = `create database IF NOT EXISTS ${metricsSchema}${onCluster}`;
    try {
      await clickhouse.command({
        query: createDbQuery,
      });
      log.atInfo().log(`Database ${metricsSchema} created or already exists`);
    } catch (e: any) {
      log.atError().withCause(e).log(`Failed to create ${metricsSchema} database.`);
      throw new Error(`Failed to create ${metricsSchema} database.`);
    }
    const errors: Error[] = [];
    const createEventsLogTableQuery: string = `create table IF NOT EXISTS ${metricsSchema}.events_log ${onCluster}
         (
           timestamp DateTime64(3),
           actorId LowCardinality(String),
           type LowCardinality(String),
           level LowCardinality(String),
           message   String
         )
         engine = ${
           metricsCluster
             ? "ReplicatedMergeTree('/clickhouse/tables/{shard}/" + metricsSchema + "/events_log', '{replica}')"
             : "MergeTree()"
         } 
        PARTITION BY toYYYYMM(timestamp)
        ORDER BY (actorId, type, timestamp)`;

    try {
      await clickhouse.command({
        query: createEventsLogTableQuery,
      });
      log.atInfo().log(`Table ${metricsSchema}.events_log created or already exists`);
    } catch (e: any) {
      log.atError().withCause(e).log(`Failed to create ${metricsSchema}.events_log table.`);
      errors.push(new Error(`Failed to create ${metricsSchema}.events_log table.`));
    }
    const createTaskLogTableQuery: string = `create table IF NOT EXISTS ${metricsSchema}.task_log ${onCluster}
         (
           task_id String,
           sync_id LowCardinality(String),
           timestamp DateTime64(3),
           level LowCardinality(String),
           logger LowCardinality(String),
           message   String
         )
         engine = ${
           metricsCluster
             ? "ReplicatedMergeTree('/clickhouse/tables/{shard}/" + metricsSchema + "/task_log', '{replica}')"
             : "MergeTree()"
         } 
        PARTITION BY toYYYYMM(timestamp)
        ORDER BY (task_id, sync_id, timestamp)
        TTL toDateTime(timestamp) + INTERVAL 3 MONTH DELETE`;

    try {
      await clickhouse.command({
        query: createTaskLogTableQuery,
      });
      log.atInfo().log(`Table ${metricsSchema}.task_log created or already exists`);
    } catch (e: any) {
      log.atError().withCause(e).log(`Failed to create ${metricsSchema}.task_log table.`);
      errors.push(new Error(`Failed to create ${metricsSchema}.task_log table.`));
    }
    if (errors.length > 0) {
      throw new Error("Failed to initialize tables: " + errors.map(e => e.message).join(", "));
    }
  })
  .toNextApiHandler();
