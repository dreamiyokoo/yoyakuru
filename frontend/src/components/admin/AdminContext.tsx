"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "@/lib/api";
import { adminApi } from "@/lib/adminApi";
import type { Me, Membership } from "@/lib/adminTypes";

const STORAGE_KEY = "yoyakuru.tenant";
const PUBLIC_PATHS = ["/login", "/invite", "/signup"];

interface AdminState {
  me: Me | null;
  membership: Membership | null;
  setTenant: (subdomain: string) => void;
  signedIn: (me: Me) => void;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AdminState | null>(null);

export function useAdmin(): AdminState {
  const value = useContext(Ctx);
  if (!value) throw new Error("AdminProvider がありません");
  return value;
}

function pick(me: Me, preferred: string | null): Membership | null {
  return me.memberships.find((m) => m.subdomain === preferred) ?? me.memberships[0] ?? null;
}

function stored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** ログイン状態と、操作中の店舗を持つ。未ログインならログイン画面へ移す。 */
export function AdminProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  // 最初の表示のときだけログイン状態を確かめる。router と pathname は参照だけにする
  const initial = useRef({ router, pathname });
  const [state, setState] = useState<{ me: Me | null; membership: Membership | null; loaded: boolean }>({
    me: null,
    membership: null,
    loaded: false,
  });

  useEffect(() => {
    let active = true;
    adminApi
      .me()
      .then((me) => active && setState({ me, membership: pick(me, stored()), loaded: true }))
      .catch((e: unknown) => {
        if (!active) return;
        setState({ me: null, membership: null, loaded: true });
        const { router: r, pathname: p } = initial.current;
        // 招待の受け入れ（/invite）と新規登録（/signup）は、まだログインしていないひとが開く
        if (e instanceof ApiError && (e.status === 401 || e.status === 403) && !PUBLIC_PATHS.includes(p)) r.replace("/login");
      });
    return () => {
      active = false;
    };
  }, []);

  const setTenant = useCallback((subdomain: string) => {
    try {
      localStorage.setItem(STORAGE_KEY, subdomain);
    } catch {
      // 保存できなくても、この画面の間は切り替える
    }
    setState((s) => ({ ...s, membership: s.me ? pick(s.me, subdomain) : null }));
  }, []);

  const signedIn = useCallback((me: Me) => setState({ me, membership: pick(me, stored()), loaded: true }), []);

  const signOut = useCallback(async () => {
    await adminApi.logout().catch(() => undefined);
    setState({ me: null, membership: null, loaded: true });
    router.replace("/login");
  }, [router]);

  if (!state.loaded && pathname !== "/login" && pathname !== "/signup") return <p className="p-6 text-sm text-sub">読み込み中…</p>;
  return <Ctx.Provider value={{ me: state.me, membership: state.membership, setTenant, signedIn, signOut }}>{children}</Ctx.Provider>;
}
