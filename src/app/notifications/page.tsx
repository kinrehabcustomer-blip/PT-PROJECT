"use client";

import { useState } from "react";
import type { NotificationKind } from "@/domain/models";
import { api } from "@/infrastructure/api/client";
import { useApp } from "@/presentation/state/app-context";

const KIND_LABEL: Record<NotificationKind, string> = {
  "appointment-confirmation": "ยืนยันนัดหมาย",
  "evening-reminder": "เตือนช่วงเย็น",
  "lead-reminder": "เตือนก่อนนัด",
  "schedule-change": "เลื่อนนัด",
  "manual-reminder": "แอดมินส่งเอง",
  cancellation: "ยกเลิกนัด",
  "course-low": "คอร์สใกล้หมด",
  "course-exhausted": "คอร์สครบ",
};
const AUDIENCE_LABEL = { patient: "ผู้ป่วย/ญาติ", therapist: "นักกายภาพ", admin: "แอดมิน" } as const;
const STATUS_LABEL = { queued: "รอส่ง", sent: "ส่งแล้ว", failed: "ส่งไม่สำเร็จ", skipped: "ไม่ได้ส่ง" } as const;

export default function NotificationsPage() {
  const { data, role, act, notify, refresh } = useApp();
  const [sending, setSending] = useState(false);
  if (!data) return null;
  const isAdmin = role === "admin";
  const { settings } = data;
  const rows = [...data.notifications].sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));

  async function sendNow() {
    setSending(true);
    try {
      const r = await api.dispatch();
      notify(`ส่งแล้ว ${r.sent} · ไม่ได้ส่ง ${r.skipped} · ล้มเหลว ${r.failed} · รอส่ง ${r.queued}`, r.failed > 0);
      await refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : "ส่งไม่สำเร็จ", true);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div><h1>การแจ้งเตือน</h1><p>ตั้งเวลาแจ้งเตือนและตรวจสอบสถานะการส่ง</p></div>
        {isAdmin && <button className="primary-button" onClick={sendNow} disabled={sending}>{sending ? "กำลังส่ง..." : "ส่งรายการที่ถึงเวลาตอนนี้"}</button>}
      </div>

      <section className="panel stack-pad">
        <div className="panel-title">ตั้งค่าเวลาแจ้งเตือน</div>
        {isAdmin ? (
          <form className="adjust-form" action={(fd) => { void act("PUT", "/api/settings", Object.fromEntries(fd), "บันทึกการตั้งค่าแล้ว (มีผลกับนัดที่สร้างหลังจากนี้)"); }}>
            <label>แจ้งเตือนช่วงเย็นเวลา<input name="eveningTime" type="time" defaultValue={settings.eveningTime} required /></label>
            <label>เตือนซ้ำก่อนนัด<select name="leadHours" defaultValue={settings.leadHours}><option value={0}>ไม่เตือนซ้ำ</option><option value={1}>1 ชั่วโมง</option><option value={2}>2 ชั่วโมง</option></select></label>
            <label>ผู้ป่วยรับแจ้ง<select name="patientReminder" defaultValue={settings.patientReminder}><option value="evening">ช่วงเย็นก่อนวันนัด</option><option value="lead">ก่อนนัด 1–2 ชั่วโมง</option><option value="both">ทั้งสองช่วง</option></select></label>
            <label>เบอร์ติดต่อเลื่อน/ยกเลิก<input name="contactPhone" defaultValue={settings.contactPhone} required /></label>
            <button className="primary-button">บันทึก</button>
          </form>
        ) : <p className="ack-note">แจ้งเย็น {settings.eveningTime} น. · เตือนซ้ำ {settings.leadHours || "ไม่มี"} ชม. — แก้ไขได้เฉพาะผู้ดูแลระบบ</p>}
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-header"><div><div className="panel-title">คิวและประวัติการแจ้งเตือน</div><div className="panel-subtitle">{rows.length} รายการ</div></div></div>
        {rows.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>กำหนดส่ง</th><th>ประเภท</th><th>ผู้รับ</th><th>สถานะ</th><th>รายละเอียด</th></tr></thead>
              <tbody>{rows.map((n) => (
                <tr key={n.id}>
                  <td>{new Date(n.scheduledAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "short", timeStyle: "short" })}</td>
                  <td>{KIND_LABEL[n.kind]}</td>
                  <td>{AUDIENCE_LABEL[n.audience]}</td>
                  <td><span className={`status ${n.status === "sent" ? "confirmed" : n.status === "queued" ? "pending" : "cancelled"}`}>{STATUS_LABEL[n.status]}</span></td>
                  <td><div className="msg">{n.message}</div>{n.detail && <div className="ack-note">{n.detail}</div>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <div className="empty-state">ยังไม่มีรายการแจ้งเตือน — สร้างนัดหมายเพื่อให้ระบบจัดคิว</div>}
      </section>
    </>
  );
}
