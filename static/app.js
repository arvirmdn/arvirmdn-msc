const API_BASE = ""; // sameorigin; ganti kalau backend beda domain dari frontend

const searchInput = document.getElementById("searchInput");
const searchWrap = document.getElementById("searchWrap");
const statusRow = document.getElementById("statusRow");
const resultList = document.getElementById("resultList");
const historyList = document.getElementById("historyList");
const emptyState = document.getElementById("emptyState");

const homeSections = document.getElementById("homeSections");
const homeLoading = document.getElementById("homeLoading");
const homeErrorState = document.getElementById("homeErrorState");
const homeRetryBtn = document.getElementById("homeRetryBtn");

const audio = document.getElementById("audioPlayer");

// Mini player
const miniPlayer = document.getElementById("miniPlayer");
const miniThumb = document.getElementById("miniThumb");
const miniTitle = document.getElementById("miniTitle");
const miniArtist = document.getElementById("miniArtist");
const miniPlayPause = document.getElementById("miniPlayPause");
const miniPlayIcon = document.getElementById("miniPlayIcon");
const miniPauseIcon = document.getElementById("miniPauseIcon");

// Full sheet
const playerSheet = document.getElementById("playerSheet");
const sheetHandle = document.getElementById("sheetHandle");
const sheetThumb = document.getElementById("sheetThumb");
const sheetTitle = document.getElementById("sheetTitle");
const sheetArtist = document.getElementById("sheetArtist");
const seekBar = document.getElementById("seekBar");
const curTimeEl = document.getElementById("curTime");
const durTimeEl = document.getElementById("durTime");
const volumeBar = document.getElementById("volumeBar");
const playBtn = document.getElementById("playBtn");
const playIcon = document.getElementById("playIcon");
const pauseIcon = document.getElementById("pauseIcon");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");

const navBtns = document.querySelectorAll(".nav-btn");
const panels = document.querySelectorAll(".panel");
const appRoot = document.getElementById("appRoot");

// Playlist elements
const createPlaylistBtn = document.getElementById("createPlaylistBtn");
const playlistGrid = document.getElementById("playlistGrid");
const playlistEmptyState = document.getElementById("playlistEmptyState");
const playlistDetail = document.getElementById("playlistDetail");
const playlistBackBtn = document.getElementById("playlistBackBtn");
const playlistRenameBtn = document.getElementById("playlistRenameBtn");
const playlistDetailName = document.getElementById("playlistDetailName");
const playlistDetailCount = document.getElementById("playlistDetailCount");
const playlistDetailList = document.getElementById("playlistDetailList");
const playlistDetailEmpty = document.getElementById("playlistDetailEmpty");

const nameModalOverlay = document.getElementById("nameModalOverlay");
const nameModalTitle = document.getElementById("nameModalTitle");
const nameModalInput = document.getElementById("nameModalInput");
const nameModalCancel = document.getElementById("nameModalCancel");
const nameModalSave = document.getElementById("nameModalSave");

const addModalOverlay = document.getElementById("addModalOverlay");
const addModalList = document.getElementById("addModalList");
const addModalNewBtn = document.getElementById("addModalNewBtn");
const addModalDone = document.getElementById("addModalDone");

// ---------- Auth (Masuk / Daftar) ----------
const AUTH_TOKEN_KEY = "musikin_token";
const AUTH_USERNAME_KEY = "musikin_username";

const authScreen = document.getElementById("authScreen");
const authTabLogin = document.getElementById("authTabLogin");
const authTabRegister = document.getElementById("authTabRegister");
const authTitleEl = document.getElementById("authTitle");
const authSubtitleEl = document.getElementById("authSubtitle");
const authConfirmField = document.getElementById("authConfirmField");
const authUsernameInput = document.getElementById("authUsername");
const authPasswordInput = document.getElementById("authPassword");
const authConfirmPasswordInput = document.getElementById("authConfirmPassword");
const authErrorEl = document.getElementById("authError");
const authSubmitBtn = document.getElementById("authSubmitBtn");
const authSubmitLabel = document.getElementById("authSubmitLabel");
const authPasswordEye = document.getElementById("authPasswordEye");
const authConfirmEye = document.getElementById("authConfirmEye");
const logoutBtn = document.getElementById("logoutBtn");

let authMode = "login"; // 'login' | 'register'

function getToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

function setAuth(token, username) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem(AUTH_USERNAME_KEY, username);
}

function clearAuth() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USERNAME_KEY);
}

function authHeaders(extra = {}) {
  const token = getToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

function setAuthMode(mode) {
  authMode = mode;
  authErrorEl.style.display = "none";
  authTabLogin.classList.toggle("active", mode === "login");
  authTabRegister.classList.toggle("active", mode === "register");
  authConfirmField.style.display = mode === "register" ? "block" : "none";
  authTitleEl.textContent = mode === "login" ? "Masuk ke Musikin" : "Buat Akun Baru";
  authSubtitleEl.textContent =
    mode === "login" ? "Playlist kamu tersimpan aman di akunmu" : "Daftar biar playlist kamu tidak hilang";
  authSubmitLabel.textContent = mode === "login" ? "Masuk" : "Daftar Sekarang";
}

authTabLogin.addEventListener("click", () => setAuthMode("login"));
authTabRegister.addEventListener("click", () => setAuthMode("register"));

function togglePasswordEye(input, btn) {
  const showing = input.type === "password";
  input.type = showing ? "text" : "password";
  btn.classList.toggle("active", showing);
}
authPasswordEye.addEventListener("click", () => togglePasswordEye(authPasswordInput, authPasswordEye));
authConfirmEye.addEventListener("click", () => togglePasswordEye(authConfirmPasswordInput, authConfirmEye));

function showAuthError(msg) {
  authErrorEl.textContent = msg;
  authErrorEl.style.display = "block";
}

function showAuthScreen() {
  authScreen.classList.remove("hidden");
}

async function enterApp() {
  authScreen.classList.add("hidden");
  await loadPlaylistsFromServer();
}

async function loadPlaylistsFromServer() {
  try {
    const res = await fetch(`${API_BASE}/api/playlists`, { headers: authHeaders() });
    if (res.status === 401) {
      clearAuth();
      showAuthScreen();
      return;
    }
    const data = await res.json();
    playlists = data.playlists || [];
    renderPlaylists();
    if (activePlaylistId) renderPlaylistDetail();
  } catch (err) {
    console.error("Gagal memuat playlist dari server:", err);
  }
}

async function submitAuth() {
  const username = authUsernameInput.value.trim();
  const password = authPasswordInput.value;
  if (!username || !password) {
    showAuthError("Nama pengguna dan kata sandi wajib diisi.");
    return;
  }
  authSubmitBtn.disabled = true;
  authErrorEl.style.display = "none";
  try {
    let res;
    if (authMode === "login") {
      res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
    } else {
      res = await fetch(`${API_BASE}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          confirm_password: authConfirmPasswordInput.value,
        }),
      });
    }
    const data = await res.json();
    if (!res.ok) {
      showAuthError(data.detail || "Terjadi kesalahan, coba lagi.");
      return;
    }
    setAuth(data.token, data.username);
    authUsernameInput.value = "";
    authPasswordInput.value = "";
    authConfirmPasswordInput.value = "";
    await enterApp();
  } catch (err) {
    console.error(err);
    showAuthError("Tidak bisa menghubungi server. Coba lagi.");
  } finally {
    authSubmitBtn.disabled = false;
  }
}

authSubmitBtn.addEventListener("click", submitAuth);
[authUsernameInput, authPasswordInput, authConfirmPasswordInput].forEach((el) => {
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitAuth();
  });
});

logoutBtn.addEventListener("click", async () => {
  try {
    await fetch(`${API_BASE}/api/auth/logout`, { method: "POST", headers: authHeaders() });
  } catch (err) {
    // abaikan, tetap logout di sisi klien
  }
  clearAuth();
  playlists = [];
  renderPlaylists();
  showAuthScreen();
});

// Cek sesi tersimpan waktu app dibuka
(async function initAuth() {
  const token = getToken();
  if (!token) {
    showAuthScreen();
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/api/auth/me`, { headers: authHeaders() });
    if (!res.ok) {
      clearAuth();
      showAuthScreen();
      return;
    }
    await enterApp();
  } catch (err) {
    showAuthScreen();
  }
})();

let currentQueue = [];
let currentIndex = -1;
let searchTimer = null;
let history = JSON.parse(localStorage.getItem("musikin_history") || "[]");
let playlists = []; // dimuat dari server setelah login, lihat loadPlaylistsFromServer()
let activePlaylistId = null;
let addModalTrack = null;
let nameModalMode = null; // 'create' | 'createAndAdd' | 'rename'
let homeLoaded = false;

// ---------- Bottom nav ----------
navBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    navBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const target = btn.dataset.view;
    panels.forEach((p) => p.classList.remove("active"));
    document.getElementById(target).classList.add("active");
    searchWrap.classList.toggle("show", target === "searchView");
    if (target === "libraryView") renderHistory();
    if (target === "playlistView") renderPlaylists();
    if (target === "homeView" && !homeLoaded) loadHome();
  });
});

// ---------- Pencarian otomatis (debounce) ke YouTube ----------
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (!q) {
    resultList.innerHTML = "";
    statusRow.textContent = "";
    emptyState.style.display = "flex";
    return;
  }
  statusRow.textContent = "Mengetik...";
  searchTimer = setTimeout(() => doSearch(q), 500);
});

searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (q) doSearch(q);
  }
});

async function doSearch(query) {
  statusRow.textContent = "Mencari...";
  resultList.innerHTML = "";
  try {
    const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error("Gagal mencari");
    const data = await res.json();
    currentQueue = data.results;
    if (!currentQueue.length) {
      statusRow.textContent = "Tidak ada hasil.";
      emptyState.style.display = "flex";
      return;
    }
    statusRow.textContent = `${currentQueue.length} hasil untuk "${query}"`;
    emptyState.style.display = "none";
    renderResults(currentQueue);
  } catch (err) {
    statusRow.textContent = "Terjadi kesalahan saat mencari. Coba lagi.";
    emptyState.style.display = "flex";
    console.error(err);
  }
}

function renderResults(tracks) {
  resultList.innerHTML = "";
  tracks.forEach((track, idx) => {
    resultList.appendChild(buildTrackItem(track, () => playTrack(idx, currentQueue)));
  });
  highlightPlayingRow();
}

function buildTrackItem(track, onClick, options = {}) {
  const { mode = "add", onAction = null } = options;
  const li = document.createElement("li");
  li.className = "track-item";
  li.dataset.id = track.id;
  const actionBtn = mode === "none" ? "" : `
    <button class="track-action ${mode}" aria-label="${mode === "add" ? "Tambah ke playlist" : "Hapus dari playlist"}">
      ${mode === "add"
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>'}
    </button>`;
  li.innerHTML = `
    <img class="track-thumb" src="${track.thumbnail || ""}" alt="">
    <div class="track-info">
      <div class="track-title">${escapeHtml(track.title)}</div>
      <div class="track-artist">${escapeHtml(track.artist || "")}</div>
    </div>
    <div class="row-eq" style="display:none"><span></span><span></span><span></span></div>
    <div class="track-duration">${formatDuration(track.duration)}</div>
    ${actionBtn}
  `;
  li.addEventListener("click", onClick);
  if (mode !== "none") {
    const btn = li.querySelector(".track-action");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (mode === "add") openAddModal(track);
      else if (onAction) onAction();
    });
  }
  return li;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

function formatDuration(sec) {
  if (!sec && sec !== 0) return "";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// ---------- Player ----------
function playTrack(index, queue) {
  currentQueue = queue;
  currentIndex = index;
  const track = currentQueue[index];
  if (!track) return;

  audio.src = `${API_BASE}/api/stream/${track.id}`;
  audio.play().catch((e) => console.error("Gagal memutar:", e));

  miniPlayer.classList.add("show");
  appRoot.classList.add("has-track");

  updateMeta(track);
  setPlayingUI(true);
  highlightPlayingRow();
  addToHistory(track);
}

function updateMeta(track) {
  miniThumb.src = track.thumbnail || "";
  miniTitle.textContent = track.title;
  miniArtist.textContent = track.artist || "";
  sheetThumb.src = track.thumbnail || "";
  sheetTitle.textContent = track.title;
  sheetArtist.textContent = track.artist || "";
}

function setPlayingUI(isPlaying) {
  miniPlayer.classList.toggle("playing", isPlaying);
  miniPlayIcon.style.display = isPlaying ? "none" : "block";
  miniPauseIcon.style.display = isPlaying ? "block" : "none";
  playIcon.style.display = isPlaying ? "none" : "block";
  pauseIcon.style.display = isPlaying ? "block" : "none";
}

function highlightPlayingRow() {
  const currentId = currentQueue[currentIndex]?.id;
  document.querySelectorAll(".track-item").forEach((el) => {
    const isPlaying = el.dataset.id === currentId;
    el.classList.toggle("playing", isPlaying);
    const eq = el.querySelector(".row-eq");
    const dur = el.querySelector(".track-duration");
    if (eq) eq.style.display = isPlaying && !audio.paused ? "flex" : "none";
    if (dur) dur.style.display = isPlaying && !audio.paused ? "none" : "block";
  });
  document.querySelectorAll(".home-card").forEach((el) => {
    el.classList.toggle("playing", el.dataset.id === currentId && !audio.paused);
  });
}

function addToHistory(track) {
  history = history.filter((t) => t.id !== track.id);
  history.unshift(track);
  history = history.slice(0, 50);
  localStorage.setItem("musikin_history", JSON.stringify(history));
}

function renderHistory() {
  historyList.innerHTML = "";
  if (!history.length) {
    historyList.innerHTML = '<div class="empty-state" style="display:flex"><p>Belum ada lagu yang diputar.</p></div>';
    return;
  }
  history.forEach((track, idx) => {
    historyList.appendChild(buildTrackItem(track, () => playTrack(idx, history)));
  });
  highlightPlayingRow();
}

// ---------- Play/pause ----------
function togglePlay() {
  if (!audio.src) return;
  if (audio.paused) {
    audio.play();
  } else {
    audio.pause();
  }
}

miniPlayPause.addEventListener("click", (e) => {
  e.stopPropagation();
  togglePlay();
});
playBtn.addEventListener("click", togglePlay);

audio.addEventListener("play", () => { setPlayingUI(true); highlightPlayingRow(); });
audio.addEventListener("pause", () => { setPlayingUI(false); highlightPlayingRow(); });

prevBtn.addEventListener("click", () => {
  if (currentIndex > 0) playTrack(currentIndex - 1, currentQueue);
});

nextBtn.addEventListener("click", () => {
  if (currentIndex < currentQueue.length - 1) playTrack(currentIndex + 1, currentQueue);
});

audio.addEventListener("ended", () => {
  if (currentIndex < currentQueue.length - 1) {
    playTrack(currentIndex + 1, currentQueue);
  }
});

audio.addEventListener("stalled", () => {
  statusRow.textContent = "Koneksi audio tersendat, coba tunggu sebentar...";
});

audio.addEventListener("waiting", () => {
  statusRow.textContent = "Memuat audio...";
});

audio.addEventListener("playing", () => {
  if (statusRow.textContent.startsWith("Memuat") || statusRow.textContent.startsWith("Koneksi")) {
    statusRow.textContent = "";
  }
});

let errorRetryCount = 0;
audio.addEventListener("error", () => {
  console.error("Audio error:", audio.error);
  setPlayingUI(false);
  const track = currentQueue[currentIndex];
  const label = track ? `"${track.title}"` : "lagu ini";

  if (errorRetryCount < 1) {
    // Kadang gagal sekali karena URL upstream keburu basi — coba re-fetch sekali.
    errorRetryCount++;
    statusRow.textContent = `Gagal muter ${label}, mencoba ulang...`;
    const retryTrack = currentQueue[currentIndex];
    setTimeout(() => {
      if (retryTrack) {
        audio.src = `${API_BASE}/api/stream/${retryTrack.id}?retry=${Date.now()}`;
        audio.play().catch(() => {});
      }
    }, 600);
    return;
  }

  errorRetryCount = 0;
  statusRow.textContent = `Gagal muter ${label}. Kemungkinan sumbernya diblokir/dibatasi — coba lagu lain atau cek log server.`;
});

audio.addEventListener("play", () => { errorRetryCount = 0; });

audio.addEventListener("timeupdate", () => {
  if (!isNaN(audio.duration)) {
    seekBar.value = (audio.currentTime / audio.duration) * 100;
    curTimeEl.textContent = formatDuration(audio.currentTime);
    durTimeEl.textContent = formatDuration(audio.duration);
  }
});

seekBar.addEventListener("input", () => {
  if (!isNaN(audio.duration)) {
    audio.currentTime = (seekBar.value / 100) * audio.duration;
  }
});

volumeBar.addEventListener("input", () => {
  audio.volume = volumeBar.value / 100;
});
audio.volume = 0.8;

// ---------- Full player sheet open/close ----------
miniPlayer.addEventListener("click", () => {
  if (!audio.src) return;
  playerSheet.classList.add("open");
});

let dragStartY = null;
sheetHandle.addEventListener("touchstart", (e) => { dragStartY = e.touches[0].clientY; }, { passive: true });
sheetHandle.addEventListener("touchmove", (e) => {
  if (dragStartY === null) return;
  const dy = e.touches[0].clientY - dragStartY;
  if (dy > 60) {
    playerSheet.classList.remove("open");
    dragStartY = null;
  }
}, { passive: true });
sheetHandle.addEventListener("touchend", () => { dragStartY = null; });
sheetHandle.addEventListener("click", () => playerSheet.classList.remove("open"));

// ---------- Playlist (disimpan di server, terikat ke akun) ----------
async function apiCreatePlaylist(name) {
  const res = await fetch(`${API_BASE}/api/playlists`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error("Gagal membuat playlist");
  return res.json();
}

async function apiUpdatePlaylist(id, patch) {
  const res = await fetch(`${API_BASE}/api/playlists/${id}`, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error("Gagal memperbarui playlist");
  return res.json();
}

async function apiDeletePlaylist(id) {
  const res = await fetch(`${API_BASE}/api/playlists/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Gagal menghapus playlist");
  return res.json();
}

function renderPlaylists() {
  playlistGrid.innerHTML = "";
  playlistEmptyState.style.display = playlists.length ? "none" : "flex";
  playlists.forEach((pl) => {
    const card = document.createElement("button");
    card.className = "playlist-card";
    card.innerHTML = `
      <div class="playlist-card-icon">🎵</div>
      <div class="playlist-card-info">
        <div class="playlist-card-name">${escapeHtml(pl.name)}</div>
        <div class="playlist-card-count">${pl.tracks.length} lagu</div>
      </div>
    `;
    card.addEventListener("click", () => openPlaylistDetail(pl.id));
    playlistGrid.appendChild(card);
  });
}

function openPlaylistDetail(id) {
  activePlaylistId = id;
  renderPlaylistDetail();
  playlistDetail.classList.add("open");
}

function renderPlaylistDetail() {
  const pl = playlists.find((p) => p.id === activePlaylistId);
  if (!pl) return;
  playlistDetailName.textContent = pl.name;
  playlistDetailCount.textContent = `${pl.tracks.length} lagu`;
  playlistDetailList.innerHTML = "";
  playlistDetailEmpty.style.display = pl.tracks.length ? "none" : "flex";
  pl.tracks.forEach((track, idx) => {
    const item = buildTrackItem(track, () => playTrack(idx, pl.tracks), {
      mode: "remove",
      onAction: () => removeFromPlaylist(pl.id, track.id),
    });
    playlistDetailList.appendChild(item);
  });
  highlightPlayingRow();
}

async function removeFromPlaylist(playlistId, trackId) {
  const pl = playlists.find((p) => p.id === playlistId);
  if (!pl) return;
  const newTracks = pl.tracks.filter((t) => t.id !== trackId);
  pl.tracks = newTracks; // optimistic
  renderPlaylistDetail();
  renderPlaylists();
  try {
    await apiUpdatePlaylist(playlistId, { tracks: newTracks });
  } catch (err) {
    console.error(err);
  }
}

playlistBackBtn.addEventListener("click", () => playlistDetail.classList.remove("open"));

playlistRenameBtn.addEventListener("click", () => {
  const pl = playlists.find((p) => p.id === activePlaylistId);
  if (!pl) return;
  openNameModal("rename", pl.name);
});

createPlaylistBtn.addEventListener("click", () => openNameModal("create", ""));

function openNameModal(mode, value) {
  nameModalMode = mode;
  nameModalTitle.textContent = mode === "rename" ? "Ubah Nama Playlist" : "Playlist Baru";
  nameModalInput.value = value;
  nameModalOverlay.classList.add("open");
  setTimeout(() => nameModalInput.focus(), 50);
}

function closeNameModal() {
  nameModalOverlay.classList.remove("open");
  nameModalMode = null;
}

nameModalCancel.addEventListener("click", closeNameModal);
nameModalOverlay.addEventListener("click", (e) => {
  if (e.target === nameModalOverlay) closeNameModal();
});

nameModalSave.addEventListener("click", async () => {
  const name = nameModalInput.value.trim();
  if (!name) return;
  nameModalSave.disabled = true;

  try {
    if (nameModalMode === "create" || nameModalMode === "createAndAdd") {
      const created = await apiCreatePlaylist(name);
      if (nameModalMode === "createAndAdd" && addModalTrack) {
        created.tracks = [addModalTrack];
        await apiUpdatePlaylist(created.id, { tracks: created.tracks });
      }
      playlists.unshift(created);
      renderPlaylists();
      if (nameModalMode === "createAndAdd") renderAddModalList();
    } else if (nameModalMode === "rename") {
      const pl = playlists.find((p) => p.id === activePlaylistId);
      if (pl) {
        await apiUpdatePlaylist(pl.id, { name });
        pl.name = name;
        renderPlaylistDetail();
        renderPlaylists();
      }
    }
    closeNameModal();
  } catch (err) {
    console.error(err);
    showAuthErrorFallback("Gagal menyimpan playlist. Coba lagi.");
  } finally {
    nameModalSave.disabled = false;
  }
});

// Fallback pesan error kecil kalau aksi playlist gagal (mis. koneksi putus)
function showAuthErrorFallback(msg) {
  statusRow.textContent = msg;
  setTimeout(() => {
    if (statusRow.textContent === msg) statusRow.textContent = "";
  }, 3000);
}

nameModalInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") nameModalSave.click();
});

// ---------- Modal: tambah lagu ke playlist ----------
function openAddModal(track) {
  addModalTrack = track;
  renderAddModalList();
  addModalOverlay.classList.add("open");
}

function closeAddModal() {
  addModalOverlay.classList.remove("open");
  addModalTrack = null;
}

function renderAddModalList() {
  addModalList.innerHTML = "";
  if (!playlists.length) {
    addModalList.innerHTML = '<li class="modal-empty-hint">Belum ada playlist. Bikin dulu di bawah.</li>';
    return;
  }
  playlists.forEach((pl) => {
    const inPlaylist = addModalTrack && pl.tracks.some((t) => t.id === addModalTrack.id);
    const li = document.createElement("li");
    li.className = "playlist-pick-item" + (inPlaylist ? " picked" : "");
    li.innerHTML = `
      <span class="pick-check">${inPlaylist ? "✓" : ""}</span>
      <span class="pick-name">${escapeHtml(pl.name)}</span>
      <span class="pick-count">${pl.tracks.length} lagu</span>
    `;
    li.addEventListener("click", () => toggleTrackInPlaylist(pl.id));
    addModalList.appendChild(li);
  });
}

async function toggleTrackInPlaylist(playlistId) {
  const pl = playlists.find((p) => p.id === playlistId);
  if (!pl || !addModalTrack) return;
  const exists = pl.tracks.some((t) => t.id === addModalTrack.id);
  const newTracks = exists
    ? pl.tracks.filter((t) => t.id !== addModalTrack.id)
    : [addModalTrack, ...pl.tracks];
  pl.tracks = newTracks; // optimistic
  renderAddModalList();
  renderPlaylists();
  if (activePlaylistId === playlistId) renderPlaylistDetail();
  try {
    await apiUpdatePlaylist(playlistId, { tracks: newTracks });
  } catch (err) {
    console.error(err);
  }
}

addModalNewBtn.addEventListener("click", () => openNameModal("createAndAdd", ""));
addModalDone.addEventListener("click", closeAddModal);
addModalOverlay.addEventListener("click", (e) => {
  if (e.target === addModalOverlay) closeAddModal();
});

renderPlaylists();

// ---------- Home ----------
async function loadHome() {
  homeLoading.style.display = "flex";
  homeErrorState.style.display = "none";
  homeSections.innerHTML = "";
  try {
    const res = await fetch(`${API_BASE}/api/home`);
    if (!res.ok) throw new Error("Gagal memuat home");
    const data = await res.json();
    homeLoaded = true;
    homeLoading.style.display = "none";
    renderHomeSections(data.sections || []);
  } catch (err) {
    console.error(err);
    homeLoading.style.display = "none";
    homeErrorState.style.display = "flex";
  }
}

homeRetryBtn.addEventListener("click", loadHome);

function renderHomeSections(sections) {
  homeSections.innerHTML = "";
  if (!sections.length) {
    homeErrorState.style.display = "flex";
    return;
  }
  sections.forEach((section) => {
    if (!section.tracks || !section.tracks.length) return;
    const wrap = document.createElement("div");
    wrap.className = "home-section";
    wrap.innerHTML = `<h2 class="home-section-title">${escapeHtml(section.title)}</h2>`;
    const row = document.createElement("div");
    row.className = "home-row";
    section.tracks.forEach((track, idx) => {
      row.appendChild(buildHomeCard(track, () => playTrack(idx, section.tracks)));
    });
    wrap.appendChild(row);
    homeSections.appendChild(wrap);
  });
  highlightPlayingRow();
}

function buildHomeCard(track, onClick) {
  const card = document.createElement("button");
  card.className = "home-card";
  card.dataset.id = track.id;
  card.innerHTML = `
    <div class="home-card-thumb-wrap">
      <img class="home-card-thumb" src="${track.thumbnail || ""}" alt="">
      <div class="home-card-eq"><span></span><span></span><span></span></div>
    </div>
    <div class="home-card-title">${escapeHtml(track.title)}</div>
    <div class="home-card-artist">${escapeHtml(track.artist || "")}</div>
  `;
  card.addEventListener("click", onClick);
  return card;
}

loadHome();
