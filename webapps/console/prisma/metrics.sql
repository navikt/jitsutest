-- not managed by prisma
create table newjitsu_metrics.active_incoming on cluster jitsu_cluster
(
    timestamp DateTime,
    workspaceId LowCardinality(String),
    messageId String
)
    engine = Null;

CREATE MATERIALIZED VIEW newjitsu_metrics.mv_active_incoming2 on cluster jitsu_cluster
        (
         `workspaceId` LowCardinality(String),
         `timestamp` DateTime,
        `count` AggregateFunction(uniq, String)
        )
        ENGINE = ReplicatedAggregatingMergeTree('/clickhouse/tables/{shard}/newjitsu_metrics/mv_active_incoming2_0',
        '{replica}')
        ORDER BY (workspaceId, timestamp)
        PARTITION BY toYYYYMM(timestamp)
        SETTINGS index_granularity = 8192
AS
SELECT
    workspaceId,
    timestamp,
    uniqState(messageId) AS count
FROM newjitsu_metrics.active_incoming
GROUP BY
    workspaceId,
    timestamp;



create table newjitsu_metrics.mv_active_incoming3 on cluster jitsu_cluster
(
    `workspaceId` LowCardinality(String),
    `timestamp` DateTime,
    `messageId` String
)
    engine = ReplicatedReplacingMergeTree('/clickhouse/tables/{shard}/newjitsu_metrics/mv_active_incoming3_1', '{replica}')
        ORDER BY (workspaceId, timestamp, messageId)
        PRIMARY KEY (workspaceId, timestamp)
        PARTITION BY toYYYYMM(timestamp)
;

--drop  table newjitsu_metrics.mv_active_incoming3 on cluster jitsu_cluster;
--drop  view newjitsu_metrics.to_mv_active_incoming3 on cluster jitsu_cluster;

CREATE MATERIALIZED VIEW newjitsu_metrics.to_mv_active_incoming3 on cluster jitsu_cluster
        TO newjitsu_metrics.mv_active_incoming3
        (
         `workspaceId` LowCardinality(String),
         `timestamp` DateTime,
         `messageId` String
            )
AS
SELECT
    workspaceId,
    timestamp,
    messageId
FROM newjitsu_metrics.active_incoming;


CREATE TABLE IF NOT EXISTS newjitsu_metrics.metrics  on cluster jitsu_cluster
(
    timestamp DateTime,
    messageId String,
    workspaceId LowCardinality(String),
    streamId LowCardinality(String),
    connectionId LowCardinality(String),
    functionId LowCardinality(String),
    destinationId LowCardinality(String),
    status LowCardinality(String),
    events Int64,
    eventIndex UInt32
    )
    ENGINE = Null;

create table newjitsu_metrics.mv_metrics on cluster jitsu_cluster
(
    timestamp     DateTime,
    workspaceId   LowCardinality(String),
    streamId      LowCardinality(String),
    connectionId  LowCardinality(String),
    functionId    LowCardinality(String),
    destinationId LowCardinality(String),
    status        LowCardinality(String),
    events        AggregateFunction(sum, Int64)
)
    engine = ReplicatedAggregatingMergeTree('/clickhouse/tables/{shard}/newjitsu_metrics/mv_metrics', '{replica}')
        ORDER BY (timestamp, workspaceId, streamId, connectionId, functionId, destinationId, status)
        SETTINGS index_granularity = 8192;


CREATE MATERIALIZED VIEW newjitsu_metrics.to_mv_metrics on cluster jitsu_cluster
            TO newjitsu_metrics.mv_metrics
            (
             `timestamp` DateTime,
             `workspaceId` LowCardinality(String),
             `streamId` LowCardinality(String),
             `connectionId` LowCardinality(String),
             `functionId` LowCardinality(String),
             `destinationId` LowCardinality(String),
             `status` LowCardinality(String),
             `events` AggregateFunction(sum, Int64)
                )
AS
SELECT
    date_trunc('minute', timestamp) as timestamp,
    workspaceId,
    streamId,
    connectionId,
    functionId,
    destinationId,
    status,
    sumState(events) AS events
FROM newjitsu_metrics.metrics
GROUP BY
    timestamp,
    workspaceId,
    streamId,
    connectionId,
    functionId,
    destinationId,
    status;

