import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { ENDPOINTS, SetupStatus, type Me } from "@bms/shared";
import { api, apiEvents, loadSession, logout } from "./api";
import { AuthContext } from "./auth";
import { Layout } from "./layout/Layout";
import { LANDING, PAGES } from "./pages";
import { ChangePassword } from "./pages/ChangePassword";
import { Login } from "./pages/Login";
import { Maintenance } from "./pages/Maintenance";
import { Setup } from "./pages/Setup";

type Boot = "loading" | "setup" | "ready";

export function App() {
  const [boot, setBoot] = useState<Boot>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [maintenance, setMaintenance] = useState(false);
  const [bootKey, setBootKey] = useState(0);

  useEffect(() => {
    apiEvents.maintenance = () => setMaintenance(true);
    apiEvents.loggedOut = () => setMe(null);
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const { needsSetup } = await api.get(ENDPOINTS.setupStatus, SetupStatus);
      if (needsSetup) return live && setBoot("setup");
      const m = await loadSession();
      if (live) { setMe(m); setBoot("ready"); }
    })().catch(() => { if (live) setBoot("ready"); }); // MAINTENANCE already flipped the flag; anything else lands on Login
    return () => { live = false; };
  }, [bootKey]);

  // Restore ends every session (spec 5.11): re-run boot, which lands on Login.
  const back = useCallback(() => { setMaintenance(false); setBootKey((k) => k + 1); }, []);
  const signOut = useCallback(async () => { await logout(); setMe(null); }, []);

  if (maintenance) return <Maintenance onDone={back} />;
  if (boot === "loading") return <div className="center">Memuat…</div>;
  if (boot === "setup") return <AuthContext.Provider value={{ me, setMe, signOut }}><Setup onDone={(m) => { setMe(m); setBoot("ready"); }} /></AuthContext.Provider>;

  const pages = me ? PAGES.filter((p) => p.roles.includes(me.role)) : [];
  const home = (me && pages.find((p) => p.path === LANDING[me.role])) ?? pages[0];
  return (
    <AuthContext.Provider value={{ me, setMe, signOut }}>
      {!me ? <Login />
        : me.mustChangePassword ? <ChangePassword forced />
        : (
          <Routes>
            <Route element={<Layout pages={pages} />}>
              {pages.map((p) => <Route key={p.path} path={p.path} element={p.element} />)}
              <Route path="*" element={<Navigate to={home!.path} replace />} />
            </Route>
          </Routes>
        )}
    </AuthContext.Provider>
  );
}
