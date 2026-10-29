"use client";

import { useState } from "react";
import type { Role } from "@/domain/models";
import { ROLE_LABEL, useApp } from "@/presentation/state/app-context";

export default function TeamPage() {
  const { data, role, act } = useApp();
  const [newRole, setNewRole] = useState<Role>("staff");
  if (!data) return null;
  if (role !== "admin") return <div className="panel empty-state">หน้านี้สำหรับผู้ดูแลระบบเท่านั้น</div>;

  const codeFor = (id: string) => data.linkCodes.find((c) => c.target === "therapist" && c.targetId === id && new Date(c.expiresAt) > new Date());

  return (
    <>
      <div className="page-heading"><div><h1>ผู้ใช้และทีม</h1><p>บัญชีเข้าสู่ระบบ นักกายภาพบำบัด และการผูก LINE</p></div></div>

      <section className="panel stack-pad" style={{ marginBottom: 16 }}>
        <div className="panel-title">นักกายภาพบำบัด</div>
        {data.therapists.map((t) => {
          const code = codeFor(t.id);
          return (
            <div className="history-line" key={t.id}>
              <span>{t.name} · {t.phone} · LINE: {t.lineUserId ? "ผูกแล้ว" : "ยังไม่ผูก"}{code && <> · ให้ส่งรหัส <strong className="code">{code.code}</strong> ไปที่ LINE Official Account</>}</span>
              <span className="appointment-actions">
                {!t.lineUserId && <button className="row-action" onClick={() => act("POST", "/api/link-codes", { target: "therapist", targetId: t.id }, "สร้างรหัสผูก LINE แล้ว (หมดอายุใน 24 ชม.)")}>สร้างรหัสผูก LINE</button>}
                {t.lineUserId && <button className="row-action danger" onClick={() => window.confirm("ยกเลิกการผูก LINE?") && act("POST", "/api/link-codes", { target: "therapist", targetId: t.id, unlink: true }, "ยกเลิกการผูกแล้ว")}>ยกเลิกการผูก</button>}
              </span>
            </div>
          );
        })}
        <form className="adjust-form" action={(fd) => { void act("POST", "/api/therapists", Object.fromEntries(fd), "เพิ่มนักกายภาพบำบัดแล้ว"); }}>
          <h3>เพิ่มนักกายภาพบำบัด</h3>
          <label>ชื่อ<input name="name" placeholder="กภ. ..." required /></label>
          <label>เบอร์โทร<input name="phone" required /></label>
          <button className="primary-button">เพิ่ม</button>
        </form>
      </section>

      <section className="panel stack-pad">
        <div className="panel-title">บัญชีผู้ใช้</div>
        {data.users.map((u) => (
          <div className="history-line" key={u.id}>
            <span className={u.active ? "" : "voided"}>{u.name} ({u.username}) · {ROLE_LABEL[u.role]}{u.therapistId ? ` · ${data.therapists.find((t) => t.id === u.therapistId)?.name ?? ""}` : ""}{u.active ? "" : " · ปิดใช้งาน"}</span>
            <span className="appointment-actions">
              <form action={(fd) => { void act("POST", `/api/users/${u.id}/password`, { password: fd.get("password") }, "ตั้งรหัสผ่านใหม่แล้ว"); }} className="inline-form">
                <input name="password" type="password" minLength={10} placeholder="รหัสผ่านใหม่ (10+ ตัว)" autoComplete="new-password" required />
                <button className="row-action">ตั้งรหัสผ่าน</button>
              </form>
              <button className="row-action danger" onClick={() => act("POST", `/api/users/${u.id}/${u.active ? "disable" : "enable"}`, {}, u.active ? "ปิดใช้งานบัญชีแล้ว" : "เปิดใช้งานบัญชีแล้ว")}>{u.active ? "ปิดใช้งาน" : "เปิดใช้งาน"}</button>
            </span>
          </div>
        ))}
        <form className="adjust-form" action={(fd) => { void act("POST", "/api/users", Object.fromEntries(fd), "สร้างบัญชีผู้ใช้แล้ว"); }}>
          <h3>สร้างบัญชีใหม่</h3>
          <label>ชื่อผู้ใช้<input name="username" required autoComplete="off" /></label>
          <label>ชื่อที่แสดง<input name="name" required /></label>
          <label>บทบาท
            <select name="role" value={newRole} onChange={(e) => setNewRole(e.target.value as Role)}>
              {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </label>
          {newRole === "therapist" && (
            <label>นักกายภาพ<select name="therapistId" required>{data.therapists.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          )}
          <label>รหัสผ่านเริ่มต้น<input name="password" type="password" minLength={10} autoComplete="new-password" required /></label>
          <button className="primary-button">สร้าง</button>
        </form>
      </section>
    </>
  );
}
