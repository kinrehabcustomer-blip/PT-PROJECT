"use client";

import { useState } from "react";
import type { LinkTarget, Patient } from "@/domain/models";
import { remainingSessions } from "@/domain/models";
import { LinkRequestsPanel } from "@/presentation/components/line/link-requests-panel";
import { useApp } from "@/presentation/state/app-context";

export default function PatientsPage() {
  const { data, role, act } = useApp();
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  if (!data) return null;
  if (role === "therapist") return <div className="panel empty-state">หน้านี้สำหรับเจ้าหน้าที่และผู้ดูแลระบบ ดูผู้ป่วยในความดูแลของคุณได้ที่เมนู &ldquo;การดูแล&rdquo;</div>;

  const unlink = (target: LinkTarget, targetId: string) =>
    act("POST", "/api/link-codes", { target, targetId, unlink: true }, "ยกเลิกการผูก LINE แล้ว");

  function LinkRow({ label, target, patient, lineId }: { label: string; target: LinkTarget; patient: Patient; lineId?: string }) {
    const keyword = target === "relative" ? `ญาติ ${patient.name}` : patient.name;
    const waiting = data!.linkRequests.filter((r) => r.target === target && r.targetId === patient.id).length;
    return (
      <div className="history-line">
        <span>
          {label}: {lineId ? "ผูก LINE แล้ว" : "ยังไม่ผูก LINE"}
          {!lineId && <> · ให้พิมพ์ส่ง LINE ของคลินิกว่า <strong className="code">{keyword}</strong></>}
          {waiting > 0 && <> · <strong>มีคำขอรอยืนยัน {waiting} รายการ</strong> (ดูด้านบนของหน้านี้)</>}
        </span>
        <span className="appointment-actions">
          {lineId && <button className="row-action danger" onClick={() => window.confirm("ยกเลิกการผูก LINE?") && unlink(target, patient.id)}>ยกเลิกการผูก</button>}
        </span>
      </div>
    );
  }

  const reminderFields = (p?: Patient) => (
    <>
      <label>เตือนผู้ป่วย
        <select name="patientReminder" defaultValue={p?.reminder?.patientReminder ?? "default"}>
          <option value="default">ตามค่ากลางของระบบ</option><option value="evening">ช่วงเย็นก่อนนัด</option><option value="lead">ก่อนนัด 1–2 ชม.</option><option value="both">ทั้งสองช่วง</option>
        </select>
      </label>
      <label>เตือนก่อนนัด
        <select name="leadHours" defaultValue={p?.reminder?.leadHours ?? "default"}>
          <option value="default">ตามค่ากลาง</option><option value={0}>ไม่เตือน</option><option value={1}>1 ชั่วโมง</option><option value={2}>2 ชั่วโมง</option>
        </select>
      </label>
    </>
  );

  return (
    <>
      <div className="page-heading">
        <div><h1>ผู้รับบริการ</h1><p>ข้อมูลผู้รับบริการ คอร์ส และการผูกบัญชี LINE</p></div>
        <button className="primary-button" onClick={() => setAdding(!adding)}>＋ &nbsp;เพิ่มผู้รับบริการ</button>
      </div>

      <LinkRequestsPanel />

      {adding && (
        <section className="panel stack-pad" style={{ marginBottom: 16 }}>
          <form className="adjust-form" action={async (fd) => { if (await act("POST", "/api/patients", Object.fromEntries(fd), "เพิ่มผู้รับบริการแล้ว")) setAdding(false); }}>
            <label>ชื่อ<input name="name" required /></label>
            <label>เบอร์โทร<input name="phone" required /></label>
            <label>อาการเบื้องต้น<input name="condition" /></label>
            {reminderFields()}
            <button className="primary-button">บันทึก</button>
          </form>
        </section>
      )}

      <div className="stack">
        {data.patients.map((p) => {
          const courses = data.courses.filter((c) => c.patientId === p.id);
          return (
            <section className="panel" key={p.id}>
              <button className="course-expand wide" onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id}>
                <div className="course-top"><span className="course-name">{p.name} · {p.phone}</span><span className="course-count">{courses.map((c) => `${remainingSessions(c)}/${c.totalSessions}`).join(" · ") || "ยังไม่มีคอร์ส"}</span></div>
                <div className="ack-note">{p.condition || "ไม่ระบุอาการ"} · LINE: {p.lineUserId ? "ผูกแล้ว" : "ยังไม่ผูก"} · ดูแลโดย: {data.assignments.filter((a) => a.patientId === p.id).map((a) => data.therapists.find((t) => t.id === a.therapistId)?.name).filter(Boolean).join(", ") || "ยังไม่ระบุ"}</div>
              </button>
              {open === p.id && (
                <div className="course-detail">
                  <h3>แก้ไขข้อมูล</h3>
                  <form className="adjust-form" action={(fd) => { void act("PUT", `/api/patients/${p.id}`, Object.fromEntries(fd), "บันทึกข้อมูลแล้ว"); }}>
                    <label>ชื่อ<input name="name" defaultValue={p.name} required /></label>
                    <label>เบอร์โทร<input name="phone" defaultValue={p.phone} required /></label>
                    <label>อาการเบื้องต้น<input name="condition" defaultValue={p.condition} /></label>
                    {reminderFields(p)}
                    <button className="primary-button">บันทึก</button>
                  </form>

                  <h3>ผูกบัญชี LINE</h3>
                  <LinkRow label="ผู้ป่วย" target="patient" patient={p} lineId={p.lineUserId} />
                  <LinkRow label="ญาติ" target="relative" patient={p} lineId={p.relativeLineUserId} />

                  <h3>เริ่มคอร์สใหม่ / ต่อคอร์ส</h3>
                  <form className="adjust-form" action={(fd) => { void act("POST", "/api/courses", { ...Object.fromEntries(fd), patientId: p.id }, "เพิ่มคอร์สแล้ว"); }}>
                    <label>ประเภทบริการ<input name="serviceName" defaultValue={courses.at(-1)?.serviceName ?? ""} required /></label>
                    <label>จำนวนครั้ง
                      <select name="totalSessions" defaultValue={10}>{[10, 20, 30].map((n) => <option key={n} value={n}>{n} ครั้ง</option>)}</select>
                    </label>
                    <button className="primary-button">เพิ่มคอร์ส</button>
                  </form>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
