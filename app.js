/**
 * Overnight Sleep Schedule Tracker - Frontend Application
 * Supports both the local Python backend (/api/schedule) and standalone/offline
 * browser usage (via localStorage + embedded initial CSV data).
 */

const INITIAL_CSV_DATA = `Time,19-Oct,20-Oct,21-Oct,22-Oct,23-Oct,24-Oct,25-Oct
9:00 PM,,down,,,,,
9:15 PM,,,,,down,,
9:20 PM,down,,,,,,
9:40 PM,,,,down,,,
9:45 PM,,,down,,,,
10:00 PM,,,,,up,,
10:40 PM,,,,,,down,
10:55 PM,,,,,,,down
11:00 PM,,,,,down,,
11:40 PM,,up,,,,,
11:45 PM,up,,,,,,
12:30 AM,down,,,,,,
12:50 AM,,down,,,,,
1:00 AM,,,up,,,,
1:45 AM,,,,up,,,
2:15 AM,,,down,,,,
2:45 AM,,,,,,up,
2:50 AM,,,,,up,,
3:00 AM,up,,,,,,
3:20 AM,,,,,,down,
3:25 AM,,,,down,,,
3:40 AM,,up,,,,,
4:00 AM,,,,,down,,
4:10 AM,down,,,,,,
4:30 AM,,down,,,,,
4:45 AM,,,up,,,,
5:30 AM,up,,,,,,
5:45 AM,,,down,up,,,
6:15 AM,,,,,,up,
6:30 AM,,up,,,up,,
6:50 AM,down,,,,,,
7:00 AM,,,,up,,,`;

const STORAGE_KEY = "sleep_schedule_tracker_v2";
const SYNC_CONFIG_KEY = "sleep_tracker_sync_config_v1";
const SYNC_SESSION_KEY = "sleep_tracker_sync_session_v1";

function generateTimeLabels() {
  const labels = [];
  const startMinutes = 21 * 60; // 9:00 PM
  for (let offset = 0; offset <= 600; offset += 5) {
    const totalMins = (startMinutes + offset) % (24 * 60);
    const hour24 = Math.floor(totalMins / 60);
    const minute = totalMins % 60;
    const period = hour24 < 12 ? "AM" : "PM";
    let hour12 = hour24 % 12;
    if (hour12 === 0) hour12 = 12;
    labels.push(`${hour12}:${String(minute).padStart(2, "0")} ${period}`);
  }
  return labels;
}

const DEFAULT_TIME_LABELS = generateTimeLabels();
const TIME_TO_MIN_MAP = {};
DEFAULT_TIME_LABELS.forEach((lbl, i) => {
  TIME_TO_MIN_MAP[lbl] = i * 5;
});

const state = {
  columns: [],
  eventsByCol: {},
  blocksByCol: {},
  statsByCol: {},
  timeLabels: [...DEFAULT_TIME_LABELS],
  activeDate: null,
  rangeStartIdx: 0,
  rangeEndIdx: 0,
  rangeInitialized: false,
  selectedSingleState: "down",
  dateFormMode: null, // 'add' | 'rename' | null
  hoverInfo: null,
  dragState: null,
  popoverState: null,
  backendAvailable: false,
  githubSync: {
    config: null, // { version, owner, repo, branch, salt, iv, ciphertext }
    unlocked: false,
    token: null,
    owner: null,
    repo: null,
    branch: "main",
    csvSha: null,
    status: "unconfigured", // 'unconfigured' | 'locked' | 'syncing' | 'synced' | 'error'
    lastSyncedAt: null,
    pushTimer: null,
    isPushing: false,
  },
};

// DOM Elements
const els = {
  mobileMenuBtn: document.getElementById("mobileMenuBtn"),
  mobileDrawerBackdrop: document.getElementById("mobileDrawerBackdrop"),
  mobileDrawerCloseBtn: document.getElementById("mobileDrawerCloseBtn"),
  editorPanel: document.getElementById("editorPanel"),
  tabChartBtn: document.getElementById("tabChartBtn"),
  tabGridBtn: document.getElementById("tabGridBtn"),
  chartViewContainer: document.getElementById("chartViewContainer"),
  gridViewContainer: document.getElementById("gridViewContainer"),
  cloudSyncBtn: document.getElementById("cloudSyncBtn"),
  cloudSyncDot: document.getElementById("cloudSyncDot"),
  cloudSyncLabel: document.getElementById("cloudSyncLabel"),
  syncPullNowBtn: document.getElementById("syncPullNowBtn"),
  csvFileInput: document.getElementById("csvFileInput"),
  exportCsvBtn: document.getElementById("exportCsvBtn"),
  downloadPngBtn: document.getElementById("downloadPngBtn"),
  resetDataBtn: document.getElementById("resetDataBtn"),

  dateRangeBadge: document.getElementById("dateRangeBadge"),
  presetLast3Btn: document.getElementById("presetLast3Btn"),
  presetLast5Btn: document.getElementById("presetLast5Btn"),
  presetAllDatesBtn: document.getElementById("presetAllDatesBtn"),
  rangeSliderFill: document.getElementById("rangeSliderFill"),
  rangeStartInput: document.getElementById("rangeStartInput"),
  rangeEndInput: document.getElementById("rangeEndInput"),
  rangeTicksContainer: document.getElementById("rangeTicksContainer"),

  datePillsContainer: document.getElementById("datePillsContainer"),
  addDateModalBtn: document.getElementById("addDateModalBtn"),
  dateForm: document.getElementById("dateForm"),
  dateNameInput: document.getElementById("dateNameInput"),
  dateFormSubmitBtn: document.getElementById("dateFormSubmitBtn"),
  dateFormCancelBtn: document.getElementById("dateFormCancelBtn"),
  activeDateTitle: document.getElementById("activeDateTitle"),
  renameDateBtn: document.getElementById("renameDateBtn"),
  clearDateBtn: document.getElementById("clearDateBtn"),
  deleteDateBtn: document.getElementById("deleteDateBtn"),

  modeSingleBtn: document.getElementById("modeSingleBtn"),
  modeRangeBtn: document.getElementById("modeRangeBtn"),
  addSingleEventForm: document.getElementById("addSingleEventForm"),
  addRangeEventForm: document.getElementById("addRangeEventForm"),
  singleTimeSelect: document.getElementById("singleTimeSelect"),
  stateDownBtn: document.getElementById("stateDownBtn"),
  stateUpBtn: document.getElementById("stateUpBtn"),
  rangeDownTimeSelect: document.getElementById("rangeDownTimeSelect"),
  rangeUpTimeSelect: document.getElementById("rangeUpTimeSelect"),

  eventCountBadge: document.getElementById("eventCountBadge"),
  eventsListContainer: document.getElementById("eventsListContainer"),
  nightTotalSleepBadge: document.getElementById("nightTotalSleepBadge"),
  blocksListContainer: document.getElementById("blocksListContainer"),

  summaryCardsContainer: document.getElementById("summaryCardsContainer"),
  showHoverGuideCheckbox: document.getElementById("showHoverGuideCheckbox"),
  interactiveChartBoard: document.getElementById("interactiveChartBoard"),
  timelineScrollHint: document.getElementById("timelineScrollHint"),
  timelineGridShell: document.getElementById("timelineGridShell"),
  timelineAxisCol: document.getElementById("timelineAxisCol"),
  timelineAxisBody: document.getElementById("timelineAxisBody"),
  axisHoverBadge: document.getElementById("axisHoverBadge"),
  timelineColumnsTrack: document.getElementById("timelineColumnsTrack"),
  timelineCrosshairLine: document.getElementById("timelineCrosshairLine"),
  canvasWrapper: document.getElementById("canvasWrapper"),
  scheduleCanvas: document.getElementById("scheduleCanvas"),
  chartPopover: document.getElementById("chartPopover"),
  popoverTitle: document.getElementById("popoverTitle"),
  popoverCloseBtn: document.getElementById("popoverCloseBtn"),
  popoverBody: document.getElementById("popoverBody"),
  chartTooltip: document.getElementById("chartTooltip"),

  filterActiveRowsCheckbox: document.getElementById("filterActiveRowsCheckbox"),
  scheduleGridTable: document.getElementById("scheduleGridTable"),
  toastContainer: document.getElementById("toastContainer"),

  syncModalOverlay: document.getElementById("syncModalOverlay"),
  syncModalCloseBtn: document.getElementById("syncModalCloseBtn"),
  syncTabUnlockBtn: document.getElementById("syncTabUnlockBtn"),
  syncTabSetupBtn: document.getElementById("syncTabSetupBtn"),
  syncUnlockSection: document.getElementById("syncUnlockSection"),
  syncSetupSection: document.getElementById("syncSetupSection"),
  syncLockedView: document.getElementById("syncLockedView"),
  syncUnlockedView: document.getElementById("syncUnlockedView"),
  syncEmptyView: document.getElementById("syncEmptyView"),
  syncRepoLabel: document.getElementById("syncRepoLabel"),
  pinUnlockForm: document.getElementById("pinUnlockForm"),
  pinUnlockInput: document.getElementById("pinUnlockInput"),
  rememberPinCheckbox: document.getElementById("rememberPinCheckbox"),
  pinUnlockError: document.getElementById("pinUnlockError"),
  pinUnlockSubmitBtn: document.getElementById("pinUnlockSubmitBtn"),
  syncActiveRepoLabel: document.getElementById("syncActiveRepoLabel"),
  syncLastTimeLabel: document.getElementById("syncLastTimeLabel"),
  modalPullBtn: document.getElementById("modalPullBtn"),
  modalPushBtn: document.getElementById("modalPushBtn"),
  lockDeviceBtn: document.getElementById("lockDeviceBtn"),
  goToSetupBtn: document.getElementById("goToSetupBtn"),
  syncSetupForm: document.getElementById("syncSetupForm"),
  setupRepoInput: document.getElementById("setupRepoInput"),
  setupBranchInput: document.getElementById("setupBranchInput"),
  setupTokenInput: document.getElementById("setupTokenInput"),
  setupPinInput: document.getElementById("setupPinInput"),
  setupStatusMsg: document.getElementById("setupStatusMsg"),
  setupSubmitBtn: document.getElementById("setupSubmitBtn"),
};

const CHART_LAYOUT = {
  marginTop: 108,
  marginBottom: 28,
  marginLeft: 82,
  marginRight: 28,
  plotHeight: 780,
  minColWidth: 112,
};

function minToTime(minute) {
  const idx = Math.round(minute / 5);
  return state.timeLabels[idx] || "";
}

function formatDuration(dur) {
  const total = Math.round(dur);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function computeBlocksClient(events) {
  const sorted = [...events].sort((a, b) => a.minute - b.minute);
  const blocks = [];
  let currentTime = 0;
  let currentState = "up";

  for (const ev of sorted) {
    const evTime = Number(ev.minute);
    const evState = String(ev.state).toLowerCase();
    if (evState !== "up" && evState !== "down") continue;

    if (evTime === 0) {
      currentState = evState;
    } else if (evTime > currentTime) {
      const dur = evTime - currentTime;
      blocks.push({
        state: currentState,
        start_min: currentTime,
        end_min: evTime,
        start_time: minToTime(currentTime),
        end_time: minToTime(evTime),
        duration: dur,
        label: formatDuration(dur),
      });
      currentTime = evTime;
      currentState = evState;
    } else if (evTime === currentTime) {
      currentState = evState;
    }
  }

  if (currentTime < 600) {
    const dur = 600 - currentTime;
    blocks.push({
      state: currentState,
      start_min: currentTime,
      end_min: 600,
      start_time: minToTime(currentTime),
      end_time: minToTime(600),
      duration: dur,
      label: formatDuration(dur),
    });
  }

  return blocks;
}

function parseCsvClient(csvText) {
  const lines = csvText
    .trim()
    .split(/\r?\n/)
    .map((l) => l.split(","));
  if (lines.length === 0) return { columns: [], events_by_col: {} };
  const header = lines[0];
  const columns = header
    .slice(1)
    .map((c) => c.trim())
    .filter(Boolean);
  const eventsByCol = {};
  columns.forEach((c) => {
    eventsByCol[c] = [];
  });

  for (let r = 1; r < lines.length; r++) {
    const row = lines[r];
    if (!row || row.length === 0) continue;
    let rawTime = (row[0] || "").trim().toUpperCase();
    if (rawTime.startsWith("0") && rawTime.length > 1) {
      rawTime = rawTime.slice(1);
    }
    const minute =
      TIME_TO_MIN_MAP[rawTime] !== undefined ? TIME_TO_MIN_MAP[rawTime] : (r - 1) * 5;
    if (minute < 0 || minute > 600) continue;

    columns.forEach((col, cIdx) => {
      const val = String(row[cIdx + 1] || "")
        .trim()
        .toLowerCase();
      if (val === "up" || val === "down") {
        eventsByCol[col].push({
          minute,
          time: minToTime(minute),
          state: val,
        });
      }
    });
  }

  columns.forEach((col) => {
    const dedup = {};
    eventsByCol[col].forEach((ev) => {
      dedup[ev.minute] = ev;
    });
    eventsByCol[col] = Object.keys(dedup)
      .map(Number)
      .sort((a, b) => a - b)
      .map((m) => dedup[m]);
  });

  return { columns, events_by_col: eventsByCol };
}

function buildPayloadClient(columns, eventsByCol) {
  const blocksByCol = {};
  const statsByCol = {};

  columns.forEach((col) => {
    const evs = eventsByCol[col] || [];
    const blocks = computeBlocksClient(evs);
    blocksByCol[col] = blocks;

    const downMins = blocks
      .filter((b) => b.state === "down")
      .reduce((acc, b) => acc + b.duration, 0);
    const upMins = blocks
      .filter((b) => b.state === "up")
      .reduce((acc, b) => acc + b.duration, 0);
    const longestDown = blocks
      .filter((b) => b.state === "down")
      .reduce((max, b) => Math.max(max, b.duration), 0);

    statsByCol[col] = {
      down_minutes: downMins,
      down_label: formatDuration(downMins),
      up_minutes: upMins,
      up_label: formatDuration(upMins),
      sleep_pct: Number(((downMins / 600) * 100).toFixed(1)),
      longest_down_minutes: longestDown,
      longest_down_label: formatDuration(longestDown),
      event_count: evs.length,
    };
  });

  return {
    columns,
    events_by_col: eventsByCol,
    blocks_by_col: blocksByCol,
    stats_by_col: statsByCol,
    time_labels: DEFAULT_TIME_LABELS,
  };
}

function serializeCsvClient(columns, eventsByCol) {
  const rows = [["Time", ...columns].join(",")];
  const lookup = {};
  columns.forEach((col) => {
    (eventsByCol[col] || []).forEach((ev) => {
      lookup[`${col}__${ev.minute}`] = ev.state;
    });
  });

  DEFAULT_TIME_LABELS.forEach((label, idx) => {
    const minute = idx * 5;
    const row = [label];
    columns.forEach((col) => {
      row.push(lookup[`${col}__${minute}`] || "");
    });
    rows.push(row.join(","));
  });

  return rows.join("\r\n");
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  els.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 2600);
}

// ============================================================================
// GitHub Cloud Sync + Web Crypto Shared PIN Encryption (AES-256-GCM)
// ============================================================================

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function utf8ToBase64(str) {
  return bytesToBase64(new TextEncoder().encode(str));
}

function base64ToUtf8(b64) {
  return new TextDecoder().decode(base64ToBytes(b64.replace(/\s+/g, "")));
}

async function deriveAesKeyFromPin(pin, saltBytes) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(String(pin).trim()),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: 100000,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptTokenWithPin(token, pin, owner, repo, branch = "main") {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKeyFromPin(pin, salt);
  const encodedToken = new TextEncoder().encode(String(token).trim());
  const encryptedBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encodedToken
  );
  return {
    version: 1,
    owner: owner.trim(),
    repo: repo.trim(),
    branch: (branch || "main").trim(),
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encryptedBuf)),
    updated_at: new Date().toISOString(),
  };
}

async function decryptTokenWithPin(configObj, pin) {
  const salt = base64ToBytes(configObj.salt);
  const iv = base64ToBytes(configObj.iv);
  const ciphertext = base64ToBytes(configObj.ciphertext);
  const key = await deriveAesKeyFromPin(pin, salt);
  const decryptedBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );
  return new TextDecoder().decode(decryptedBuf);
}

function detectGitHubPagesRepo() {
  const host = window.location.hostname || "";
  if (host.endsWith(".github.io")) {
    const owner = host.replace(/\.github\.io$/, "");
    const parts = window.location.pathname.split("/").filter(Boolean);
    const repo = parts[0] || "";
    if (owner && repo) {
      return { owner, repo, full: `${owner}/${repo}` };
    }
  }
  return null;
}

async function githubGetFile(owner, repo, path, branch = "main", token = null) {
  const url = `https://api.github.com/repos/${encodeURIComponent(
    owner
  )}/${encodeURIComponent(repo)}/contents/${path}?ref=${encodeURIComponent(
    branch
  )}&_t=${Date.now()}`;
  const headers = {
    Accept: "application/vnd.github+json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(url, { headers, cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) {
    let errText = `${res.status} ${res.statusText}`;
    try {
      const errJson = await res.json();
      if (errJson && errJson.message) errText = errJson.message;
    } catch (_) {}
    throw new Error(errText);
  }
  const data = await res.json();
  return {
    sha: data.sha,
    text: base64ToUtf8(data.content || ""),
  };
}

async function githubPutFile(
  owner,
  repo,
  path,
  branch,
  token,
  contentText,
  commitMessage,
  knownSha = null
) {
  let sha = knownSha;
  if (!sha) {
    const existing = await githubGetFile(owner, repo, path, branch, token);
    if (existing) sha = existing.sha;
  }

  const attemptPut = async (shaToUse) => {
    const url = `https://api.github.com/repos/${encodeURIComponent(
      owner
    )}/${encodeURIComponent(repo)}/contents/${path}`;
    const body = {
      message: commitMessage,
      content: utf8ToBase64(contentText),
      branch,
    };
    if (shaToUse) body.sha = shaToUse;
    return fetch(url, {
      method: "PUT",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  };

  let res = await attemptPut(sha);
  if (res.status === 409 || res.status === 422) {
    const latest = await githubGetFile(owner, repo, path, branch, token);
    res = await attemptPut(latest ? latest.sha : null);
  }

  if (!res.ok) {
    let errText = `${res.status} ${res.statusText}`;
    try {
      const errJson = await res.json();
      if (errJson && errJson.message) errText = errJson.message;
    } catch (_) {}
    throw new Error(errText);
  }

  const data = await res.json();
  return data.content ? data.content.sha : null;
}

function updateSyncUI() {
  const gs = state.githubSync;
  if (!els.cloudSyncDot || !els.cloudSyncLabel) return;

  els.cloudSyncDot.className = `sync-dot ${gs.status}`;
  if (gs.status === "synced") {
    els.cloudSyncLabel.textContent = "Cloud Synced";
    els.syncPullNowBtn.classList.remove("hidden");
  } else if (gs.status === "syncing") {
    els.cloudSyncLabel.textContent = "Syncing...";
    els.syncPullNowBtn.classList.remove("hidden");
  } else if (gs.status === "locked") {
    els.cloudSyncLabel.textContent = "🔒 Unlock Sync (PIN)";
    els.syncPullNowBtn.classList.add("hidden");
  } else if (gs.status === "error") {
    els.cloudSyncLabel.textContent = "Sync Error";
    els.syncPullNowBtn.classList.remove("hidden");
  } else {
    els.cloudSyncLabel.textContent = "Set Up Cloud Sync";
    els.syncPullNowBtn.classList.add("hidden");
  }

  // Update Modal views
  if (gs.unlocked) {
    els.syncLockedView.classList.add("hidden");
    els.syncEmptyView.classList.add("hidden");
    els.syncUnlockedView.classList.remove("hidden");
    els.syncActiveRepoLabel.textContent = `Repository: ${gs.owner}/${gs.repo} (${gs.branch})`;
    els.syncLastTimeLabel.textContent = gs.lastSyncedAt
      ? `Last synced: ${gs.lastSyncedAt.toLocaleTimeString()}`
      : "Connected to GitHub";
  } else if (gs.config && gs.config.ciphertext) {
    els.syncLockedView.classList.remove("hidden");
    els.syncUnlockedView.classList.add("hidden");
    els.syncEmptyView.classList.add("hidden");
    els.syncRepoLabel.textContent = `Repository: ${gs.config.owner}/${gs.config.repo} (${
      gs.config.branch || "main"
    })`;
  } else {
    els.syncLockedView.classList.add("hidden");
    els.syncUnlockedView.classList.add("hidden");
    els.syncEmptyView.classList.remove("hidden");
  }
}

async function discoverSyncConfig() {
  // 1. Check relative ./data/sync-config.json
  try {
    if (window.location.protocol.startsWith("http")) {
      const res = await fetch(`./data/sync-config.json?_t=${Date.now()}`, {
        cache: "no-store",
      });
      if (res.ok) {
        const cfg = await res.json();
        if (cfg && cfg.ciphertext && cfg.owner && cfg.repo) {
          localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(cfg));
          return cfg;
        }
      }
    }
  } catch (_) {}

  // 2. If hosted on *.github.io, check unauthenticated GitHub Contents API
  const ghPage = detectGitHubPagesRepo();
  if (ghPage) {
    try {
      const file = await githubGetFile(
        ghPage.owner,
        ghPage.repo,
        "data/sync-config.json",
        "main"
      );
      if (file && file.text) {
        const cfg = JSON.parse(file.text);
        if (cfg && cfg.ciphertext && cfg.owner && cfg.repo) {
          localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(cfg));
          return cfg;
        }
      }
    } catch (_) {}
  }

  // 3. Fallback to cached config in localStorage
  try {
    const cached = localStorage.getItem(SYNC_CONFIG_KEY);
    if (cached) {
      const cfg = JSON.parse(cached);
      if (cfg && cfg.ciphertext && cfg.owner && cfg.repo) {
        return cfg;
      }
    }
  } catch (_) {}

  return null;
}

async function pullScheduleFromGitHub(silent = false) {
  const gs = state.githubSync;
  if (!gs.unlocked || !gs.owner || !gs.repo || !gs.token) return false;

  gs.status = "syncing";
  updateSyncUI();

  try {
    const file = await githubGetFile(
      gs.owner,
      gs.repo,
      "data/schedule.csv",
      gs.branch || "main",
      gs.token
    );
    if (file && file.text) {
      gs.csvSha = file.sha;
      const parsed = parseCsvClient(file.text);
      if (parsed.columns && parsed.columns.length > 0) {
        try {
          localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
              columns: parsed.columns,
              events_by_col: parsed.events_by_col,
            })
          );
        } catch (_) {}
        applyScheduleData(buildPayloadClient(parsed.columns, parsed.events_by_col));
      }
    }
    gs.status = "synced";
    gs.lastSyncedAt = new Date();
    updateSyncUI();
    if (!silent) showToast(`Synced latest schedule from ${gs.owner}/${gs.repo}`);
    return true;
  } catch (err) {
    gs.status = "error";
    updateSyncUI();
    if (!silent) showToast(`GitHub sync error: ${err.message}`);
    return false;
  }
}

async function pushScheduleToGitHub(toastOnSuccess = false) {
  const gs = state.githubSync;
  if (!gs.unlocked || !gs.owner || !gs.repo || !gs.token) return false;

  gs.isPushing = true;
  gs.status = "syncing";
  updateSyncUI();

  try {
    const csvText = serializeCsvClient(state.columns, state.eventsByCol);
    const newSha = await githubPutFile(
      gs.owner,
      gs.repo,
      "data/schedule.csv",
      gs.branch || "main",
      gs.token,
      csvText,
      `Update sleep schedule (${state.activeDate || "app"})`,
      gs.csvSha
    );
    if (newSha) gs.csvSha = newSha;
    gs.status = "synced";
    gs.lastSyncedAt = new Date();
    updateSyncUI();
    if (toastOnSuccess) {
      showToast(`Pushed schedule to ${gs.owner}/${gs.repo}`);
    }
    return true;
  } catch (err) {
    gs.status = "error";
    updateSyncUI();
    showToast(`Failed to push to GitHub: ${err.message}`);
    return false;
  } finally {
    gs.isPushing = false;
  }
}

function scheduleGitHubPush() {
  const gs = state.githubSync;
  if (!gs.unlocked) return;
  if (gs.pushTimer) clearTimeout(gs.pushTimer);
  gs.status = "syncing";
  updateSyncUI();
  gs.pushTimer = setTimeout(() => {
    pushScheduleToGitHub(false);
  }, 550);
}

// Hybrid Load/Save (GitHub Cloud Sync, Local Python API, or localStorage fallback)
async function fetchSchedule() {
  populateTimeSelects();

  // Render initial/cached schedule immediately on load (0ms latency) before awaiting network
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && Array.isArray(parsed.columns) && parsed.columns.length > 0) {
        applyScheduleData(buildPayloadClient(parsed.columns, parsed.events_by_col));
      }
    }
  } catch (_) {}
  if (!state.columns || state.columns.length === 0) {
    const initial = parseCsvClient(INITIAL_CSV_DATA);
    applyScheduleData(buildPayloadClient(initial.columns, initial.events_by_col));
  }

  const ghPage = detectGitHubPagesRepo();
  if (ghPage && els.setupRepoInput && !els.setupRepoInput.value) {
    els.setupRepoInput.value = ghPage.full;
  }

  // 1. Discover any existing PIN-encrypted GitHub Sync config
  const cfg = await discoverSyncConfig();
  if (cfg) {
    state.githubSync.config = cfg;
    state.githubSync.owner = cfg.owner;
    state.githubSync.repo = cfg.repo;
    state.githubSync.branch = cfg.branch || "main";
    if (els.setupRepoInput) els.setupRepoInput.value = `${cfg.owner}/${cfg.repo}`;
    if (els.setupBranchInput) els.setupBranchInput.value = cfg.branch || "main";
  }

  // 2. Check if this device already has an unlocked session saved
  try {
    const savedSession = localStorage.getItem(SYNC_SESSION_KEY);
    if (savedSession) {
      const sess = JSON.parse(savedSession);
      if (sess && sess.token && sess.owner && sess.repo) {
        state.githubSync.unlocked = true;
        state.githubSync.token = sess.token;
        state.githubSync.owner = sess.owner;
        state.githubSync.repo = sess.repo;
        state.githubSync.branch = sess.branch || "main";
      }
    }
  } catch (_) {}

  if (state.githubSync.unlocked) {
    const ok = await pullScheduleFromGitHub(true);
    if (ok) return;
  } else if (state.githubSync.config) {
    state.githubSync.status = "locked";
    updateSyncUI();
  } else {
    state.githubSync.status = "unconfigured";
    updateSyncUI();
  }

  // 3. Check local Python backend (/api/schedule)
  try {
    if (
      window.location.protocol.startsWith("http") &&
      !window.location.hostname.endsWith(".github.io")
    ) {
      const res = await fetch("/api/schedule");
      if (res.ok) {
        const data = await res.json();
        state.backendAvailable = true;
        applyScheduleData(data);
        return;
      }
    }
  } catch (_) {
    state.backendAvailable = false;
  }

  // 4. Try reading ./data/schedule.csv directly (e.g., on GitHub Pages before PIN unlock)
  try {
    if (window.location.protocol.startsWith("http")) {
      const csvRes = await fetch(`./data/schedule.csv?_t=${Date.now()}`, {
        cache: "no-store",
      });
      if (csvRes.ok) {
        const csvText = await csvRes.text();
        const parsed = parseCsvClient(csvText);
        if (parsed.columns && parsed.columns.length > 0) {
          applyScheduleData(buildPayloadClient(parsed.columns, parsed.events_by_col));
          return;
        }
      }
    }
  } catch (_) {}

  // 5. Fallback to localStorage or INITIAL_CSV_DATA
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && Array.isArray(parsed.columns) && parsed.columns.length > 0) {
        applyScheduleData(buildPayloadClient(parsed.columns, parsed.events_by_col));
        return;
      }
    }
  } catch (_) {}

  const initial = parseCsvClient(INITIAL_CSV_DATA);
  applyScheduleData(buildPayloadClient(initial.columns, initial.events_by_col));
}

async function saveScheduleToServer(toastMsg = null) {
  // Always update local state immediately for zero-latency UI
  const localPayload = buildPayloadClient(state.columns, state.eventsByCol);
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        columns: state.columns,
        events_by_col: state.eventsByCol,
      })
    );
  } catch (_) {}

  applyScheduleData(localPayload);

  if (state.githubSync.unlocked) {
    if (toastMsg) showToast(toastMsg);
    scheduleGitHubPush();
  } else if (state.githubSync.config) {
    showToast(
      toastMsg
        ? `${toastMsg} · 🔒 Unlock PIN to sync to GitHub`
        : "🔒 Unlock PIN to sync changes to GitHub"
    );
  } else if (toastMsg) {
    showToast(toastMsg);
  }

  if (state.backendAvailable) {
    try {
      await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          columns: state.columns,
          events_by_col: state.eventsByCol,
        }),
      });
    } catch (_) {}
  }
}

function getVisibleColumns() {
  if (!state.columns || state.columns.length === 0) return [];
  const start = Math.max(0, Math.min(state.columns.length - 1, state.rangeStartIdx));
  const end = Math.max(start, Math.min(state.columns.length - 1, state.rangeEndIdx));
  return state.columns.slice(start, end + 1);
}

function applyScheduleData(data) {
  const prevLen = state.columns.length;
  state.columns = data.columns || [];
  state.eventsByCol = data.events_by_col || {};
  state.blocksByCol = data.blocks_by_col || {};
  state.statsByCol = data.stats_by_col || {};
  if (data.time_labels && data.time_labels.length > 0) {
    state.timeLabels = data.time_labels;
  }

  const maxIdx = Math.max(0, state.columns.length - 1);
  if (!state.rangeInitialized) {
    state.rangeStartIdx = 0;
    state.rangeEndIdx = maxIdx;
    state.rangeInitialized = true;
  } else {
    // If columns grew and rangeEndIdx was at the previous end, extend to include new column
    if (state.columns.length > prevLen && state.rangeEndIdx === Math.max(0, prevLen - 1)) {
      state.rangeEndIdx = maxIdx;
    } else {
      state.rangeStartIdx = Math.min(state.rangeStartIdx, maxIdx);
      state.rangeEndIdx = Math.max(state.rangeStartIdx, Math.min(state.rangeEndIdx, maxIdx));
    }
  }

  if (!state.activeDate || !state.columns.includes(state.activeDate)) {
    state.activeDate =
      state.columns[state.columns.length - 1] || state.columns[0] || null;
  }

  renderAll();
}

function populateTimeSelects() {
  const selects = [
    els.singleTimeSelect,
    els.rangeDownTimeSelect,
    els.rangeUpTimeSelect,
  ];
  selects.forEach((sel) => {
    sel.innerHTML = "";
    state.timeLabels.forEach((label, idx) => {
      const opt = document.createElement("option");
      opt.value = String(idx * 5);
      opt.textContent = label;
      sel.appendChild(opt);
    });
  });
  els.singleTimeSelect.value = "30";
  els.rangeDownTimeSelect.value = "30";
  els.rangeUpTimeSelect.value = "180";
}

function syncSmartDefaultsForActiveDate() {
  if (!state.activeDate) return;
  const evs = state.eventsByCol[state.activeDate] || [];
  if (evs.length === 0) {
    setSingleStateChoice("down");
    els.singleTimeSelect.value = "20";
  } else {
    const lastEv = evs[evs.length - 1];
    const nextState = lastEv.state === "down" ? "up" : "down";
    setSingleStateChoice(nextState);
    const nextMin = Math.min(600, lastEv.minute + 60);
    els.singleTimeSelect.value = String(nextMin);
  }
}

function setSingleStateChoice(s) {
  state.selectedSingleState = s;
  els.stateDownBtn.classList.toggle("active", s === "down");
  els.stateUpBtn.classList.toggle("active", s === "up");
}

function renderAll() {
  renderDatePills();
  renderActiveDateHeader();
  renderEventsAndBlocksList();
  renderDateRangeSlider();
  renderSummaryCards();
  renderChartCanvas(false);
  renderGridTable();
}

function renderDateRangeSlider() {
  const total = state.columns.length;
  const maxIdx = Math.max(0, total - 1);

  els.rangeStartInput.min = "0";
  els.rangeStartInput.max = String(maxIdx);
  els.rangeStartInput.value = String(state.rangeStartIdx);

  els.rangeEndInput.min = "0";
  els.rangeEndInput.max = String(maxIdx);
  els.rangeEndInput.value = String(state.rangeEndIdx);

  const startPct = maxIdx > 0 ? (state.rangeStartIdx / maxIdx) * 100 : 0;
  const endPct = maxIdx > 0 ? (state.rangeEndIdx / maxIdx) * 100 : 100;
  els.rangeSliderFill.style.left = `${startPct}%`;
  els.rangeSliderFill.style.width = `${Math.max(0, endPct - startPct)}%`;

  const visibleCols = getVisibleColumns();
  if (visibleCols.length === 0) {
    els.dateRangeBadge.textContent = "No nights";
  } else if (visibleCols.length === 1) {
    els.dateRangeBadge.textContent = `${visibleCols[0]} (1 of ${total} nights)`;
  } else {
    els.dateRangeBadge.textContent = `${visibleCols[0]} → ${
      visibleCols[visibleCols.length - 1]
    } (${visibleCols.length} of ${total} nights)`;
  }

  els.rangeTicksContainer.innerHTML = "";
  state.columns.forEach((col, idx) => {
    const tickBtn = document.createElement("button");
    tickBtn.type = "button";
    const inRange = idx >= state.rangeStartIdx && idx <= state.rangeEndIdx;
    const isEndpoint = idx === state.rangeStartIdx || idx === state.rangeEndIdx;
    tickBtn.className = `slider-tick-btn ${inRange ? "in-range" : ""} ${
      isEndpoint ? "endpoint" : ""
    }`;
    tickBtn.textContent = col;
    tickBtn.title = "Click to adjust range endpoint · Double-click to solo this date";
    tickBtn.addEventListener("click", () => {
      const distStart = Math.abs(idx - state.rangeStartIdx);
      const distEnd = Math.abs(idx - state.rangeEndIdx);
      if (idx < state.rangeStartIdx || (distStart <= distEnd && idx <= state.rangeEndIdx)) {
        state.rangeStartIdx = idx;
      } else {
        state.rangeEndIdx = idx;
      }
      renderDateRangeSlider();
      renderSummaryCards();
      renderChartCanvas(false);
      renderGridTable();
    });
    tickBtn.addEventListener("dblclick", () => {
      state.rangeStartIdx = idx;
      state.rangeEndIdx = idx;
      state.activeDate = col;
      renderAll();
    });
    els.rangeTicksContainer.appendChild(tickBtn);
  });
}

function renderDatePills() {
  els.datePillsContainer.innerHTML = "";
  state.columns.forEach((col, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `date-pill ${col === state.activeDate ? "active" : ""}`;
    const st = state.statsByCol[col];
    const sleepLabel = st ? st.down_label : "0m";
    btn.innerHTML = `<span>${col}</span><span class="pill-sub">${sleepLabel}</span>`;
    btn.addEventListener("click", () => {
      state.activeDate = col;
      // Ensure selected night is within visible slider range
      if (idx < state.rangeStartIdx) state.rangeStartIdx = idx;
      if (idx > state.rangeEndIdx) state.rangeEndIdx = idx;
      closePopover();
      syncSmartDefaultsForActiveDate();
      renderAll();
    });
    els.datePillsContainer.appendChild(btn);
  });
}

function renderActiveDateHeader() {
  const label = state.activeDate || "None";
  els.activeDateTitle.textContent = label;
  document.querySelectorAll(".inline-date").forEach((el) => {
    el.textContent = label;
  });
}

function renderEventsAndBlocksList() {
  els.eventsListContainer.innerHTML = "";
  els.blocksListContainer.innerHTML = "";

  if (!state.activeDate) return;
  const events = state.eventsByCol[state.activeDate] || [];
  const blocks = state.blocksByCol[state.activeDate] || [];
  const stats = state.statsByCol[state.activeDate];

  els.eventCountBadge.textContent = `${events.length} ${events.length === 1 ? "event" : "events"}`;
  els.nightTotalSleepBadge.textContent = stats
    ? `Down: ${stats.down_label} (${stats.sleep_pct}%)`
    : "Down: 0m";

  if (events.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-events-msg";
    empty.textContent = `No transitions logged for ${state.activeDate} yet. Add a "Down" or "Up" time above, or click directly on the chart.`;
    els.eventsListContainer.appendChild(empty);
  } else {
    events.forEach((ev, idx) => {
      const prevEv = idx > 0 ? events[idx - 1] : null;
      const isSameStateAsPrev = prevEv && prevEv.state === ev.state;

      const row = document.createElement("div");
      row.className = `event-item ${isSameStateAsPrev ? "duplicate-warning" : ""}`;

      const timeControls = document.createElement("div");
      timeControls.className = "event-time-controls";

      const minusBtn = document.createElement("button");
      minusBtn.type = "button";
      minusBtn.className = "step-btn";
      minusBtn.textContent = "−5";
      minusBtn.title = "Move 5 minutes earlier";
      minusBtn.disabled = ev.minute <= 0;
      minusBtn.addEventListener("click", () => {
        updateEventMinute(state.activeDate, ev.minute, ev.minute - 5);
      });

      const select = document.createElement("select");
      select.className = "event-time-select";
      state.timeLabels.forEach((tLabel, tIdx) => {
        const mVal = tIdx * 5;
        const opt = document.createElement("option");
        opt.value = String(mVal);
        opt.textContent = tLabel;
        if (mVal === ev.minute) opt.selected = true;
        select.appendChild(opt);
      });
      select.addEventListener("change", (e) => {
        updateEventMinute(state.activeDate, ev.minute, Number(e.target.value));
      });

      const plusBtn = document.createElement("button");
      plusBtn.type = "button";
      plusBtn.className = "step-btn";
      plusBtn.textContent = "+5";
      plusBtn.title = "Move 5 minutes later";
      plusBtn.disabled = ev.minute >= 600;
      plusBtn.addEventListener("click", () => {
        updateEventMinute(state.activeDate, ev.minute, ev.minute + 5);
      });

      timeControls.appendChild(minusBtn);
      timeControls.appendChild(select);
      timeControls.appendChild(plusBtn);

      const rightControls = document.createElement("div");
      rightControls.className = "event-right-controls";

      const statePill = document.createElement("button");
      statePill.type = "button";
      statePill.className = `state-pill-btn ${ev.state}`;
      statePill.textContent = ev.state === "down" ? "Down (Sleep)" : "Up (Awake)";
      statePill.title = "Click to flip between Down and Up";
      statePill.addEventListener("click", () => {
        toggleEventState(state.activeDate, ev.minute);
      });

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "delete-event-btn";
      delBtn.innerHTML = "&times;";
      delBtn.title = "Remove transition";
      delBtn.addEventListener("click", () => {
        deleteEvent(state.activeDate, ev.minute);
      });

      rightControls.appendChild(statePill);
      rightControls.appendChild(delBtn);

      row.appendChild(timeControls);
      row.appendChild(rightControls);
      els.eventsListContainer.appendChild(row);
    });
  }

  blocks.forEach((b) => {
    const bRow = document.createElement("div");
    bRow.className = `block-row ${b.state}`;
    bRow.innerHTML = `
      <span>${b.state.toUpperCase()} · <strong>${b.label}</strong></span>
      <span class="block-range">${b.start_time} → ${b.end_time}</span>
    `;
    els.blocksListContainer.appendChild(bRow);
  });
}

function renderSummaryCards() {
  els.summaryCardsContainer.innerHTML = "";
  const visibleCols = getVisibleColumns();
  visibleCols.forEach((col) => {
    const st = state.statsByCol[col] || {
      down_label: "0m",
      up_label: "10h",
      sleep_pct: 0,
      longest_down_label: "0m",
    };
    const card = document.createElement("div");
    card.className = `summary-card ${col === state.activeDate ? "active" : ""}`;
    card.innerHTML = `
      <div class="summary-card-top">
        <span class="summary-card-date">${col}</span>
        <span class="summary-card-pct">${st.sleep_pct}% Down</span>
      </div>
      <div class="summary-card-metrics">
        <span>Down: <strong>${st.down_label}</strong></span>
        <span>Up: <strong>${st.up_label}</strong></span>
      </div>
      <div class="summary-bar">
        <div class="summary-bar-fill" style="width: ${st.sleep_pct}%"></div>
      </div>
    `;
    card.addEventListener("click", () => {
      state.activeDate = col;
      closePopover();
      syncSmartDefaultsForActiveDate();
      renderAll();
    });
    els.summaryCardsContainer.appendChild(card);
  });
}

function upsertEvent(col, minute, evState, toastMsg = null) {
  if (!state.eventsByCol[col]) state.eventsByCol[col] = [];
  const list = state.eventsByCol[col].filter((e) => e.minute !== minute);
  list.push({
    minute,
    time: minToTime(minute),
    state: evState,
  });
  list.sort((a, b) => a.minute - b.minute);
  state.eventsByCol[col] = list;
  saveScheduleToServer(toastMsg);
}

function updateEventMinute(col, oldMinute, newMinute) {
  if (newMinute < 0 || newMinute > 600) return;
  const list = state.eventsByCol[col] || [];
  const target = list.find((e) => e.minute === oldMinute);
  if (!target) return;
  const filtered = list.filter(
    (e) => e.minute !== oldMinute && e.minute !== newMinute
  );
  filtered.push({
    minute: newMinute,
    time: minToTime(newMinute),
    state: target.state,
  });
  filtered.sort((a, b) => a.minute - b.minute);
  state.eventsByCol[col] = filtered;
  saveScheduleToServer();
}

function toggleEventState(col, minute) {
  const list = state.eventsByCol[col] || [];
  const target = list.find((e) => e.minute === minute);
  if (!target) return;
  target.state = target.state === "down" ? "up" : "down";
  saveScheduleToServer(
    `Switched ${col} @ ${target.time} to ${target.state.toUpperCase()}`
  );
}

function deleteEvent(col, minute) {
  const list = state.eventsByCol[col] || [];
  const target = list.find((e) => e.minute === minute);
  state.eventsByCol[col] = list.filter((e) => e.minute !== minute);
  saveScheduleToServer(
    target ? `Removed ${target.time} transition on ${col}` : null
  );
}

// ============================================================================
// High-DPI Canvas Visualization (Exact Replica of sleep tracking.ipynb)
// ============================================================================
function getChartDimensions() {
  const visibleCols = getVisibleColumns();
  const nCols = Math.max(visibleCols.length, 1);
  const colWidth = Math.max(CHART_LAYOUT.minColWidth, Math.floor(720 / nCols));
  const plotWidth = nCols * colWidth;
  const totalWidth =
    CHART_LAYOUT.marginLeft + plotWidth + CHART_LAYOUT.marginRight;
  const totalHeight =
    CHART_LAYOUT.marginTop + CHART_LAYOUT.plotHeight + CHART_LAYOUT.marginBottom;

  return {
    visibleCols,
    nCols,
    colWidth,
    plotWidth,
    plotHeight: CHART_LAYOUT.plotHeight,
    totalWidth,
    totalHeight,
    plotLeft: CHART_LAYOUT.marginLeft,
    plotTop: CHART_LAYOUT.marginTop,
    plotRight: CHART_LAYOUT.marginLeft + plotWidth,
    plotBottom: CHART_LAYOUT.marginTop + CHART_LAYOUT.plotHeight,
  };
}

function renderChartCanvas(isExport = false, targetCanvas = els.scheduleCanvas) {
  if (!isExport) {
    renderInteractiveTimeline();
    return;
  }

  const dims = getChartDimensions();
  const visibleCols = dims.visibleCols;
  const dpr = 2.5;

  targetCanvas.width = dims.totalWidth * dpr;
  targetCanvas.height = dims.totalHeight * dpr;

  const ctx = targetCanvas.getContext("2d");
  ctx.save();
  ctx.scale(dpr, dpr);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, dims.totalWidth, dims.totalHeight);

  ctx.fillStyle = "#000000";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font =
    "bold 18px -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif";
  const centerX = dims.plotLeft + dims.plotWidth / 2;
  ctx.fillText("Overnight sleep tracker", centerX, 16);
  ctx.font =
    "bold 15px -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif";
  ctx.fillText("[Black = Down, White = Up]", centerX, 40);

  visibleCols.forEach((col, colIdx) => {
    const colX = dims.plotLeft + colIdx * dims.colWidth;
    const blocks = state.blocksByCol[col] || [];

    blocks.forEach((b) => {
      const yStart = dims.plotTop + (b.start_min / 600) * dims.plotHeight;
      const yHeight = (b.duration / 600) * dims.plotHeight;

      ctx.fillStyle = b.state === "down" ? "#000000" : "#ffffff";
      ctx.fillRect(colX, yStart, dims.colWidth, yHeight);

      let fontSize = 14;
      if (b.duration >= 30) {
        fontSize = 14;
      } else if (b.duration >= 20) {
        fontSize = 12;
      } else if (b.duration >= 15) {
        fontSize = 10.5;
      } else {
        fontSize = 9.5;
      }

      if (b.duration >= 5) {
        ctx.fillStyle = b.state === "down" ? "#ffffff" : "#000000";
        ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(b.label, colX + dims.colWidth / 2, yStart + yHeight / 2);
      }
    });
  });

  // Dotted gray horizontal lines every 15 minutes
  ctx.save();
  ctx.strokeStyle = "rgba(136, 136, 136, 0.55)";
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  for (let t = 0; t <= 600; t += 15) {
    const y = dims.plotTop + (t / 600) * dims.plotHeight;
    ctx.beginPath();
    ctx.moveTo(dims.plotLeft, y);
    ctx.lineTo(dims.plotRight, y);
    ctx.stroke();
  }
  ctx.restore();

  // Solid vertical borders between columns
  ctx.save();
  ctx.strokeStyle = "#666666";
  ctx.lineWidth = 1.15;
  for (let i = 1; i < visibleCols.length; i++) {
    const x = dims.plotLeft + i * dims.colWidth;
    ctx.beginPath();
    ctx.moveTo(x, dims.plotTop);
    ctx.lineTo(x, dims.plotBottom);
    ctx.stroke();
  }
  ctx.restore();

  // Outer Chart Border
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(dims.plotLeft, dims.plotTop, dims.plotWidth, dims.plotHeight);

  // Top X-Axis Ticks & Date Labels
  ctx.fillStyle = "#000000";
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 1.2;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.font =
    "bold 15px -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif";

  visibleCols.forEach((col, colIdx) => {
    const xCenter = dims.plotLeft + (colIdx + 0.5) * dims.colWidth;
    ctx.beginPath();
    ctx.moveTo(xCenter, dims.plotTop);
    ctx.lineTo(xCenter, dims.plotTop - 5);
    ctx.stroke();
    ctx.fillStyle = "#000000";
    ctx.fillText(col, xCenter, dims.plotTop - 9);
  });

  // Left Y-Axis Hourly Ticks & Labels
  const hourlyLabels = [
    "9:00 PM",
    "10:00 PM",
    "11:00 PM",
    "12:00 AM",
    "1:00 AM",
    "2:00 AM",
    "3:00 AM",
    "4:00 AM",
    "5:00 AM",
    "6:00 AM",
    "7:00 AM",
  ];

  ctx.fillStyle = "#000000";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.font =
    "500 13.5px -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif";

  hourlyLabels.forEach((label, idx) => {
    const t = idx * 60;
    const y = dims.plotTop + (t / 600) * dims.plotHeight;
    ctx.beginPath();
    ctx.moveTo(dims.plotLeft, y);
    ctx.lineTo(dims.plotLeft - 5, y);
    ctx.stroke();
    ctx.fillText(label, dims.plotLeft - 9, y);
  });

  ctx.restore();
}

// ============================================================================
// Responsive Interactive DOM/CSS Schedule Timeline
// ============================================================================

const HOURLY_AXIS_LABELS = [
  "9:00 PM",
  "10:00 PM",
  "11:00 PM",
  "12:00 AM",
  "1:00 AM",
  "2:00 AM",
  "3:00 AM",
  "4:00 AM",
  "5:00 AM",
  "6:00 AM",
  "7:00 AM",
];

function renderAxisTicksOnce() {
  if (!els.timelineAxisBody) return;
  els.timelineAxisBody.style.position = "relative";
  els.timelineAxisBody.style.height = "680px";
  els.timelineAxisBody.style.minHeight = "680px";
  els.timelineAxisBody.style.flex = "0 0 680px";

  els.timelineAxisBody.querySelectorAll(".timeline-axis-tick").forEach((el) => el.remove());
  HOURLY_AXIS_LABELS.forEach((label, idx) => {
    const tick = document.createElement("div");
    tick.className = `timeline-axis-tick ${
      idx === 0 ? "edge-top" : idx === HOURLY_AXIS_LABELS.length - 1 ? "edge-bottom" : ""
    }`;
    tick.style.position = "absolute";
    tick.style.right = "8px";
    tick.style.top = `${(idx * 60 * 100) / 600}%`;
    tick.style.transform =
      idx === 0
        ? "translateY(2px)"
        : idx === HOURLY_AXIS_LABELS.length - 1
        ? "translateY(-100%)"
        : "translateY(-50%)";
    tick.style.fontSize = "0.75rem";
    tick.style.fontWeight = "600";
    tick.style.color = "#334155";
    tick.style.whiteSpace = "nowrap";
    tick.style.pointerEvents = "none";
    tick.textContent = label;
    els.timelineAxisBody.appendChild(tick);
  });
}

function buildGridLinesFragment() {
  const container = document.createElement("div");
  container.className = "timeline-grid-lines";
  container.style.position = "absolute";
  container.style.inset = "0";
  container.style.pointerEvents = "none";
  container.style.zIndex = "5";
  for (let t = 15; t < 600; t += 15) {
    const line = document.createElement("div");
    const isHourly = t % 60 === 0;
    line.className = `timeline-grid-line ${isHourly ? "hourly" : ""}`;
    line.style.position = "absolute";
    line.style.left = "0";
    line.style.right = "0";
    line.style.top = `${(t / 600) * 100}%`;
    line.style.borderTop = isHourly
      ? "1px dashed rgba(100, 116, 139, 0.55)"
      : "1px dotted rgba(148, 163, 184, 0.42)";
    container.appendChild(line);
  }
  return container;
}

function ensureTimelineDomStructure() {
  if (els.timelineColumnsTrack) return true;
  if (!els.canvasWrapper) return false;

  if (els.scheduleCanvas) {
    els.scheduleCanvas.classList.add("hidden");
    els.scheduleCanvas.style.display = "none";
  }

  const shell = document.createElement("div");
  shell.id = "timelineGridShell";
  shell.className = "timeline-grid-shell";

  const axisCol = document.createElement("div");
  axisCol.id = "timelineAxisCol";
  axisCol.className = "timeline-axis-col";

  const corner = document.createElement("div");
  corner.className = "timeline-axis-corner";
  corner.style.height = "58px";
  corner.style.minHeight = "58px";
  corner.style.flex = "0 0 58px";
  corner.style.borderBottom = "1px solid #cbd5e1";
  corner.style.display = "flex";
  corner.style.alignItems = "center";
  corner.style.justifyContent = "flex-end";
  corner.style.paddingRight = "10px";
  corner.style.fontSize = "0.72rem";
  corner.style.fontWeight = "700";
  corner.style.color = "#64748b";
  corner.textContent = "Time";

  const axisBody = document.createElement("div");
  axisBody.id = "timelineAxisBody";
  axisBody.className = "timeline-axis-body";

  const hoverBadge = document.createElement("div");
  hoverBadge.id = "axisHoverBadge";
  hoverBadge.className = "axis-hover-badge hidden";
  axisBody.appendChild(hoverBadge);

  axisCol.appendChild(corner);
  axisCol.appendChild(axisBody);

  const track = document.createElement("div");
  track.id = "timelineColumnsTrack";
  track.className = "timeline-columns-track";

  const crosshair = document.createElement("div");
  crosshair.id = "timelineCrosshairLine";
  crosshair.className = "timeline-crosshair-line hidden";

  shell.appendChild(axisCol);
  shell.appendChild(track);
  shell.appendChild(crosshair);

  els.canvasWrapper.insertBefore(shell, els.canvasWrapper.firstChild);

  els.timelineGridShell = shell;
  els.timelineAxisCol = axisCol;
  els.timelineAxisBody = axisBody;
  els.axisHoverBadge = hoverBadge;
  els.timelineColumnsTrack = track;
  els.timelineCrosshairLine = crosshair;
  return true;
}

function renderInteractiveTimeline() {
  if (!ensureTimelineDomStructure()) return;
  renderAxisTicksOnce();

  const visibleCols = getVisibleColumns();
  const nCols = Math.max(1, visibleCols.length);
  const isMobile = window.innerWidth <= 768;

  // Responsive column sizing: never squished on mobile!
  const minColPx = isMobile ? (nCols <= 3 ? 78 : 98) : 108;
  const axisWidthPx = isMobile ? 64 : 76;

  if (els.timelineGridShell) {
    els.timelineGridShell.style.display = "flex";
    els.timelineGridShell.style.position = "relative";
    els.timelineGridShell.style.width = "100%";
    els.timelineGridShell.style.minHeight = "738px";
  }
  if (els.timelineAxisCol) {
    els.timelineAxisCol.style.position = "sticky";
    els.timelineAxisCol.style.left = "0";
    els.timelineAxisCol.style.zIndex = "16";
    els.timelineAxisCol.style.width = `${axisWidthPx}px`;
    els.timelineAxisCol.style.flex = `0 0 ${axisWidthPx}px`;
    els.timelineAxisCol.style.display = "flex";
    els.timelineAxisCol.style.flexDirection = "column";
  }

  els.timelineColumnsTrack.style.setProperty("--col-min-width", `${minColPx}px`);
  els.timelineColumnsTrack.style.display = "flex";
  els.timelineColumnsTrack.style.flex = "1 0 auto";
  els.timelineColumnsTrack.style.minHeight = "738px";

  if (els.timelineScrollHint) {
    els.timelineScrollHint.classList.toggle(
      "visible-mobile",
      isMobile && nCols >= 4
    );
  }

  els.timelineColumnsTrack.innerHTML = "";

  visibleCols.forEach((col, colIdx) => {
    const isActiveCol = col === state.activeDate;
    const colEl = document.createElement("div");
    colEl.className = `timeline-col ${isActiveCol ? "active-col" : ""}`;
    colEl.dataset.col = col;
    colEl.style.display = "flex";
    colEl.style.flexDirection = "column";
    colEl.style.flex = `1 0 ${minColPx}px`;
    colEl.style.minWidth = `${minColPx}px`;
    colEl.style.borderRight =
      colIdx === visibleCols.length - 1 ? "none" : "1px solid #cbd5e1";
    colEl.style.position = "relative";

    // 1. Column Header (Date + Total Sleep Summary)
    const st = state.statsByCol[col] || { down_label: "0m", sleep_pct: 0 };
    const headerEl = document.createElement("div");
    headerEl.className = "timeline-col-header";
    headerEl.title = `Select ${col} for editing`;
    headerEl.style.height = "58px";
    headerEl.style.minHeight = "58px";
    headerEl.style.flex = "0 0 58px";
    headerEl.style.padding = "6px 8px";
    headerEl.style.borderBottom = isActiveCol
      ? "2px solid #2563eb"
      : "1px solid #cbd5e1";
    headerEl.style.background = isActiveCol ? "#eff6ff" : "#f8fafc";
    headerEl.style.display = "flex";
    headerEl.style.flexDirection = "column";
    headerEl.style.alignItems = "center";
    headerEl.style.justifyContent = "center";
    headerEl.style.gap = "3px";
    headerEl.style.cursor = "pointer";
    headerEl.innerHTML = `
      <span class="timeline-col-date" style="font-size:0.88rem;font-weight:800;color:${
        isActiveCol ? "#2563eb" : "#0f172a"
      };line-height:1.1;">${col}</span>
      <span class="timeline-col-sub" style="font-size:0.71rem;font-weight:600;color:${
        isActiveCol ? "#1e40af" : "#475569"
      };background:${
      isActiveCol ? "#dbeafe" : "#e2e8f0"
    };padding:1px 7px;border-radius:10px;white-space:nowrap;">Down: ${
      st.down_label
    }</span>
    `;
    headerEl.addEventListener("click", () => {
      state.activeDate = col;
      closePopover();
      syncSmartDefaultsForActiveDate();
      renderAll();
    });
    colEl.appendChild(headerEl);

    // 2. Column 600-Minute Body
    const bodyEl = document.createElement("div");
    bodyEl.className = "timeline-col-body";
    bodyEl.dataset.col = col;
    bodyEl.style.position = "relative";
    bodyEl.style.height = "680px";
    bodyEl.style.minHeight = "680px";
    bodyEl.style.flex = "0 0 680px";
    bodyEl.style.width = "100%";
    bodyEl.style.overflow = "hidden";
    bodyEl.style.cursor = "crosshair";

    let blocks = state.blocksByCol[col] || [];
    let events = state.eventsByCol[col] || [];

    if (state.dragState && state.dragState.col === col) {
      events = events
        .filter(
          (e) =>
            e.minute !== state.dragState.originalMinute &&
            e.minute !== state.dragState.currentMinute
        )
        .concat([
          {
            minute: state.dragState.currentMinute,
            time: minToTime(state.dragState.currentMinute),
            state: state.dragState.eventState,
          },
        ])
        .sort((a, b) => a.minute - b.minute);
      blocks = computeBlocksClient(events);
    }

    // Render Blocks (Down / Up)
    blocks.forEach((b) => {
      const isDown = b.state === "down";
      const blockEl = document.createElement("div");
      blockEl.className = `timeline-block ${b.state}`;
      blockEl.style.position = "absolute";
      blockEl.style.left = "0";
      blockEl.style.right = "0";
      blockEl.style.top = `${(b.start_min / 600) * 100}%`;
      blockEl.style.height = `${(b.duration / 600) * 100}%`;
      blockEl.style.display = "flex";
      blockEl.style.flexDirection = "column";
      blockEl.style.alignItems = "center";
      blockEl.style.justifyContent = "center";
      blockEl.style.padding = "2px 4px";
      blockEl.style.overflow = "hidden";
      blockEl.style.background = isDown ? "#000000" : "#ffffff";
      blockEl.style.color = isDown ? "#ffffff" : "#000000";

      if (b.duration >= 10) {
        const durLbl = document.createElement("span");
        const sizeClass =
          b.duration < 20 ? "tiny" : b.duration < 35 ? "compact" : "";
        durLbl.className = `block-duration-label ${sizeClass}`;
        durLbl.style.position = "relative";
        durLbl.style.zIndex = "6";
        durLbl.style.fontWeight = "800";
        durLbl.style.fontSize =
          b.duration < 20 ? "0.62rem" : b.duration < 35 ? "0.7rem" : "0.84rem";
        durLbl.style.lineHeight = "1.1";
        durLbl.style.textAlign = "center";
        durLbl.style.pointerEvents = "none";
        durLbl.style.color = isDown ? "#ffffff" : "#000000";
        durLbl.textContent = b.label;
        blockEl.appendChild(durLbl);
      }

      bodyEl.appendChild(blockEl);
    });

    // Render 15-min & Hourly Grid Lines
    bodyEl.appendChild(buildGridLinesFragment());

    // Render Draggable Transition Handles
    if (els.showHoverGuideCheckbox.checked) {
      events.forEach((ev) => {
        const handleEl = document.createElement("div");
        const isDraggingThis =
          state.dragState &&
          state.dragState.col === col &&
          state.dragState.currentMinute === ev.minute;
        handleEl.className = `timeline-handle ${isDraggingThis ? "dragging" : ""}`;
        handleEl.style.position = "absolute";
        handleEl.style.left = "0";
        handleEl.style.right = "0";
        handleEl.style.height = "18px";
        handleEl.style.top = `${(ev.minute / 600) * 100}%`;
        handleEl.style.transform = "translateY(-50%)";
        handleEl.style.zIndex = "10";
        handleEl.style.cursor = "ns-resize";
        handleEl.style.touchAction = "none";
        handleEl.style.display = "flex";
        handleEl.style.alignItems = "center";
        handleEl.style.justifyContent = "center";

        const pill = document.createElement("span");
        pill.className = "timeline-handle-pill";
        pill.textContent = `↕ ${minToTime(ev.minute)} (${ev.state.toUpperCase()})`;
        handleEl.appendChild(pill);

        handleEl.addEventListener("pointerdown", (evt) => {
          evt.stopPropagation();
          evt.preventDefault();
          closePopover();
          state.dragState = {
            col,
            colIdx,
            originalMinute: ev.minute,
            currentMinute: ev.minute,
            eventState: ev.state,
            bodyEl,
            startY: evt.clientY,
            hasMoved: false,
          };
        });

        handleEl.addEventListener("click", (evt) => {
          evt.stopPropagation();
          if (state.dragState && state.dragState.hasMoved) return;
          openChartPopover({
            col,
            minute: ev.minute,
            nearEvent: ev,
            clientX: evt.clientX,
            clientY: evt.clientY,
          });
        });

        bodyEl.appendChild(handleEl);
      });
    }

    // Hover Crosshair & Rich Tooltip inside Column Body
    bodyEl.addEventListener("pointermove", (evt) => {
      if (state.dragState) return;
      const rect = bodyEl.getBoundingClientRect();
      const relY = Math.max(0, Math.min(rect.height, evt.clientY - rect.top));
      const rawMinute = (relY / rect.height) * 600;
      const snappedMin = Math.max(0, Math.min(600, Math.round(rawMinute / 5) * 5));
      const pctTop = (snappedMin / 600) * 100;

      if (els.showHoverGuideCheckbox.checked) {
        if (els.timelineCrosshairLine) {
          els.timelineCrosshairLine.style.top = `${58 + (snappedMin / 600) * rect.height}px`;
          els.timelineCrosshairLine.classList.remove("hidden");
        }
        if (els.axisHoverBadge) {
          els.axisHoverBadge.style.top = `${pctTop}%`;
          els.axisHoverBadge.textContent = minToTime(snappedMin);
          els.axisHoverBadge.classList.remove("hidden");
        }

        if (state.popoverState === null) {
          const activeBlock = blocks.find(
            (b) => snappedMin >= b.start_min && snappedMin <= b.end_min
          );
          const nearEv = events.find((e) => Math.abs(e.minute - snappedMin) <= 5);
          if (nearEv) {
            positionTooltip(
              evt,
              `<strong>${col} @ ${nearEv.time}</strong> <span class="tooltip-badge ${nearEv.state}">${nearEv.state.toUpperCase()}</span><br/>Drag handle ↕ to adjust time, or click to edit`
            );
          } else if (activeBlock) {
            const stateTitle = activeBlock.state === "down" ? "DOWN (Asleep)" : "UP (Awake)";
            positionTooltip(
              evt,
              `<strong>${col} · ${minToTime(snappedMin)}</strong> <span class="tooltip-badge ${activeBlock.state}">${stateTitle}</span><br/>Stretch: <strong>${activeBlock.label}</strong> (${activeBlock.start_time} → ${activeBlock.end_time})<br/><span style="opacity:0.75">Click to insert/edit transition here</span>`
            );
          }
        }
      }
    });

    bodyEl.addEventListener("pointerleave", () => {
      if (!state.dragState) {
        if (els.timelineCrosshairLine) els.timelineCrosshairLine.classList.add("hidden");
        if (els.axisHoverBadge) els.axisHoverBadge.classList.add("hidden");
        els.chartTooltip.classList.add("hidden");
      }
    });

    bodyEl.addEventListener("click", (evt) => {
      if (state.dragState) return;
      const rect = bodyEl.getBoundingClientRect();
      const relY = Math.max(0, Math.min(rect.height, evt.clientY - rect.top));
      const rawMinute = (relY / rect.height) * 600;
      const snappedMin = Math.max(0, Math.min(600, Math.round(rawMinute / 5) * 5));
      const existingEv = events.find((e) => Math.abs(e.minute - snappedMin) <= 5);

      openChartPopover({
        col,
        minute: existingEv ? existingEv.minute : snappedMin,
        nearEvent: existingEv || null,
        clientX: evt.clientX,
        clientY: evt.clientY,
      });
    });

    colEl.appendChild(bodyEl);
    els.timelineColumnsTrack.appendChild(colEl);
  });
}

// Global Pointer Drag Handlers (Mouse + Touch)
window.addEventListener("pointermove", (evt) => {
  if (!state.dragState) return;
  const ds = state.dragState;
  if (Math.abs(evt.clientY - ds.startY) > 2) {
    ds.hasMoved = true;
  }

  // Find column body rect for accurate vertical coordinate
  const colBody =
    Array.from(
      els.timelineColumnsTrack.querySelectorAll(".timeline-col-body")
    ).find((el) => el.dataset.col === ds.col) || ds.bodyEl;
  if (!colBody) return;

  const rect = colBody.getBoundingClientRect();
  const relY = Math.max(0, Math.min(rect.height, evt.clientY - rect.top));
  const rawMinute = (relY / rect.height) * 600;
  const snapped = Math.max(0, Math.min(600, Math.round(rawMinute / 5) * 5));

  if (snapped !== ds.currentMinute) {
    ds.currentMinute = snapped;
    renderInteractiveTimeline();
  }

  if (els.timelineCrosshairLine) {
    els.timelineCrosshairLine.style.top = `${58 + (snapped / 600) * rect.height}px`;
    els.timelineCrosshairLine.classList.remove("hidden");
  }
  if (els.axisHoverBadge) {
    els.axisHoverBadge.style.top = `${(snapped / 600) * 100}%`;
    els.axisHoverBadge.textContent = minToTime(snapped);
    els.axisHoverBadge.classList.remove("hidden");
  }

  positionTooltip(
    evt,
    `<strong>${ds.col}</strong> · Moving <strong>${ds.eventState.toUpperCase()}</strong> transition to <strong>${minToTime(snapped)}</strong>`
  );
});

window.addEventListener("pointerup", (evt) => {
  if (!state.dragState) return;
  const ds = state.dragState;
  state.dragState = null;

  if (els.timelineCrosshairLine) els.timelineCrosshairLine.classList.add("hidden");
  if (els.axisHoverBadge) els.axisHoverBadge.classList.add("hidden");
  els.chartTooltip.classList.add("hidden");

  if (ds.hasMoved && ds.currentMinute !== ds.originalMinute) {
    state.activeDate = ds.col;
    updateEventMinute(ds.col, ds.originalMinute, ds.currentMinute);
    showToast(`Moved ${ds.col} transition to ${minToTime(ds.currentMinute)}`);
  } else if (!ds.hasMoved) {
    openChartPopover({
      col: ds.col,
      minute: ds.originalMinute,
      nearEvent: {
        minute: ds.originalMinute,
        time: minToTime(ds.originalMinute),
        state: ds.eventState,
      },
      clientX: evt.clientX,
      clientY: evt.clientY,
    });
  } else {
    renderInteractiveTimeline();
  }
});

window.addEventListener("resize", () => {
  renderInteractiveTimeline();
});

function positionTooltip(evt, htmlContent) {
  const wrapperRect = els.canvasWrapper.getBoundingClientRect();
  els.chartTooltip.innerHTML = htmlContent;
  els.chartTooltip.classList.remove("hidden");

  const tipWidth = els.chartTooltip.offsetWidth || 220;
  const rawLeft = evt.clientX - wrapperRect.left + els.canvasWrapper.scrollLeft + 14;
  const maxLeft = els.canvasWrapper.scrollLeft + wrapperRect.width - tipWidth - 10;
  const left = Math.max(els.canvasWrapper.scrollLeft + 8, Math.min(maxLeft, rawLeft));
  const top = Math.max(10, evt.clientY - wrapperRect.top + els.canvasWrapper.scrollTop + 14);
  els.chartTooltip.style.left = `${left}px`;
  els.chartTooltip.style.top = `${top}px`;
}

function openChartPopover(info) {
  state.activeDate = info.col;
  syncSmartDefaultsForActiveDate();
  renderDatePills();
  renderActiveDateHeader();
  renderEventsAndBlocksList();
  renderSummaryCards();

  const existing =
    info.nearEvent ||
    (state.eventsByCol[info.col] || []).find((e) => e.minute === info.minute);
  const targetMin = existing ? existing.minute : info.minute;
  const targetTime = minToTime(targetMin);

  state.popoverState = { col: info.col, minute: targetMin, existing };
  els.chartTooltip.classList.add("hidden");

  els.popoverTitle.textContent = `${info.col} @ ${targetTime}`;
  els.popoverBody.innerHTML = "";

  if (existing) {
    const statusNote = document.createElement("div");
    statusNote.className = "muted-label";
    statusNote.innerHTML = `Current transition: <strong>${existing.state.toUpperCase()}</strong>`;
    els.popoverBody.appendChild(statusNote);

    const actionsGrid = document.createElement("div");
    actionsGrid.className = "popover-actions-grid";

    const flipBtn = document.createElement("button");
    flipBtn.type = "button";
    flipBtn.className = "btn btn-sm btn-primary";
    const opposite = existing.state === "down" ? "Up" : "Down";
    flipBtn.textContent = `Switch to ${opposite}`;
    flipBtn.addEventListener("click", () => {
      toggleEventState(info.col, targetMin);
      closePopover();
    });

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn btn-sm btn-secondary";
    removeBtn.style.color = "#dc2626";
    removeBtn.textContent = "Delete";
    removeBtn.addEventListener("click", () => {
      deleteEvent(info.col, targetMin);
      closePopover();
    });

    actionsGrid.appendChild(flipBtn);
    actionsGrid.appendChild(removeBtn);
    els.popoverBody.appendChild(actionsGrid);
  } else {
    const promptNote = document.createElement("div");
    promptNote.className = "muted-label";
    promptNote.textContent = "Set state transition starting at this time:";
    els.popoverBody.appendChild(promptNote);

    const actionsGrid = document.createElement("div");
    actionsGrid.className = "popover-actions-grid";

    const setDownBtn = document.createElement("button");
    setDownBtn.type = "button";
    setDownBtn.className = "btn btn-sm btn-primary";
    setDownBtn.textContent = "Set Down";
    setDownBtn.addEventListener("click", () => {
      upsertEvent(
        info.col,
        targetMin,
        "down",
        `Added DOWN at ${targetTime} on ${info.col}`
      );
      closePopover();
    });

    const setUpBtn = document.createElement("button");
    setUpBtn.type = "button";
    setUpBtn.className = "btn btn-sm btn-secondary";
    setUpBtn.textContent = "Set Up";
    setUpBtn.addEventListener("click", () => {
      upsertEvent(
        info.col,
        targetMin,
        "up",
        `Added UP at ${targetTime} on ${info.col}`
      );
      closePopover();
    });

    actionsGrid.appendChild(setDownBtn);
    actionsGrid.appendChild(setUpBtn);
    els.popoverBody.appendChild(actionsGrid);
  }

  const wrapperRect = els.canvasWrapper.getBoundingClientRect();
  els.chartPopover.classList.remove("hidden");
  const popLeft = Math.max(
    12,
    Math.min(
      els.canvasWrapper.scrollWidth - 260,
      info.clientX - wrapperRect.left + els.canvasWrapper.scrollLeft - 110
    )
  );
  const popTop = Math.max(
    12,
    info.clientY - wrapperRect.top + els.canvasWrapper.scrollTop + 12
  );
  els.chartPopover.style.left = `${popLeft}px`;
  els.chartPopover.style.top = `${popTop}px`;
}

function closePopover() {
  state.popoverState = null;
  els.chartPopover.classList.add("hidden");
}

els.popoverCloseBtn.addEventListener("click", closePopover);

function renderGridTable() {
  if (!els.scheduleGridTable) return;
  const thead = els.scheduleGridTable.querySelector("thead");
  const tbody = els.scheduleGridTable.querySelector("tbody");
  thead.innerHTML = "";
  tbody.innerHTML = "";

  const visibleCols = getVisibleColumns();

  const headerRow = document.createElement("tr");
  const timeTh = document.createElement("th");
  timeTh.textContent = "Time";
  headerRow.appendChild(timeTh);

  visibleCols.forEach((col) => {
    const th = document.createElement("th");
    th.textContent = col;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);

  const cellMap = {};
  visibleCols.forEach((col) => {
    (state.eventsByCol[col] || []).forEach((ev) => {
      cellMap[`${col}__${ev.minute}`] = ev.state;
    });
  });

  const onlyActive = els.filterActiveRowsCheckbox.checked;

  state.timeLabels.forEach((tLabel, idx) => {
    const minute = idx * 5;
    const hasAnyEvent = visibleCols.some(
      (col) => cellMap[`${col}__${minute}`]
    );
    if (onlyActive && !hasAnyEvent) return;

    const tr = document.createElement("tr");
    const tdTime = document.createElement("td");
    tdTime.className = "time-col";
    tdTime.textContent = tLabel;
    tr.appendChild(tdTime);

    visibleCols.forEach((col) => {
      const td = document.createElement("td");
      const val = cellMap[`${col}__${minute}`] || "";
      td.className = `grid-cell ${
        val === "down" ? "cell-down" : val === "up" ? "cell-up" : ""
      }`;
      td.textContent = val;
      td.addEventListener("click", () => {
        if (val === "") {
          upsertEvent(col, minute, "down");
        } else if (val === "down") {
          upsertEvent(col, minute, "up");
        } else {
          deleteEvent(col, minute);
        }
      });
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });
}

// Date Range Slider Listeners
els.rangeStartInput.addEventListener("input", (e) => {
  let val = Number(e.target.value);
  if (val > state.rangeEndIdx) {
    val = state.rangeEndIdx;
    els.rangeStartInput.value = String(val);
  }
  state.rangeStartIdx = val;
  closePopover();
  renderDateRangeSlider();
  renderSummaryCards();
  renderChartCanvas(false);
  renderGridTable();
});

els.rangeEndInput.addEventListener("input", (e) => {
  let val = Number(e.target.value);
  if (val < state.rangeStartIdx) {
    val = state.rangeStartIdx;
    els.rangeEndInput.value = String(val);
  }
  state.rangeEndIdx = val;
  closePopover();
  renderDateRangeSlider();
  renderSummaryCards();
  renderChartCanvas(false);
  renderGridTable();
});

els.presetLast3Btn.addEventListener("click", () => {
  const maxIdx = Math.max(0, state.columns.length - 1);
  state.rangeEndIdx = maxIdx;
  state.rangeStartIdx = Math.max(0, maxIdx - 2);
  closePopover();
  renderAll();
});

els.presetLast5Btn.addEventListener("click", () => {
  const maxIdx = Math.max(0, state.columns.length - 1);
  state.rangeEndIdx = maxIdx;
  state.rangeStartIdx = Math.max(0, maxIdx - 4);
  closePopover();
  renderAll();
});

els.presetAllDatesBtn.addEventListener("click", () => {
  state.rangeStartIdx = 0;
  state.rangeEndIdx = Math.max(0, state.columns.length - 1);
  closePopover();
  renderAll();
});

els.stateDownBtn.addEventListener("click", () => setSingleStateChoice("down"));
els.stateUpBtn.addEventListener("click", () => setSingleStateChoice("up"));

els.modeSingleBtn.addEventListener("click", () => {
  els.modeSingleBtn.classList.add("active");
  els.modeRangeBtn.classList.remove("active");
  els.addSingleEventForm.classList.remove("hidden");
  els.addRangeEventForm.classList.add("hidden");
});

els.modeRangeBtn.addEventListener("click", () => {
  els.modeRangeBtn.classList.add("active");
  els.modeSingleBtn.classList.remove("active");
  els.addRangeEventForm.classList.remove("hidden");
  els.addSingleEventForm.classList.add("hidden");
});

els.addSingleEventForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!state.activeDate) return;
  const minute = Number(els.singleTimeSelect.value);
  const chosenState = state.selectedSingleState;
  upsertEvent(
    state.activeDate,
    minute,
    chosenState,
    `Added ${chosenState.toUpperCase()} at ${minToTime(minute)} on ${
      state.activeDate
    }`
  );
  setSingleStateChoice(chosenState === "down" ? "up" : "down");
  els.singleTimeSelect.value = String(Math.min(600, minute + 60));
});

els.addRangeEventForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!state.activeDate) return;
  const downMin = Number(els.rangeDownTimeSelect.value);
  const upMin = Number(els.rangeUpTimeSelect.value);
  if (downMin === upMin) {
    showToast("Down time and Up time must be different");
    return;
  }
  const col = state.activeDate;
  const list = (state.eventsByCol[col] || []).filter(
    (ev) => ev.minute !== downMin && ev.minute !== upMin
  );
  list.push({ minute: downMin, time: minToTime(downMin), state: "down" });
  list.push({ minute: upMin, time: minToTime(upMin), state: "up" });
  list.sort((a, b) => a.minute - b.minute);
  state.eventsByCol[col] = list;
  saveScheduleToServer(
    `Added Down (${minToTime(downMin)}) & Up (${minToTime(upMin)}) to ${col}`
  );
});

function suggestNextDateLabel() {
  if (state.columns.length === 0) return "20-Oct";
  const last = state.columns[state.columns.length - 1];
  const match = last.match(/^(\d{1,2})-([A-Za-z]+)$/);
  if (match) {
    const nextDay = Number(match[1]) + 1;
    return `${nextDay}-${match[2]}`;
  }
  return `Night-${state.columns.length + 1}`;
}

els.addDateModalBtn.addEventListener("click", () => {
  state.dateFormMode = "add";
  els.dateNameInput.value = suggestNextDateLabel();
  els.dateFormSubmitBtn.textContent = "Add Night";
  els.dateForm.classList.remove("hidden");
  els.dateNameInput.focus();
  els.dateNameInput.select();
});

els.renameDateBtn.addEventListener("click", () => {
  if (!state.activeDate) return;
  state.dateFormMode = "rename";
  els.dateNameInput.value = state.activeDate;
  els.dateFormSubmitBtn.textContent = "Rename";
  els.dateForm.classList.remove("hidden");
  els.dateNameInput.focus();
  els.dateNameInput.select();
});

els.dateFormCancelBtn.addEventListener("click", () => {
  state.dateFormMode = null;
  els.dateForm.classList.add("hidden");
});

els.dateForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const val = els.dateNameInput.value.trim();
  if (!val) return;

  if (state.dateFormMode === "add") {
    if (state.columns.includes(val)) {
      showToast(`"${val}" already exists`);
      return;
    }
    state.columns.push(val);
    state.eventsByCol[val] = [];
    state.activeDate = val;
    els.dateForm.classList.add("hidden");
    saveScheduleToServer(`Added night ${val}`);
  } else if (state.dateFormMode === "rename" && state.activeDate) {
    const oldName = state.activeDate;
    if (val !== oldName && state.columns.includes(val)) {
      showToast(`"${val}" already exists`);
      return;
    }
    state.columns = state.columns.map((c) => (c === oldName ? val : c));
    state.eventsByCol[val] = state.eventsByCol[oldName] || [];
    if (val !== oldName) delete state.eventsByCol[oldName];
    state.activeDate = val;
    els.dateForm.classList.add("hidden");
    saveScheduleToServer(`Renamed ${oldName} to ${val}`);
  }
});

els.clearDateBtn.addEventListener("click", () => {
  if (!state.activeDate) return;
  state.eventsByCol[state.activeDate] = [];
  saveScheduleToServer(`Cleared all transitions on ${state.activeDate}`);
});

els.deleteDateBtn.addEventListener("click", () => {
  if (!state.activeDate) return;
  if (state.columns.length <= 1) {
    showToast("At least one night column is required");
    return;
  }
  const removed = state.activeDate;
  state.columns = state.columns.filter((c) => c !== removed);
  delete state.eventsByCol[removed];
  state.activeDate = state.columns[state.columns.length - 1];
  saveScheduleToServer(`Deleted night ${removed}`);
});

// Mobile Hamburger Drawer Controls
function openMobileDrawer() {
  if (!els.editorPanel) return;
  els.editorPanel.classList.add("mobile-open");
  if (els.mobileDrawerBackdrop) {
    els.mobileDrawerBackdrop.classList.remove("hidden");
  }
  if (els.mobileMenuBtn) {
    els.mobileMenuBtn.setAttribute("aria-expanded", "true");
  }
}

function closeMobileDrawer() {
  if (!els.editorPanel) return;
  els.editorPanel.classList.remove("mobile-open");
  if (els.mobileDrawerBackdrop) {
    els.mobileDrawerBackdrop.classList.add("hidden");
  }
  if (els.mobileMenuBtn) {
    els.mobileMenuBtn.setAttribute("aria-expanded", "false");
  }
}

function toggleMobileDrawer() {
  if (!els.editorPanel) return;
  if (els.editorPanel.classList.contains("mobile-open")) {
    closeMobileDrawer();
  } else {
    openMobileDrawer();
  }
}

if (els.mobileMenuBtn) {
  els.mobileMenuBtn.addEventListener("click", toggleMobileDrawer);
}
if (els.mobileDrawerCloseBtn) {
  els.mobileDrawerCloseBtn.addEventListener("click", closeMobileDrawer);
}
if (els.mobileDrawerBackdrop) {
  els.mobileDrawerBackdrop.addEventListener("click", closeMobileDrawer);
}
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeMobileDrawer();
  }
});

if (els.filterActiveRowsCheckbox) {
  els.filterActiveRowsCheckbox.addEventListener("change", renderGridTable);
}
els.showHoverGuideCheckbox.addEventListener("change", () =>
  renderChartCanvas(false)
);

els.exportCsvBtn.addEventListener("click", () => {
  const csvText = serializeCsvClient(state.columns, state.eventsByCol);
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "time_schedule_export.csv";
  link.click();
  URL.revokeObjectURL(url);
  showToast("Exported time_schedule_export.csv");
});

els.downloadPngBtn.addEventListener("click", () => {
  const offscreen = document.createElement("canvas");
  renderChartCanvas(true, offscreen);
  const link = document.createElement("a");
  link.download = "schedule_durations_visualization.png";
  link.href = offscreen.toDataURL("image/png");
  link.click();
  showToast("Downloaded schedule_durations_visualization.png");
});

els.csvFileInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  e.target.value = "";
  const parsed = parseCsvClient(text);
  if (!parsed.columns || parsed.columns.length === 0) {
    showToast("Could not find valid date columns in CSV");
    return;
  }
  state.columns = parsed.columns;
  state.eventsByCol = parsed.events_by_col;
  state.activeDate = parsed.columns[parsed.columns.length - 1] || null;
  saveScheduleToServer(`Imported CSV (${parsed.columns.length} nights)`);
});

els.resetDataBtn.addEventListener("click", async () => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (_) {}
  if (state.backendAvailable) {
    try {
      const res = await fetch("/api/reset", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        applyScheduleData(data);
        showToast("Reset to original 19-Oct to 25-Oct schedule");
        return;
      }
    } catch (_) {}
  }
  const initial = parseCsvClient(INITIAL_CSV_DATA);
  state.columns = initial.columns;
  state.eventsByCol = initial.events_by_col;
  state.activeDate = initial.columns[initial.columns.length - 1];
  saveScheduleToServer("Reset to original 19-Oct to 25-Oct schedule");
});

// ============================================================================
// Cloud Sync & Shared PIN Modal Event Listeners
// ============================================================================

function switchSyncModalTab(tab) {
  const isUnlock = tab === "unlock";
  els.syncTabUnlockBtn.classList.toggle("active", isUnlock);
  els.syncTabSetupBtn.classList.toggle("active", !isUnlock);
  els.syncUnlockSection.classList.toggle("hidden", !isUnlock);
  els.syncSetupSection.classList.toggle("hidden", isUnlock);
  els.pinUnlockError.classList.add("hidden");
  els.setupStatusMsg.classList.add("hidden");
}

function openSyncModal() {
  updateSyncUI();
  if (!state.githubSync.config && !state.githubSync.unlocked) {
    switchSyncModalTab("setup");
  } else {
    switchSyncModalTab("unlock");
  }
  els.syncModalOverlay.classList.remove("hidden");
  if (state.githubSync.config && !state.githubSync.unlocked) {
    setTimeout(() => els.pinUnlockInput.focus(), 50);
  }
}

function closeSyncModal() {
  els.syncModalOverlay.classList.add("hidden");
}

if (els.cloudSyncBtn) {
  els.cloudSyncBtn.addEventListener("click", openSyncModal);
}
if (els.syncPullNowBtn) {
  els.syncPullNowBtn.addEventListener("click", () => {
    pullScheduleFromGitHub(false);
  });
}
if (els.syncModalCloseBtn) {
  els.syncModalCloseBtn.addEventListener("click", closeSyncModal);
}
if (els.syncModalOverlay) {
  els.syncModalOverlay.addEventListener("click", (e) => {
    if (e.target === els.syncModalOverlay) closeSyncModal();
  });
}
if (els.syncTabUnlockBtn) {
  els.syncTabUnlockBtn.addEventListener("click", () =>
    switchSyncModalTab("unlock")
  );
}
if (els.syncTabSetupBtn) {
  els.syncTabSetupBtn.addEventListener("click", () =>
    switchSyncModalTab("setup")
  );
}
if (els.goToSetupBtn) {
  els.goToSetupBtn.addEventListener("click", () => switchSyncModalTab("setup"));
}

if (els.pinUnlockForm) {
  els.pinUnlockForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    els.pinUnlockError.classList.add("hidden");
    const pin = els.pinUnlockInput.value;
    const cfg = state.githubSync.config;
    if (!cfg || !cfg.ciphertext) {
      els.pinUnlockError.textContent =
        "No sync configuration found. Please use One-Time Setup first.";
      els.pinUnlockError.classList.remove("hidden");
      return;
    }

    els.pinUnlockSubmitBtn.disabled = true;
    els.pinUnlockSubmitBtn.textContent = "Unlocking...";
    try {
      const decryptedToken = await decryptTokenWithPin(cfg, pin);
      state.githubSync.unlocked = true;
      state.githubSync.token = decryptedToken;
      state.githubSync.owner = cfg.owner;
      state.githubSync.repo = cfg.repo;
      state.githubSync.branch = cfg.branch || "main";

      if (els.rememberPinCheckbox.checked) {
        try {
          localStorage.setItem(
            SYNC_SESSION_KEY,
            JSON.stringify({
              owner: cfg.owner,
              repo: cfg.repo,
              branch: cfg.branch || "main",
              token: decryptedToken,
            })
          );
        } catch (_) {}
      }

      els.pinUnlockInput.value = "";
      await pullScheduleFromGitHub(false);
      updateSyncUI();
      closeSyncModal();
    } catch (_) {
      els.pinUnlockError.textContent =
        "Incorrect Shared PIN. Please check your PIN and try again.";
      els.pinUnlockError.classList.remove("hidden");
    } finally {
      els.pinUnlockSubmitBtn.disabled = false;
      els.pinUnlockSubmitBtn.textContent = "Unlock & Sync Schedule";
    }
  });
}

if (els.modalPullBtn) {
  els.modalPullBtn.addEventListener("click", async () => {
    await pullScheduleFromGitHub(false);
  });
}

if (els.modalPushBtn) {
  els.modalPushBtn.addEventListener("click", async () => {
    await pushScheduleToGitHub(true);
  });
}

if (els.lockDeviceBtn) {
  els.lockDeviceBtn.addEventListener("click", () => {
    try {
      localStorage.removeItem(SYNC_SESSION_KEY);
    } catch (_) {}
    state.githubSync.unlocked = false;
    state.githubSync.token = null;
    state.githubSync.status = state.githubSync.config ? "locked" : "unconfigured";
    updateSyncUI();
    showToast("Locked GitHub sync on this device");
  });
}

function parseRepoInput(raw) {
  const cleaned = String(raw || "")
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/^\/+|\/+$/g, "");
  const parts = cleaned.split("/");
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return { owner: parts[0], repo: parts[1] };
  }
  return null;
}

if (els.syncSetupForm) {
  els.syncSetupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    els.setupStatusMsg.classList.add("hidden");
    els.setupStatusMsg.classList.remove("success");

    const parsedRepo = parseRepoInput(els.setupRepoInput.value);
    if (!parsedRepo) {
      els.setupStatusMsg.textContent =
        "Please enter a valid GitHub repository in 'owner/repo' format.";
      els.setupStatusMsg.classList.remove("hidden");
      return;
    }

    const { owner, repo } = parsedRepo;
    const branch = (els.setupBranchInput.value || "main").trim();
    const token = els.setupTokenInput.value.trim();
    const pin = els.setupPinInput.value;

    els.setupSubmitBtn.disabled = true;
    els.setupSubmitBtn.textContent = "Encrypting & Saving to GitHub...";

    try {
      // 1. Encrypt token with Shared PIN using Web Crypto AES-256-GCM
      const encryptedConfig = await encryptTokenWithPin(
        token,
        pin,
        owner,
        repo,
        branch
      );

      // 2. Commit data/sync-config.json to GitHub repo
      await githubPutFile(
        owner,
        repo,
        "data/sync-config.json",
        branch,
        token,
        JSON.stringify(encryptedConfig, null, 2),
        "Configure PIN-encrypted Cloud Sync"
      );

      // 3. Commit current data/schedule.csv to GitHub repo
      const csvText = serializeCsvClient(state.columns, state.eventsByCol);
      const newSha = await githubPutFile(
        owner,
        repo,
        "data/schedule.csv",
        branch,
        token,
        csvText,
        "Sync sleep schedule data"
      );

      // 4. Save locally & unlock current device
      localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(encryptedConfig));
      localStorage.setItem(
        SYNC_SESSION_KEY,
        JSON.stringify({ owner, repo, branch, token })
      );

      state.githubSync.config = encryptedConfig;
      state.githubSync.unlocked = true;
      state.githubSync.token = token;
      state.githubSync.owner = owner;
      state.githubSync.repo = repo;
      state.githubSync.branch = branch;
      state.githubSync.csvSha = newSha;
      state.githubSync.status = "synced";
      state.githubSync.lastSyncedAt = new Date();

      els.setupTokenInput.value = "";
      els.setupPinInput.value = "";
      updateSyncUI();
      switchSyncModalTab("unlock");
      showToast(`Cloud Sync configured and saved to ${owner}/${repo}!`);
    } catch (err) {
      els.setupStatusMsg.textContent = `GitHub API Error: ${err.message}. Check that your repo name, branch, and token permissions (Contents: Read & Write) are correct.`;
      els.setupStatusMsg.classList.remove("hidden");
    } finally {
      els.setupSubmitBtn.disabled = false;
      els.setupSubmitBtn.textContent = "Encrypt with PIN & Save to GitHub Repo";
    }
  });
}

// Auto-pull latest schedule when switching back to tab on phone or laptop
document.addEventListener("visibilitychange", () => {
  if (
    document.visibilityState === "visible" &&
    state.githubSync.unlocked &&
    !state.githubSync.isPushing
  ) {
    pullScheduleFromGitHub(true);
  }
});

// Initialize on load
fetchSchedule().then(() => {
  syncSmartDefaultsForActiveDate();
});
