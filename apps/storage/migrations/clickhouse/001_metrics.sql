CREATE TABLE IF NOT EXISTS metrics
(
    timestamp DateTime64(9, 'UTC'),
    service_name LowCardinality(String),
    environment LowCardinality(String),
    host LowCardinality(String),
    version LowCardinality(String),
    name LowCardinality(String),
    type LowCardinality(String),
    unit LowCardinality(String),
    value Float64,
    tags Map(String, String)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (service_name, environment, name, timestamp)
TTL toDateTime(timestamp) + INTERVAL 30 DAY
SETTINGS index_granularity = 8192;
