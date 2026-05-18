const API_ENDPOINT = "/api/stats";
const CACHE_KEY = "kegel-daily-seconds";
const LEGACY_CACHE_KEY = "kegel-daily-cache";
const DEVICE_ID_KEY = "kegel-device-id";
const PENDING_SYNC_KEY = "kegel-pending-seconds";
const LEGACY_PENDING_SYNC_KEY = "kegel-pending-sync";
const MODE_KEY = "kegel-training-mode";
const MODE_PICKED_KEY = "kegel-mode-picked";
const VOICE_KEY = "kegel-speech-voice";
const LEGACY_CYCLE_SECONDS = 10;
const CHECK_IN_SECONDS = 10 * 60;
const AUDIO_ASSET_VERSION = "20260518-audio-clock";
const TIMER_RENDER_INTERVAL_MS = 250;

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

const SPEECH_VOICES = {
  xiaoxiao: {
    name: "晓晓",
    matchNames: ["microsoft xiaoxiao", "xiaoxiao", "晓晓"],
    lang: "zh-CN",
    fallbackLangs: ["zh-CN", "cmn-Hans-CN", "zh"],
    fallbackNames: ["google 普通话", "google chinese", "ting-ting", "tingting"],
    fallbackIndex: 0,
    rate: 1,
    pitch: 1.08
  },
  yunxi: {
    name: "云希",
    matchNames: ["microsoft yunxi", "yunxi", "云希"],
    lang: "zh-TW",
    fallbackLangs: ["zh-TW", "cmn-Hant-TW", "zh-CN", "zh"],
    fallbackNames: ["google 國語", "google 国语", "mei-jia", "meijia"],
    fallbackIndex: 1,
    rate: 0.92,
    pitch: 0.96
  },
  yunye: {
    name: "云野",
    matchNames: ["microsoft yunye", "yunye", "云野"],
    lang: "zh-HK",
    fallbackLangs: ["zh-HK", "yue-Hant-HK", "zh-TW", "zh-CN", "zh"],
    fallbackNames: ["google 粤語", "google 粤语", "sin-ji", "sinji", "kangkang", "yunjian", "yunyang"],
    fallbackIndex: -1,
    rate: 0.88,
    pitch: 0.78
  },
  mute: {
    name: "静音",
    matchNames: [],
    lang: "zh-CN",
    fallbackLangs: [],
    fallbackNames: [],
    fallbackIndex: 0,
    rate: 1,
    pitch: 1
  }
};

const phaseName = document.getElementById("phaseName");
const countdown = document.getElementById("countdown");
const phaseHint = document.getElementById("phaseHint");
const modeDescription = document.getElementById("modeDescription");
const modeHero = document.getElementById("modeHero");
const modeHeroStatus = document.getElementById("modeHeroStatus");
const currentModeBadge = document.getElementById("currentModeBadge");
const audioStatus = document.getElementById("audioStatus");
const checkInProgressText = document.getElementById("checkInProgressText");
const checkInProgressFill = document.getElementById("checkInProgressFill");
const checkInRemainingText = document.getElementById("checkInRemainingText");
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
const endButton = document.getElementById("endButton");
const voiceSelect = document.getElementById("voiceSelect");
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
let currentVoiceKey = loadVoiceKey();
let modeSelectionComplete = true;
let phaseIndex = 0;
let secondsLeft = getCurrentPhases()[0].duration;
let elapsed = 0;
let lastAccountedElapsed = 0;
let lastAccountedAtWallMs = 0;
let fallbackStartedAtMs = 0;
let fallbackStartedElapsed = 0;
let dailyCache = loadSecondsCache();
let pendingSync = loadPendingSeconds();
let deviceId = loadDeviceId();
let remoteState = "local-cache";
let syncInFlight = false;
let syncTimeoutId = null;
let browserSpeechVoices = [];
let backgroundAudio = null;
let backgroundAudioSrc = "";
let backgroundAudioModeKey = "";
let backgroundAudioRunning = false;
let backgroundAudioError = "";
let stoppingBackgroundAudio = false;
let backgroundAudioOffsetSeconds = 0;
let lastBackgroundAudioTime = 0;

function getTodayDate() {
  return getDateKeyForTime(Date.now());
}

function getDateKeyForTime(timestampMs) {
  const now = new Date(timestampMs);
  const offset = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function getNextLocalMidnightMs(timestampMs) {
  const date = new Date(timestampMs);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
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

function loadVoiceKey() {
  const stored = window.localStorage.getItem(VOICE_KEY);
  return stored && SPEECH_VOICES[stored] ? stored : "xiaoxiao";
}

function loadModeSelectionComplete() {
  try {
    return window.sessionStorage.getItem(MODE_PICKED_KEY) !== "0";
  } catch {
    return true;
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

function canSpeak() {
  return "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

function loadBrowserSpeechVoices() {
  if (!canSpeak()) {
    browserSpeechVoices = [];
    return browserSpeechVoices;
  }

  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) {
    browserSpeechVoices = voices;
  }
  return browserSpeechVoices;
}

function scheduleSpeechVoiceLoad() {
  if (!canSpeak()) {
    return;
  }

  [50, 250, 800, 1500].forEach((delay) => {
    window.setTimeout(loadBrowserSpeechVoices, delay);
  });
}

function normalizeSpeechText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function getVoiceSearchText(voice) {
  return normalizeSpeechText(`${voice.name} ${voice.voiceURI} ${voice.lang}`);
}

function isChineseSpeechVoice(voice) {
  const lang = normalizeSpeechText(voice.lang);
  const name = getVoiceSearchText(voice);

  return (
    lang.startsWith("zh") ||
    lang.startsWith("cmn") ||
    lang.startsWith("yue") ||
    name.includes("chinese") ||
    name.includes("mandarin") ||
    name.includes("普通话") ||
    name.includes("國語") ||
    name.includes("国语") ||
    name.includes("粤語") ||
    name.includes("粤语")
  );
}

function findVoiceByNames(voices, names) {
  const matchNames = names.map(normalizeSpeechText);
  return voices.find((voice) => {
    const searchText = getVoiceSearchText(voice);
    return matchNames.some((matchName) => searchText.includes(matchName));
  });
}

function findVoiceByLangs(voices, langs) {
  const normalizedLangs = langs.map(normalizeSpeechText);
  return voices.find((voice) => {
    const voiceLang = normalizeSpeechText(voice.lang);
    return normalizedLangs.some((lang) => voiceLang === lang || voiceLang.startsWith(`${lang}-`));
  });
}

function getIndexedFallbackVoice(voices, fallbackIndex) {
  if (voices.length === 0) {
    return null;
  }

  if (fallbackIndex < 0) {
    return voices[voices.length - 1];
  }

  return voices[Math.min(fallbackIndex, voices.length - 1)];
}

function findSpeechVoice() {
  const voices = loadBrowserSpeechVoices();
  const voiceConfig = SPEECH_VOICES[currentVoiceKey] ?? SPEECH_VOICES.xiaoxiao;
  const chineseVoices = voices.filter(isChineseSpeechVoice);
  const candidateVoices = chineseVoices.length > 0 ? chineseVoices : voices;

  return (
    findVoiceByNames(candidateVoices, voiceConfig.matchNames) ||
    findVoiceByNames(candidateVoices, voiceConfig.fallbackNames) ||
    findVoiceByLangs(candidateVoices, voiceConfig.fallbackLangs) ||
    getIndexedFallbackVoice(candidateVoices, voiceConfig.fallbackIndex) ||
    null
  );
}

function cancelSpeech() {
  if (canSpeak()) {
    window.speechSynthesis.cancel();
  }
}

function speakPhase(phase) {
  if (!phase || currentVoiceKey === "mute" || !canSpeak()) {
    return false;
  }

  cancelSpeech();

  const voiceConfig = SPEECH_VOICES[currentVoiceKey] ?? SPEECH_VOICES.xiaoxiao;
  const utterance = new SpeechSynthesisUtterance(phase.name);
  const selectedVoice = findSpeechVoice();
  if (selectedVoice) {
    utterance.voice = selectedVoice;
  }
  utterance.lang = selectedVoice?.lang || voiceConfig.lang;
  utterance.rate = voiceConfig.rate;
  utterance.pitch = voiceConfig.pitch;
  utterance.volume = 1;
  window.speechSynthesis.resume();
  window.speechSynthesis.speak(utterance);
  return true;
}

function getCycleDurationSeconds() {
  return getCurrentPhases().reduce((sum, phase) => sum + phase.duration, 0);
}

function ensureBackgroundAudioElement() {
  if (backgroundAudio) {
    return backgroundAudio;
  }

  backgroundAudio = document.createElement("audio");
  backgroundAudio.loop = true;
  backgroundAudio.preload = "auto";
  backgroundAudio.setAttribute("playsinline", "");
  backgroundAudio.setAttribute("webkit-playsinline", "");
  backgroundAudio.addEventListener("play", () => {
    backgroundAudioRunning = true;
    backgroundAudioError = "";
    updateBackgroundAudioClockOffset();
    accountElapsedToNow();
    render();
  });
  backgroundAudio.addEventListener("playing", () => {
    backgroundAudioRunning = true;
    backgroundAudioError = "";
    updateBackgroundAudioClockOffset();
    accountElapsedToNow();
    render();
  });
  backgroundAudio.addEventListener("timeupdate", () => {
    updateBackgroundAudioClockOffset();
    accountElapsedToNow();
    render();
  });
  backgroundAudio.addEventListener("pause", () => {
    backgroundAudioRunning = false;
    if (isRunning && !stoppingBackgroundAudio) {
      pauseTimer();
      return;
    }
    render();
  });
  backgroundAudio.addEventListener("error", () => {
    backgroundAudioRunning = false;
    backgroundAudioError = "节奏音加载失败，当前使用前台语音播报";
    render();
  });
  document.body.appendChild(backgroundAudio);
  return backgroundAudio;
}

function prepareBackgroundAudio() {
  const audio = ensureBackgroundAudioElement();
  const nextAudioSrc = `./audio/kegel-${currentModeKey}.m4a?v=${AUDIO_ASSET_VERSION}`;

  if (backgroundAudioModeKey === currentModeKey && backgroundAudioSrc === nextAudioSrc) {
    return audio;
  }

  backgroundAudioSrc = nextAudioSrc;
  backgroundAudioModeKey = currentModeKey;
  backgroundAudioOffsetSeconds = 0;
  lastBackgroundAudioTime = 0;
  audio.src = backgroundAudioSrc;
  audio.load();
  return audio;
}

function updateBackgroundAudioVolume() {
  if (!backgroundAudio) {
    return;
  }

  backgroundAudio.volume = 1;
}

function getBackgroundAudioDuration(audio = backgroundAudio) {
  if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) {
    return 0;
  }

  return audio.duration;
}

function updateBackgroundAudioClockOffset() {
  if (!backgroundAudio || backgroundAudio.readyState === 0) {
    return;
  }

  const currentTime = backgroundAudio.currentTime || 0;
  const duration = getBackgroundAudioDuration(backgroundAudio);

  if (duration > 0 && lastBackgroundAudioTime - currentTime > duration / 2) {
    backgroundAudioOffsetSeconds += duration;
  }

  lastBackgroundAudioTime = currentTime;
}

function isBackgroundAudioClockActive() {
  return (
    currentVoiceKey !== "mute" &&
    backgroundAudioRunning &&
    backgroundAudio &&
    !backgroundAudio.paused &&
    backgroundAudio.readyState > 0
  );
}

function getPracticeElapsedSeconds() {
  if (isBackgroundAudioClockActive()) {
    updateBackgroundAudioClockOffset();
    return Math.max(elapsed, backgroundAudioOffsetSeconds + (backgroundAudio.currentTime || 0));
  }

  if (isRunning && fallbackStartedAtMs > 0) {
    return fallbackStartedElapsed + Math.max(0, Date.now() - fallbackStartedAtMs) / 1000;
  }

  return elapsed;
}

function setBackgroundAudioPositionFromElapsed(audio = backgroundAudio) {
  if (!audio || audio.readyState === 0) {
    backgroundAudioOffsetSeconds = elapsed;
    lastBackgroundAudioTime = 0;
    return false;
  }

  const duration = getBackgroundAudioDuration(audio);
  const targetTime = duration > 0 ? elapsed % duration : 0;

  try {
    audio.currentTime = targetTime;
    backgroundAudioOffsetSeconds = elapsed - targetTime;
    lastBackgroundAudioTime = targetTime;
    return true;
  } catch {
    backgroundAudioOffsetSeconds = elapsed;
    lastBackgroundAudioTime = 0;
    return false;
  }
}

async function startBackgroundAudio() {
  if (currentVoiceKey === "mute") {
    backgroundAudioRunning = false;
    backgroundAudioError = "";
    render();
    return false;
  }

  try {
    const audio = prepareBackgroundAudio();
    const setAudioPosition = () => {
      setBackgroundAudioPositionFromElapsed(audio);
    };

    if (audio.readyState > 0) {
      setAudioPosition();
    } else {
      audio.addEventListener("loadedmetadata", setAudioPosition, { once: true });
    }

    updateBackgroundAudioVolume();
    await audio.play();
    setBackgroundAudioPositionFromElapsed(audio);
    updateBackgroundAudioVolume();
    backgroundAudioRunning = true;
    fallbackStartedAtMs = 0;
    backgroundAudioError = "";
    accountElapsedToNow();
    render();
    updateMediaSession();
    return true;
  } catch {
    backgroundAudioRunning = false;
    backgroundAudioError = "微信内提示音未能启动，请再次点击开始";
    render();
    return false;
  }
}

function stopBackgroundAudio({ reset = false } = {}) {
  if (!backgroundAudio) {
    backgroundAudioRunning = false;
    return;
  }

  stoppingBackgroundAudio = true;
  backgroundAudio.pause();
  if (reset) {
    backgroundAudio.currentTime = 0;
    backgroundAudioOffsetSeconds = 0;
    lastBackgroundAudioTime = 0;
  }
  backgroundAudioRunning = false;
  window.setTimeout(() => {
    stoppingBackgroundAudio = false;
  }, 0);
  updateMediaSession();
}

function getAudioStatusText() {
  if (currentVoiceKey === "mute") {
    return "提示音已关闭";
  }

  if (backgroundAudioError) {
    return backgroundAudioError;
  }

  if (isRunning && backgroundAudioRunning) {
    return "提示音已开启：页面计时跟随音频进度";
  }

  if (isRunning) {
    return "正在启动微信内提示音";
  }

  return "微信内播放：点击开始后启用收紧/放松提示音";
}

function updateMediaSession() {
  if (!("mediaSession" in navigator)) {
    return;
  }

  if (typeof MediaMetadata !== "undefined") {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: "凯格尔运动计时器",
      artist: getCurrentMode().name,
      album: "收紧 / 放松节奏提示"
    });
  }
  navigator.mediaSession.playbackState = isRunning && backgroundAudioRunning ? "playing" : "paused";

  try {
    navigator.mediaSession.setActionHandler("play", () => {
      void startTimer();
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      pauseTimer();
    });
  } catch {
    return;
  }
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

function getCurrentPhaseElapsedMs() {
  if (!hasStarted) {
    return 0;
  }

  const currentPhase = getCurrentPhases()[phaseIndex];
  const durationMs = currentPhase.duration * 1000;
  const state = getPhaseStateFromElapsed(getPracticeElapsedSeconds());

  return Math.min(durationMs, state.secondsIntoPhase * 1000);
}

function getCurrentPhaseProgress() {
  const currentPhase = getCurrentPhases()[phaseIndex];
  if (!currentPhase) {
    return 0;
  }

  return getCurrentPhaseElapsedMs() / (currentPhase.duration * 1000);
}

function getCycleProgress() {
  const phases = getCurrentPhases();
  const totalDuration = phases.reduce((sum, phase) => sum + phase.duration, 0);
  const elapsedBeforePhase = phases
    .slice(0, phaseIndex)
    .reduce((sum, phase) => sum + phase.duration, 0);
  const elapsedInCycle = elapsedBeforePhase + (getCurrentPhaseElapsedMs() / 1000);

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
  const checkedSeconds = Object.values(dailyCache).filter((value) => value >= CHECK_IN_SECONDS);
  const totalSeconds = checkedSeconds.reduce((sum, value) => sum + value, 0);
  const totalDays = checkedSeconds.length;

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
  if (seconds < 60) {
    return `${Math.max(1, Math.floor(seconds))} 秒`;
  }

  return `${Math.ceil(seconds / 60)} 分钟`;
}

function formatCalendarMinutesShort(seconds) {
  if (seconds < 60) {
    return "<1分";
  }

  return `${Math.ceil(seconds / 60)}分`;
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

function updateVoiceSelect() {
  if (voiceSelect) {
    voiceSelect.value = currentVoiceKey;
  }
}

function updateModeHero() {
  if (!modeHero || !modeHeroStatus) {
    return;
  }

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
      ? `正在同步，待上传 ${formatDuration(pendingTotal)}`
      : "正在同步";
  }

  if (pendingTotal > 0) {
    return `已保存在本机，联网后同步 ${formatDuration(pendingTotal)}`;
  }

  if (remoteState === "synced") {
    return "数据已同步";
  }

  return "数据已保存在本机";
}

function isCheckedIn(seconds) {
  return seconds >= CHECK_IN_SECONDS;
}

function getCheckInStatusText(seconds) {
  if (isCheckedIn(seconds)) {
    return "今日已打卡";
  }

  return seconds > 0 ? "未满 10 分钟" : "今日未打卡";
}

function getTodaySummaryText(summary) {
  if (isCheckedIn(summary.todaySeconds)) {
    return `今天已打卡 ${formatDuration(summary.todaySeconds)}，打卡累计 ${summary.totalDays} 天 / ${formatDuration(summary.totalSeconds)}`;
  }

  if (summary.todaySeconds > 0) {
    return `今天已练习 ${formatDuration(summary.todaySeconds)}，打卡还差 ${formatDuration(CHECK_IN_SECONDS - summary.todaySeconds)}`;
  }

  return `今天还没开始，打卡累计 ${summary.totalDays} 天 / ${formatDuration(summary.totalSeconds)}`;
}

function updateCheckInProgress(todaySeconds) {
  const progress = Math.min(1, Math.max(0, todaySeconds / CHECK_IN_SECONDS));
  const remaining = Math.max(0, CHECK_IN_SECONDS - todaySeconds);

  if (checkInProgressText) {
    checkInProgressText.textContent = `${formatDuration(todaySeconds)} / 10 分钟`;
  }

  if (checkInProgressFill) {
    checkInProgressFill.style.width = `${(progress * 100).toFixed(1)}%`;
  }

  if (checkInRemainingText) {
    checkInRemainingText.textContent = remaining > 0
      ? `距离打卡还差 ${formatDuration(remaining)}`
      : "今日打卡已完成";
  }
}

function render() {
  const currentMode = getCurrentMode();
  const currentPhase = getCurrentPhases()[phaseIndex];
  const summary = buildSummary();
  currentModeBadge.textContent = currentMode.name;

  modeDescription.textContent = "默认普通模式，打开微信后可直接开始。";

  if (!hasStarted) {
    phaseName.textContent = "准备开始";
    phaseHint.textContent = getStartHint();
  } else if (isRunning) {
    phaseName.textContent = currentPhase.name;
    phaseHint.textContent = currentPhase.hint;
  } else {
    phaseName.textContent = `${currentPhase.name} 已暂停`;
    phaseHint.textContent = "点击继续，从当前秒数接着练习";
  }

  countdown.textContent = String(secondsLeft);
  elapsedTime.textContent = formatDuration(elapsed);
  if (audioStatus) {
    audioStatus.textContent = getAudioStatusText();
  }
  dailyCount.textContent = formatDuration(summary.todaySeconds);
  checkInStatus.textContent = getCheckInStatusText(summary.todaySeconds);
  checkedDays.textContent = String(summary.totalDays);
  totalCount.textContent = formatDuration(summary.totalSeconds);
  summaryText.textContent = getTodaySummaryText(summary);
  syncStatus.textContent = getSyncMessage();
  updateCheckInProgress(summary.todaySeconds);
  renderHistory();
  updateRhythm();
  updateModeSwitcher();
  updateVoiceSelect();
  updateModeHero();
  updateTrainingLayout();
  updatePulseGraph();
  startButton.disabled = isRunning;
  pauseButton.disabled = !isRunning;
  if (endButton) {
    endButton.disabled = !hasStarted;
  }
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

function addSecondsToDate(dateKey, deltaSeconds) {
  if (deltaSeconds <= 0) {
    return;
  }

  setCachedSeconds(dateKey, getCachedSeconds(dateKey) + deltaSeconds);
  addPendingSeconds(dateKey, deltaSeconds);
  schedulePendingSync();
}

function addElapsedSeconds(startMs, deltaSeconds) {
  let cursorMs = startMs;
  let remainingSeconds = deltaSeconds;

  while (remainingSeconds > 0) {
    const nextMidnightMs = getNextLocalMidnightMs(cursorMs);
    const secondsUntilMidnight = Math.max(1, Math.ceil((nextMidnightMs - cursorMs) / 1000));
    const secondsForDate = Math.min(remainingSeconds, secondsUntilMidnight);
    addSecondsToDate(getDateKeyForTime(cursorMs), secondsForDate);
    cursorMs += secondsForDate * 1000;
    remainingSeconds -= secondsForDate;
  }
}

function getPhaseStateFromElapsed(totalElapsedSeconds) {
  const phases = getCurrentPhases();
  const cycleDuration = phases.reduce((sum, phase) => sum + phase.duration, 0);
  let cyclePosition = cycleDuration > 0 ? totalElapsedSeconds % cycleDuration : 0;

  for (let index = 0; index < phases.length; index += 1) {
    const phase = phases[index];
    if (cyclePosition < phase.duration) {
      return {
        phaseIndex: index,
        secondsIntoPhase: cyclePosition,
        secondsLeft: Math.max(1, Math.ceil(phase.duration - cyclePosition))
      };
    }
    cyclePosition -= phase.duration;
  }

  return {
    phaseIndex: 0,
    secondsIntoPhase: 0,
    secondsLeft: phases[0].duration
  };
}

function applyPhaseStateFromElapsed(totalElapsedSeconds = getPracticeElapsedSeconds()) {
  const state = getPhaseStateFromElapsed(totalElapsedSeconds);
  phaseIndex = state.phaseIndex;
  secondsLeft = state.secondsLeft;
}

function startFallbackClock() {
  fallbackStartedAtMs = Date.now();
  fallbackStartedElapsed = elapsed;
}

function stopFallbackClock() {
  fallbackStartedAtMs = 0;
  fallbackStartedElapsed = elapsed;
}

function preparePracticeAccounting() {
  lastAccountedElapsed = elapsed;
  lastAccountedAtWallMs = Date.now();
  if (currentVoiceKey === "mute") {
    startFallbackClock();
  } else {
    stopFallbackClock();
  }
  applyPhaseStateFromElapsed(elapsed);
}

function accountElapsedToNow() {
  if (!isRunning) {
    return 0;
  }

  const preciseElapsed = getPracticeElapsedSeconds();
  const nextElapsed = Math.floor(preciseElapsed);
  const deltaSeconds = nextElapsed - lastAccountedElapsed;
  if (deltaSeconds <= 0) {
    applyPhaseStateFromElapsed(preciseElapsed);
    return 0;
  }

  const accountedFromMs = lastAccountedAtWallMs || Math.max(0, Date.now() - deltaSeconds * 1000);
  lastAccountedAtWallMs = accountedFromMs + (deltaSeconds * 1000);
  lastAccountedElapsed = nextElapsed;
  elapsed = nextElapsed;
  addElapsedSeconds(accountedFromMs, deltaSeconds);
  applyPhaseStateFromElapsed(preciseElapsed);
  return deltaSeconds;
}

function announcePhaseIfNeeded(previousPhaseIndex) {
  if (previousPhaseIndex === phaseIndex || backgroundAudioRunning) {
    return;
  }

  speakPhase(getCurrentPhases()[phaseIndex]);
}

function tick() {
  if (!isRunning) {
    return;
  }

  const previousPhaseIndex = phaseIndex;
  accountElapsedToNow();
  updateBackgroundAudioVolume();
  announcePhaseIfNeeded(previousPhaseIndex);
  render();
}

async function startTimer() {
  if (isRunning) {
    return;
  }

  hasStarted = true;
  isRunning = true;
  preparePracticeAccounting();
  render();
  startPulseAnimation();
  if (timerId !== null) {
    window.clearInterval(timerId);
  }
  timerId = window.setInterval(tick, TIMER_RENDER_INTERVAL_MS);

  const hasBackgroundAudio = await startBackgroundAudio();
  if (!isRunning) {
    stopBackgroundAudio({ reset: true });
    return;
  }
  if (!hasBackgroundAudio) {
    startFallbackClock();
    speakPhase(getCurrentPhases()[phaseIndex]);
  }
}

function pauseTimer() {
  if (!isRunning) {
    return;
  }

  accountElapsedToNow();
  isRunning = false;
  applyPhaseStateFromElapsed(elapsed);
  lastAccountedAtWallMs = 0;
  stopFallbackClock();
  window.clearInterval(timerId);
  timerId = null;
  stopPulseAnimation();
  stopBackgroundAudio();
  cancelSpeech();
  void flushAllPendingDates();
  render();
}

function restartCurrentSession() {
  isRunning = false;
  lastAccountedElapsed = 0;
  lastAccountedAtWallMs = 0;
  fallbackStartedAtMs = 0;
  fallbackStartedElapsed = 0;
  window.clearInterval(timerId);
  timerId = null;
  stopPulseAnimation();
  stopBackgroundAudio({ reset: true });
  cancelSpeech();
  void flushAllPendingDates();
  phaseIndex = 0;
  secondsLeft = getCurrentPhases()[0].duration;
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

function switchVoice(nextVoiceKey) {
  if (!SPEECH_VOICES[nextVoiceKey]) {
    return;
  }

  currentVoiceKey = nextVoiceKey;
  window.localStorage.setItem(VOICE_KEY, currentVoiceKey);

  if (currentVoiceKey === "mute") {
    stopBackgroundAudio();
    cancelSpeech();
    if (isRunning) {
      startFallbackClock();
    }
    render();
    return;
  }

  loadBrowserSpeechVoices();

  if (isRunning) {
    void startBackgroundAudio().then((hasBackgroundAudio) => {
      if (!hasBackgroundAudio && isRunning) {
        startFallbackClock();
        speakPhase(getCurrentPhases()[phaseIndex]);
      }
    });
  }
}

function refreshRunningState() {
  if (!isRunning) {
    return;
  }

  const previousPhaseIndex = phaseIndex;
  accountElapsedToNow();
  announcePhaseIfNeeded(previousPhaseIndex);
  render();
}

function primeStartAssets() {
  loadBrowserSpeechVoices();

  if (currentVoiceKey === "mute") {
    return;
  }

  try {
    prepareBackgroundAudio();
  } catch {
    return;
  }
}

startButton.addEventListener("pointerdown", primeStartAssets, { passive: true });
startButton.addEventListener("touchstart", primeStartAssets, { passive: true });
startButton.addEventListener("click", () => {
  void startTimer();
});
pauseButton.addEventListener("click", pauseTimer);
if (endButton) {
  endButton.addEventListener("click", restartCurrentSession);
}
if (voiceSelect) {
  voiceSelect.addEventListener("change", () => {
    switchVoice(voiceSelect.value);
  });
}
modeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    switchMode(button.dataset.mode);
  });
});
window.addEventListener("online", () => {
  refreshRunningState();
  void refreshFromCloudflare();
  void flushAllPendingDates();
});
window.addEventListener("focus", refreshRunningState);
window.addEventListener("pageshow", refreshRunningState);
document.addEventListener("visibilitychange", refreshRunningState);
if (canSpeak()) {
  loadBrowserSpeechVoices();
  scheduleSpeechVoiceLoad();
  window.speechSynthesis.onvoiceschanged = loadBrowserSpeechVoices;
  if (window.speechSynthesis.addEventListener) {
    window.speechSynthesis.addEventListener("voiceschanged", loadBrowserSpeechVoices);
  }
}

render();
void refreshFromCloudflare();
void flushAllPendingDates();
