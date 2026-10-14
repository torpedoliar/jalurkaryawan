import { z } from "zod";
import { Booking, ENDPOINTS } from "@bms/shared";
import { api } from "../../api";
import { BOOKING_STATUS_TEXT, DIRECTION_LABEL, ErrorText, hhmm, useLoad } from "../../ui";

/** Spec 6.2 riwayat: every booking, newest first. */
export function History() {
  const { data, error } = useLoad(
    () => api.get(ENDPOINTS.myBookings, z.array(Booking)).then((rows) => rows.sort((a, b) => b.departureAt.localeCompare(a.departureAt))),
    [],
  );
  return (
    <section className="card">
      <h1>Riwayat</h1>
      <ErrorText error={error} />
      {/* The header row only renders with the data, so `findAllByRole("row")` retries until the body is there. */}
      {data && (
        <table>
          <thead><tr><th>Tanggal</th><th>Jam</th><th>Rute</th><th>Arah</th><th>Titik</th><th>Status</th></tr></thead>
          <tbody>
            {data.map((b) => (
              <tr key={b.id}>
                <td>{b.date}</td><td>{hhmm(b.departureAt)}</td><td>{b.routeCode} {b.routeName}</td>
                <td>{DIRECTION_LABEL[b.direction]}</td><td>{b.stopName}</td><td>{BOOKING_STATUS_TEXT[b.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
