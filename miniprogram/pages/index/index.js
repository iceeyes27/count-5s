const CHECK_IN_SECONDS = 10 * 60;
const AUTOSAVE_INTERVAL_MS = 15 * 1000;
const STORAGE_USAGE_WARN_RATIO = 0.7;
const TIMER_RENDER_INTERVAL_MS = 250;
const AUDIO_SYNC_INTERVAL_MS = 3000;
const AUDIO_DRIFT_TOLERANCE_SECONDS = 0.15;
const AUDIO_FORCE_SYNC_TOLERANCE_SECONDS = 0.05;
const AUDIO_CUE_GUARD_SECONDS = 0.8;
const STORAGE_KEYS = {
  config: "kegel-mini-config",
  legacyRecords: "kegel-mini-daily-seconds",
  dailyPrefix: "kegel-mini-daily:",
  eventsPrefix: "kegel-mini-events:"
};

const MODES = {
  normal: {
    name: "普通模式",
    description: "普通模式：5 秒收紧，5 秒放松，自动循环。",
    audio: "/audio/kegel-normal.m4a",
    phases: [
      { name: "收紧", hint: "收紧骨盆底肌，保持均匀发力", duration: 5 },
      { name: "放松", hint: "放松骨盆底肌，让肌肉自然恢复", duration: 5 }
    ]
  },
  quick: {
    name: "快速模式",
    description: "快速模式：1 秒收紧，2 秒放松，自动循环。",
    audio: "/audio/kegel-quick.m4a",
    phases: [
      { name: "收紧", hint: "快速收紧骨盆底肌，短促但清晰发力", duration: 1 },
      { name: "放松", hint: "快速放松骨盆底肌，让肌肉完全松开", duration: 2 }
    ]
  }
};

const DEFAULT_CONFIG = {
  modeKey: "normal",
  soundEnabled: true
};

function getMode(modeKey) {
  return MODES[modeKey] || MODES.normal;
}

function padDatePart(value) {
  return String(value).padStart(2, "0");
}

function getDateKey(timeMs = Date.now()) {
  const date = new Date(timeMs);
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

function getMonthKey(timeMs = Date.now()) {
  const date = new Date(timeMs);
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}`;
}

function getYearKeyFromDateKey(dateKey) {
  return String(dateKey).slice(0, 4);
}

function getLocalNoonTimeMs(dateKey) {
  const [year, month, day] = String(dateKey).split("-").map((value) => Number(value));
  return new Date(year, month - 1, day, 12, 0, 0, 0).getTime();
}

function getDailyStorageKey(yearKey) {
  return `${STORAGE_KEYS.dailyPrefix}${yearKey}`;
}

function getEventsStorageKey(monthKey) {
  return `${STORAGE_KEYS.eventsPrefix}${monthKey}`;
}

function formatDuration(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;

  if (minutes > 0) {
    return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`;
  }

  return `${seconds} 秒`;
}

function normalizeLegacyRecords(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value).reduce((records, [dateKey, seconds]) => {
    const normalizedSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey) && normalizedSeconds > 0) {
      records[dateKey] = normalizedSeconds;
    }
    return records;
  }, {});
}

function normalizeDailySummary(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const date = String(value.date || "");
  const totalSeconds = Math.max(0, Math.floor(Number(value.totalSeconds) || 0));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || totalSeconds <= 0) {
    return null;
  }

  return {
    date,
    totalSeconds,
    checkedIn: totalSeconds >= CHECK_IN_SECONDS,
    sessionCount: Math.max(1, Math.floor(Number(value.sessionCount) || 1)),
    updatedAt: Number(value.updatedAt) || Date.now()
  };
}

function normalizeDailySummaries(value) {
  if (!value || typeof value !== "object") {
    return {};
  }

  const entries = Array.isArray(value)
    ? value.map((item) => [item && item.date, item])
    : Object.entries(value);

  return entries.reduce((summaries, [dateKey, item]) => {
    const source = typeof item === "number" ? { date: dateKey, totalSeconds: item } : { date: dateKey, ...item };
    const summary = normalizeDailySummary(source);
    if (summary) {
      summaries[summary.date] = summary;
    }
    return summaries;
  }, {});
}

function normalizeEvent(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const startAt = Math.floor(Number(value.startAt) || 0);
  const endAt = Math.floor(Number(value.endAt) || 0);
  const durationSeconds = Math.max(0, Math.floor(Number(value.durationSeconds) || Math.floor((endAt - startAt) / 1000)));

  if (startAt <= 0 || endAt <= startAt || durationSeconds <= 0) {
    return null;
  }

  return {
    id: String(value.id || `event-${startAt}-${endAt}`),
    startAt,
    endAt,
    durationSeconds,
    modeKey: MODES[value.modeKey] ? value.modeKey : "normal",
    createdAt: Number(value.createdAt) || startAt,
    updatedAt: Number(value.updatedAt) || endAt
  };
}

function makeEventId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function readStorageByPrefix(prefix) {
  try {
    const info = wx.getStorageInfoSync();
    return (info.keys || [])
      .filter((key) => key.indexOf(prefix) === 0)
      .reduce((items, key) => {
        items[key] = wx.getStorageSync(key);
        return items;
      }, {});
  } catch (error) {
    return {};
  }
}

function mergeDailySummary(target, summary) {
  const existing = target[summary.date];
  if (!existing || summary.totalSeconds > existing.totalSeconds) {
    target[summary.date] = summary;
    return;
  }

  if (summary.totalSeconds === existing.totalSeconds) {
    existing.sessionCount = Math.max(existing.sessionCount, summary.sessionCount);
    existing.updatedAt = Math.max(existing.updatedAt, summary.updatedAt);
  }
}

Page({
  data: {
    modeKey: DEFAULT_CONFIG.modeKey,
    modeName: MODES.normal.name,
    modeDescription: MODES.normal.description,
    soundEnabled: DEFAULT_CONFIG.soundEnabled,
    phaseName: "准备开始",
    phaseHint: "点击开始后进入 5 秒收紧",
    countdownText: "--",
    elapsedText: "0 秒",
    todayText: "0 秒",
    checkInStatus: "今日未打卡",
    checkedDays: 0,
    progressPercent: 0,
    checkInProgressText: "0 / 10 分钟",
    remainingText: "距离打卡还差 10 分钟",
    summaryText: "今天还没开始，累计 0 天 / 0 秒",
    history: [],
    storagePolicyText: "数据保存在当前手机；换手机请先导出 JSON，再在新手机导入。",
    storageUsageText: "存储空间：--",
    soundStatusText: "点击开始后播放本地提示音"
  },

  timerId: null,
  audioContext: null,
  audioHandlers: null,
  audioEventsBound: false,
  audioReady: false,
  isAudioPlaying: false,
  audioStatusMessage: "",
  audioSourcePath: "",
  lastAudioNoticeAtMs: 0,
  lastAudioSyncAtMs: 0,
  audioClockOffsetSeconds: 0,
  lastAudioCurrentTime: 0,
  monthlyEvents: {},
  dailySummaries: {},
  dirtyDailyYears: {},
  dirtyEventMonths: {},
  activeSession: null,
  lastDailySaveAt: 0,
  isRunning: false,
  hasStarted: false,
  phaseIndex: 0,
  lastAccountedElapsed: 0,
  lastAccountedAtWallMs: 0,
  fallbackStartedAtMs: 0,
  fallbackStartedElapsed: 0,
  elapsedSeconds: 0,

  onLoad() {
    this.initRuntimeState();
    this.loadLocalState();
    this.resetSession(false);
    this.renderAll();
    this.updateStorageUsage();
  },

  initRuntimeState() {
    this.timerId = null;
    this.audioContext = null;
    this.audioHandlers = null;
    this.audioEventsBound = false;
    this.audioReady = false;
    this.isAudioPlaying = false;
    this.audioStatusMessage = "";
    this.audioSourcePath = "";
    this.lastAudioNoticeAtMs = 0;
    this.lastAudioSyncAtMs = 0;
    this.audioClockOffsetSeconds = 0;
    this.lastAudioCurrentTime = 0;
    this.monthlyEvents = {};
    this.dailySummaries = {};
    this.dirtyDailyYears = {};
    this.dirtyEventMonths = {};
    this.activeSession = null;
    this.lastDailySaveAt = 0;
    this.isRunning = false;
    this.hasStarted = false;
    this.phaseIndex = 0;
    this.lastAccountedElapsed = 0;
    this.lastAccountedAtWallMs = 0;
    this.fallbackStartedAtMs = 0;
    this.fallbackStartedElapsed = 0;
    this.elapsedSeconds = 0;
  },

  onShow() {
    if (this.isRunning) {
      this.accountElapsedToNow();
      this.updatePhaseFromClock();
      this.startTicker();
      this.startAudio(true);
      this.tick();
    } else {
      this.refreshAudioStatus();
    }
  },

  onHide() {
    this.accountElapsedToNow();
    this.commitActiveSessionSnapshot(true);
    this.saveDirtyDailySummaries();
    this.stopTicker();
    if (!this.isRunning) {
      this.pauseAudio();
    }
  },

  onUnload() {
    this.commitActiveSessionSnapshot(true);
    this.saveDirtyDailySummaries();
    this.stopTicker();
    this.destroyAudio();
  },

  loadLocalState() {
    const storedConfig = wx.getStorageSync(STORAGE_KEYS.config);
    const config = {
      ...DEFAULT_CONFIG,
      ...(storedConfig && typeof storedConfig === "object" ? storedConfig : {})
    };

    if (!MODES[config.modeKey]) {
      config.modeKey = DEFAULT_CONFIG.modeKey;
    }

    this.monthlyEvents = this.loadMonthlyEvents();
    this.dailySummaries = this.loadDailySummaries();

    if (Object.keys(this.monthlyEvents).length === 0) {
      this.migrateLegacyRecords();
    }

    if (Object.keys(this.monthlyEvents).length > 0) {
      this.rebuildDailySummariesFromEvents();
      this.saveAllDailySummaries();
    }

    this.setData({
      modeKey: config.modeKey,
      soundEnabled: Boolean(config.soundEnabled)
    });
  },

  ensureAudioContext() {
    if (this.audioContext) {
      return this.audioContext;
    }

    const audio = wx.createInnerAudioContext();
    audio.loop = true;
    audio.obeyMuteSwitch = false;
    this.audioContext = audio;
    this.audioReady = false;
    this.bindAudioEvents(audio);
    this.refreshAudioStatus();
    return audio;
  },

  bindAudioEvents(audio) {
    if (!audio || this.audioEventsBound) {
      return;
    }

    this.audioHandlers = {
      play: () => {
        this.isAudioPlaying = true;
        this.audioReady = true;
        this.audioStatusMessage = "";
        this.updateAudioClockOffset();
        this.stopFallbackClock();
        this.refreshAudioStatus();
      },
      pause: () => {
        this.isAudioPlaying = false;
        this.updateAudioClockOffset();
        if (this.isRunning) {
          this.startFallbackClock();
        }
        this.refreshAudioStatus();
      },
      stop: () => {
        this.isAudioPlaying = false;
        this.audioReady = false;
        this.updateAudioClockOffset();
        if (this.isRunning) {
          this.startFallbackClock();
        }
        this.refreshAudioStatus();
      },
      ended: () => {
        this.updateAudioClockOffset();
        this.accountElapsedToNow();
        this.isAudioPlaying = false;
        if (this.isRunning) {
          this.startAudio(true);
          return;
        }
        this.refreshAudioStatus();
      },
      timeUpdate: () => {
        this.audioReady = true;
        this.updateAudioClockOffset();
        if (this.isRunning) {
          this.accountElapsedToNow();
        }
      },
      waiting: () => {
        if (this.isRunning) {
          this.startFallbackClock();
        }
        this.refreshAudioStatus();
      },
      error: (error) => {
        this.isAudioPlaying = false;
        this.audioReady = false;
        this.audioStatusMessage = "提示音播放失败，请返回页面后重试开始";
        if (this.isRunning) {
          this.startFallbackClock();
        }
        this.refreshAudioStatus();

        const now = Date.now();
        if (now - this.lastAudioNoticeAtMs >= 5000) {
          this.lastAudioNoticeAtMs = now;
          wx.showToast({
            title: "提示音播放失败",
            icon: "none"
          });
        }
      }
    };

    audio.onPlay(this.audioHandlers.play);
    audio.onPause(this.audioHandlers.pause);
    audio.onStop(this.audioHandlers.stop);
    audio.onEnded(this.audioHandlers.ended);
    audio.onTimeUpdate(this.audioHandlers.timeUpdate);
    audio.onWaiting(this.audioHandlers.waiting);
    audio.onError(this.audioHandlers.error);
    this.audioEventsBound = true;
  },

  getSoundStatusText() {
    if (!this.data.soundEnabled) {
      return "本地提示音已关闭";
    }

    if (this.audioStatusMessage) {
      return this.audioStatusMessage;
    }

    if (this.isRunning && this.isAudioPlaying) {
      return "提示音播放中";
    }

    if (this.isRunning) {
      return "正在启动提示音";
    }

    return "点击开始后播放本地提示音";
  },

  refreshAudioStatus() {
    this.setData({ soundStatusText: this.getSoundStatusText() });
  },

  prepareAudioSource(audio, mode) {
    if (!audio || !mode) {
      return false;
    }

    const shouldReplace = this.audioSourcePath !== mode.audio;
    if (shouldReplace) {
      this.audioReady = false;
      this.isAudioPlaying = false;
      this.audioSourcePath = mode.audio;
      audio.stop();
      audio.src = mode.audio;
    }

    return shouldReplace;
  },

  loadMonthlyEvents() {
    const storedItems = readStorageByPrefix(STORAGE_KEYS.eventsPrefix);

    return Object.entries(storedItems).reduce((months, [key, value]) => {
      const monthKey = key.slice(STORAGE_KEYS.eventsPrefix.length);
      const events = Array.isArray(value) ? value.map(normalizeEvent).filter(Boolean) : [];
      if (/^\d{4}-\d{2}$/.test(monthKey) && events.length > 0) {
        months[monthKey] = events;
      }
      return months;
    }, {});
  },

  loadDailySummaries() {
    const storedItems = readStorageByPrefix(STORAGE_KEYS.dailyPrefix);

    return Object.values(storedItems).reduce((summaries, value) => {
      const dailyItems = normalizeDailySummaries(value);
      Object.values(dailyItems).forEach((summary) => mergeDailySummary(summaries, summary));
      return summaries;
    }, {});
  },

  migrateLegacyRecords() {
    const legacyRecords = normalizeLegacyRecords(wx.getStorageSync(STORAGE_KEYS.legacyRecords));
    const legacyEvents = Object.entries(legacyRecords).map(([date, totalSeconds]) => {
      const startAt = getLocalNoonTimeMs(date);
      return {
        id: `legacy-${date}`,
        startAt,
        endAt: startAt + totalSeconds * 1000,
        durationSeconds: totalSeconds,
        modeKey: "normal",
        createdAt: startAt,
        updatedAt: Date.now()
      };
    });

    legacyEvents.forEach((event) => this.addEventToMemory(event));
    if (legacyEvents.length > 0) {
      this.saveAllMonthlyEvents();
      wx.removeStorageSync(STORAGE_KEYS.legacyRecords);
    }
  },

  saveConfig() {
    wx.setStorageSync(STORAGE_KEYS.config, {
      modeKey: this.data.modeKey,
      soundEnabled: this.data.soundEnabled
    });
  },

  saveMonthEvents(monthKey) {
    const events = this.monthlyEvents[monthKey] || [];
    if (events.length > 0) {
      wx.setStorageSync(getEventsStorageKey(monthKey), events);
    }
    delete this.dirtyEventMonths[monthKey];
  },

  saveAllMonthlyEvents() {
    Object.keys(this.monthlyEvents).forEach((monthKey) => this.saveMonthEvents(monthKey));
  },

  saveDailySummariesForYear(yearKey) {
    const summaries = Object.values(this.dailySummaries)
      .filter((summary) => getYearKeyFromDateKey(summary.date) === yearKey)
      .sort((left, right) => left.date.localeCompare(right.date))
      .reduce((items, summary) => {
        items[summary.date] = summary;
        return items;
      }, {});

    wx.setStorageSync(getDailyStorageKey(yearKey), summaries);
    delete this.dirtyDailyYears[yearKey];
  },

  saveDirtyDailySummaries() {
    Object.keys(this.dirtyDailyYears).forEach((yearKey) => this.saveDailySummariesForYear(yearKey));
    this.lastDailySaveAt = Date.now();
    this.updateStorageUsage();
  },

  saveAllDailySummaries() {
    const yearKeys = new Set(Object.keys(this.dailySummaries).map((dateKey) => getYearKeyFromDateKey(dateKey)));
    yearKeys.forEach((yearKey) => this.saveDailySummariesForYear(yearKey));
    this.lastDailySaveAt = Date.now();
  },

  getCurrentMode() {
    return getMode(this.data.modeKey);
  },

  getCurrentPhase() {
    return this.getCurrentMode().phases[this.phaseIndex] || this.getCurrentMode().phases[0];
  },

  startTimer() {
    if (this.isRunning) {
      return;
    }

    const now = Date.now();
    this.isRunning = true;
    this.hasStarted = true;
    this.preparePracticeAccounting(now);
    this.activeSession = {
      id: makeEventId(),
      startAt: now,
      endAt: now,
      modeKey: this.data.modeKey,
      countedDates: {},
      createdAt: now,
      lastSavedAt: 0
    };
    this.startTicker();
    this.startAudio(true);
    this.tick();
  },

  pauseTimer() {
    if (!this.isRunning) {
      return;
    }

    this.accountElapsedToNow();
    this.finishActiveSession();
    this.applyPhaseStateFromElapsed(this.elapsedSeconds);
    this.isRunning = false;
    this.lastAccountedAtWallMs = 0;
    this.stopFallbackClock();
    this.stopTicker();
    this.pauseAudio();
    this.renderAll();
  },

  endSession() {
    this.accountElapsedToNow();
    this.finishActiveSession();
    this.resetSession(true);
    this.renderAll();
  },

  resetSession(shouldSave) {
    const phase = this.getCurrentMode().phases[0];
    this.stopTicker();
    this.stopAudio(true);
    this.isRunning = false;
    this.hasStarted = false;
    this.activeSession = null;
    this.phaseIndex = 0;
    this.lastAccountedElapsed = 0;
    this.lastAccountedAtWallMs = 0;
    this.fallbackStartedAtMs = 0;
    this.fallbackStartedElapsed = 0;
    this.audioClockOffsetSeconds = 0;
    this.lastAudioCurrentTime = 0;
    this.audioStatusMessage = "";
    this.audioSourcePath = "";
    this.elapsedSeconds = 0;

    if (shouldSave) {
      this.saveDirtyDailySummaries();
    }

    this.setData({
      phaseName: "准备开始",
      phaseHint: `点击开始后进入 ${phase.duration} 秒${phase.name}`,
      countdownText: "--",
      elapsedText: "0 秒"
    });
    this.refreshAudioStatus();
  },

  startTicker() {
    this.stopTicker();
    this.timerId = setInterval(() => this.tick(), TIMER_RENDER_INTERVAL_MS);
  },

  stopTicker() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  },

  tick() {
    if (!this.isRunning) {
      return;
    }

    this.accountElapsedToNow();
    this.updatePhaseFromClock();
    this.renderAll();
  },

  accountElapsedToNow() {
    if (!this.isRunning || !this.activeSession) {
      return;
    }

    const preciseElapsed = this.getPracticeElapsedSeconds();
    const nextElapsed = Math.floor(preciseElapsed);
    const elapsedWholeSeconds = nextElapsed - this.lastAccountedElapsed;
    if (elapsedWholeSeconds <= 0) {
      this.applyPhaseStateFromElapsed(preciseElapsed);
      return;
    }

    const accountedFromMs = this.lastAccountedAtWallMs || Math.max(0, Date.now() - elapsedWholeSeconds * 1000);
    this.addSecondsAcrossDates(accountedFromMs, elapsedWholeSeconds, this.activeSession);
    this.lastAccountedAtWallMs = accountedFromMs + elapsedWholeSeconds * 1000;
    this.lastAccountedElapsed = nextElapsed;
    this.elapsedSeconds = nextElapsed;
    this.activeSession.endAt = this.lastAccountedAtWallMs;
    this.applyPhaseStateFromElapsed(preciseElapsed);
    this.commitActiveSessionSnapshot(false);

    if (Date.now() - this.lastDailySaveAt >= AUTOSAVE_INTERVAL_MS) {
      this.saveDirtyDailySummaries();
    }
  },

  addSecondsAcrossDates(startMs, seconds, session) {
    let remainingSeconds = seconds;
    let cursorMs = startMs;

    while (remainingSeconds > 0) {
      const cursorDate = new Date(cursorMs);
      const nextMidnightMs = new Date(
        cursorDate.getFullYear(),
        cursorDate.getMonth(),
        cursorDate.getDate() + 1,
        0,
        0,
        0,
        0
      ).getTime();
      const secondsUntilMidnight = Math.max(1, Math.ceil((nextMidnightMs - cursorMs) / 1000));
      const secondsForDate = Math.min(remainingSeconds, secondsUntilMidnight);
      const dateKey = getDateKey(cursorMs);

      this.addDailySeconds(dateKey, secondsForDate, session);
      cursorMs += secondsForDate * 1000;
      remainingSeconds -= secondsForDate;
    }
  },

  addDailySeconds(dateKey, seconds, session) {
    const existing = this.dailySummaries[dateKey] || {
      date: dateKey,
      totalSeconds: 0,
      checkedIn: false,
      sessionCount: 0,
      updatedAt: Date.now()
    };

    existing.totalSeconds += seconds;
    existing.checkedIn = existing.totalSeconds >= CHECK_IN_SECONDS;
    existing.updatedAt = Date.now();

    if (session && !session.countedDates[dateKey]) {
      existing.sessionCount += 1;
      session.countedDates[dateKey] = true;
    }

    this.dailySummaries[dateKey] = existing;
    this.dirtyDailyYears[getYearKeyFromDateKey(dateKey)] = true;
  },

  addEventToMemory(event) {
    const normalized = normalizeEvent(event);
    if (!normalized) {
      return;
    }

    const monthKey = getMonthKey(normalized.startAt);
    const events = this.monthlyEvents[monthKey] || [];
    const existingIndex = events.findIndex((item) => item.id === normalized.id);

    if (existingIndex >= 0) {
      events[existingIndex] = normalized;
    } else {
      events.push(normalized);
    }

    events.sort((left, right) => left.startAt - right.startAt);
    this.monthlyEvents[monthKey] = events;
    this.dirtyEventMonths[monthKey] = true;
  },

  commitActiveSessionSnapshot(forceSave) {
    if (!this.activeSession || this.activeSession.endAt <= this.activeSession.startAt) {
      return;
    }

    const now = Date.now();
    if (!forceSave && now - this.activeSession.lastSavedAt < AUTOSAVE_INTERVAL_MS) {
      return;
    }

    const event = {
      id: this.activeSession.id,
      startAt: this.activeSession.startAt,
      endAt: this.activeSession.endAt,
      durationSeconds: Math.max(1, Math.floor((this.activeSession.endAt - this.activeSession.startAt) / 1000)),
      modeKey: this.activeSession.modeKey,
      createdAt: this.activeSession.createdAt,
      updatedAt: now
    };

    this.addEventToMemory(event);
    Object.keys(this.dirtyEventMonths).forEach((monthKey) => this.saveMonthEvents(monthKey));
    this.activeSession.lastSavedAt = now;
  },

  finishActiveSession() {
    this.commitActiveSessionSnapshot(true);
    this.activeSession = null;
    this.saveDirtyDailySummaries();
  },

  rebuildDailySummariesFromEvents() {
    const summaries = {};

    Object.values(this.monthlyEvents).forEach((events) => {
      events.forEach((event) => {
        this.applyEventToDailySummaries(summaries, event);
      });
    });

    this.dailySummaries = summaries;
    Object.keys(summaries).forEach((dateKey) => {
      this.dirtyDailyYears[getYearKeyFromDateKey(dateKey)] = true;
    });
  },

  applyEventToDailySummaries(summaries, event) {
    let remainingSeconds = event.durationSeconds;
    let cursorMs = event.startAt;

    while (remainingSeconds > 0) {
      const cursorDate = new Date(cursorMs);
      const nextMidnightMs = new Date(
        cursorDate.getFullYear(),
        cursorDate.getMonth(),
        cursorDate.getDate() + 1,
        0,
        0,
        0,
        0
      ).getTime();
      const secondsUntilMidnight = Math.max(1, Math.ceil((nextMidnightMs - cursorMs) / 1000));
      const secondsForDate = Math.min(remainingSeconds, secondsUntilMidnight);
      const dateKey = getDateKey(cursorMs);
      const summary = summaries[dateKey] || {
        date: dateKey,
        totalSeconds: 0,
        checkedIn: false,
        sessionCount: 0,
        updatedAt: 0
      };

      summary.totalSeconds += secondsForDate;
      summary.sessionCount += 1;
      summary.updatedAt = Math.max(summary.updatedAt, event.updatedAt);
      summary.checkedIn = summary.totalSeconds >= CHECK_IN_SECONDS;
      summaries[dateKey] = summary;

      cursorMs += secondsForDate * 1000;
      remainingSeconds -= secondsForDate;
    }
  },

  getPhaseStateFromElapsed(totalElapsedSeconds) {
    const phases = this.getCurrentMode().phases;
    const cycleDuration = phases.reduce((total, phase) => total + phase.duration, 0);
    let cyclePosition = cycleDuration > 0 ? totalElapsedSeconds % cycleDuration : 0;

    for (let index = 0; index < phases.length; index += 1) {
      const phase = phases[index];
      if (cyclePosition < phase.duration) {
        return {
          phaseIndex: index,
          phaseElapsedMs: cyclePosition * 1000,
          secondsLeft: Math.max(1, Math.ceil(phase.duration - cyclePosition))
        };
      }
      cyclePosition -= phase.duration;
    }

    return {
      phaseIndex: 0,
      phaseElapsedMs: 0,
      secondsLeft: phases[0].duration
    };
  },

  applyPhaseStateFromElapsed(totalElapsedSeconds = this.getPracticeElapsedSeconds()) {
    const state = this.getPhaseStateFromElapsed(totalElapsedSeconds);
    this.phaseIndex = state.phaseIndex;
    return state;
  },

  updatePhaseFromClock() {
    const previousPhaseIndex = this.phaseIndex;
    this.applyPhaseStateFromElapsed();

    if (previousPhaseIndex !== this.phaseIndex) {
      this.syncAudioToCurrentPhase(true);
    } else {
      this.syncAudioToCurrentPhase(false);
    }
  },

  switchMode(event) {
    const modeKey = event.currentTarget.dataset.mode;
    if (!MODES[modeKey] || modeKey === this.data.modeKey) {
      return;
    }

    this.accountElapsedToNow();
    this.finishActiveSession();
    this.setData({ modeKey });
    this.saveConfig();
    this.resetSession(true);
    this.renderAll();
  },

  toggleSound() {
    const soundEnabled = !this.data.soundEnabled;
    this.setData({ soundEnabled });
    this.saveConfig();

    if (soundEnabled && this.isRunning) {
      this.audioStatusMessage = "";
      this.startAudio(true);
    } else {
      this.pauseAudio();
    }

    this.refreshAudioStatus();
  },

  startAudio(shouldSync) {
    if (!this.data.soundEnabled) {
      return;
    }

    const mode = this.getCurrentMode();
    const audio = this.ensureAudioContext();
    const replacedSource = this.prepareAudioSource(audio, mode);
    const needsSync = shouldSync || replacedSource;

    if (needsSync) {
      this.setAudioPositionFromElapsed();
    }

    this.audioStatusMessage = "";
    this.refreshAudioStatus();
    audio.play();

    if (needsSync) {
      setTimeout(() => {
        this.syncAudioToCurrentPhase(true);
      }, 120);
    }
  },

  pauseAudio() {
    if (this.audioContext) {
      this.updateAudioClockOffset();
      this.audioContext.pause();
    }
    if (this.isRunning) {
      this.startFallbackClock();
    }
    this.lastAudioSyncAtMs = 0;
    this.refreshAudioStatus();
  },

  stopAudio(shouldReset) {
    if (this.audioContext) {
      this.updateAudioClockOffset();
      this.audioContext.stop();
      this.isAudioPlaying = false;
      if (shouldReset) {
        this.audioReady = false;
        this.audioClockOffsetSeconds = 0;
        this.lastAudioCurrentTime = 0;
      }
    }
    this.lastAudioSyncAtMs = 0;
    this.refreshAudioStatus();
  },

  getAudioLoopDuration() {
    const duration = Number(this.audioContext && this.audioContext.duration) || 0;
    if (duration > 0) {
      return duration;
    }

    const mode = this.getCurrentMode();
    return mode.phases.reduce((total, phase) => total + phase.duration, 0);
  },

  updateAudioClockOffset() {
    if (!this.audioContext) {
      return;
    }

    const currentTime = Number(this.audioContext.currentTime) || 0;
    const duration = this.getAudioLoopDuration();
    if (duration > 0 && this.lastAudioCurrentTime - currentTime > duration / 2) {
      this.audioClockOffsetSeconds += duration;
    }

    this.lastAudioCurrentTime = currentTime;
  },

  isAudioClockActive() {
    return Boolean(this.data.soundEnabled && this.audioContext && this.isAudioPlaying && this.audioReady);
  },

  getPracticeElapsedSeconds() {
    if (this.isAudioClockActive()) {
      this.updateAudioClockOffset();
      return Math.max(this.elapsedSeconds, this.audioClockOffsetSeconds + (Number(this.audioContext.currentTime) || 0));
    }

    if (this.isRunning && this.fallbackStartedAtMs > 0) {
      return this.fallbackStartedElapsed + Math.max(0, Date.now() - this.fallbackStartedAtMs) / 1000;
    }

    return this.elapsedSeconds;
  },

  setAudioPositionFromElapsed() {
    if (!this.audioContext) {
      this.audioClockOffsetSeconds = this.elapsedSeconds;
      this.lastAudioCurrentTime = 0;
      return;
    }

    const duration = this.getAudioLoopDuration();
    const targetTime = duration > 0 ? this.elapsedSeconds % duration : 0;
    if (typeof this.audioContext.seek === "function") {
      this.audioContext.seek(targetTime);
    } else {
      this.audioClockOffsetSeconds = this.elapsedSeconds - targetTime;
      this.lastAudioCurrentTime = targetTime;
      return;
    }
    this.audioClockOffsetSeconds = this.elapsedSeconds - targetTime;
    this.lastAudioCurrentTime = targetTime;
  },

  startFallbackClock() {
    this.fallbackStartedAtMs = Date.now();
    this.fallbackStartedElapsed = this.elapsedSeconds;
  },

  stopFallbackClock() {
    this.fallbackStartedAtMs = 0;
    this.fallbackStartedElapsed = this.elapsedSeconds;
  },

  preparePracticeAccounting(now = Date.now()) {
    this.lastAccountedElapsed = this.elapsedSeconds;
    this.lastAccountedAtWallMs = now;
    this.startFallbackClock();
    this.applyPhaseStateFromElapsed(this.elapsedSeconds);
  },

  getAudioTargetSeconds() {
    const loopDuration = this.getAudioLoopDuration();
    if (loopDuration <= 0) {
      return 0;
    }

    return this.getPracticeElapsedSeconds() % loopDuration;
  },

  getAudioDriftSeconds(actualSeconds, targetSeconds) {
    const loopDuration = this.getAudioLoopDuration();
    if (loopDuration <= 0) {
      return actualSeconds - targetSeconds;
    }

    let driftSeconds = actualSeconds - targetSeconds;
    if (driftSeconds > loopDuration / 2) {
      driftSeconds -= loopDuration;
    } else if (driftSeconds < -loopDuration / 2) {
      driftSeconds += loopDuration;
    }
    return driftSeconds;
  },

  isAudioCueWindow(seconds) {
    const loopDuration = this.getAudioLoopDuration();
    if (loopDuration <= 0) {
      return false;
    }

    const normalizedSeconds = ((seconds % loopDuration) + loopDuration) % loopDuration;
    let phaseStartsAt = 0;
    return this.getCurrentMode().phases.some((phase) => {
      const inWindow = normalizedSeconds >= phaseStartsAt && normalizedSeconds < phaseStartsAt + AUDIO_CUE_GUARD_SECONDS;
      phaseStartsAt += phase.duration;
      return inWindow;
    });
  },

  syncAudioToCurrentPhase(force) {
    if (!this.audioContext || !this.data.soundEnabled || !this.isRunning) {
      return;
    }

    const now = Date.now();
    if (!force && now - this.lastAudioSyncAtMs < AUDIO_SYNC_INTERVAL_MS) {
      return;
    }

    const targetSeconds = this.getAudioTargetSeconds();
    const currentTime = Number(this.audioContext.currentTime) || 0;
    const driftSeconds = this.getAudioDriftSeconds(currentTime, targetSeconds);
    const toleranceSeconds = force ? AUDIO_FORCE_SYNC_TOLERANCE_SECONDS : AUDIO_DRIFT_TOLERANCE_SECONDS;

    this.lastAudioSyncAtMs = now;

    if (Math.abs(driftSeconds) <= toleranceSeconds) {
      return;
    }

    if (!force && (this.isAudioCueWindow(currentTime) || this.isAudioCueWindow(targetSeconds))) {
      return;
    }

    if (typeof this.audioContext.seek === "function") {
      this.audioContext.seek(targetSeconds);
      this.audioClockOffsetSeconds = this.elapsedSeconds - targetSeconds;
      this.lastAudioCurrentTime = targetSeconds;
    }
  },

  destroyAudio() {
    if (this.audioContext) {
      this.stopAudio(false);
      if (typeof this.audioContext.destroy === "function") {
        this.audioContext.destroy();
      }
    }
    this.audioContext = null;
    this.audioHandlers = null;
    this.audioEventsBound = false;
    this.audioReady = false;
    this.isAudioPlaying = false;
  },

  exportData() {
    this.accountElapsedToNow();
    this.commitActiveSessionSnapshot(true);
    this.saveDirtyDailySummaries();

    const events = Object.values(this.monthlyEvents)
      .flat()
      .sort((left, right) => left.startAt - right.startAt);
    const dailySummaries = Object.values(this.dailySummaries)
      .sort((left, right) => left.date.localeCompare(right.date));
    const payload = {
      version: 1,
      app: "count-5s-miniprogram",
      exportedAt: new Date().toISOString(),
      checkInSeconds: CHECK_IN_SECONDS,
      dailySummaries,
      events
    };
    const filePath = `${wx.env.USER_DATA_PATH}/kegel-checkin-${getDateKey()}-${Date.now()}.json`;

    wx.getFileSystemManager().writeFile({
      filePath,
      data: JSON.stringify(payload, null, 2),
      encoding: "utf8",
      success: () => {
        this.updateStorageUsage();
        if (typeof wx.shareFileMessage === "function") {
          wx.shareFileMessage({
            filePath,
            success: () => wx.showToast({ title: "导出完成", icon: "success" }),
            fail: () => this.showExportPath(filePath)
          });
        } else {
          this.showExportPath(filePath);
        }
      },
      fail: () => {
        wx.showToast({ title: "导出失败", icon: "none" });
      }
    });
  },

  showExportPath(filePath) {
    wx.showModal({
      title: "导出完成",
      content: `文件已生成：${filePath}`,
      showCancel: false
    });
  },

  importData() {
    wx.chooseMessageFile({
      count: 1,
      type: "file",
      extension: ["json"],
      success: (result) => {
        const file = result.tempFiles && result.tempFiles[0];
        if (!file || !file.path) {
          wx.showToast({ title: "未选择文件", icon: "none" });
          return;
        }

        wx.getFileSystemManager().readFile({
          filePath: file.path,
          encoding: "utf8",
          success: (readResult) => this.mergeImportedPayload(readResult.data),
          fail: () => wx.showToast({ title: "读取失败", icon: "none" })
        });
      },
      fail: () => {}
    });
  },

  mergeImportedPayload(content) {
    let payload = null;
    try {
      payload = JSON.parse(content);
    } catch (error) {
      wx.showToast({ title: "文件格式错误", icon: "none" });
      return;
    }

    const importedEvents = Array.isArray(payload.events)
      ? payload.events.map(normalizeEvent).filter(Boolean)
      : [];
    const importedDaily = normalizeDailySummaries(payload.dailySummaries || payload.records || payload);

    if (importedEvents.length === 0 && Object.keys(importedDaily).length === 0) {
      wx.showToast({ title: "没有可导入数据", icon: "none" });
      return;
    }

    importedEvents.forEach((event) => this.addEventToMemory(event));
    Object.keys(this.dirtyEventMonths).forEach((monthKey) => this.saveMonthEvents(monthKey));

    if (importedEvents.length > 0) {
      this.rebuildDailySummariesFromEvents();
    }

    Object.values(importedDaily).forEach((summary) => {
      mergeDailySummary(this.dailySummaries, summary);
      this.dirtyDailyYears[getYearKeyFromDateKey(summary.date)] = true;
    });

    this.saveDirtyDailySummaries();
    this.renderAll();
    this.updateStorageUsage();
    wx.showToast({ title: "导入完成", icon: "success" });
  },

  updateStorageUsage() {
    try {
      const info = wx.getStorageInfoSync();
      const currentSize = Number(info.currentSize) || 0;
      const limitSize = Number(info.limitSize) || 0;
      const ratio = limitSize > 0 ? currentSize / limitSize : 0;
      const usageText = limitSize > 0
        ? `存储空间：${(currentSize / 1024).toFixed(2)} / ${(limitSize / 1024).toFixed(2)} MB`
        : `存储空间：${(currentSize / 1024).toFixed(2)} MB`;

      this.setData({
        storageUsageText: ratio >= STORAGE_USAGE_WARN_RATIO ? `${usageText}，建议导出数据` : usageText
      });
    } catch (error) {
      this.setData({ storageUsageText: "存储空间：暂时无法读取" });
    }
  },

  renderAll() {
    const mode = this.getCurrentMode();
    const phase = this.hasStarted ? this.getCurrentPhase() : mode.phases[0];
    const todaySummary = this.dailySummaries[getDateKey()];
    const todaySeconds = todaySummary ? todaySummary.totalSeconds : 0;
    const checkedSummaries = Object.values(this.dailySummaries).filter((summary) => summary.totalSeconds >= CHECK_IN_SECONDS);
    const totalCheckedSeconds = checkedSummaries.reduce((total, summary) => total + summary.totalSeconds, 0);
    const remainingSeconds = Math.max(0, CHECK_IN_SECONDS - todaySeconds);
    const progressPercent = Math.round(Math.min(1, todaySeconds / CHECK_IN_SECONDS) * 100);
    const phaseState = this.hasStarted ? this.getPhaseStateFromElapsed(this.getPracticeElapsedSeconds()) : { phaseElapsedMs: 0 };
    const countdownText = this.hasStarted
      ? String(Math.max(1, Math.ceil((phase.duration * 1000 - phaseState.phaseElapsedMs) / 1000)))
      : "--";
    const history = Object.values(this.dailySummaries)
      .sort((left, right) => right.date.localeCompare(left.date))
      .slice(0, 7)
      .map((summary) => ({
        date: summary.date,
        durationText: formatDuration(summary.totalSeconds),
        statusText: summary.totalSeconds >= CHECK_IN_SECONDS ? "已打卡" : "未满 10 分钟"
      }));

    const soundStatusText = this.getSoundStatusText();

    this.setData({
      modeName: mode.name,
      modeDescription: mode.description,
      phaseName: this.hasStarted ? phase.name : "准备开始",
      phaseHint: this.hasStarted ? phase.hint : `点击开始后进入 ${phase.duration} 秒${phase.name}`,
      countdownText,
      elapsedText: formatDuration(this.elapsedSeconds),
      todayText: formatDuration(todaySeconds),
      checkInStatus: todaySeconds >= CHECK_IN_SECONDS ? "已打卡" : todaySeconds > 0 ? "未满 10 分钟" : "今日未打卡",
      checkedDays: checkedSummaries.length,
      progressPercent,
      checkInProgressText: `${Math.min(10, Math.floor(todaySeconds / 60))} / 10 分钟`,
      remainingText: remainingSeconds > 0 ? `距离打卡还差 ${formatDuration(remainingSeconds)}` : "今日已达到打卡标准",
      summaryText: `累计 ${checkedSummaries.length} 天 / ${formatDuration(totalCheckedSeconds)}`,
      soundStatusText,
      history
    });
  }
});
