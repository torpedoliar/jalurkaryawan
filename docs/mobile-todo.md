# Mobile (apps/mobile): yang masih perlu dilakukan

Per 2026-10-18. Kode Plan 3 sudah di master (sampai `abec9ce`); mock jalan, 46 test hijau.
Spec: `docs/superpowers/specs/2026-10-13-bus-booking-subproject-a-design.md` §6.2.

## 1. Menunggu data/akun dari pengguna (jangan diisi tebakan)

- [ ] **Domain API asli.** Tambah `env` ke profil `preview` di `apps/mobile/eas.json`
      supaya URL tertanam saat build (spec §6.2):
      ```json
      "preview": {
        "distribution": "internal",
        "android": { "buildType": "apk" },
        "env": { "EXPO_PUBLIC_API_URL": "https://<domain-perusahaan>", "EXPO_PUBLIC_USE_MOCK": "" }
      }
      ```
      Tanpa ini build preview jatuh ke mode mock.
- [ ] **Firebase / FCM.**
      1. Buat project Firebase, daftarkan app Android `com.santosjayaabadi.bms`.
      2. Simpan `google-services.json` di `apps/mobile/`, lalu di `app.json`:
         `"android": { "package": "com.santosjayaabadi.bms", "googleServicesFile": "./google-services.json" }`.
      3. Backend butuh kredensial service account FCM untuk mengirim push (Plan 4).
      Catatan: token FCM hanya keluar di dev build / APK preview, tidak di Expo Go.
- [ ] **EAS projectId.** Jalankan `eas init` (atau `eas project:init`) di `apps/mobile`;
      `app.json` masih `00000000-0000-0000-0000-000000000000`.
- [ ] **iOS** (hanya jika iOS jadi target): `ios.bundleIdentifier` belum ada,
      plus `GoogleService-Info.plist`. Distribusi store di luar lingkup (spec §9); jalur yang dipilih APK internal.

## 2. Celah kode

- [ ] **Notifikasi saat app di foreground tidak tampil.** Belum ada
      `Notifications.setNotificationHandler(...)` (cukup satu panggilan di `index.ts`).
- [ ] **`restoreSession` menghapus refresh token pada semua `!r.ok`** (`src/api.ts:61`),
      termasuk 503 `MAINTENANCE`. Akibatnya restore saat server sedang restore DB = karyawan harus login ulang.
      Perbaikan: hapus hanya pada 401.
- [x] **Banner pembekuan** menampilkan "Alasan: " kosong bila `suspendReason` null/kosong — kini " Alasan: …" hanya muncul bila ada alasan (sama dengan web).
- [ ] **Uji visual di perangkat**: desain "Jalur Karyawan" (font Archivo/JetBrains Mono/Inter Tight via `useFonts` di `index.ts`) belum dicek di emulator/HP; jest tidak memuat font. Mode gelap belum ada (token terang saja).
- [ ] **Tab bar ikut ter-scroll** bersama konten (masih di dalam `ScrollView`, `src/App.tsx:83`).

## 3. Verifikasi yang belum dijalankan

- [ ] Checklist manual di perangkat (`apps/mobile/README.md`, poin 1–6).
- [ ] Inset safe-area di Android asli (notch / status bar / gesture bar) di semua layar:
      login, ganti password, maintenance, tab karyawan.
- [ ] Integrasi dengan backend asli (Plan 4, spec §7 langkah 5):
      - `POST`/`DELETE /api/device-tokens` dengan body `{token, platform}` / `{token}`;
      - refresh & logout mengirim `{refreshToken}` di body JSON (spec §5.8);
      - 401 bersamaan hanya memicu satu refresh;
      - push nyata sampai ke HP (booking dibatalkan admin, pengingat, dll., spec §5.7).

## 4. Rapi-rapi kecil (tidak mendesak)

- [ ] `routes`/`shifts` di-fetch dua kali (`src/screens/Book.tsx:14-15` dan `src/screens/Subscriptions.tsx:12`).
- [ ] Parameter `label` di helper `choose` (`test/employee.test.tsx`) tidak terpakai.
- [ ] devDependency `react-test-renderer` tidak terpakai.
- [ ] README: komentar `EXPO_PUBLIC_API_URL=http://localhost` beda dengan `.env.example`;
      ada ```` ``` ```` nyasar di akhir file; belum ada catatan bahwa FCM butuh dev build, bukan Expo Go.
- [ ] Peer warning dari `expo install` (tidak memecah build): typescript >=5.8 (`@expo/metro-config`),
      jest 30 (`jest-watch-typeahead`), react-dom 18 vs react 19.

## Sudah selesai (konteks)

- `80c43b1` siklus token FCM (register saat sesi pulih dari SecureStore, body DELETE `{token}`),
  warna rute, a11y (role/selected), celah test (refresh tunggal, suspensi setelah login, batal booking harian).
- `abec9ce` bundle id `com.santosjayaabadi.bms`, `react-native-safe-area-context` di root.
- `feat/plan-3-mobile` sudah fast-forward ke master.
