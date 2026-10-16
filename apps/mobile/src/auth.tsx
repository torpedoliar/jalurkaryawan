import { createContext, useContext } from "react";
import type { Me } from "@bms/shared";

export interface Auth { me: Me | null; setMe(me: Me | null): void; signOut(): Promise<void> }
export const AuthContext = createContext<Auth | null>(null);

export function useAuth(): Auth {
  const a = useContext(AuthContext);
  if (!a) throw new Error("AuthContext missing");
  return a;
}

/** Only for screens rendered under the tab shell, where a signed-in user is guaranteed. */
export function useMe(): Me {
  const { me } = useAuth();
  if (!me) throw new Error("Not signed in");
  return me;
}
