import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth, useMe } from "../auth";
import { GROUPS, type Page } from "../pages";
import { Icon, PAGE_ICON } from "../icons";
import { today } from "../ui";

const ROLE_LABEL: Record<string, string> = { SUPER_ADMIN: "Super Admin", ADMIN_GA: "Admin GA", VENDOR: "Vendor", EMPLOYEE: "Karyawan", DRIVER: "Sopir" };

export function Layout({ pages }: { pages: Page[] }) {
  const me = useMe();
  const { signOut } = useAuth();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  const suspended = me.bookingSuspendedUntil !== null && me.bookingSuspendedUntil >= today();
  const sections = GROUPS.map((g) => ({ group: g, items: pages.filter((p) => p.group === g) })).filter((s) => s.items.length > 0);
  return (
    <div className="app">
      <aside className={open ? "side open" : "side"}>
        <div className="side-top">
          <div className="brand">Jalur <span>Karyawan</span></div>
          <button className="menu-toggle" aria-expanded={open} aria-controls="main-nav" onClick={() => setOpen((o) => !o)}>
            {open ? "Tutup" : "Menu"}
          </button>
        </div>
        <div className="who">
          <span className="avatar" aria-hidden="true">{me.name.slice(0, 1).toUpperCase()}</span>
          <div><strong>{me.name}</strong><span className="eyebrow">{ROLE_LABEL[me.role] ?? me.role} · {me.nik}</span></div>
        </div>
        <nav id="main-nav">
          {sections.map((s) => (
            <div key={s.group} className="nav-group" data-group={s.group}>
              <span className="nav-label">{s.group}</span>
              {s.items.map((p) => <NavLink key={p.path} to={p.path}>{PAGE_ICON[p.path] && <Icon name={PAGE_ICON[p.path]!} />}<span>{p.label}</span></NavLink>)}
            </div>
          ))}
        </nav>
        <figure className="side-quote">
          <blockquote>Perjalanan Nyaman, Kerja Tenang.</blockquote>
          <figcaption><b>JALUR</b> — Jemput Antar Layanan untuk Rutinitas Karyawan</figcaption>
        </figure>
        <button className="signout" onClick={() => void signOut()}>Keluar</button>
      </aside>
      <main>
        {suspended && (
          <div className="banner" role="status">
            Booking kamu dibekukan sampai {me.bookingSuspendedUntil}.{me.suspendReason ? ` Alasan: ${me.suspendReason}` : ""}
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}
