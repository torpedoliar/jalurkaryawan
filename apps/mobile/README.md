# Bus Karyawan (mobile)

Expo app for EMPLOYEE and DRIVER roles. Spec: `docs/superpowers/specs/2026-10-13-bus-booking-subproject-a-design.md` §6.2.
Open items before release: `docs/mobile-todo.md`.

## Run with mock API

```bash
cd apps/mobile
cp .env.example .env   # EXPO_PUBLIC_USE_MOCK=true, EXPO_PUBLIC_API_URL=http://localhost
pnpm install
pnpm test              # jest-expo + msw/node, seeded accounts K1001..K1090 / demo1234
npx expo start
```

`index.ts` starts `msw/native` with `@bms/mock-api` handlers when `EXPO_PUBLIC_USE_MOCK=true`.
Scan the QR with Expo Go, or press `a` for an emulator.

## Point at the real backend

```bash
EXPO_PUBLIC_API_URL=https://bus.perusahaan.id EXPO_PUBLIC_USE_MOCK= npx expo start
```

No other setting needed — the URL is baked at build time (spec §6.2).

## Internal APK (preview)

```bash
eas project:init   # replaces the zero projectId in app.json
eas build --profile preview --platform android
```

`eas.json` preview = `distribution: internal`, `android.buildType: apk`.
Share the QR/download link with employees; no Play Store needed.

## Manual checklist (spec §8: web & mobile get manual checks)

1. Login K1001/demo1234 → Beranda shows 14 cards (7 days × PICKUP/DROPOFF).
2. Booking Harian → tomorrow, siang, PICKUP, R2, Halte Bulak Kapal → "Sisa kursi" → Pesan → "Booking berhasil" → Beranda shows it → Batalkan → "Dibatalkan".
3. K1090/demo1234 → forced change form blocks every tab until changed.
4. K1059 → suspension banner on every tab; Pesan disabled.
5. Kill and reopen the app → session restored (SecureStore refresh rotation).
6. Airplane mode on login → "Terjadi kesalahan. Coba lagi." (network failure is not ApiFailure).

## Native scanner and GPS limitations

The local Expo Android module in `modules/datawedge` is autolinked via `expo.autolinking.nativeModulesDir`. It receives DataWedge broadcast intent output and requests a `BMS Driver` profile associated with this app, with barcode input on and keystroke output off. This is **not keyboard emulation**. Build a native APK/development client after dependency changes (`npx expo prebuild --platform android`, then a native/EAS build). Expo Go cannot load this module. Camera scanning works separately and requires permission.

On Zebra devices with supported DataWedge, allow profile configuration or provision the `BMS Driver` profile via your fleet administrator. Intent action must be `com.santosjayaabadi.bms.SCAN`, category `android.intent.category.DEFAULT`, delivery `Broadcast intent` (2), data extra `com.symbol.datawedge.data_string`. The module requests OVERWRITE for its dedicated profile and configures `intent_component_info` with this application's package for targeted output (DataWedge 8+). It requests a correlated SET_CONFIG result and rejects after 5 seconds without SUCCESS; both native emission and UI scan handling remain gated until that confirmation. Managed profiles may reject configuration; the UI then offers camera fallback. Confirm targeted-intent support on the deployed DataWedge version before rollout. The receiver is exported so DataWedge can send scans; scan contents are untrusted and must always be verified by the authenticated server. Do not put credentials in QR codes.

GPS requires foreground and background permission plus a native build; iOS background location capability and Android foreground-service/background permissions are configured through expo-location. Start is explicit, an ongoing Android foreground notification is shown, and end/logout stops the OS task. Background location is not guaranteed after force-stop, OEM battery restrictions, or revoked permissions. Denying GPS never disables the independent check-in controls. No offline check-in queue or optimistic success is provided. Network failures require server-confirmed retry.

### GPS buffering and stop policy

GPS samples are persisted as separate encrypted SecureStore records before upload. The queue is bounded to **100 samples total**, keeps stable sample IDs for server deduplication, and expires samples after **6 hours** (oldest samples are evicted at capacity). Each upload has at most 100 samples. Failed uploads retain records; retries occur on the next background location callback and every 10 seconds / app foreground while driver tracking controls are mounted. Reconnection without an OS callback or active UI does not guarantee immediate delivery; OS background execution restrictions still apply. This queue is telemetry only, not an offline attendance queue.

`Akhiri GPS` stops and discards pending telemetry for the viewed trip only. `Akhiri perjalanan dan GPS` also requests server completion; a network failure is shown and must be retried, but collection and that trip's queue remain stopped/discarded. Ending a viewed trip never stops a different trip's GPS or deletes its samples. Starting a trip checks for another active local run before contacting the server. Logout/session expiry revokes local tracking context and discards **all** pending telemetry; no queued locations are carried into another login. An upload already in flight cannot be recalled. The employee `Lihat posisi bus` view polls every 15 seconds and labels positions over 120 seconds old or failed refreshes as last-known, not live.

**Physical hardware unverified:** Zebra scanner/profile behavior, actual camera decode, background delivery, battery behavior and iOS/Android permission dialogs must be validated on target devices before release. Test a stale/forged QR, wrong bus/trip, duplicate scan, denied camera/GPS, airplane mode, logout while tracking, and force-stop/relaunch. All boarding success must come from the server response, never from a decode alone.

DataWedge: payload scanner memerlukan konfirmasi sopir sebelum request check-in. Output ditargetkan ke package aplikasi; receiver Android tetap bukan bukti kriptografis asal scan. Jangan memasang aplikasi tidak dipercaya di handheld operasional.
