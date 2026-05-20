const CHECK_IN_SECONDS = 10 * 60;
const AUTOSAVE_INTERVAL_MS = 15 * 1000;
const STORAGE_USAGE_WARN_RATIO = 0.7;
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
    storageUsageText: "存储空间：--"
  },

  timerId: null,
  audioContext: null,
  monthlyEvents: {},
  dailySummaries: {},
  dirtyDailyYears: {},
  dirtyEventMonths: {},
  activeSession: null,
  lastDailySaveAt: 0,
  isRunning: false,
  hasStarted: false,
  phaseIndex: 0,
  phaseStartedAt: 0,
  pausedPhaseElapsedMs: 0,
  lastAccountingAtMs: 0,
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
    this.monthlyEvents = {};
    this.dailySummaries = {};
    this.dirtyDailyYears = {};
    this.dirtyEventMonths = {};
    this.activeSession = null;
    this.lastDailySaveAt = 0;
    this.isRunning = false;
    this.hasStarted = false;
    this.phaseIndex = 0;
    this.phaseStartedAt = 0;
    this.pausedPhaseElapsedMs = 0;
    this.lastAccountingAtMs = 0;
    this.elapsedSeconds = 0;
  },

  onShow() {
    if (this.isRunning) {
      this.accountElapsedToNow();
      this.updatePhaseFromClock();
      this.startTicker();
      this.startAudio(true);
      this.tick();
    }
  },

  onHide() {
    this.accountElapsedToNow();
    this.commitActiveSessionSnapshot(true);
    this.saveDirtyDailySummaries();
    this.stopTicker();
    this.pauseAudio();
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
    this.lastAccountingAtMs = now;
    this.phaseStartedAt = now - this.pausedPhaseElapsedMs;
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
    this.pausedPhaseElapsedMs = Date.now() - this.phaseStartedAt;
    this.isRunning = false;
    this.lastAccountingAtMs = 0;
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
    this.phaseStartedAt = 0;
    this.pausedPhaseElapsedMs = 0;
    this.lastAccountingAtMs = 0;
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
  },

  startTicker() {
    this.stopTicker();
    this.timerId = setInterval(() => this.tick(), 250);
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
    if (!this.isRunning || !this.lastAccountingAtMs || !this.activeSession) {
      return;
    }

    const now = Date.now();
    const elapsedWholeSeconds = Math.floor((now - this.lastAccountingAtMs) / 1000);
    if (elapsedWholeSeconds <= 0) {
      return;
    }

    this.addSecondsAcrossDates(this.lastAccountingAtMs, elapsedWholeSeconds, this.activeSession);
    this.lastAccountingAtMs += elapsedWholeSeconds * 1000;
    this.elapsedSeconds += elapsedWholeSeconds;
    this.activeSession.endAt = this.lastAccountingAtMs;
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

  updatePhaseFromClock() {
    const mode = this.getCurrentMode();
    const now = Date.now();
    let phase = mode.phases[this.phaseIndex];
    let phaseElapsedMs = now - this.phaseStartedAt;

    while (phaseElapsedMs >= phase.duration * 1000) {
      this.phaseStartedAt += phase.duration * 1000;
      this.phaseIndex = (this.phaseIndex + 1) % mode.phases.length;
      phase = mode.phases[this.phaseIndex];
      phaseElapsedMs = now - this.phaseStartedAt;
    }

    this.pausedPhaseElapsedMs = phaseElapsedMs;
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
      this.startAudio(true);
    } else {
      this.pauseAudio();
    }
  },

  startAudio(shouldSync) {
    if (!this.data.soundEnabled) {
      return;
    }

    const mode = this.getCurrentMode();
    if (!this.audioContext) {
      this.audioContext = wx.createInnerAudioContext();
      this.audioContext.loop = true;
      this.audioContext.obeyMuteSwitch = false;
    }

    if (this.audioContext.src !== mode.audio) {
      this.audioContext.stop();
      this.audioContext.src = mode.audio;
      shouldSync = true;
    }

    if (shouldSync) {
      this.syncAudioToCurrentPhase();
    }

    this.audioContext.play();

    if (shouldSync) {
      setTimeout(() => {
        this.syncAudioToCurrentPhase();
      }, 80);
    }
  },

  pauseAudio() {
    if (this.audioContext) {
      this.audioContext.pause();
    }
  },

  stopAudio(shouldReset) {
    if (this.audioContext) {
      this.audioContext.stop();
      if (shouldReset) {
        this.audioContext.seek(0);
      }
    }
  },

  syncAudioToCurrentPhase() {
    if (!this.audioContext) {
      return;
    }

    const mode = this.getCurrentMode();
    const loopDuration = mode.phases.reduce((total, phase) => total + phase.duration, 0);
    if (loopDuration <= 0) {
      return;
    }

    const previousPhaseSeconds = mode.phases
      .slice(0, this.phaseIndex)
      .reduce((total, phase) => total + phase.duration, 0);
    const phaseElapsedSeconds = Math.max(0, this.pausedPhaseElapsedMs / 1000);
    const targetSeconds = (previousPhaseSeconds + phaseElapsedSeconds) % loopDuration;

    this.audioContext.seek(targetSeconds);
  },

  destroyAudio() {
    if (this.audioContext) {
      this.audioContext.destroy();
      this.audioContext = null;
    }
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
    const countdownText = this.hasStarted
      ? String(Math.max(1, Math.ceil((phase.duration * 1000 - this.pausedPhaseElapsedMs) / 1000)))
      : "--";
    const history = Object.values(this.dailySummaries)
      .sort((left, right) => right.date.localeCompare(left.date))
      .slice(0, 7)
      .map((summary) => ({
        date: summary.date,
        durationText: formatDuration(summary.totalSeconds),
        statusText: summary.totalSeconds >= CHECK_IN_SECONDS ? "已打卡" : "未满 10 分钟"
      }));

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
      history
    });
  }
});
