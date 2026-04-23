const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LEGACY_CYCLE_SECONDS = 10;
const CHECK_IN_SECONDS = 10 * 60;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=UTF-8"
    }
  });
}

function isValidDateKey(value) {
  return typeof value === "string" && DATE_PATTERN.test(value);
}

function isValidDeviceId(value) {
  return typeof value === "string" && value.length >= 8 && value.length <= 128;
}

function toLegacyCycles(seconds) {
  return Math.floor(Number(seconds ?? 0) / LEGACY_CYCLE_SECONDS);
}

async function ensureSchema(db) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS daily_counts (
      device_id TEXT NOT NULL,
      record_date TEXT NOT NULL,
      cycles INTEGER NOT NULL DEFAULT 0,
      total_seconds INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (device_id, record_date)
    )`
  ).run();

  const schema = await db.prepare("PRAGMA table_info(daily_counts)").all();
  const columns = Array.isArray(schema.results) ? schema.results : [];
  const hasTotalSeconds = columns.some((column) => column.name === "total_seconds");

  if (!hasTotalSeconds) {
    await db.prepare(
      "ALTER TABLE daily_counts ADD COLUMN total_seconds INTEGER NOT NULL DEFAULT 0"
    ).run();
  }
}

async function readSeconds(db, deviceId, recordDate) {
  const result = await db
    .prepare(
      `SELECT total_seconds + (cycles * ?3) AS seconds
       FROM daily_counts
       WHERE device_id = ?1 AND record_date = ?2
       LIMIT 1`
    )
    .bind(deviceId, recordDate, LEGACY_CYCLE_SECONDS)
    .first();

  return Number(result?.seconds ?? 0);
}

function withLegacyCycles(record) {
  const seconds = Number(record?.seconds ?? 0);
  return {
    ...record,
    seconds,
    cycles: toLegacyCycles(seconds),
    isCheckedIn: seconds >= CHECK_IN_SECONDS
  };
}

async function listRecords(db, deviceId) {
  const result = await db
    .prepare(
      `SELECT record_date AS date, total_seconds + (cycles * ?2) AS seconds
       FROM daily_counts
       WHERE device_id = ?1 AND (total_seconds > 0 OR cycles > 0)
       ORDER BY record_date DESC`
    )
    .bind(deviceId, LEGACY_CYCLE_SECONDS)
    .all();

  return Array.isArray(result.results) ? result.results.map(withLegacyCycles) : [];
}

async function handleGet(context) {
  const db = context.env.KEGEL_DB;
  if (!db) {
    return json({ error: "KEGEL_DB binding is missing." }, 503);
  }

  const url = new URL(context.request.url);
  const recordDate = url.searchParams.get("date");
  const deviceId = url.searchParams.get("deviceId");

  if (!isValidDeviceId(deviceId)) {
    return json({ error: "Invalid deviceId." }, 400);
  }

  await ensureSchema(db);

  if (!recordDate) {
    const records = await listRecords(db, deviceId);
    const checkedRecords = records.filter((item) => item.isCheckedIn);
    const totalSeconds = checkedRecords.reduce((sum, item) => sum + Number(item.seconds ?? 0), 0);

    return json({
      records,
      totalDays: checkedRecords.length,
      totalSeconds,
      totalCycles: toLegacyCycles(totalSeconds)
    });
  }

  if (!isValidDateKey(recordDate)) {
    return json({ error: "Invalid date." }, 400);
  }

  const seconds = await readSeconds(db, deviceId, recordDate);
  return json({
    date: recordDate,
    seconds,
    cycles: toLegacyCycles(seconds),
    isCheckedIn: seconds >= CHECK_IN_SECONDS
  });
}

async function handlePost(context) {
  const db = context.env.KEGEL_DB;
  if (!db) {
    return json({ error: "KEGEL_DB binding is missing." }, 503);
  }

  let payload;

  try {
    payload = await context.request.json();
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }

  const recordDate = payload?.date;
  const deviceId = payload?.deviceId;
  const deltaSeconds = payload?.deltaSeconds === undefined
    ? Number(payload?.delta) * LEGACY_CYCLE_SECONDS
    : Number(payload.deltaSeconds);

  if (
    !isValidDateKey(recordDate) ||
    !isValidDeviceId(deviceId) ||
    !Number.isInteger(deltaSeconds) ||
    deltaSeconds <= 0
  ) {
    return json({ error: "Invalid payload." }, 400);
  }

  await ensureSchema(db);
  await db
    .prepare(
      `INSERT INTO daily_counts (device_id, record_date, total_seconds, updated_at)
       VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)
       ON CONFLICT(device_id, record_date) DO UPDATE SET
         total_seconds = daily_counts.total_seconds + excluded.total_seconds,
         updated_at = CURRENT_TIMESTAMP`
    )
    .bind(deviceId, recordDate, deltaSeconds)
    .run();

  const seconds = await readSeconds(db, deviceId, recordDate);
  return json({
    date: recordDate,
    seconds,
    cycles: toLegacyCycles(seconds),
    isCheckedIn: seconds >= CHECK_IN_SECONDS
  });
}

export async function onRequest(context) {
  if (context.request.method === "GET") {
    return handleGet(context);
  }

  if (context.request.method === "POST") {
    return handlePost(context);
  }

  return json({ error: "Method not allowed." }, 405);
}
