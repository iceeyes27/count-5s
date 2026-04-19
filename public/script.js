const API_ENDPOINT = "/api/stats";
const CACHE_KEY = "kegel-daily-seconds";
const LEGACY_CACHE_KEY = "kegel-daily-cache";
const DEVICE_ID_KEY = "kegel-device-id";
const PENDING_SYNC_KEY = "kegel-pending-seconds";
const LEGACY_PENDING_SYNC_KEY = "kegel-pending-sync";
const MODE_KEY = "kegel-training-mode";
const MODE_PICKED_KEY = "kegel-mode-picked";
const LEGACY_CYCLE_SECONDS = 10;

const MODES = {
  normal: {
    name: "普通模式",
    description: "普通模式：5 秒收紧，5 秒放松，自动循环，并记录练习时间。",
    phases: [
      {
        name: "收紧",
        hint: "收紧骨盆底肌，保持均匀发力",
        duration: 5
      },
      {
        name: "放松",
        hint: "放松骨盆底肌，让肌肉自然恢复",
        duration: 5
      }
    ]
  },
  quick: {
    name: "快速模式",
    description: "快速模式：1 秒收紧，2 秒放松，自动循环，并记录练习时间。",
    phases: [
      {
        name: "收紧",
        hint: "快速收紧骨盆底肌，短促但清晰发力",
        duration: 1
      },
      {
        name: "放松",
        hint: "快速放松骨盆底肌，让肌肉完全松开",
        duration: 2
      }
    ]
  }
};

const phaseName = document.getElementById("phaseName");
const countdown = document.getElementById("countdown");
const phaseHint = document.getElementById("phaseHint");
const modeDescription = document.getElementById("modeDescription");
const modeHero = document.getElementById("modeHero");
const modeHeroStatus = document.getElementById("modeHeroStatus");
const currentModeBadge = document.getElementById("currentModeBadge");
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
const modeButtons = Array.from(document.querySelectorAll("[data-mode]"));
const pulsePanel = document.getElementById("pulsePanel");
const pulseMeter = document.getElementById("pulseMeter");
const pulseNote = document.getElementById("pulseNote");
const pulseWaveScroll = document.getElementById("pulseWaveScroll");
const squeezeStepLabel = document.getElementById("squeezeStepLabel");
const relaxStepLabel = document.getElementById("relaxStepLabel");
const squeezeStep = document.getElementById("squeezeStep");
const relaxStep = document.getElementById("relaxStep");

let timerId = null;
let animationFrameId = null;
let isRunning = false;
let hasStarted = false;
let currentModeKey = loadModeKey();
let modeSelectionComplete = loadModeSelectionComplete();
let phaseIndex = 0;
let secondsLeft = getCurrentPhases()[0].duration;
let phaseStartedAt = 0;
let pausedPhaseElapsedMs = 0;
let elapsed = 0;
let dailyCache = loadSecondsCache();
let pendingSync = loadPendingSeconds();
let deviceId = loadDeviceId();
let remoteState = "local-cache";
let syncInFlight = false;
let syncTimeoutId = null;

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

function mergeStoredObjects(primary, fallback) {
  const merged = { ...primary };

  Object.entries(fallback).forEach(([dateKey, value]) => {
    merged[dateKey] = (merged[dateKey] ?? 0) + value;
  });

  return merged;
}

function convertLegacyCyclesToSeconds(data) {
  return Object.entries(data).reduce((accumulator, [dateKey, cycles]) => {
    accumulator[dateKey] = cycles * LEGACY_CYCLE_SECONDS;
    return accumulator;
  }, {});
}

function loadSecondsCache() {
  const storedSeconds = loadStoredObject(CACHE_KEY);
  const legacySeconds = convertLegacyCyclesToSeconds(loadStoredObject(LEGACY_CACHE_KEY));
  const merged = mergeStoredObjects(storedSeconds, legacySeconds);

  if (Object.keys(legacySeconds).length > 0) {
    saveStoredObject(CACHE_KEY, merged);
    window.localStorage.removeItem(LEGACY_CACHE_KEY);
  }

  return merged;
}

function loadPendingSeconds() {
  const storedSeconds = loadStoredObject(PENDING_SYNC_KEY);
  const legacySeconds = convertLegacyCyclesToSeconds(loadStoredObject(LEGACY_PENDING_SYNC_KEY));
  const merged = mergeStoredObjects(storedSeconds, legacySeconds);

  if (Object.keys(legacySeconds).length > 0) {
    saveStoredObject(PENDING_SYNC_KEY, merged);
    window.localStorage.removeItem(LEGACY_PENDING_SYNC_KEY);
  }

  return merged;
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

function loadModeKey() {
  const stored = window.localStorage.getItem(MODE_KEY);
  return stored && MODES[stored] ? stored : "normal";
}

function loadModeSelectionComplete() {
  try {
    return window.sessionStorage.getItem(MODE_PICKED_KEY) === "1";
  } catch {
    return false;
  }
}

function saveModeSelectionComplete(value) {
  try {
    if (value) {
      window.sessionStorage.setItem(MODE_PICKED_KEY, "1");
    } else {
      window.sessionStorage.removeItem(MODE_PICKED_KEY);
    }
  } catch {
    return;
  }
}

function getCurrentMode() {
  return MODES[currentModeKey] ?? MODES.normal;
}

function getCurrentPhases() {
  return getCurrentMode().phases;
}

function getStartHint() {
  const [firstPhase] = getCurrentPhases();
  return `点击开始后进入 ${firstPhase.duration} 秒${firstPhase.name}`;
}

function formatPhaseLabel(phase) {
  return `${phase.name} ${phase.duration} 秒`;
}

function formatDuration(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return minutes > 0 ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`;
  }

  if (minutes > 0) {
    return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`;
  }

  return `${seconds} 秒`;
}

function getRecordSeconds(record) {
  if (Number.isFinite(record?.seconds)) {
    return Math.floor(record.seconds);
  }

  if (Number.isFinite(record?.cycles)) {
    return Math.floor(record.cycles) * LEGACY_CYCLE_SECONDS;
  }

  return 0;
}

function getCurrentPhaseElapsedMs(now = performance.now()) {
  if (!hasStarted) {
    return 0;
  }

  const currentPhase = getCurrentPhases()[phaseIndex];
  const durationMs = currentPhase.duration * 1000;

  if (!isRunning) {
    return Math.min(durationMs, pausedPhaseElapsedMs);
  }

  return Math.min(durationMs, Math.max(0, now - phaseStartedAt));
}

function getCurrentPhaseProgress(now = performance.now()) {
  const currentPhase = getCurrentPhases()[phaseIndex];
  if (!currentPhase) {
    return 0;
  }

  return getCurrentPhaseElapsedMs(now) / (currentPhase.duration * 1000);
}

function getCycleProgress(now = performance.now()) {
  const phases = getCurrentPhases();
  const totalDuration = phases.reduce((sum, phase) => sum + phase.duration, 0);
  const elapsedBeforePhase = phases
    .slice(0, phaseIndex)
    .reduce((sum, phase) => sum + phase.duration, 0);
  const elapsedInCycle = elapsedBeforePhase + (getCurrentPhaseElapsedMs(now) / 1000);

  if (totalDuration === 0) {
    return 0;
  }

  return Math.min(1, Math.max(0, elapsedInCycle / totalDuration));
}

function getCachedSeconds(dateKey) {
  return dailyCache[dateKey] ?? 0;
}

function getPendingSeconds(dateKey) {
  return pendingSync[dateKey] ?? 0;
}

function getPendingTotal() {
  return Object.values(pendingSync).reduce((sum, value) => sum + value, 0);
}

function setCachedSeconds(dateKey, totalSeconds) {
  if (totalSeconds <= 0) {
    delete dailyCache[dateKey];
  } else {
    dailyCache[dateKey] = Math.floor(totalSeconds);
  }

  saveStoredObject(CACHE_KEY, dailyCache);
}

function replaceCache(nextCache) {
  dailyCache = nextCache;
  saveStoredObject(CACHE_KEY, dailyCache);
}

function addPendingSeconds(dateKey, deltaSeconds) {
  pendingSync[dateKey] = getPendingSeconds(dateKey) + deltaSeconds;
  saveStoredObject(PENDING_SYNC_KEY, pendingSync);
}

function resolvePendingSeconds(dateKey, syncedDelta, serverSeconds) {
  const currentPending = getPendingSeconds(dateKey);
  const nextPending = Math.max(0, currentPending - syncedDelta);

  if (nextPending === 0) {
    delete pendingSync[dateKey];
  } else {
    pendingSync[dateKey] = nextPending;
  }

  saveStoredObject(PENDING_SYNC_KEY, pendingSync);
  setCachedSeconds(dateKey, serverSeconds + nextPending);
}

function applyPendingToCache(sourceCache) {
  const mergedCache = { ...sourceCache };

  for (const [dateKey, pendingSeconds] of Object.entries(pendingSync)) {
    if (pendingSeconds > 0) {
      mergedCache[dateKey] = (mergedCache[dateKey] ?? 0) + pendingSeconds;
    }
  }

  return mergedCache;
}

function buildSummary() {
  const todayDate = getTodayDate();
  const todaySeconds = getCachedSeconds(todayDate);
  const totalSeconds = Object.values(dailyCache).reduce((sum, value) => sum + value, 0);
  const totalDays = Object.values(dailyCache).filter((value) => value > 0).length;

  return {
    todayDate,
    todaySeconds,
    totalSeconds,
    totalDays
  };
}

function buildMonthlyCalendars() {
  const recordsByMonth = Object.entries(dailyCache)
    .filter(([dateKey, seconds]) => isValidDateKey(dateKey) && seconds > 0)
    .reduce((monthMap, [dateKey, seconds]) => {
      const monthKey = dateKey.slice(0, 7);
      const records = monthMap.get(monthKey) ?? new Map();
      records.set(dateKey, Math.floor(seconds));
      monthMap.set(monthKey, records);
      return monthMap;
    }, new Map());

  return Array.from(recordsByMonth.entries())
    .sort(([leftMonth], [rightMonth]) => rightMonth.localeCompare(leftMonth))
    .map(([monthKey, records]) => ({ monthKey, records }));
}

function formatMonthLabel(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  return `${year} 年 ${month} 月`;
}

function formatCalendarMinutes(seconds) {
  return `${Math.max(1, Math.ceil(seconds / 60))} 分钟`;
}

function formatCalendarMinutesShort(seconds) {
  return `${Math.max(1, Math.ceil(seconds / 60))} m`;
}

function getMonthCells(monthKey, records) {
  const [year, month] = monthKey.split("-").map(Number);
  const firstDay = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const leadingEmptyDays = (firstDay.getDay() + 6) % 7;
  const cells = [];

  for (let index = 0; index < leadingEmptyDays; index += 1) {
    cells.push({ type: "empty", key: `${monthKey}-empty-${index}` });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = `${monthKey}-${String(day).padStart(2, "0")}`;
    cells.push({
      type: "day",
      key: dateKey,
      day,
      seconds: records.get(dateKey) ?? 0
    });
  }

  return cells;
}

function renderHistory() {
  const months = buildMonthlyCalendars();

  if (months.length === 0) {
    historyList.innerHTML = '<div class="history-empty">还没有打卡记录</div>';
    return;
  }

  historyList.innerHTML = months
    .map(
      ({ monthKey, records }) => `
        <div class="calendar-month">
          <div class="calendar-month-header">
            <span>${formatMonthLabel(monthKey)}</span>
          </div>
          <div class="calendar-weekdays" aria-hidden="true">
            <span>一</span>
            <span>二</span>
            <span>三</span>
            <span>四</span>
            <span>五</span>
            <span>六</span>
            <span>日</span>
          </div>
          <div class="calendar-grid">
            ${getMonthCells(monthKey, records)
              .map((cell) => {
                if (cell.type === "empty") {
                  return '<span class="calendar-day calendar-day-empty" aria-hidden="true"></span>';
                }

                const hasPractice = cell.seconds > 0;
                return `
                  <div class="calendar-day${hasPractice ? " has-practice" : ""}" aria-label="${formatMonthLabel(monthKey)} ${cell.day} 日${hasPractice ? `，练习 ${formatCalendarMinutes(cell.seconds)}` : "，没有练习"}">
                    <span class="calendar-date">${cell.day}</span>
                    ${hasPractice ? `<span class="calendar-minutes">${formatCalendarMinutesShort(cell.seconds)}</span>` : ""}
                  </div>
                `;
              })
              .join("")}
          </div>
        </div>
      `
    )
    .join("");
}

function updateRhythm() {
  const phases = getCurrentPhases();
  squeezeStepLabel.textContent = formatPhaseLabel(phases[0]);
  relaxStepLabel.textContent = formatPhaseLabel(phases[1]);
  squeezeStep.classList.toggle("active", phaseIndex === 0);
  relaxStep.classList.toggle("active", phaseIndex === 1);
}

function updateModeSwitcher() {
  modeButtons.forEach((button) => {
    const isActive = button.dataset.mode === currentModeKey;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function updateModeHero() {
  modeHero.hidden = modeSelectionComplete;

  if (!modeSelectionComplete) {
    modeHeroStatus.textContent = "选择后开始按钮才会启用";
    return;
  }

  modeHeroStatus.textContent = `${getCurrentMode().name} 已选，可直接开始训练`;
}

function updateTrainingLayout() {
  document.body.classList.toggle("mode-selected", modeSelectionComplete);
}

function updatePulseGraph(now = performance.now()) {
  const isQuickMode = currentModeKey === "quick" && modeSelectionComplete;
  pulsePanel.hidden = !isQuickMode;
  pulsePanel.setAttribute("aria-hidden", String(!isQuickMode));

  if (!isQuickMode) {
    return;
  }

  const cycleProgress = getCycleProgress(now);
  let meterState = "idle";
  let note = "方波向左经过纵轴，高位收紧，低位放松";
  let waveShiftPercent = 0;

  if (hasStarted) {
    waveShiftPercent = cycleProgress * 25;

    if (phaseIndex === 0) {
      meterState = "squeeze";
      note = isRunning
        ? "纵轴对应高位平台时持续收紧 1 秒"
        : "暂停中，继续后从当前纵轴位置接着练";
    } else {
      meterState = "relax";
      note = isRunning
        ? "纵轴对应低位平台时持续放松 2 秒"
        : "暂停中，继续后从当前纵轴位置接着练";
    }
  }

  pulseMeter.dataset.phase = meterState;
  pulseMeter.dataset.running = String(isRunning);
  pulseWaveScroll.style.transform = `translate3d(-${waveShiftPercent.toFixed(3)}%, 0, 0)`;
  pulseNote.textContent = note;
}

function stopPulseAnimation() {
  if (animationFrameId !== null) {
    window.cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

function runPulseAnimation() {
  updatePulseGraph();

  if (isRunning && currentModeKey === "quick" && modeSelectionComplete) {
    animationFrameId = window.requestAnimationFrame(runPulseAnimation);
  } else {
    animationFrameId = null;
  }
}

function startPulseAnimation() {
  stopPulseAnimation();
  if (currentModeKey === "quick" && modeSelectionComplete) {
    animationFrameId = window.requestAnimationFrame(runPulseAnimation);
  }
}

function getSyncMessage() {
  const pendingTotal = getPendingTotal();

  if (remoteState === "syncing") {
    return pendingTotal > 0
      ? `Cloudflare 同步中，待上传 ${formatDuration(pendingTotal)}`
      : "Cloudflare 同步中";
  }

  if (pendingTotal > 0) {
    return `Cloudflare 暂未同步，待上传 ${formatDuration(pendingTotal)}`;
  }

  if (remoteState === "synced") {
    return "Cloudflare 已同步";
  }

  return "Cloudflare 未连接，当前使用本机缓存";
}

function render() {
  const currentMode = getCurrentMode();
  const currentPhase = getCurrentPhases()[phaseIndex];
  const summary = buildSummary();
  currentModeBadge.textContent = modeSelectionComplete ? currentMode.name : "待选模式";

  modeDescription.textContent = modeSelectionComplete
    ? "跟着倒计时和脉冲练习，系统会自动记录练习时间。"
    : "先选择普通模式或快速模式，再开始训练。";

  if (!modeSelectionComplete) {
    phaseName.textContent = "先选模式";
    phaseHint.textContent = "普通模式 5 秒收紧 / 5 秒放松，快速模式 1 秒收紧 / 2 秒放松";
  } else if (!hasStarted) {
    phaseName.textContent = "准备开始";
    phaseHint.textContent = getStartHint();
  } else if (isRunning) {
    phaseName.textContent = currentPhase.name;
    phaseHint.textContent = currentPhase.hint;
  } else {
    phaseName.textContent = `${currentPhase.name} 已暂停`;
    phaseHint.textContent = "点击继续，从当前秒数接着练习";
  }

  countdown.textContent = modeSelectionComplete ? String(secondsLeft) : "--";
  elapsedTime.textContent = formatDuration(elapsed);
  dailyCount.textContent = formatDuration(summary.todaySeconds);
  checkInStatus.textContent = summary.todaySeconds > 0 ? "今日已打卡" : "今日未打卡";
  checkedDays.textContent = String(summary.totalDays);
  totalCount.textContent = formatDuration(summary.totalSeconds);
  summaryText.textContent = summary.todaySeconds > 0
    ? `今天已练习 ${formatDuration(summary.todaySeconds)}，累计 ${summary.totalDays} 天 / ${formatDuration(summary.totalSeconds)}`
    : `今天还没开始，累计 ${summary.totalDays} 天 / ${formatDuration(summary.totalSeconds)}`;
  syncStatus.textContent = getSyncMessage();
  renderHistory();
  updateRhythm();
  updateModeSwitcher();
  updateModeHero();
  updateTrainingLayout();
  updatePulseGraph();
  startButton.disabled = isRunning || !modeSelectionComplete;
  pauseButton.disabled = !isRunning;
  startButton.textContent = modeSelectionComplete
    ? (hasStarted ? "继续" : "开始")
    : "先选模式";
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
    const seconds = getRecordSeconds(item);

    if (isValidDateKey(item?.date) && seconds > 0) {
      accumulator[item.date] = seconds;
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
  const delta = getPendingSeconds(dateKey);

  if (delta <= 0 || syncInFlight) {
    return;
  }

  syncInFlight = true;
  let didSync = false;

  try {
    remoteState = "syncing";
    render();

    const data = await requestStats(API_ENDPOINT, {
      method: "POST",
      body: JSON.stringify({
        date: dateKey,
        deltaSeconds: delta,
        deviceId
      })
    });

    resolvePendingSeconds(dateKey, delta, getRecordSeconds(data));
    didSync = true;
    remoteState = "synced";
    render();
  } catch {
    remoteState = "local-cache";
    render();
  } finally {
    syncInFlight = false;

    if (getPendingSeconds(dateKey) > 0) {
      if (didSync) {
        void flushPendingDate(dateKey);
      } else {
        schedulePendingSync();
      }
    }
  }
}

async function flushAllPendingDates() {
  const dates = Object.keys(pendingSync).sort();

  for (const dateKey of dates) {
    await flushPendingDate(dateKey);
  }
}

function schedulePendingSync() {
  if (syncTimeoutId !== null) {
    return;
  }

  syncTimeoutId = window.setTimeout(() => {
    syncTimeoutId = null;
    void flushAllPendingDates();
  }, 5000);
}

function addSecondToToday() {
  const todayDate = getTodayDate();
  setCachedSeconds(todayDate, getCachedSeconds(todayDate) + 1);
  addPendingSeconds(todayDate, 1);
  schedulePendingSync();
}

function advancePhase() {
  const phases = getCurrentPhases();

  phaseIndex = (phaseIndex + 1) % phases.length;
  secondsLeft = phases[phaseIndex].duration;
  phaseStartedAt = performance.now();
  pausedPhaseElapsedMs = 0;
  render();
}

function tick() {
  if (!isRunning) {
    return;
  }

  secondsLeft -= 1;
  elapsed += 1;
  addSecondToToday();

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
  phaseStartedAt = performance.now() - pausedPhaseElapsedMs;
  render();
  startPulseAnimation();
  timerId = window.setInterval(tick, 1000);
}

function pauseTimer() {
  if (!isRunning) {
    return;
  }

  pausedPhaseElapsedMs = getCurrentPhaseElapsedMs();
  isRunning = false;
  window.clearInterval(timerId);
  timerId = null;
  stopPulseAnimation();
  void flushAllPendingDates();
  render();
}

function restartCurrentSession() {
  isRunning = false;
  window.clearInterval(timerId);
  timerId = null;
  stopPulseAnimation();
  void flushAllPendingDates();
  phaseIndex = 0;
  secondsLeft = getCurrentPhases()[0].duration;
  phaseStartedAt = 0;
  pausedPhaseElapsedMs = 0;
  elapsed = 0;
  hasStarted = false;
  render();
}

function switchMode(nextModeKey) {
  if (!MODES[nextModeKey]) {
    return;
  }

  modeSelectionComplete = true;
  saveModeSelectionComplete(true);

  if (nextModeKey === currentModeKey) {
    render();
    return;
  }

  currentModeKey = nextModeKey;
  window.localStorage.setItem(MODE_KEY, currentModeKey);
  restartCurrentSession();
}

startButton.addEventListener("click", startTimer);
pauseButton.addEventListener("click", pauseTimer);
modeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    switchMode(button.dataset.mode);
  });
});
window.addEventListener("online", () => {
  void refreshFromCloudflare();
  void flushAllPendingDates();
});

render();
void refreshFromCloudflare();
void flushAllPendingDates();
