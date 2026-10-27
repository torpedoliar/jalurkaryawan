# Karawang local application DEMO

This is an **additive synthetic fixture for the actual Prisma-backed dev app**, not the mock API. Do not run the destructive `prisma/seed.ts` to install it. No package script changes are needed.

## Safety and review

Review `apps/api/prisma/demo-karawang.ts` before applying. It has not been executed by its author. Default mode is an offline plan: it never opens a database connection. Writes require `--apply` and a PostgreSQL `DATABASE_URL` with database exactly `bms_dev`, host `localhost`, `127.0.0.1`, or `::1`, and no query/fragment. A localhost check is not proof of container identity: the operator must verify the port belongs to **bms-local-dev only**, never production or tests. Current local startup port is expected to be 5497; confirm rather than assume.

From the repository root, first run the offline plan:

```powershell
pnpm --filter @bms/api exec tsx prisma/demo-karawang.ts
```

For apply, use the existing local startup environment from `scripts/start.ps1` (including its `DATABASE_URL` and `.local/app-secret`; never print or commit either). Inspect only the local dev container's published port, for example by obtaining its ID with `docker compose -p bms-local-dev -f scripts/compose.dev.yml ps -q postgres` **using the actual compose filename referenced by the startup script**, then `docker inspect --format '{{json .NetworkSettings.Ports}}' <local-dev-container-id>`. Do not inspect unrelated containers or use production/test environments. The fixture needs DATABASE_URL only; the running app retains its existing APP_SECRET, and QR credentials are generated lazily by the app, not fabricated here.

After main/operator review, in that verified local environment:

```powershell
pnpm --filter @bms/api exec tsx prisma/demo-karawang.ts --apply
```

Do not paste database credentials into logs or shared shell transcripts. The script suppresses raw exception objects because Prisma errors may contain sensitive connection information.

## Dataset

Internal IDs retain `demo-karawang-` as provenance. Visible names use fictional Indonesian full names and fictional vendors (PT. Lintas Wahana Karawang and PT. Mitra Jelajah Mandiri), with illustrative Karawang-style `T` plates, so presentation labels carry no DEMO marker. Any resemblance to real people, companies or registered vehicles is coincidental; these labels are not verified identities. Driver login NIKs were refreshed with the same allowlisted presentation update and collision check.

Routes are `KRW-01` **Telukjambe → PT. Santos Jaya Abadi — Surya Cipta** and `KRW-02` **Klari–Kosambi → PT. Santos Jaya Abadi — Surya Cipta**. The destination is an illustrative label, not a verified company location or affiliation. Stops use actual area names with approximate coordinates only. All stops/GPS are illustrative Karawang-area coordinates, limited to Telukjambe, Klari, Kosambi, Karawang Barat and Karawang Timur. These are not verified gates, surveyed stops, real employees, real vehicles, real vendors, real driver identities, or actual company shift/transport schedules.

Planned initial maximum counts:

| Entity | Count |
| --- | ---: |
| Vendors / buses / drivers | 2 / 4 / 4 |
| Employees | 24 |
| Routes / stops / shifts | 2 / 7 / 3 |
| Templates / trips / assigned operations | 12 / 108 / 108 |
| Subscriptions / bookings / notifications | 24 / 432 / 24 |
| GPS samples | 6 |
| Synthetic attendance (depending on time of day) | up to 24 |

Trips cover **today through today + 8 days inclusive**, using Asia/Jakarta operational dates. Synthetic shifts are 07:00–15:00, 15:00–23:00 and 23:00–07:00; pickup starts 70 minutes before the shift and reaches the factory after 50 minutes. Dropoff leaves 10 minutes after shift end; overnight dropoff uses dayOffset 1. Two buses/drivers per route separate pickup and dropoff. Drivers belong to the vendor of their assigned bus. Half the employees have bounded subscriptions; half have daily bookings, in both directions. Up to 24 explicitly synthetic attendance rows are inserted for today's demo pickup bookings, only once the planned pickup stop time has passed (never future check-ins). These are fixture history, not evidence of actual travel. Today's morning pickup on each route has three static GPS samples for a populated tracking map; execution remains NOT_STARTED (no false live journey). Positions age out after 24h as usual; rerunning the same date does not refresh samples or make them live.

## Demo-only login

- Employee NIKs are **strings with leading zeroes**, `00012345` through `00012368` (first login: `00012345`).
- Driver NIKs: `00022345`–`00022348`, same public demo password.
- New synthetic accounts only use public password `KarawangDemo2026!` and no forced-change prompt, for local demonstrations.
- This password is **not a real credential**. Change it and enforce password changes before any real use. Never reuse it outside isolated local development.
- Use the existing admin account; this fixture neither creates an admin nor changes any admin password, settings or APP_SECRET. It creates no vendor login; existing admins can manage the synthetic vendors.

## Rerun and conflicts

By default, existing rows retain empty upsert updates, preserving passwords, user edits, cancellations, operation state and existing GPS. To opt in to refreshing existing fixture presentation labels, after reviewing the offline plan use **both** flags in the verified local environment:

```powershell
# Offline preview only; still no database connection
pnpm --filter @bms/api exec tsx prisma/demo-karawang.ts --refresh-labels
# Explicit write authorization, only after operator review
pnpm --filter @bms/api exec tsx prisma/demo-karawang.ts --apply --refresh-labels
```

The refresh allowlist is vendor `name/contact` (contact becomes blank, not a fabricated contact), bus `plate`, user `name/department` (drivers: name only), shift `name`, route `code/name`, stop `name`, and notification `title/body`. Updates target only explicit `demo-karawang-` IDs. Stop coordinates remain approximate and are not refreshed. Login NIKs, passwords, roles, admin accounts, relationships, notification metadata/read status, settings, bookings, trip state, operations and GPS are never updated by the label refresh. It does not reset or delete data. This option accompanies the normal additive fixture application: missing rows may still be created, and the usual booking/attendance insertion rules below still apply; it is not a labels-only installation mode.

Only insertion of a new booking increments the corresponding locked trip's bookedCount. A transaction and fixture advisory lock prevent partial installation/concurrent fixture runs. Existing active bookings for the same employee/date/shift/direction are skipped; full/cancelled trips are skipped. No delete/reset/cleanup is included.

A foreign record with one of the padded NIKs aborts the whole transaction rather than adopting or modifying that employee. Other unique collisions (plate/code/stop sequence) likewise fail atomically. Trips are resolved by the schema's unique `(templateId, date)` constraint: a scheduler-created trip with a generated ID is reused only for the exact explicit demo template/date, with matching demo route/shift/direction/bus. Bookings, operations, GPS and attendance reference that actual trip ID. Trips belonging to other templates are never adopted. Inspect conflicts manually; **never delete real data to make the fixture fit**. Reruns on later dates add the new date horizon but do not extend existing subscriptions or reset past states; counts printed are planned maxima, not database-diff counts. Run with the local scheduler paused when installing if it could concurrently generate the new templates. Resume it after installation and review.

## Hasil pengisian lokal

Dataset diterapkan dan diuji ulang tanpa duplikasi pada database development `bms_dev` milik container `bms-local-dev-postgres-1` (port lokal 5497), tanggal 27 Oktober 2026. Hasil: 24 karyawan (`00012345`–`00012368`), 4 sopir, 2 vendor, 4 bus, 2 rute, 7 titik, 108 trip, 432 booking, 8 attendance historis simulasi dan 6 sampel GPS. Label tampilan sudah diperbarui: plat `T 7142 KA`–`T 7468 KD`, rute `KRW-01`/`KRW-02`, sopir `00022345`–`00022348`. Akun admin yang sudah ada dipertahankan. Tidak ada database produksi/test yang diisi.
