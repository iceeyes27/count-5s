const PHASES = [
  {
    name: "收紧",
    hint: "收紧骨盆底肌，保持均匀发力",
    duration: 5
  },
  {
    name: "停留",
    hint: "维持发力状态，不要憋气",
    duration: 5
  }
];

const API_ENDPOINT = "/api/stats";
const CACHE_KEY = "kegel-daily-cache";
const DEVICE_ID_KEY = "kegel-device-id";
const PENDING_SYNC_KEY = "kegel-pending-sync";

const phaseName = document.getElementById("phaseName");
const countdown = document.getElementById("countdown");
const phaseHint = document.getElementById("phaseHint");
const cycleCount = document.getElementById("cycleCount");
const elapsedTime = document.getElementById("elapsedTime");
const dailyCount = document.getElementById("dailyCount");
const checkInStatus = document.getElementById("checkInStatus");
const checkedDays = document.getElementById("checkedDays");
const totalCount = document.getElementById("totalCount");
const summaryText = document.getElementById("summaryText");
const syncStatus = document.getElementById("syncStatus");
const historyList = document.getElementById("historyList");
const startButton = document.getElementById("startButton");
const pauseButton = document.getElementById("pauseButton");
const resetButton = document.getElementById("resetButton");
const squeezeStep = document.getElementById("squeezeStep");
const holdStep = document.getElementById("holdStep");

let timerId = null;
let isRunning = false;
let hasStarted = false;
let phaseIndex = 0;
let secondsLeft = PHASES[0].duration;
let cycles = 0;
let elapsed = 0;
let dailyCache = loadStoredObject(CACHE_KEY);
let pendingSync = loadStoredObject(PENDING_SYNC_KEY);
let deviceId = loadDeviceId();
let remoteState = "local-cache";
let syncInFlight = false;

function getTodayDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function isValidDateKey(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function loadStoredObject(storageKey) {
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) {
      return {};
    }

    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.entries(parsed).reduce((accumulator, [key, value]) => {
      if (isValidDateKey(key) && Number.isFinite(value) && value >= 0) {
        accumulator[key] = Math.floor(value);
      }
      return accumulator;
    }, {});
  } catch {
    return {};
  }
}

function saveStoredObject(storageKey, data) {
  window.localStorage.setItem(storageKey, JSON.stringify(data));
}

function createDeviceId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `device-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function loadDeviceId() {
  const stored = window.localStorage.getItem(DEVICE_ID_KEY);
  if (stored) {
    return stored;
  }

  const nextDeviceId = createDeviceId();
  window.localStorage.setItem(DEVICE_ID_KEY, nextDeviceId);
  return nextDeviceId;
}

function getCachedCycles(dateKey) {
  return dailyCache[dateKey] ?? 0;
}

function getPendingCycles(dateKey) {
  return pendingSync[dateKey] ?? 0;
}

function getPendingTotal() {
  return Object.values(pendingSync).reduce((sum, value) => sum + value, 0);
}

function setCachedCycles(dateKey, totalCycles) {
  if (totalCycles <= 0) {
    delete dailyCache[dateKey];
  } else {
    dailyCache[dateKey] = Math.floor(totalCycles);
  }

  saveStoredObject(CACHE_KEY, dailyCache);
}

function replaceCache(nextCache) {
  dailyCache = nextCache;
  saveStoredObject(CACHE_KEY, dailyCache);
}

function addPendingCycles(dateKey, delta) {
  pendingSync[dateKey] = getPendingCycles(dateKey) + delta;
  saveStoredObject(PENDING_SYNC_KEY, pendingSync);
}

function resolvePendingCycles(dateKey, syncedDelta, serverCycles) {
  const currentPending = getPendingCycles(dateKey);
  const nextPending = Math.max(0, currentPending - syncedDelta);

  if (nextPending === 0) {
    delete pendingSync[dateKey];
  } else {
    pendingSync[dateKey] = nextPending;
  }

  saveStoredObject(PENDING_SYNC_KEY, pendingSync);
  setCachedCycles(dateKey, serverCycles + nextPending);
}

function applyPendingToCache(sourceCache) {
  const mergedCache = { ...sourceCache };

  for (const [dateKey, pendingCycles] of Object.entries(pendingSync)) {
    if (pendingCycles > 0) {
      mergedCache[dateKey] = (mergedCache[dateKey] ?? 0) + pendingCycles;
    }
  }

  return mergedCache;
}

function buildSummary() {
  const todayDate = getTodayDate();
  const todayCycles = getCachedCycles(todayDate);
  const totalCycles = Object.values(dailyCache).reduce((sum, value) => sum + value, 0);
  const totalDays = Object.values(dailyCache).filter((value) => value > 0).length;

  return {
    todayDate,
    todayCycles,
    totalCycles,
    totalDays
  };
}

function buildHistoryRecords(limit = 10) {
  return Object.entries(dailyCache)
    .filter(([, cycles]) => cycles > 0)
    .sort(([leftDate], [rightDate]) => rightDate.localeCompare(leftDate))
    .slice(0, limit)
    .map(([date, cycles]) => ({ date, cycles }));
}

function formatDateLabel(dateKey) {
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return dateKey;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    weekday: "short"
  }).format(date);
}

function renderHistory() {
  const records = buildHistoryRecords();

  if (records.length === 0) {
    historyList.innerHTML = '<div class="history-empty">还没有打卡记录</div>';
    return;
  }

  historyList.innerHTML = records
    .map(
      ({ date, cycles }) => `
        <div class="history-item">
          <span class="history-date">${date} ${formatDateLabel(date)}</span>
          <span class="history-cycles">${cycles} 轮</span>
        </div>
      `
    )
    .join("");
}

function updateRhythm() {
  squeezeStep.classList.toggle("active", phaseIndex === 0);
  holdStep.classList.toggle("active", phaseIndex === 1);
}

function getSyncMessage() {
  const pendingTotal = getPendingTotal();

  if (remoteState === "syncing") {
    return pendingTotal > 0
      ? `Cloudflare 同步中，待上传 ${pendingTotal} 轮`
      : "Cloudflare 同步中";
  }

  if (pendingTotal > 0) {
    return `Cloudflare 暂未同步，待上传 ${pendingTotal} 轮`;
  }

  if (remoteState === "synced") {
    return "Cloudflare 已同步";
  }

  return "Cloudflare 未连接，当前使用本机缓存";
}

function render() {
  const currentPhase = PHASES[phaseIndex];
  const summary = buildSummary();

  if (!hasStarted) {
    phaseName.textContent = "准备开始";
    phaseHint.textContent = "点击开始后进入 5 秒收紧";
  } else if (isRunning) {
    phaseName.textContent = currentPhase.name;
    phaseHint.textContent = currentPhase.hint;
  } else {
    phaseName.textContent = `${currentPhase.name} 已暂停`;
    phaseHint.textContent = "点击继续，从当前秒数接着练习";
  }

  countdown.textContent = String(secondsLeft);
  cycleCount.textContent = String(cycles);
  elapsedTime.textContent = String(elapsed);
  dailyCount.textContent = String(summary.todayCycles);
  checkInStatus.textContent = summary.todayCycles > 0 ? "今日已打卡" : "今日未打卡";
  checkedDays.textContent = String(summary.totalDays);
  totalCount.textContent = String(summary.totalCycles);
  summaryText.textContent = summary.todayCycles > 0
    ? `今天已打卡 ${summary.todayCycles} 轮，累计 ${summary.totalDays} 天 / ${summary.totalCycles} 轮`
    : `今天还没开始，累计 ${summary.totalDays} 天 / ${summary.totalCycles} 轮`;
  syncStatus.textContent = getSyncMessage();
  renderHistory();
  updateRhythm();
  startButton.disabled = isRunning;
  pauseButton.disabled = !isRunning;
  startButton.textContent = hasStarted ? "继续" : "开始";
}

async function requestStats(url, options = {}) {
  const response = await window.fetch(url, {
    cache: "no-store",
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }

  return response.json();
}

function normalizeRecords(records) {
  if (!Array.isArray(records)) {
    return {};
  }

  return records.reduce((accumulator, item) => {
    if (isValidDateKey(item?.date) && Number.isFinite(item?.cycles) && item.cycles > 0) {
      accumulator[item.date] = Math.floor(item.cycles);
    }
    return accumulator;
  }, {});
}

async function refreshFromCloudflare() {
  try {
    remoteState = "syncing";
    render();

    const params = new URLSearchParams({ deviceId });
    const data = await requestStats(`${API_ENDPOINT}?${params.toString()}`);
    replaceCache(applyPendingToCache(normalizeRecords(data.records)));
    remoteState = "synced";
    render();
  } catch {
    remoteState = "local-cache";
    render();
  }
}

async function flushPendingDate(dateKey) {
  const delta = getPendingCycles(dateKey);

  if (delta <= 0 || syncInFlight) {
    return;
  }

  syncInFlight = true;

  try {
    remoteState = "syncing";
    render();

    const data = await requestStats(API_ENDPOINT, {
      method: "POST",
      body: JSON.stringify({
        date: dateKey,
        delta,
        deviceId
      })
    });

    resolvePendingCycles(dateKey, delta, Number(data.cycles));
    remoteState = "synced";
    render();
  } catch {
    remoteState = "local-cache";
    render();
  } finally {
    syncInFlight = false;

    if (getPendingCycles(dateKey) > 0) {
      void flushPendingDate(dateKey);
    }
  }
}

async function flushAllPendingDates() {
  const dates = Object.keys(pendingSync).sort();

  for (const dateKey of dates) {
    await flushPendingDate(dateKey);
  }
}

function addCycleToToday() {
  const todayDate = getTodayDate();
  setCachedCycles(todayDate, getCachedCycles(todayDate) + 1);
  addPendingCycles(todayDate, 1);
  render();
  void flushPendingDate(todayDate);
}

function advancePhase() {
  if (phaseIndex === PHASES.length - 1) {
    cycles += 1;
    addCycleToToday();
  }

  phaseIndex = (phaseIndex + 1) % PHASES.length;
  secondsLeft = PHASES[phaseIndex].duration;
  render();
}

function tick() {
  if (!isRunning) {
    return;
  }

  secondsLeft -= 1;
  elapsed += 1;

  if (secondsLeft === 0) {
    advancePhase();
    return;
  }

  render();
}

function startTimer() {
  if (isRunning) {
    return;
  }

  hasStarted = true;
  isRunning = true;
  render();
  timerId = window.setInterval(tick, 1000);
}

function pauseTimer() {
  if (!isRunning) {
    return;
  }

  isRunning = false;
  window.clearInterval(timerId);
  timerId = null;
  render();
}

function resetTimer() {
  isRunning = false;
  window.clearInterval(timerId);
  timerId = null;
  phaseIndex = 0;
  secondsLeft = PHASES[0].duration;
  cycles = 0;
  elapsed = 0;
  hasStarted = false;
  render();
}

startButton.addEventListener("click", startTimer);
pauseButton.addEventListener("click", pauseTimer);
resetButton.addEventListener("click", resetTimer);
window.addEventListener("online", () => {
  void refreshFromCloudflare();
  void flushAllPendingDates();
});

render();
void refreshFromCloudflare();
void flushAllPendingDates();
