"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ROLE_LABEL, useApp } from "@/presentation/state/app-context";
import { AppSidebar } from "@/presentation/components/navigation/app-sidebar";

export function AppShell({ children }: { children: ReactNode }) {
  const { data, user, toast, logout } = useApp();
  const pathname = usePathname();
  // A failed first load keeps its message on screen; otherwise show a skeleton while waiting.
  const failed = !data && Boolean(toast?.error);
  const toastNode = toast && <div role="status" className={`toast ${toast.error ? "error" : ""}`}>{toast.message}</div>;

  if (pathname === "/login") return <>{children}{toastNode}</>;

  return (
    <div className="app-shell">
      <AppSidebar />
      <main className="main">
        <div className="topbar">
          {user ? (
            <div className="role-switch">
              {user.name} · {ROLE_LABEL[user.role]}
              <button className="row-action" onClick={() => void logout()}>ออกจากระบบ</button>
            </div>
          ) : (
            !failed && <div className="role-switch" aria-hidden="true"><span className="skeleton skeleton-line" style={{ width: 150 }} /></div>
          )}
        </div>
        {data ? children : failed ? <div className="panel empty-state" role="alert">{toast?.message}</div> : <PageSkeleton />}
      </main>
      {toastNode}
    </div>
  );
}

function PageSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">กำลังโหลดข้อมูล...</span>
      <div aria-hidden="true">
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-line" style={{ width: 240, marginBottom: 22 }} />
        <div className="stats-grid">
          {[0, 1, 2, 3].map((i) => <div className="stat-card" key={i}><div className="skeleton skeleton-line" style={{ width: "55%" }} /><div className="skeleton skeleton-value" /></div>)}
        </div>
        <div className="panel skeleton-panel">
          {[0, 1, 2, 3].map((i) => (
            <div className="skeleton-row" key={i}>
              <span className="skeleton skeleton-line" style={{ width: 56 }} />
              <span className="skeleton skeleton-line" style={{ width: "28%" }} />
              <span className="skeleton skeleton-line" style={{ width: "22%" }} />
              <span className="skeleton skeleton-line" style={{ width: "34%" }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
