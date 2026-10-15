import { NavLink, Outlet } from "react-router-dom";
import { useAuth, useMe } from "../auth";
import type { Page } from "../pages";
import { today } from "../ui";

export function Layout({ pages }: { pages: Page[] }) {
  const me = useMe();
  const { signOut } = useAuth();
  const suspended = me.bookingSuspendedUntil !== null && me.bookingSuspendedUntil >= today();
  return (
    <div className="app">
      <nav>
        <strong>{me.name}</strong>
        {pages.map((p) => <NavLink key={p.path} to={p.path}>{p.label}</NavLink>)}
        <button onClick={() => void signOut()}>Keluar</button>
      </nav>
      <main>
        {suspended && (
          <div className="banner" role="status">
            Booking kamu dibekukan sampai {me.bookingSuspendedUntil}. Alasan: {me.suspendReason}
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}
