"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ROLE_LABEL, useApp } from "@/presentation/state/app-context";
import { AppSidebar } from "@/presentation/components/navigation/app-sidebar";

export function AppShell({ children }: { children: ReactNode }) {
  const { data, user, toast, logout } = useApp();
  const pathname = usePathname();
  const toastNode = toast && <div role="status" className={`toast ${toast.error ? "error" : ""}`}>{toast.message}</div>;

  if (pathname === "/login") return <>{children}{toastNode}</>;

  return (
    <div className="app-shell">
      <AppSidebar />
      <main className="main">
        <div className="topbar">
          {user && (
            <div className="role-switch">
              {user.name} · {ROLE_LABEL[user.role]}
              <button className="row-action" onClick={() => void logout()}>ออกจากระบบ</button>
            </div>
          )}
        </div>
        {data ? children : <div className="panel empty-state">{toast?.message ?? "กำลังโหลดข้อมูล..."}</div>}
      </main>
      {toastNode}
    </div>
  );
}
