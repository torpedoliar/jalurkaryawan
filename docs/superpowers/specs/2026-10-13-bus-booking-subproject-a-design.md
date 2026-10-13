# Bus Management System Karyawan — Sub-project A: Penjadwalan & Booking

Tanggal: 2026-10-13
Status: Draft, menunggu review

## 1. Konteks & Tujuan

Aplikasi transportasi bus karyawan untuk ~2.500 karyawan, ~50 bus, 3 shift (Pagi/Siang/Malam), satu lokasi pabrik/kantor. Total kapasitas ≈ jumlah karyawan, sehingga kursi bisa habis di rute padat.

Sistem dipecah menjadi tiga sub-project, dikerjakan berurutan:

| Sub-project | Isi | Status |
|---|---|---|
| **A — Penjadwalan & Booking** | Bus, vendor, rute, shift, trip, langganan, booking harian, laporan, notifikasi | **Dokumen ini** |
| B — Absensi penumpang | Scan naik bus, deteksi no-show | Nanti |
| C — Live tracking GPS + aplikasi supir | Posisi bus real-time, manifest di aplikasi supir | Nanti |

**Kriteria sukses sub-project A:**
- Admin bisa mengelola bus, vendor, rute, shift, dan jadwal trip.
- Karyawan bisa langganan dan booking harian dari HP (web responsif atau aplikasi mobile) tanpa kursi terjual dobel.
- Admin bisa melihat siapa naik trip mana dan mengekspor daftar penumpang.
- Admin dan vendor bisa melihat rute/shift mana yang kekurangan kursi.

## 2. Keputusan Utama

| Topik | Keputusan |
|---|---|
| Pengguna | Super Admin & Admin GA (web), Karyawan (web responsif + aplikasi mobile), Vendor (web, hanya baca). Supir: ditunda ke sub-project C. |
| Model booking | Langganan per periode sebagai default + booking harian untuk kursi sisa. |
| Validasi shift | Tidak ada. Karyawan bebas booking shift apa pun; admin memantau lewat laporan. |
| Login | NIK + password; data karyawan diimpor dari Excel/CSV. Skema disiapkan untuk SSO (`auth_provider`), tanpa kode SSO. |
| Struktur trip | Rute tetap. Setiap shift punya trip **jemput** (`PICKUP`) dan **antar** (`DROPOFF`) yang di-booking terpisah. |
| Kapasitas | Kuota per trip, tanpa nomor kursi. |
| Batas booking/batal | Relatif per trip, `departure_at − booking_cutoff_minutes`, default 120 menit, bisa diatur admin. |
| Trip penuh | Booking ditolak dan dicatat di `rejected_requests` (laporan kekurangan kursi). Tanpa waitlist. |
| No-show | Status `NO_SHOW` disiapkan; deteksi ada di sub-project B. Sanksi berupa pembekuan **manual oleh admin** di tingkat user. |
| Notifikasi | Disimpan di aplikasi + push FCM untuk kejadian penting dan pengingat sebelum trip. |
| Vendor | Banyak vendor; setiap bus terhubung ke satu vendor. Semua vendor melihat seluruh data (tidak difilter per vendor), hanya baca. |
| Hosting | On-premise, dapat diakses dari internet lewat HTTPS. |

## 3. Arsitektur

### 3.1 Stack

| Lapisan | Pilihan |
|---|---|
| Backend API | NestJS + Prisma |
| Database | PostgreSQL |
| Web (admin, karyawan, vendor) | React + Vite (SPA) |
| Mobile (karyawan) | React Native (Expo) |
| Shared | Paket `shared`: skema Zod, tipe, enum |
| Deploy | Docker Compose + Nginx (HTTPS, sajikan web statis, proxy `/api`) |
| Push notification | Firebase Cloud Messaging (FCM) |

### 3.2 Struktur monorepo (pnpm workspaces)

```
apps/
  api/       NestJS + Prisma (REST API, cron, FCM)
  web/       React + Vite (layar dibedakan per role)
  mobile/    Expo (khusus karyawan)
packages/
  shared/    skema Zod, tipe, enum
infra/
  docker-compose.yml   postgres, api, nginx
```

### 3.3 Modul backend

Satu modul NestJS per domain, tanpa layer repository/service tambahan.

| Modul | Tanggung jawab |
|---|---|
| `auth` | Login NIK+password, JWT access + refresh token, lockout, rate limit, wajib ganti password saat login pertama |
| `users` | Import karyawan Excel/CSV, CRUD akun admin & vendor, reset password, bekukan/cabut pembekuan booking |
| `fleet` | Vendor dan bus |
| `routes` | Rute, titik jemput berurutan, shift |
| `trips` | Template trip, generate trip harian, ganti bus, batalkan trip |
| `bookings` | Langganan, booking harian, pembatalan, batas waktu, log permintaan ditolak |
| `reports` | Keterisian, permintaan ditolak, riwayat booking (dipakai dashboard admin & vendor) |
| `notifications` | Notifikasi di aplikasi, kirim FCM, cron pengingat |
| `audit` | Log setiap perubahan oleh admin |

### 3.4 Role & hak akses

| Role | Akses |
|---|---|
| `SUPER_ADMIN` | Semua akses Admin GA + pengaturan sistem + CRUD akun admin |
| `ADMIN_GA` | Operasional: karyawan, vendor, bus, rute, shift, template, trip, laporan, audit log, pembekuan |
| `EMPLOYEE` | Booking/langganan miliknya sendiri, notifikasi, ganti password |
| `VENDOR` | Hanya baca: dashboard keterisian dan permintaan ditolak |

Hak akses ditegakkan dengan guard role di setiap endpoint.

### 3.5 Job terjadwal

Menggunakan `@nestjs/schedule` di dalam proses API, tanpa Redis atau queue.

| Job | Jadwal | Tugas |
|---|---|---|
| Generate trip | Tiap malam + saat API start | Buat trip dan booking langganan sampai H+`generate_days_ahead` |
| Pengingat | Tiap 5 menit | Kirim pengingat untuk booking yang berangkat dalam `reminder_minutes` |

> ponytail: satu proses API dan satu PostgreSQL. Tambah Redis/queue atau API multi-instance hanya jika cron mulai berat atau beban melebihi satu server. Kalau API dijalankan lebih dari satu instance, cron harus dipindah ke satu instance saja atau diberi advisory lock.

## 4. Model Data

Semua waktu disimpan sebagai `timestamptz`; zona waktu bisnis Asia/Jakarta. Jadwal trip disimpan sebagai `departure_at` (tanggal + jam lengkap) supaya shift malam yang melewati tengah malam tetap benar. Kolom `date` pada trip adalah **tanggal operasional** (tanggal shift dimulai).

### 4.1 Master data

**`users`**
- `id`, `nik` (unique), `name`, `department`, `phone`
- `role` (`SUPER_ADMIN`/`ADMIN_GA`/`EMPLOYEE`/`VENDOR`)
- `password_hash` (nullable), `auth_provider` (`LOCAL`/`SSO`, default `LOCAL`)
- `must_change_password`, `failed_login_count`, `locked_until`
- `booking_suspended_until` (date, nullable), `suspend_reason` (nullable)
- `vendor_id` (nullable, hanya untuk role `VENDOR`)
- `active`, `created_at`, `updated_at`

Akun vendor dan admin login memakai kolom `nik` sebagai username.

**`refresh_tokens`**: `user_id`, `token_hash`, `expires_at`, `revoked_at`

**`vendors`**: `name`, `contact`, `active`

**`buses`**: `plate` (unique), `capacity`, `vendor_id`, `active`

**`shifts`**: `name`, `start_time`, `end_time` (jam lokal; `end_time < start_time` berarti melewati tengah malam)

**`routes`**: `code` (unique), `name`, `active`

**`route_stops`**: `route_id`, `seq`, `name`, `offset_minutes`, `lat`/`lng` (nullable, untuk GPS nanti), `active`. Unique `(route_id, seq)`.
- Untuk trip `PICKUP`, jam jemput di titik = `departure_at + offset_minutes`.
- Untuk trip `DROPOFF`, urutan titik dibalik dan perkiraan jam tiba = `departure_at + (offset_terakhir − offset_minutes)`.

**`settings`**: `key`, `value`. Nilai awal:
- `booking_cutoff_minutes` = 120
- `reminder_minutes` = 60
- `generate_days_ahead` = 7

### 4.2 Jadwal & trip

**`trip_templates`**: jadwal tetap yang dipakai cron untuk generate trip.
- `route_id`, `shift_id`, `direction` (`PICKUP`/`DROPOFF`), `bus_id`
- `departure_time` (jam lokal), `day_offset` (0 atau 1; 1 berarti berangkat keesokan hari dari tanggal operasional, misalnya antar shift malam)
- `weekdays` (array 1–7), `active`

**`trips`**
- `template_id`, `route_id`, `shift_id`, `direction`, `date`, `departure_at`
- `bus_id`, `capacity`, `booked_count` (default 0)
- `status` (`SCHEDULED`/`CANCELLED`)
- Unique `(template_id, date)`
- `CHECK (booked_count >= 0 AND booked_count <= capacity)`
- Index `(route_id, shift_id, direction, date)`

Satu trip = satu bus. Satu kombinasi rute + shift + arah + tanggal boleh punya beberapa trip (rute padat dengan lebih dari satu bus).

### 4.3 Booking

**`subscriptions`**
- `user_id`, `route_id`, `stop_id`, `shift_id`, `direction`
- `start_date`, `end_date` (nullable = tanpa batas), `weekdays` (array 1–7)
- `status` (`ACTIVE`/`ENDED`), `created_at`

**`bookings`**
- `user_id`, `trip_id`, `stop_id`, `subscription_id` (nullable)
- Denormalisasi untuk pengecekan bentrok: `date`, `shift_id`, `direction`
- `source` (`SUBSCRIPTION`/`DAILY`)
- `status` (`BOOKED`/`CANCELLED`/`NO_SHOW`)
- `cancelled_at`, `reminder_sent_at`, `created_at`
- `cancel_reason` (nullable): `USER` (dibatalkan karyawan), `ADMIN_TRIP` (trip dibatalkan admin), `SUSPENDED` (user dibekukan), `SUBSCRIPTION_ENDED`, `USER_DEACTIVATED`
- Partial unique index `(user_id, date, shift_id, direction) WHERE status = 'BOOKED'`. Ini menegakkan aturan bentrok dan otomatis mencegah booking dobel di trip yang sama.

**`rejected_requests`**: sumber laporan kekurangan kursi.
- `user_id`, `route_id`, `shift_id`, `direction`, `date`, `source`, `subscription_id` (nullable), `created_at`

### 4.4 Pendukung

- **`notifications`**: `user_id`, `type`, `title`, `body`, `data` (JSON), `read_at`, `created_at`
- **`device_tokens`**: `user_id`, `token` (unique), `platform`, `updated_at`
- **`audit_logs`**: `actor_id`, `action`, `entity`, `entity_id`, `before` (JSON), `after` (JSON), `created_at`

## 5. Alur & Aturan Bisnis

### 5.1 Alokasi kursi (inti, mencegah kursi dobel)

Dijalankan dalam satu transaksi database untuk setiap booking (harian maupun langganan):

1. Validasi: user aktif, `booking_suspended_until` kosong atau sudah lewat, dan `stop_id` milik rute tersebut serta aktif.
2. Ambil daftar trip `SCHEDULED` untuk rute + shift + arah + tanggal yang **belum lewat cutoff** (`now < departure_at − cutoff`), urut berdasarkan `departure_at`, lalu `id`. Jika trip ada tetapi semuanya sudah lewat cutoff, kembalikan `CUTOFF_PASSED` tanpa mencatat `rejected_requests`. (Generate langganan oleh cron melewati filter cutoff ini.)
3. Untuk setiap trip, jalankan:
   ```sql
   UPDATE trips SET booked_count = booked_count + 1
   WHERE id = $1 AND status = 'SCHEDULED' AND booked_count < capacity
   ```
   Jika ada baris yang ter-update, buat baris `bookings` dan berhenti.
4. Jika semua trip gagal, insert `rejected_requests` dan kembalikan error `TRIP_FULL`. Insert ini di-commit walaupun booking gagal.
5. Jika insert `bookings` melanggar partial unique index, transaksi di-rollback dan dikembalikan `SCHEDULE_CONFLICT`.

Tidak perlu `SELECT ... FOR UPDATE`; update bersyarat yang atomik sudah cukup mencegah overbooking.

### 5.2 Generate trip & booking langganan

Dijalankan oleh cron malam dan saat API start, untuk setiap tanggal dari hari ini sampai H+`generate_days_ahead`. Satu transaksi per tanggal:

1. Untuk setiap `trip_templates` aktif yang `weekdays`-nya mencakup tanggal itu, insert trip dengan `ON CONFLICT (template_id, date) DO NOTHING`. Kapasitas diambil dari bus template. Job ini idempoten dan otomatis mengejar tanggal yang terlewat jika server sempat mati.
2. Untuk setiap langganan `ACTIVE` yang mencakup tanggal itu (rentang tanggal + `weekdays`), urut berdasarkan `subscriptions.created_at`:
   - Lewati jika user dibekukan pada tanggal itu.
   - Lewati jika user sudah punya booking `BOOKED` di tanggal + shift + arah itu (dari langganan ini maupun booking harian).
   - Lewati jika booking dari langganan ini untuk tanggal itu pernah dibatalkan dengan `cancel_reason` `USER` (karyawan membatalkan hari itu) atau `ADMIN_TRIP` (trip dibatalkan admin). Booking yang batal karena `SUSPENDED` **dibuat ulang** setelah pembekuan dicabut.
   - Lewati jika sudah ada `rejected_requests` untuk langganan ini di tanggal itu, supaya penolakan dan notifikasinya tidak berulang setiap malam. Karyawan yang ditolak tetap bisa mencoba booking harian.
   - Jalankan alokasi kursi (5.1) tanpa pengecekan cutoff. Jika penuh, catat `rejected_requests` (source `SUBSCRIPTION`) dan kirim notifikasi "Langganan tanggal X tidak kebagian kursi".

Karena trip dan booking langganan untuk satu tanggal dibuat dalam transaksi yang sama, pelanggan langganan selalu mendapat kursi lebih dulu sebelum trip bisa dipesan lewat booking harian.

### 5.3 Langganan

- **Buat:** karyawan memilih rute, titik jemput, shift, arah, rentang tanggal, dan hari dalam seminggu. Booking untuk tanggal yang tripnya sudah ada langsung dibuat lewat 5.1 (dengan cek cutoff; tanggal yang sudah lewat cutoff dilewati). Tanggal berikutnya dibuat oleh cron.
- **Akhiri:** `end_date` = hari ini, `status` = `ENDED`, lalu semua booking dari langganan ini yang belum lewat cutoff dibatalkan.
- Satu karyawan boleh punya beberapa langganan, misalnya jemput dan antar. Bentrok antar-langganan ditolak saat dibuat jika rentang tanggal, hari, shift, dan arahnya tumpang tindih.

### 5.4 Booking harian

- Hanya untuk trip yang sudah di-generate (sampai H+7) dan belum lewat cutoff.
- Karyawan memilih tanggal, shift, arah, rute, dan titik jemput. Layar menampilkan sisa kursi = total `capacity − booked_count` dari semua trip di kombinasi tersebut.
- Dialokasikan lewat 5.1.

### 5.5 Pembatalan oleh karyawan

- Hanya sebelum `departure_at − cutoff`.
- Status jadi `CANCELLED` dan `booked_count` dikurangi 1 dalam satu transaksi, sehingga kursi langsung tersedia untuk booking harian.
- Membatalkan booking dari langganan hanya berlaku untuk hari itu; langganan tetap `ACTIVE`.
- Mengganti titik jemput atau rute = batalkan lalu booking ulang. Tidak ada endpoint "ubah booking" terpisah. Untuk langganan: akhiri, lalu buat langganan baru.
- Perubahan detail langganan (rute, titik, hari) tidak didukung; akhiri dan buat baru.

### 5.6 Aksi admin

| Aksi | Efek |
|---|---|
| Ganti bus di trip | `capacity` = kapasitas bus baru. Ditolak dengan `CAPACITY_BELOW_BOOKED` jika lebih kecil dari `booked_count`. Penumpang mendapat notifikasi. |
| Ubah template (bus, jam, hari) | Diterapkan juga ke trip `SCHEDULED` yang sudah di-generate dan belum berangkat. Jika ada trip yang tidak muat, seluruh perubahan dibatalkan dan error menyebutkan trip mana. Penumpang trip yang terdampak mendapat notifikasi. |
| Tambah template (misalnya bus baru di rute padat) | Trip untuk tanggal yang sudah berjalan langsung di-generate, sehingga kapasitas langsung bertambah. |
| Nonaktifkan template | Tidak membuat trip baru. Trip yang sudah ada dibatalkan lewat aksi "batalkan trip" secara eksplisit. |
| Batalkan trip / semua trip di satu tanggal (libur) | Status `CANCELLED`, semua booking di dalamnya dibatalkan (`cancel_reason` = pembatalan oleh admin), penumpang mendapat notifikasi. Tidak ada pemindahan otomatis. |
| Bekukan user | Set `booking_suspended_until` dan `suspend_reason`. Semua booking user itu yang belum lewat cutoff dibatalkan. Booking harian baru ditolak (`USER_SUSPENDED`), dan cron tidak membuatkan booking dari langganannya selama dibekukan. Langganan tidak berubah dan otomatis jalan lagi setelah masa pembekuan selesai. User mendapat notifikasi. |
| Cabut pembekuan | `booking_suspended_until` = null. Booking langganan untuk tanggal yang sudah di-generate langsung dibuat ulang (dengan cek cutoff). User mendapat notifikasi. |
| Ubah kapasitas bus | Diterapkan ke trip `SCHEDULED` bus itu yang belum berangkat. Ditolak dengan `CAPACITY_BELOW_BOOKED` jika ada trip yang tidak muat, dan error menyebutkan trip mana. |
| Nonaktifkan bus / rute | Ditolak jika masih dipakai template aktif atau trip `SCHEDULED` yang belum berangkat. Admin harus memindahkan atau membatalkannya dulu. |
| Nonaktifkan titik jemput | Ditolak jika masih dipakai langganan `ACTIVE` atau booking `BOOKED` ke depan. Titik jemput tidak pernah dihapus permanen supaya riwayat tetap utuh. |
| Nonaktifkan karyawan | `active` = false, semua booking ke depan dibatalkan (`USER_DEACTIVATED`, tanpa cek cutoff), langganan di-`ENDED`, semua refresh token dicabut. |

Pembekuan **hanya dilakukan admin secara manual**. Sistem tidak membekukan user secara otomatis. Semua aksi admin dicatat di `audit_logs`.

### 5.7 Notifikasi

- Setiap notifikasi disimpan dulu di `notifications`, lalu dikirim lewat FCM ke semua `device_tokens` milik user.
- Jika FCM gagal, cukup dicatat di log tanpa retry. Token yang dinyatakan tidak valid oleh FCM dihapus.
- Jenis notifikasi: trip dibatalkan, ganti bus/jadwal, booking dibatalkan admin, langganan tidak kebagian kursi, dibekukan/pembekuan dicabut, pengingat sebelum berangkat.
- **Pengingat:** cron tiap 5 menit memilih booking `BOOKED` dengan `departure_at` dalam `reminder_minutes` ke depan dan `reminder_sent_at` masih null. Setelah dikirim, `reminder_sent_at` diisi.
- Web membaca notifikasi dari tabel; mobile menerima push dan juga membaca tabel.

### 5.8 Autentikasi & keamanan

- Password di-hash dengan argon2 atau bcrypt.
- Import karyawan menghasilkan password awal acak, `must_change_password` = true. Admin mengunduh daftar password awal sekali saat import. Endpoint selain ganti password ditolak sampai password diganti.
- Lockout: 5 kali gagal login membuat akun terkunci 15 menit. Rate limit per IP di endpoint login.
- Access token JWT berlaku 15 menit. Refresh token berlaku 30 hari, disimpan dalam bentuk hash, dirotasi setiap dipakai, dan dicabut saat logout atau reset password.
- Web menyimpan refresh token di cookie httpOnly + Secure + SameSite=Strict. Mobile menyimpannya di `expo-secure-store`.
- Wajib HTTPS (Nginx). CORS hanya untuk origin web.
- Reset password oleh admin menghasilkan password sementara acak (ditampilkan sekali ke admin), `must_change_password` = true, dan semua refresh token user dicabut. Tidak ada fitur "lupa password" mandiri di sub-project A; karyawan menghubungi admin.
- User dengan `auth_provider = SSO` tidak bisa login dengan password. Integrasi SSO tidak dibangun di sub-project A.

### 5.9 Import karyawan

- Upload Excel/CSV dengan kolom: NIK, nama, departemen, no. HP.
- Server mem-parsing dan memvalidasi data, lalu menampilkan preview: baris baru, baris yang diperbarui (berdasarkan NIK), dan baris error beserta alasannya.
- Admin mengonfirmasi, lalu data disimpan dalam satu transaksi.
- Karyawan yang tidak ada di file **tidak** dinonaktifkan otomatis. Penonaktifan dilakukan manual.

### 5.10 Format error API

Format `{ "code": string, "message": string }`, pesan dalam bahasa Indonesia dan ditampilkan langsung di web/mobile.

| Code | Arti |
|---|---|
| `TRIP_FULL` | Semua trip di kombinasi itu penuh |
| `CUTOFF_PASSED` | Sudah lewat batas waktu booking/pembatalan |
| `SCHEDULE_CONFLICT` | Sudah punya booking di tanggal + shift + arah yang sama |
| `USER_SUSPENDED` | Booking user sedang dibekukan |
| `CAPACITY_BELOW_BOOKED` | Kapasitas baru lebih kecil dari jumlah booking |
| `VALIDATION_ERROR` | Input tidak valid |
| `UNAUTHORIZED` / `FORBIDDEN` | Belum login / tidak punya akses |
| `ACCOUNT_LOCKED` | Akun terkunci karena terlalu banyak gagal login |

### 5.11 Operasional & data

- **Zona waktu:** server dan container memakai `TZ=Asia/Jakarta`; semua konversi jam lokal ke `departure_at` dilakukan di satu helper waktu yang di-unit-test.
- **Backup:** `pg_dump` harian lewat cron di host ke folder lokal server (`/backups`), disimpan 14 hari. Setelah dump, file disalin ke **network share** (path diatur lewat `.env`, misalnya mount SMB/CIFS). Jika salin ke network share gagal, dicatat di log dan tampil sebagai peringatan di dashboard Super Admin. Super Admin juga bisa **mengunduh** file backup dari layar Pengaturan (daftar file backup lokal + tombol download; folder `/backups` di-mount read-only ke container API). Prosedur restore diuji minimal sekali sebelum go-live.
- **Logging:** log aplikasi JSON ke stdout (dikumpulkan Docker, rotasi via `json-file` max-size). Endpoint `GET /api/health` untuk cek API + koneksi DB.
- **Retensi:** data booking, trip, dan audit log disimpan tanpa penghapusan otomatis di sub-project A (≈300 trip/hari, ≈5.000 booking/hari, aman untuk PostgreSQL bertahun-tahun). Notifikasi yang sudah dibaca dan lebih dari 90 hari dihapus oleh cron malam.
- **Migrasi DB:** `prisma migrate deploy` dijalankan saat container API start.
- **Konfigurasi rahasia** (JWT secret, kredensial DB, service account FCM) lewat file `.env` di server, tidak masuk git.

## 6. Layar per Role

### 6.1 Admin (web)

| Layar | Isi |
|---|---|
| Dashboard | Keterisian trip hari ini dan besok, trip penuh, jumlah booking ditolak |
| Karyawan | Import Excel/CSV dengan preview, daftar + pencarian, reset password, bekukan/cabut pembekuan, nonaktifkan |
| Vendor & Bus | CRUD vendor, CRUD bus, CRUD akun vendor |
| Rute | CRUD rute dan titik jemput berurutan (drag untuk ubah urutan, offset menit) |
| Shift & Template | Jam shift; template per rute + shift + arah (bus, jam berangkat, `day_offset`, hari) |
| Trip harian | Filter tanggal/rute/shift; ganti bus; batalkan trip atau satu tanggal; daftar penumpang per trip + export Excel |
| Laporan | Keterisian per rute/shift/tanggal, permintaan ditolak, riwayat booking per karyawan; semua bisa diekspor ke Excel |
| Audit log | Filter berdasarkan admin, aksi, tanggal |
| Pengaturan & Admin user | Khusus `SUPER_ADMIN`: cutoff, pengingat, jumlah hari generate, CRUD akun admin, daftar & unduh file backup, status salinan ke network share |

### 6.2 Karyawan (web responsif + Expo, fitur sama)

- Login; ganti password wajib saat login pertama
- Beranda: booking 7 hari ke depan (rute, titik jemput, jam jemput, plat bus) dengan tombol batal yang hilang setelah cutoff
- Booking harian: pilih tanggal → shift → arah → rute → titik jemput, tampilkan sisa kursi
- Langganan saya: buat, lihat, akhiri
- Riwayat booking dan notifikasi
- Banner jika booking sedang dibekukan (sampai tanggal berapa dan alasannya)
- Mobile mendaftarkan token FCM setelah login dan menghapusnya saat logout

### 6.3 Vendor (web, hanya baca)

- Satu dashboard: keterisian per rute/shift/tanggal (kuota, terisi, persentase), rute yang sering penuh, permintaan ditolak. Bisa diekspor ke Excel.
- Semua vendor melihat seluruh data.

## 7. Urutan Implementasi: Frontend Dulu

Seluruh frontend (web admin/karyawan/vendor + aplikasi mobile karyawan) dibangun lebih dulu, baru backend.

1. **Kontrak API di `packages/shared`.** Sebelum UI, tulis skema Zod untuk setiap request/response, enum, kode error (5.10), dan daftar endpoint. Ini satu-satunya sumber kebenaran untuk frontend dan backend.
2. **Mock API dengan MSW** (`msw` di browser untuk web, `msw/native` untuk Expo). Handler mock tinggal di `packages/mock-api`, memakai data in-memory hasil seed dan meniru aturan bisnis penting (kuota penuh, cutoff, bentrok, dibekukan, role) supaya semua state UI (sukses, error, kosong, loading) bisa dicoba.
3. **Frontend web lalu mobile**, dipanggil lewat satu API client tipis yang memvalidasi response dengan skema Zod. Mock aktif lewat env `VITE_USE_MOCK=true` / `EXPO_PUBLIC_USE_MOCK=true`.
4. **Backend NestJS** mengimplementasikan kontrak yang sama. Integration test backend memastikan response lolos skema Zod dari `shared`.
5. **Integrasi:** matikan mock, arahkan frontend ke API asli, jalankan smoke test Playwright.

Risiko: aturan bisnis di mock bisa menyimpang dari backend asli. Mitigasinya, mock hanya meniru perilaku yang tercantum di spec ini, dan backend adalah sumber kebenaran; selisih ditemukan saat langkah 5 dan diperbaiki di backend atau kontrak.

## 8. Testing

**Integration test API terhadap PostgreSQL asli** (container Docker, tanpa mock DB), dengan fokus pada logika berisiko:
- Rebutan kursi: 100 booking bersamaan ke total kapasitas 50 harus menghasilkan tepat 50 sukses, 50 `TRIP_FULL`, 50 baris `rejected_requests`, dan `booked_count` = 50.
- Penempatan ke bus kedua saat bus pertama penuh.
- Cutoff booking dan pembatalan; bentrok tanggal + shift + arah; user dibekukan ditolak.
- Generate trip idempoten (dijalankan dua kali hasilnya sama); prioritas langganan berdasarkan `created_at`; pembatalan per hari tidak dibuat ulang oleh cron.
- Ganti bus / ubah template ditolak jika kapasitas < booking.
- Pembekuan membatalkan booking ke depan dan cron melewati langganannya; setelah dicabut, booking dibuat lagi.
- Cron tidak membuat ulang booking langganan yang dibatalkan karyawan, dan tidak mengirim notifikasi "tidak kebagian kursi" dua kali untuk tanggal yang sama.
- Booking harian ke kombinasi yang semua tripnya lewat cutoff mengembalikan `CUTOFF_PASSED`, bukan `TRIP_FULL`.
- Nonaktifkan karyawan membatalkan booking ke depan dan mengakhiri langganannya.
- Login lockout; guard role (vendor tidak bisa menulis, karyawan tidak bisa mengakses data karyawan lain).

**Unit test:** perhitungan waktu (shift malam melewati tengah malam, `day_offset`, cutoff, jam jemput per titik) dan parser import Excel/CSV.

**Web & mobile:** pengecekan manual + satu smoke test Playwright untuk alur login → booking harian → batal.

**Seed script:** data contoh realistis (50 bus, beberapa vendor, 3 shift, ~20 rute, 2.500 karyawan dummy) untuk demo dan uji beban sederhana.

## 9. Di Luar Lingkup Sub-project A

- Absensi naik bus dan deteksi no-show otomatis (sub-project B)
- Live tracking GPS dan aplikasi supir (sub-project C)
- Integrasi SSO (skema sudah disiapkan)
- Waitlist dan pemindahan otomatis penumpang saat trip dibatalkan
- Notifikasi otomatis ke karyawan yang ditolak saat ada bus baru
- Pemilihan nomor kursi
- Optimasi/rute dinamis
- Notifikasi WhatsApp/SMS
- Multi-lokasi/multi-site
- Pembekuan otomatis oleh sistem
- Lupa password mandiri (reset lewat admin)
- Ubah booking/langganan di tempat (cukup batal lalu buat baru)
- Distribusi aplikasi mobile ke Play Store/App Store (cara distribusi: APK internal atau store, diputuskan saat implementasi mobile)
