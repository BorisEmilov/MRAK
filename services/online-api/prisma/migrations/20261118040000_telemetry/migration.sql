-- Telemetry (docs/systems/telemetry.md, threat model C-26). Kept in its own schema, outside the
-- Prisma model: partitioned tables are written with raw SQL. Opt-in, no personal data, 90 days.
CREATE SCHEMA IF NOT EXISTS telemetry;

CREATE TABLE telemetry.events (
  day         date             NOT NULL DEFAULT current_date,
  received_at timestamptz      NOT NULL DEFAULT now(),
  install     uuid             NOT NULL,
  session     uuid             NOT NULL,
  build       text             NOT NULL,
  demo        boolean          NOT NULL,
  name        text             NOT NULL,
  t           integer          NOT NULL,
  zone        text,
  key         text,
  cause       text,
  value       double precision,
  n           double precision,
  text        text
) PARTITION BY RANGE (day);

CREATE INDEX events_day_name_idx ON telemetry.events (day, name);

-- One partition per day: today + 7 ahead; partitions older than `retention` days are dropped.
CREATE FUNCTION telemetry.maintain(retention integer) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  d date;
  part record;
BEGIN
  FOR i IN 0..7 LOOP
    d := current_date + i;
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS telemetry.%I PARTITION OF telemetry.events FOR VALUES FROM (%L) TO (%L)',
      'events_' || to_char(d, 'YYYYMMDD'), d, d + 1);
  END LOOP;
  FOR part IN
    SELECT c.relname FROM pg_inherits inh
    JOIN pg_class c ON c.oid = inh.inhrelid
    JOIN pg_class p ON p.oid = inh.inhparent
    JOIN pg_namespace n ON n.oid = p.relnamespace
    WHERE n.nspname = 'telemetry' AND p.relname = 'events'
      AND c.relname ~ '^events_[0-9]{8}$'
      AND to_date(substr(c.relname, 8), 'YYYYMMDD') < current_date - retention
  LOOP
    EXECUTE format('DROP TABLE telemetry.%I', part.relname);
  END LOOP;
END $$;

SELECT telemetry.maintain(90);
