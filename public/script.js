const API_ENDPOINT = "/api/stats";
const CACHE_KEY = "kegel-daily-cache";
const DEVICE_ID_KEY = "kegel-device-id";
const PENDING_SYNC_KEY = "kegel-pending-sync";
const MODE_KEY = "kegel-training-mode";
const MODE_PICKED_KEY = "kegel-mode-picked";

const MODES = {
  normal: {
    name: "普通模式",
    description: "普通模式：5 秒收紧，5 秒放松，自动循环，并记录完成轮次。",
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
    description: "快速模式：1 秒收紧，2 秒放松，自动循环，并记录完成轮次。",
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
const modeButtons = Array.from(document.querySelectorAll("[data-mode]"));
const pulsePanel = document.getElementById("pulsePanel");
const pulseMeter = document.getElementById("pulseMeter");
const pulseNote = document.getElementById("pulseNote");
const pulseTrackFill = document.getElementById("pulseTrackFill");
const pulseMarkers = Array.from(document.querySelectorAll(".pulse-marker"));
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

  const currentPhase = getCurrentPhases()[phaseIndex];
  const phaseProgress = getCurrentPhaseProgress(now);
  const cycleProgress = getCycleProgress(now);
  let energy = 0.18;
  let meterState = "idle";
  let note = "跟着脉冲收紧 1 秒，再放松 2 秒";

  if (hasStarted) {
    if (phaseIndex === 0) {
      energy = 0.42 + (phaseProgress * 0.58);
      meterState = "squeeze";
      note = isRunning
        ? "脉冲快速上冲时收紧 1 秒"
        : "暂停中，继续后从当前脉冲位置接着练";
    } else {
      energy = 1 - (phaseProgress * 0.76);
      meterState = "relax";
      note = isRunning
        ? "脉冲缓慢回落的 2 秒里放松"
        : "暂停中，继续后从当前脉冲位置接着练";
    }
  }

  pulseMeter.dataset.phase = meterState;
  pulseMeter.dataset.running = String(isRunning);
  pulseMeter.style.setProperty("--pulse-energy", energy.toFixed(3));
  pulseTrackFill.style.transform = `scaleX(${cycleProgress.toFixed(4)})`;
  pulseNote.textContent = note;

  const activeSegment = Math.min(2, Math.floor(cycleProgress * 3));
  pulseMarkers.forEach((marker, index) => {
    marker.classList.toggle("active", hasStarted && index === activeSegment);
    marker.classList.toggle("complete", hasStarted && index < activeSegment);
  });
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
  const currentMode = getCurrentMode();
  const currentPhase = getCurrentPhases()[phaseIndex];
  const summary = buildSummary();
  currentModeBadge.textContent = modeSelectionComplete ? currentMode.name : "待选模式";

  modeDescription.textContent = modeSelectionComplete
    ? "跟着倒计时和脉冲练习，系统会自动记录完成轮次。"
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
  const phases = getCurrentPhases();

  if (phaseIndex === phases.length - 1) {
    cycles += 1;
    addCycleToToday();
  }

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
  render();
}

function resetTimer() {
  isRunning = false;
  window.clearInterval(timerId);
  timerId = null;
  stopPulseAnimation();
  phaseIndex = 0;
  secondsLeft = getCurrentPhases()[0].duration;
  phaseStartedAt = 0;
  pausedPhaseElapsedMs = 0;
  cycles = 0;
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
  resetTimer();
}

startButton.addEventListener("click", startTimer);
pauseButton.addEventListener("click", pauseTimer);
resetButton.addEventListener("click", resetTimer);
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
