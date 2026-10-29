"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { AppData, Role, User } from "@/domain/models";
import { ApiError, api } from "@/infrastructure/api/client";

interface Toast { message: string; error?: boolean }

interface AppState {
  user: User | null;
  data: AppData | null;
  role: Role;
  toast: Toast | null;
  notify: (message: string, error?: boolean) => void;
  /** Calls the API, swaps in the returned data, and toasts the outcome. Resolves true on success. */
  act: (
    method: "POST" | "PUT",
    path: string,
    body: Record<string, unknown>,
    success: string | ((data: AppData) => Toast),
  ) => Promise<boolean>;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AppContext = createContext<AppState | null>(null);

export const ROLE_LABEL: Record<Role, string> = { admin: "ผู้ดูแลระบบ", staff: "เจ้าหน้าที่", therapist: "นักกายภาพบำบัด" };
const POLL_MS = 20_000;
const MIN_GAP_MS = 5_000;

export function AppProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const onLogin = pathname === "/login";
  const [user, setUser] = useState<User | null>(null);
  const [data, setData] = useState<AppData | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const notify = useCallback((message: string, error?: boolean) => setToast({ message, error }), []);

  // One refresh at a time: a slow server must never pile up requests behind each other.
  const inFlight = useRef(false);
  const lastLoad = useRef(0);

  const load = useCallback(async (quiet: boolean) => {
    if (inFlight.current) return;
    if (quiet && Date.now() - lastLoad.current < MIN_GAP_MS) return;
    inFlight.current = true;
    try {
      const result = await api.load();
      setUser(result.user);
      setData(result.data);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setUser(null);
        setData(null);
        router.replace("/login");
      } else if (!quiet) {
        notify(error instanceof Error ? error.message : "โหลดข้อมูลไม่สำเร็จ", true);
      }
    } finally {
      inFlight.current = false;
      lastLoad.current = Date.now();
    }
  }, [notify, router]);

  const refresh = useCallback(() => load(false), [load]);

  // Initial load, then keep the screen current while the tab is visible.
  useEffect(() => {
    if (onLogin) return;
    const first = window.setTimeout(() => void load(false), 0);
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void load(true);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, onLogin]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const act: AppState["act"] = async (method, path, body, success) => {
    try {
      const next = await api.send(method, path, body);
      setData(next);
      const outcome = typeof success === "function" ? success(next) : { message: success };
      notify(outcome.message, outcome.error);
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) router.replace("/login");
      notify(error instanceof Error ? error.message : "ดำเนินการไม่สำเร็จ", true);
      return false;
    }
  };

  const logout = async () => {
    await api.logout();
    setUser(null);
    setData(null);
    router.replace("/login");
  };

  return (
    <AppContext.Provider value={{ user, data, role: user?.role ?? "staff", toast, notify, act, refresh, logout }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
