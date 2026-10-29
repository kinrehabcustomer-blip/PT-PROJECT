"use client";

import { useMemo, useState } from "react";
import type { DashboardAppointment } from "@/domain/models";
import { remainingSessions } from "@/domain/models";
import { downloadCsv, toCsv } from "@/presentation/lib/csv";
import { lineStatus } from "@/application/line-status";
import { useApp } from "@/presentation/state/app-context";
import { StatCard } from "@/presentation/components/dashboard/stat-card";
import { APPOINTMENT_COLUMNS, AppointmentHead, AppointmentRow } from "@/presentation/components/appointments/appointment-row";
import { NewAppointmentModal } from "@/presentation/components/appointments/new-appointment-modal";
import { RemindModal } from "@/presentation/components/appointments/remind-modal";
import { RescheduleModal } from "@/presentation/components/appointments/reschedule-modal";
import { CourseList } from "@/presentation/components/courses/course-list";

const FILTERS = ["ทั้งหมด", "รอยืนยัน", "ยืนยันแล้ว", "เสร็จสิ้น", "ไม่มาตามนัด", "ยกเลิก"];

export default function DashboardPage() {
  const { data, role, act } = useApp();
  const [modal, setModal] = useState<"new-appointment" | null>(null);
  const [rescheduling, setRescheduling] = useState<DashboardAppointment | null>(null);
  const [filter, setFilter] = useState("ทั้งหมด");
  const [expandedCourse, setExpandedCourse] = useState<string | null>(null);
  const [reminding, setReminding] = useState<DashboardAppointment | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [day, setDay] = useState(() => getLocalDateString(new Date()));

  const appointments = useMemo(() => {
    if (!data) return [];
    return data.appointments
      .map((appointment): DashboardAppointment | null => {
        const patient = data.patients.find(({ id }) => id === appointment.patientId);
        const therapist = data.therapists.find(({ id }) => id === appointment.therapistId);
        const course = data.courses.find(({ id }) => id === appointment.courseId);
        return patient && therapist && course ? { ...appointment, patient, therapist, course } : null;
      })
      .filter((appointment): appointment is DashboardAppointment => appointment !== null)
      .filter((appointment) => appointment.date === day)
      .filter((appointment) => filter === "ทั้งหมด" || appointment.status === filter)
      .sort((a, b) => a.time.localeCompare(b.time));
  }, [data, filter, day]);

  if (!data) return null;

  const post = async (id: string, action: string, success: string, body: Record<string, unknown> = {}) => {
    if (busyId) return false;
    setBusyId(id);
    try {
      return await act("POST", `/api/appointments/${id}/${action}`, body, success);
    } finally {
      setBusyId(null);
    }
  };

  async function createAppointment(formData: FormData) {
    const ok = await act("POST", "/api/appointments", Object.fromEntries(formData), "บันทึกนัดหมายแล้ว และเข้าคิวแจ้งเตือนผู้ป่วย/นักกายภาพ");
    if (ok) setModal(null);
  }

  async function sendReminder(formData: FormData) {
    if (!reminding || busyId) return;
    const target = reminding;
    setBusyId(target.id);
    try {
      const ok = await act(
        "POST",
        `/api/appointments/${target.id}/remind`,
        { audiences: formData.getAll("audiences"), note: formData.get("note") },
        (next) => {
          const mine = next.notifications.filter((n) => n.kind === "manual-reminder" && n.appointmentId === target.id && Date.now() - new Date(n.scheduledAt).getTime() < 60_000);
          const sent = mine.filter((n) => n.status === "sent").length;
          const problems = mine.filter((n) => n.status !== "sent");
          if (!mine.length) return { message: "ไม่มีข้อความที่ส่ง", error: true };
          if (problems.length) {
            return { message: `ส่งสำเร็จ ${sent} จาก ${mine.length} ข้อความ — ${problems[0].detail ?? "ส่งไม่สำเร็จ"}`, error: true };
          }
          return { message: `ส่งแจ้งเตือนทาง LINE แล้ว (${sent} ข้อความ)` };
        },
      );
      if (ok) setReminding(null);
    } finally {
      setBusyId(null);
    }
  }

  async function reschedule(formData: FormData) {
    if (!rescheduling) return;
    const ok = await post(rescheduling.id, "reschedule", "เลื่อนนัดแล้ว และเข้าคิวแจ้งการเปลี่ยนแปลง", Object.fromEntries(formData));
    if (ok) setRescheduling(null);
  }

  function exportCsv() {
    const rows = appointments.map((a) => [
      a.time, a.date, a.patient.name, a.patient.phone, a.therapist.name, a.therapist.phone,
      a.serviceName, a.location, a.address, a.status,
      a.acknowledged ? "รับทราบแล้ว" : "ยังไม่รับทราบ",
      `${a.course.usedSessions}/${a.course.totalSessions}`,
    ]);
    downloadCsv(`appointments-${day}.csv`, toCsv(
      [...APPOINTMENT_COLUMNS.slice(0, 1), "วันที่", "ผู้รับบริการ", "เบอร์ผู้รับบริการ", "นักกายภาพบำบัด", "เบอร์นักกายภาพ", "บริการ", "สถานที่", "ที่อยู่", "สถานะ", "การรับทราบ", "คอร์ส ใช้ไป/ทั้งหมด"],
      rows,
    ));
  }

  const dayAppointments = data.appointments.filter((item) => item.date === day);
  const confirmedCount = dayAppointments.filter((item) => item.acknowledged && item.status === "ยืนยันแล้ว").length;
  const pendingCount = dayAppointments.filter((item) => item.status === "รอยืนยัน").length;
  const nearEnd = data.courses.filter((course) => remainingSessions(course) <= 3).length;
  const noShowWaiting = data.appointments.filter((a) => a.status === "ไม่มาตามนัด" && !a.noShowResolution).length;

  return (
    <>
      <div className="page-heading">
        <div><h1>ภาพรวมการทำงาน</h1><p>ติดตามนัดหมายและการดูแลผู้รับบริการของคุณ</p></div>
        {role !== "therapist" && <button className="primary-button" onClick={() => setModal("new-appointment")}>＋ &nbsp;สร้างนัดหมาย</button>}
      </div>

      <section className="stats-grid" aria-label="สรุปภาพรวม">
        <StatCard label="นัดหมายในวันนี้" value={dayAppointments.length} caption="รายการนัดหมายทั้งหมด" icon="▣" tone="teal" />
        <StatCard label="นักกายภาพรับทราบแล้ว" value={confirmedCount} caption="กดยืนยันรับทราบแล้ว" icon="✓" tone="blue" />
        <StatCard label="รอยืนยัน" value={pendingCount} caption="รอการยืนยันจากนักกายภาพ" icon="◷" tone="amber" />
        <StatCard label="คอร์สใกล้หมด" value={nearEnd} caption={noShowWaiting ? `เหลือไม่เกิน 3 ครั้ง · รอตัดสินไม่มาตามนัด ${noShowWaiting}` : "เหลือไม่เกิน 3 ครั้ง"} icon="!" tone="red" />
      </section>

      <div className="content-grid">
        <section className="panel">
          <div className="panel-header">
            <div><div className="panel-title">ตารางนัดหมาย</div><div className="panel-subtitle">รายการเข้ารับบริการประจำวัน</div></div>
            <div className="filters">
              <input type="date" aria-label="เลือกวัน" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
              <button className="row-action" onClick={exportCsv} disabled={!appointments.length}>ส่งออก CSV</button>
              <select aria-label="กรองสถานะ" value={filter} onChange={(event) => setFilter(event.target.value)}>
                {FILTERS.map((status) => <option key={status}>{status}</option>)}
              </select>
            </div>
          </div>
          {appointments.length ? <div className="appointment-table" role="table" aria-label="ตารางนัดหมาย">
            <AppointmentHead />
            {appointments.map((appointment) => (
              <AppointmentRow
                key={appointment.id}
                appointment={appointment}
                role={role}
                busy={busyId !== null}
                line={{
                  patient: role === "therapist" ? undefined : lineStatus(data, appointment.id, "patient"),
                  therapist: lineStatus(data, appointment.id, "therapist"),
                }}
                onRemind={() => setReminding(appointment)}
                onAcknowledge={() => post(appointment.id, "acknowledge", "ยืนยันรับทราบนัดหมายแล้ว")}
                onComplete={() => post(appointment.id, "complete", "บันทึกการรักษาและตัดคอร์สแล้ว 1 ครั้ง")}
                onCancel={() => window.confirm(`ยกเลิกนัดของ ${appointment.patient.name}? ระบบจะแจ้งผู้ป่วยและนักกายภาพ`) && post(appointment.id, "cancel", "ยกเลิกนัดหมายแล้ว — ไม่ตัดคอร์ส และเข้าคิวแจ้งผู้เกี่ยวข้อง")}
                onReschedule={() => setRescheduling(appointment)}
                onNoShow={() => window.confirm(`บันทึกว่า ${appointment.patient.name} ไม่มาตามนัด?`) && post(appointment.id, "no-show", "บันทึกว่าไม่มาตามนัด — ยังไม่ตัดคอร์สจนกว่าแอดมินยืนยัน")}
                onResolveNoShow={(deduct) => post(appointment.id, "resolve-no-show", deduct ? "ตัดคอร์สแล้ว 1 ครั้ง" : "บันทึกว่าไม่ตัดคอร์ส", { deduct })}
              />
            ))}
          </div> : <div className="empty-state">ไม่มีนัดหมายในวันและสถานะนี้</div>}
        </section>

        <aside className="side-column">
          <section className="reminder-card">
            <div className="reminder-heading"><div className="reminder-symbol">♧</div><div>ระบบแจ้งเตือน</div></div>
            <p>แจ้งตารางช่วง {data.settings.eveningTime} น. ของวันก่อนนัด{data.settings.leadHours ? ` และเตือนซ้ำก่อนนัด ${data.settings.leadHours} ชั่วโมง` : ""}</p>
            <div className="reminder-channel"><span>ช่องทางแจ้งเตือน</span><span className="channel-state">LINE</span></div>
          </section>
          <CourseList
            data={data}
            expandedCourse={expandedCourse}
            onToggle={(courseId) => setExpandedCourse(expandedCourse === courseId ? null : courseId)}
          />
        </aside>
      </div>

      {modal === "new-appointment" && <NewAppointmentModal data={data} today={day} onClose={() => setModal(null)} onSubmit={createAppointment} />}
      {reminding && <RemindModal data={data} appointment={reminding} busy={busyId !== null} onClose={() => setReminding(null)} onSubmit={sendReminder} />}
      {rescheduling && <RescheduleModal appointment={rescheduling} onClose={() => setRescheduling(null)} onSubmit={reschedule} />}
    </>
  );
}

function getLocalDateString(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}
