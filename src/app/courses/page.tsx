"use client";

import { useState } from "react";
import { remainingSessions } from "@/domain/models";
import { downloadCsv, toCsv } from "@/presentation/lib/csv";
import { useApp } from "@/presentation/state/app-context";

const ACTION_LABEL = { deduct: "ตัดคอร์ส", restore: "คืนสิทธิ์", "adjust-total": "แก้จำนวนทั้งหมด", "adjust-used": "แก้จำนวนที่ใช้" } as const;

export default function CoursesPage() {
  const { data, role, act } = useApp();
  const [open, setOpen] = useState<string | null>(null);
  if (!data) return null;
  const isAdmin = role === "admin";

  async function adjust(courseId: string, formData: FormData) {
    await act("POST", `/api/courses/${courseId}/adjust`, Object.fromEntries(formData), "แก้ไขคอร์สและบันทึกประวัติแล้ว");
  }

  function exportCsv() {
    const rows = data!.courses.map((c) => [
      data!.patients.find(({ id }) => id === c.patientId)?.name, c.serviceName, c.totalSessions, c.usedSessions, remainingSessions(c),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    downloadCsv(`courses-${today}.csv`, toCsv(["ผู้รับบริการ", "บริการ", "ทั้งหมด", "ใช้ไป", "คงเหลือ"], rows));
  }

  return (
    <>
      <div className="page-heading"><div><h1>คอร์สการรักษา</h1><p>จำนวนครั้งที่ใช้ไป คงเหลือ และประวัติการตัดคอร์ส</p></div><button className="row-action" onClick={exportCsv}>ส่งออก CSV</button></div>
      <div className="stack">
        {data.courses.map((course) => {
          const patient = data.patients.find(({ id }) => id === course.patientId);
          const remaining = remainingSessions(course);
          const audit = data.courseAudit.filter((entry) => entry.courseId === course.id);
          return (
            <section className="panel" key={course.id}>
              <button className="course-expand wide" onClick={() => setOpen(open === course.id ? null : course.id)} aria-expanded={open === course.id}>
                <div className="course-top"><span className="course-name">{patient?.name} · {course.serviceName}</span><span className="course-count">ใช้ไป {course.usedSessions} · เหลือ {remaining} / {course.totalSessions}</span></div>
                <div className="progress-track"><div className={`progress-fill ${remaining === 0 ? "exhausted" : remaining <= 3 ? "warning" : ""}`} style={{ width: `${course.usedSessions / course.totalSessions * 100}%` }} /></div>
              </button>
              {open === course.id && (
                <div className="course-detail">
                  <h3>ประวัติการรักษา</h3>
                  {course.history.length ? course.history.map((entry) => (
                    <div className="history-line" key={entry.id}>
                      <span className={entry.voided ? "voided" : ""}>{entry.date} · {entry.therapistName} · {entry.serviceName}{entry.voided ? " (ยกเลิกรายการ)" : ""}</span>
                      {isAdmin && !entry.voided && (
                        <form action={(fd) => { void act("POST", `/api/courses/${course.id}/void-history`, { historyId: entry.id, reason: fd.get("reason") }, "ยกเลิกรายการตัดคอร์สและคืนสิทธิ์ 1 ครั้งแล้ว"); }}>
                          <input name="reason" placeholder="เหตุผล" required /><button className="row-action">ยกเลิกรายการ</button>
                        </form>
                      )}
                    </div>
                  )) : <div className="empty-state">ยังไม่มีประวัติการรักษา</div>}

                  {isAdmin ? (
                    <form className="adjust-form" action={(fd) => adjust(course.id, fd)}>
                      <h3>แก้ไขจำนวนครั้ง (เฉพาะผู้ดูแลระบบ)</h3>
                      <label>ทั้งหมด<input name="totalSessions" type="number" min={1} defaultValue={course.totalSessions} required /></label>
                      <label>ใช้ไป<input name="usedSessions" type="number" min={0} defaultValue={course.usedSessions} required /></label>
                      <label>เหตุผล<input name="reason" required /></label>
                      <button className="primary-button">บันทึก</button>
                    </form>
                  ) : <p className="ack-note">การแก้ไขรายการตัดคอร์สทำได้เฉพาะผู้ดูแลระบบ</p>}

                  <h3>ประวัติการแก้ไข</h3>
                  {audit.length ? audit.map((entry) => (
                    <div className="history-line" key={entry.id}>
                      <span>{new Date(entry.at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })} · {entry.actor} · {ACTION_LABEL[entry.action]} · ใช้ {entry.before.usedSessions}/{entry.before.totalSessions} → {entry.after.usedSessions}/{entry.after.totalSessions} · {entry.reason}</span>
                    </div>
                  )) : <div className="empty-state">ยังไม่มีการแก้ไข</div>}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
