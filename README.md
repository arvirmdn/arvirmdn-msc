# Musikin — Web Musik dengan Pencarian Otomatis ke YouTube

Web player musik gaya Spotify. Kamu ketik judul lagu, otomatis dicari ke YouTube
lewat backend (yt-dlp), lalu diputar sebagai **audio only** (video-nya tidak
ditampilkan) langsung di browser.

## Struktur

```
web-musik/
├── main.py            # Backend FastAPI (search + stream audio via yt-dlp)
├── requirements.txt
├── static/
│   ├── index.html     # UI
│   ├── style.css       # Tema dark ala Spotify
│   └── app.js           # Logika search, queue, dan player
```

## Cara jalanin lokal

```bash
cd web-musik
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Buka `http://localhost:8000` di browser.

## Akun & Playlist (baru)

Sekarang ada sistem **Masuk / Daftar** sebelum masuk ke app. Playlist disimpan
di database (bukan `localStorage` lagi), jadi kalau user logout lalu login
lagi (bahkan dari HP lain), playlist mereka tetap ada.

- Password di-hash (PBKDF2-SHA256 + salt per user), tidak pernah disimpan
  polos.
- Sesi login pakai token sederhana (`sessions` table), dikirim lewat header
  `Authorization: Bearer <token>`.
- Endpoint baru: `POST /api/auth/register`, `POST /api/auth/login`,
  `POST /api/auth/logout`, `GET /api/auth/me`, dan CRUD
  `GET/POST/PUT/DELETE /api/playlists`.

### ⚠️ PENTING — data akun bisa hilang di Railway kalau tidak pasang Volume

Database disimpan sebagai file SQLite (`musikin.db`) di filesystem container.
Railway **mereset filesystem setiap kali kamu redeploy** kecuali kamu pasang
**Railway Volume**:

1. Di project Railway → tab **Volumes** → **New Volume** → mount path
   misalnya `/data`.
2. Set environment variable `DB_PATH=/data/musikin.db`.
3. Redeploy. Setelah ini, akun & playlist akan tetap ada walau kamu push
   kode baru.

Tanpa langkah ini, versi dasar tetap jalan normal untuk development/testing,
tapi semua akun & playlist akan hilang setiap kali ada deploy baru.

## Rate limiting (baru)

Endpoint yang rawan disalahgunakan sekarang dibatasi per-IP pakai `slowapi`:

- `POST /api/auth/login` — 5/menit
- `POST /api/auth/register` — 5/jam
- `POST /api/auth/reset-password` — 5/menit
- `GET /api/search` — 30/menit
- `GET /api/stream/{video_id}` — 20/menit

Kalau limit kelewat, server balas `429 Too Many Requests` dan frontend
menampilkan pesan "terlalu banyak percobaan". Angka-angka ini didefinisikan
lewat decorator `@limiter.limit(...)` di `main.py`, tinggal ubah sesuai
kebutuhan.

## Lupa kata sandi / Reset password (baru)

Karena akun di sini cuma pakai username (tanpa email), reset password pakai
**kode pemulihan** (recovery code), bukan link lewat email:

- Saat **daftar**, user langsung dikasih kode pemulihan (format
  `AB12-CD34-EF56`) lewat modal — cuma ditampilkan **sekali**, dan yang
  disimpan di database cuma hash-nya (pakai algoritma hash yang sama dengan
  password, PBKDF2-SHA256 + salt).
- Kalau lupa password, user klik "Lupa kata sandi?" di layar login, lalu
  masukkan username + kode pemulihan + password baru lewat
  `POST /api/auth/reset-password`. Berhasil reset akan otomatis logout semua
  sesi lama, dan kode pemulihan dirotasi (kode lama jadi tidak berlaku,
  langsung dikasih kode baru).
- Dari menu Profil, ada tombol "Buat / Perbarui Kode Pemulihan"
  (`POST /api/auth/recovery-code/regenerate`, butuh konfirmasi password saat
  ini) — buat generate kode baru kalau kodenya hilang, atau buat akun lama
  yang dibuat sebelum fitur ini ada (kolom recovery code-nya otomatis
  ditambahkan lewat migrasi ringan di `_init_db()`).

⚠️ Kalau user kehilangan kode pemulihan DAN lupa password sekaligus, akunnya
tidak bisa dipulihkan lewat aplikasi — ini trade-off dari desain tanpa email.

## Kalau audio sering "mati sendiri" / gagal diputar (baru)

**Penyebab paling umum (sudah diperbaiki di versi ini):** sejak yt-dlp versi
2025.11.12, YouTube mewajibkan server yang mengekstrak audio punya
**"JS runtime" (Deno)** terpasang. Tanpa ini, yt-dlp tetap "jalan" tapi
sering diam-diam gagal dapat URL audio yang valid — persis gejala
"tersendat"/"gagal diputar". Perbaikannya:

1. File `nixpacks.toml` di root proyek ini sudah memasang Deno otomatis
   setiap kali Railway build ulang — **tidak perlu langkah manual apapun**,
   cukup redeploy.
2. `requirements.txt` sudah dinaikkan ke `yt-dlp[default]>=2026.08.19`
   (versi lama `>=2024.12.1` sudah pasti gagal total di tahun 2026).
3. **yt-dlp WAJIB di-update berkala** (bukan sekali pasang lalu dibiarkan) —
   YouTube rutin mengubah mekanisme proteksinya tiap beberapa
   minggu/bulan. Kalau tiba-tiba mulai gagal lagi setelah lama lancar,
   coba naikkan dulu angka versi minimum `yt-dlp` di `requirements.txt` ke
   rilis terbaru (cek di github.com/yt-dlp/yt-dlp/releases) sebelum curiga
   hal lain.

Selain itu, penyebab kedua yang masih mungkin terjadi: **YouTube
membatasi/menolak IP server** kamu (umum di hosting cloud kayak Railway).
Sudah dikuatin di versi ini:

- `_get_audio_stream_info` sekarang nyoba beberapa "player client" YouTube
  berurutan (`android` → `ios` → `web` → kombinasi ketiganya) sebelum
  benar-benar menyerah, plus retry bawaan yt-dlp (`retries`,
  `fragment_retries`, `extractor_retries`).
- `/api/stream` nyoba konek ke sumber audio sampai 3x kalau gagal/ditolak
  sesaat, dan kalau koneksinya putus di TENGAH streaming, server nutup
  dengan rapi (gak crash) — dan frontend otomatis retry dari posisi
  terakhir sampai 3x dengan jeda yang makin lama (600ms → 1.5s → 3s),
  bukan cuma sekali kayak sebelumnya.
- Ditambah "watchdog": kalau audio macet diem >10 detik tanpa progres
  (bukan cuma yang munculin error eksplisit), otomatis dianggap gagal dan
  masuk ke jalur retry yang sama.

**Kalau masih sering gagal setelah ini**, itu tandanya IP server kamu
memang lagi diblokir cukup keras sama YouTube, dan solusi paling ampuh
adalah pasang `cookies.txt`:

1. Login ke YouTube di browser kamu, lalu export cookies-nya (ekstensi
   browser "Get cookies.txt LOCALLY" biasanya paling gampang).
2. Upload file `cookies.txt` itu ke server (mis. lewat Railway Volume yang
   sudah kamu pasang buat database, taruh di `/data/cookies.txt`).
3. Set environment variable `COOKIES_FILE=/data/cookies.txt` di Railway.
4. Redeploy. Server otomatis pakai cookies itu buat semua request ke
   YouTube (search maupun stream) kalau env var-nya ke-set dan filenya ada.

⚠️ Cookies YouTube ini biasanya berumur beberapa minggu–bulan sebelum perlu
di-export ulang. Kalau tiba-tiba gagal lagi setelah lama jalan lancar,
kemungkinan besar cookies-nya udah kedaluwarsa.

### Foto Profil

User bisa ganti foto profil dari menu Profil (ikon kamera kecil di avatar).
Server otomatis crop jadi persegi + resize ke 256x256 dan simpan sebagai JPG.

- Format diterima: JPG, PNG, WEBP. Maksimal 5MB.
- Foto disimpan di folder `avatars/` **sebelahan dengan file database**
  (`DB_PATH`), jadi kalau kamu sudah pasang Railway Volume untuk database
  (lihat bagian di atas), foto profil otomatis ikut aman di volume yang sama
  — tidak perlu setup volume terpisah.
- Butuh dependency baru: `Pillow` (sudah ditambahkan ke `requirements.txt`).

## Cara kerja

1. User ketik query di search box → setelah 500ms jeda (debounce), frontend
   panggil `GET /api/search?q=...`.
2. Backend pakai `yt_dlp` dengan `ytsearch{N}:query` buat ambil daftar hasil
   dari YouTube (judul, channel, durasi, thumbnail) — tanpa download.
3. Waktu user klik salah satu hasil, frontend set `<audio>` src ke
   `/api/stream/{video_id}`.
4. Backend ekstrak URL audio langsung (`bestaudio`) via yt-dlp, lalu di-proxy
   (di-stream ulang) ke browser supaya tidak kena blokir CORS/hotlink dari
   googlevideo.com.
5. Riwayat lagu yang pernah diputar disimpan di `localStorage` browser (tab
   "Riwayat").

## Deploy ke Railway (sama seperti arvirmdn)

1. Push folder ini ke repo GitHub baru.
2. Buat project baru di Railway → Deploy from GitHub repo.
3. Railway otomatis deteksi Python. Set start command:
   ```
   uvicorn main:app --host 0.0.0.0 --port $PORT
   ```
4. Tidak perlu environment variable khusus untuk versi dasar ini.

## Catatan penting

- **Legal/ToS**: streaming audio dari YouTube lewat yt-dlp berpotensi
  melanggar Terms of Service YouTube. Ini murni implementasi teknis sesuai
  permintaanmu — pertimbangkan risiko ini sebelum dipakai publik/produksi.
- **Rate limit / blokir**: YouTube kadang membatasi request dari IP server
  cloud (termasuk Railway). Kalau `/api/stream` sering gagal, biasanya solusinya
  pakai `cookies.txt` akun YouTube di opsi yt-dlp (`cookiefile`) atau proxy
  residential — tinggal bilang kalau mau aku tambahkan.
- **Performa search**: tiap request `/api/search` memanggil yt-dlp secara
  langsung (tidak ada cache). Untuk trafik lebih besar, sebaiknya tambah
  caching (mis. Redis) supaya query yang sama tidak berulang kali hit YouTube.
- CORS dibuka untuk semua origin (`*`) — persempit ke domain frontend-mu saja
  kalau backend dipisah domainnya dari frontend saat production.
