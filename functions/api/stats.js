const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

async function ensureSchema(db) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS daily_counts (
      device_id TEXT NOT NULL,
      record_date TEXT NOT NULL,
      cycles INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (device_id, record_date)
    )`
  ).run();
}

async function readCycles(db, deviceId, recordDate) {
  const result = await db
    .prepare(
      `SELECT cycles
       FROM daily_counts
       WHERE device_id = ?1 AND record_date = ?2
       LIMIT 1`
    )
    .bind(deviceId, recordDate)
    .first();

  return Number(result?.cycles ?? 0);
}

async function listRecords(db, deviceId) {
  const result = await db
    .prepare(
      `SELECT record_date AS date, cycles
       FROM daily_counts
       WHERE device_id = ?1 AND cycles > 0
       ORDER BY record_date DESC`
    )
    .bind(deviceId)
    .all();

  return Array.isArray(result.results) ? result.results : [];
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
    const totalCycles = records.reduce((sum, item) => sum + Number(item.cycles ?? 0), 0);

    return json({
      records,
      totalDays: records.length,
      totalCycles
    });
  }

  if (!isValidDateKey(recordDate)) {
    return json({ error: "Invalid date." }, 400);
  }

  const cycles = await readCycles(db, deviceId, recordDate);
  return json({ date: recordDate, cycles });
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
  const delta = Number(payload?.delta);

  if (
    !isValidDateKey(recordDate) ||
    !isValidDeviceId(deviceId) ||
    !Number.isInteger(delta) ||
    delta <= 0
  ) {
    return json({ error: "Invalid payload." }, 400);
  }

  await ensureSchema(db);
  await db
    .prepare(
      `INSERT INTO daily_counts (device_id, record_date, cycles, updated_at)
       VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)
       ON CONFLICT(device_id, record_date) DO UPDATE SET
         cycles = daily_counts.cycles + excluded.cycles,
         updated_at = CURRENT_TIMESTAMP`
    )
    .bind(deviceId, recordDate, delta)
    .run();

  const cycles = await readCycles(db, deviceId, recordDate);
  return json({ date: recordDate, cycles });
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
