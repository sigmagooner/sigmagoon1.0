const SUPABASE_URL = "https://ytbbpxjdwhpntlufufzx.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl0YmJweGpkd2hwbnRsdWZ1Znp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3Mjk2NjksImV4cCI6MjA5NDMwNTY2OX0.uGaBd6dmsjMb5j3e278OHN9sqYpuS7QNJyfBTLcyf0w";

const timeline = document.querySelector("#timeline");
const loadMoreButton = document.querySelector("#loadMoreButton");
const searchInput = document.querySelector("#searchInput");
const jumpDateInput = document.querySelector("#jumpDateInput");
const todayButton = document.querySelector("#todayButton");
const authForm = document.querySelector("#authForm");
const emailInput = document.querySelector("#emailInput");
const passwordInput = document.querySelector("#passwordInput");
const signUpButton = document.querySelector("#signUpButton");
const signOutButton = document.querySelector("#signOutButton");
const exportButton = document.querySelector("#exportButton");
const exportMarkdownButton = document.querySelector("#exportMarkdownButton");
const importButton = document.querySelector("#importButton");
const importFile = document.querySelector("#importFile");
const userPanel = document.querySelector("#userPanel");
const userEmail = document.querySelector("#userEmail");
const syncStatus = document.querySelector("#syncStatus");

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const STORAGE_KEY = "timeline-diary.entries";
const dayMs = 24 * 60 * 60 * 1000;

let visibleDays = 18;
let entries = loadLocalEntries();
let currentUser = null;
let saveTimers = new Map();
let sessionVersion = 0;
let focusedDateKey = todayKey();

function loadLocalEntries() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {};
  } catch {
    return {};
  }
}

function saveLocalEntries() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function setStatus(message, type = "neutral") {
  syncStatus.textContent = message;
  syncStatus.classList.toggle("is-error", type === "error");
  syncStatus.classList.toggle("is-success", type === "success");
}

function formatError(error) {
  return error?.message ?? "发生未知错误";
}

function withTimeout(promise, milliseconds, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), milliseconds);
  });

  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timeoutId);
  });
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromDateKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function todayKey() {
  return toDateKey(new Date());
}

function formatRelativeDay(date) {
  const today = fromDateKey(todayKey());
  const diff = Math.round((stripTime(today) - stripTime(date)) / dayMs);
  if (diff === 0) return "今天";
  if (diff === 1) return "昨天";
  if (diff === 2) return "前天";
  return new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(date);
}

function stripTime(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatMonthDay(date) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "numeric",
  }).format(date);
}

function createDayList() {
  const start = stripTime(new Date());
  return Array.from({ length: visibleDays }, (_, index) => {
    const date = addDays(start, -index);
    const key = toDateKey(date);
    return { date, key };
  });
}

function ensureDateVisible(key) {
  const targetDate = fromDateKey(key);
  const today = stripTime(new Date());
  const diff = Math.round((today - stripTime(targetDate)) / dayMs);

  if (diff >= 0 && diff >= visibleDays) {
    visibleDays = diff + 8;
  }
}

function matchesSearch(key, text, keyword) {
  if (!keyword) return true;
  return key.includes(keyword) || text.toLowerCase().includes(keyword);
}

function countWords(text) {
  const compact = text.replace(/\s+/g, "");
  return compact.length;
}

function summarize(text) {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) return "未记录";
  return normalized.length > 70 ? `${normalized.slice(0, 70)}...` : normalized;
}

function showSignedOut() {
  authForm.hidden = false;
  userPanel.hidden = true;
  userEmail.textContent = "";
  setStatus("未登录，本地保存");
}

function showSignedIn(user) {
  authForm.hidden = true;
  userPanel.hidden = false;
  userEmail.textContent = user.email;
  setStatus("已登录，云端保存");
}

async function loadCloudEntries() {
  setStatus("正在读取云端日记...");

  try {
    const { data, error } = await withTimeout(
      supabaseClient
        .from("diary_entries")
        .select("entry_date, content")
        .order("entry_date", { ascending: false }),
      10000,
      "读取超时，请检查网络后刷新"
    );

    if (error) throw error;

    entries = {};
    data.forEach((entry) => {
      entries[entry.entry_date] = entry.content ?? "";
    });
    setStatus("已登录，云端保存", "success");
  } catch (error) {
    setStatus(`云端读取失败：${formatError(error)}`, "error");
    console.error(error);
    return;
  }
}

async function saveCloudEntry(key, content) {
  if (!currentUser) return;

  if (!content.trim()) {
    const { error } = await supabaseClient
      .from("diary_entries")
      .delete()
      .eq("user_id", currentUser.id)
      .eq("entry_date", key);

    if (error) throw error;
    return;
  }

  const { error } = await supabaseClient.from("diary_entries").upsert(
    {
      user_id: currentUser.id,
      entry_date: key,
      content,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,entry_date" }
  );

  if (error) throw error;
}

function queueSave(key, value, saved) {
  if (saveTimers.has(key)) {
    clearTimeout(saveTimers.get(key));
  }

  saved.textContent = currentUser ? "同步中..." : "本地保存中...";

  const timer = setTimeout(async () => {
    try {
      if (currentUser) {
        await saveCloudEntry(key, value);
        saved.textContent = value.trim() ? "已同步" : "空白";
        setStatus("已保存到云端", "success");
      } else {
        saveLocalEntries();
        saved.textContent = value.trim() ? "已本地保存" : "空白";
      }
    } catch (error) {
      saved.textContent = "保存失败";
      setStatus(`云端保存失败：${formatError(error)}`, "error");
      console.error(error);
    }
  }, 500);

  saveTimers.set(key, timer);
}

function renderTimeline() {
  const keyword = searchInput.value.trim().toLowerCase();
  const days = createDayList().filter(({ key }) => matchesSearch(key, entries[key] ?? "", keyword));
  timeline.innerHTML = "";
  const currentTodayKey = todayKey();

  if (days.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "没有找到匹配的日记。";
    timeline.append(empty);
    return;
  }

  days.forEach(({ date, key }) => {
    const text = entries[key] ?? "";
    const article = document.createElement("article");
    article.className = "day";
    article.dataset.date = key;
    if (text.trim()) article.classList.add("has-entry");
    if (key === currentTodayKey) article.classList.add("is-today");
    if (key === currentTodayKey || key === focusedDateKey) article.classList.add("is-open");

    const dateLabel = document.createElement("div");
    dateLabel.className = "date";

    const dayNumber = document.createElement("strong");
    dayNumber.textContent = String(date.getDate());

    const relative = document.createElement("span");
    relative.textContent = formatRelativeDay(date);

    dateLabel.append(dayNumber, relative);

    const node = document.createElement("button");
    node.className = "node-button";
    node.type = "button";
    node.setAttribute("aria-label", `打开 ${key} 的日记`);

    const entry = document.createElement("section");
    entry.className = "entry";

    const summary = document.createElement("p");
    summary.className = "summary";
    summary.textContent = text.trim() ? summarize(text) : formatMonthDay(date);

    const editor = document.createElement("div");
    editor.className = "editor";

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.placeholder = key === currentTodayKey ? "今天发生了什么？" : "补写这一天";
    textarea.setAttribute("aria-label", `${key} 日记`);

    const meta = document.createElement("div");
    meta.className = "meta";

    const words = document.createElement("span");
    words.textContent = `${countWords(text)} 字`;

    const saved = document.createElement("span");
    saved.textContent = text.trim() ? (currentUser ? "已同步" : "已本地保存") : "空白";

    textarea.addEventListener("input", () => {
      entries[key] = textarea.value;
      if (!textarea.value.trim()) {
        delete entries[key];
      }
      summary.textContent = textarea.value.trim() ? summarize(textarea.value) : formatMonthDay(date);
      words.textContent = `${countWords(textarea.value)} 字`;
      article.classList.toggle("has-entry", Boolean(textarea.value.trim()));
      queueSave(key, textarea.value, saved);
    });

    node.addEventListener("click", () => {
      article.classList.toggle("is-open");
      if (article.classList.contains("is-open")) {
        textarea.focus();
      }
    });

    meta.append(words, saved);
    editor.append(textarea, meta);
    entry.append(summary, editor);
    article.append(dateLabel, node, entry);
    timeline.append(article);
  });
}

function scrollToDate(key) {
  requestAnimationFrame(() => {
    const target = document.querySelector(`[data-date="${key}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

function jumpToDate(key) {
  if (!key) return;

  const targetDate = stripTime(fromDateKey(key));
  const today = stripTime(new Date());

  if (targetDate > today) {
    setStatus("还不能跳到未来日期", "error");
    return;
  }

  focusedDateKey = key;
  searchInput.value = "";
  ensureDateVisible(key);
  renderTimeline();
  scrollToDate(key);
}

function buildBackupData() {
  return {
    app: "timeline-diary",
    version: 1,
    exportedAt: new Date().toISOString(),
    entries: Object.entries(entries)
      .filter(([, content]) => content.trim())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([entry_date, content]) => ({ entry_date, content })),
  };
}

function downloadTextFile(filename, text) {
  const type = filename.endsWith(".md") ? "text/markdown;charset=utf-8" : "application/json;charset=utf-8";
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportBackup() {
  const backup = buildBackupData();
  const filename = `timeline-diary-backup-${todayKey()}.json`;
  downloadTextFile(filename, JSON.stringify(backup, null, 2));
  setStatus(`已导出 ${backup.entries.length} 条 JSON 备份`, "success");
}

function buildMarkdown() {
  const backup = buildBackupData();
  const lines = [
    "# 日线日记",
    "",
    `导出时间：${new Date().toLocaleString("zh-CN")}`,
    "",
  ];

  backup.entries.forEach((entry) => {
    lines.push(`## ${entry.entry_date}`);
    lines.push("");
    lines.push(entry.content.trim());
    lines.push("");
  });

  if (backup.entries.length === 0) {
    lines.push("暂无日记。");
    lines.push("");
  }

  return {
    count: backup.entries.length,
    markdown: lines.join("\n"),
  };
}

function exportMarkdown() {
  const { count, markdown } = buildMarkdown();
  const filename = `timeline-diary-${todayKey()}.md`;
  downloadTextFile(filename, markdown);
  setStatus(`已导出 ${count} 条 Markdown 日记`, "success");
}

function validateBackup(data) {
  if (!data || data.app !== "timeline-diary" || !Array.isArray(data.entries)) {
    throw new Error("这不是有效的日线备份文件");
  }

  data.entries.forEach((entry) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.entry_date) || typeof entry.content !== "string") {
      throw new Error("备份文件中的日记格式不正确");
    }
  });

  return data.entries;
}

async function importBackup(file) {
  if (!file) return;

  try {
    setStatus("正在导入备份...");
    const text = await file.text();
    const importedEntries = validateBackup(JSON.parse(text));

    entries = {};
    importedEntries.forEach((entry) => {
      if (entry.content.trim()) {
        entries[entry.entry_date] = entry.content;
      }
    });

    if (currentUser) {
      const rows = importedEntries
        .filter((entry) => entry.content.trim())
        .map((entry) => ({
          user_id: currentUser.id,
          entry_date: entry.entry_date,
          content: entry.content,
          updated_at: new Date().toISOString(),
        }));

      if (rows.length > 0) {
        const { error } = await supabaseClient
          .from("diary_entries")
          .upsert(rows, { onConflict: "user_id,entry_date" });

        if (error) throw error;
      }
    } else {
      saveLocalEntries();
    }

    renderTimeline();
    setStatus(`已导入 ${importedEntries.length} 条日记`, "success");
  } catch (error) {
    setStatus(`导入失败：${formatError(error)}`, "error");
    console.error(error);
  } finally {
    importFile.value = "";
  }
}

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("正在登录...");

  const { error } = await supabaseClient.auth.signInWithPassword({
    email: emailInput.value,
    password: passwordInput.value,
  });

  if (error) {
    setStatus(`登录失败：${formatError(error)}`, "error");
  }
});

signUpButton.addEventListener("click", async () => {
  setStatus("正在注册...");

  const { error } = await supabaseClient.auth.signUp({
    email: emailInput.value,
    password: passwordInput.value,
  });

  if (error) {
    setStatus(`注册失败：${formatError(error)}`, "error");
    return;
  }

  setStatus("注册成功。若开启邮箱验证，请先查收邮件。", "success");
});

signOutButton.addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
});

exportButton.addEventListener("click", exportBackup);

exportMarkdownButton.addEventListener("click", exportMarkdown);

importButton.addEventListener("click", () => {
  importFile.click();
});

importFile.addEventListener("change", () => {
  importBackup(importFile.files?.[0]);
});

searchInput.addEventListener("input", () => {
  renderTimeline();
});

jumpDateInput.addEventListener("change", () => {
  jumpToDate(jumpDateInput.value);
});

todayButton.addEventListener("click", () => {
  focusedDateKey = todayKey();
  jumpDateInput.value = focusedDateKey;
  searchInput.value = "";
  renderTimeline();
  scrollToDate(focusedDateKey);
});

loadMoreButton.addEventListener("click", () => {
  visibleDays += 18;
  renderTimeline();
});

async function handleSession(session) {
  const version = ++sessionVersion;
  currentUser = session?.user ?? null;

  if (currentUser) {
    showSignedIn(currentUser);
    await loadCloudEntries();
    if (version !== sessionVersion) return;
  } else {
    entries = loadLocalEntries();
    showSignedOut();
  }

  renderTimeline();
}

supabaseClient.auth.onAuthStateChange((_event, session) => {
  setTimeout(() => {
    handleSession(session);
  }, 0);
});

async function init() {
  jumpDateInput.value = todayKey();

  const {
    data: { session },
  } = await supabaseClient.auth.getSession();

  await handleSession(session);
}

init();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch((error) => {
      console.error("Service worker registration failed", error);
    });
  });
}
