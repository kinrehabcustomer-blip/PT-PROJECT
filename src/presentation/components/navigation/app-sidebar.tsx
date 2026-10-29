"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/domain/models";
import { useApp } from "@/presentation/state/app-context";

const navigation: ReadonlyArray<readonly [string, string, string, readonly Role[]]> = [
  ["▦", "นัดหมาย", "/", ["admin", "staff", "therapist"]],
  ["♙", "ผู้รับบริการ", "/patients", ["admin", "staff"]],
  ["☍", "การดูแล", "/caseload", ["admin", "staff", "therapist"]],
  ["✚", "คอร์สการรักษา", "/courses", ["admin", "staff", "therapist"]],
  ["◷", "แจ้งเตือน", "/notifications", ["admin", "staff", "therapist"]],
  ["⚙", "ผู้ใช้และทีม", "/team", ["admin"]],
];

export function AppSidebar() {
  const pathname = usePathname();
  const { role, data } = useApp();
  const pending = data?.linkRequests.length ?? 0;

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">+</div>
        <div className="brand-text"><div className="brand-name">PT Care</div><div className="brand-sub">Care, connected.</div></div>
      </div>
      <div className="nav-label">เมนูหลัก</div>
      <nav className="nav-list" aria-label="เมนูหลัก">
        {navigation.filter(([, , , roles]) => roles.includes(role)).map(([icon, label, href]) => (
          <Link key={href} href={href} className={`nav-item ${pathname === href ? "active" : ""}`} aria-current={pathname === href ? "page" : undefined}>
            <span className="nav-icon">{icon}</span><span className="nav-text">{label}{href === "/patients" && pending > 0 ? <span className="nav-badge" aria-label={`${pending} คำขอรอยืนยัน`}>{pending}</span> : null}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}
