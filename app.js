const SUPABASE_URL = "https://ytbbpxjdwhpntlufufzx.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl0YmJweGpkd2hwbnRsdWZ1Znp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3Mjk2NjksImV4cCI6MjA5NDMwNTY2OX0.uGaBd6dmsjMb5j3e278OHN9sqYpuS7QNJyfBTLcyf0w";

const timeline = document.querySelector("#timeline");
const loadMoreButton = document.querySelector("#loadMoreButton");
const authForm = document.querySelector("#authForm");
const emailInput = document.querySelector("#emailInput");
const passwordInput = document.querySelector("#passwordInput");
const signUpButton = document.querySelector("#signUpButton");
const signOutButton = document.querySelector("#signOutButton");
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

function setStatus(message) {
  syncStatus.textContent = message;
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

  const { data, error } = await supabaseClient
    .from("diary_entries")
    .select("entry_date, content")
    .order("entry_date", { ascending: false });

  if (error) {
    setStatus("云端读取失败，请检查数据表");
    console.error(error);
    return;
  }

  entries = {};
  data.forEach((entry) => {
    entries[entry.entry_date] = entry.content ?? "";
  });
  setStatus("已登录，云端保存");
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
        setStatus("已登录，云端保存");
      } else {
        saveLocalEntries();
        saved.textContent = value.trim() ? "已本地保存" : "空白";
      }
    } catch (error) {
      saved.textContent = "保存失败";
      setStatus("云端保存失败");
      console.error(error);
    }
  }, 500);

  saveTimers.set(key, timer);
}

function renderTimeline() {
  const days = createDayList();
  timeline.innerHTML = "";
  const currentTodayKey = todayKey();

  days.forEach(({ date, key }) => {
    const text = entries[key] ?? "";
    const article = document.createElement("article");
    article.className = "day";
    article.dataset.date = key;
    if (text.trim()) article.classList.add("has-entry");
    if (key === currentTodayKey) article.classList.add("is-today");
    if (key === currentTodayKey) article.classList.add("is-open");

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

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("正在登录...");

  const { error } = await supabaseClient.auth.signInWithPassword({
    email: emailInput.value,
    password: passwordInput.value,
  });

  if (error) {
    setStatus(error.message);
  }
});

signUpButton.addEventListener("click", async () => {
  setStatus("正在注册...");

  const { error } = await supabaseClient.auth.signUp({
    email: emailInput.value,
    password: passwordInput.value,
  });

  if (error) {
    setStatus(error.message);
    return;
  }

  setStatus("注册成功。若开启邮箱验证，请先查收邮件。");
});

signOutButton.addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
});

loadMoreButton.addEventListener("click", () => {
  visibleDays += 18;
  renderTimeline();
});

supabaseClient.auth.onAuthStateChange(async (_event, session) => {
  currentUser = session?.user ?? null;

  if (currentUser) {
    showSignedIn(currentUser);
    await loadCloudEntries();
  } else {
    entries = loadLocalEntries();
    showSignedOut();
  }

  renderTimeline();
});

async function init() {
  const {
    data: { session },
  } = await supabaseClient.auth.getSession();

  currentUser = session?.user ?? null;

  if (currentUser) {
    showSignedIn(currentUser);
    await loadCloudEntries();
  } else {
    showSignedOut();
  }

  renderTimeline();
}

init();
