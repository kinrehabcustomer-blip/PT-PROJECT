import type React from "react";
import { bangkokToday } from "@/domain/calendar";
import type { DashboardAppointment, Role } from "@/domain/models";
import type { LineStatus } from "@/application/line-status";

const STATUS_CLASS: Record<string, string> = {
  "ยืนยันแล้ว": "confirmed",
  "เสร็จสิ้น": "completed",
  "ยกเลิก": "cancelled",
  "ไม่มาตามนัด": "cancelled",
};

export const APPOINTMENT_COLUMNS = ["เวลา", "ผู้รับบริการ", "นักกายภาพบำบัด", "บริการ / สถานที่", "สถานะ", "แจ้งเตือน LINE", "จัดการ"];

export function AppointmentHead() {
  return (
    <div className="appointment-head" role="row">
      {APPOINTMENT_COLUMNS.map((name) => <div key={name} role="columnheader">{name}</div>)}
    </div>
  );
}

export function AppointmentRow({
  appointment,
  role,
  onAcknowledge,
  onComplete,
  onCancel,
  onReschedule,
  onNoShow,
  onResolveNoShow,
  busy,
  line,
  onRemind,
}: {
  appointment: DashboardAppointment;
  role: Role;
  onAcknowledge: () => void;
  onComplete: () => void;
  onCancel: () => void;
  onReschedule: () => void;
  onNoShow: () => void;
  onResolveNoShow: (deduct: boolean) => void;
  /** An action is in flight: lock the buttons but keep their size and position. */
  busy?: boolean;
  line: { patient?: LineStatus; therapist?: LineStatus };
  onRemind: () => void;
}) {
  const { status } = appointment;
  const notYetDay = appointment.date > bangkokToday(new Date());
  const notYetHint = notYetDay ? "ยังไม่ถึงวันนัด" : undefined;
  const open = status === "รอยืนยัน" || status === "ยืนยันแล้ว";
  const awaitingNoShowDecision = status === "ไม่มาตามนัด" && !appointment.noShowResolution;

  return (
    <article className="appointment-row" role="row">
      <div role="cell"><div className="time">{appointment.time}</div><div className="time-label">{formatDay(appointment.date)}</div></div>
      <div role="cell" className="person">
        <div className="person-copy"><div className="person-name">{appointment.patient.name}</div><div className="person-detail">{appointment.patient.phone}</div></div>
      </div>
      <div role="cell" className="person">
        <div className={`avatar ${appointment.therapist.color}`}>{appointment.therapist.initials}</div>
        <div className="person-copy"><div className="person-name">{appointment.therapist.name}</div><div className="person-detail">{appointment.therapist.phone}</div></div>
      </div>
      <div role="cell" className="service">{appointment.serviceName}<div className="service-location">{appointment.location} · {appointment.address}</div></div>
      <div role="cell" className="status-cell">
        <span className={`status ${STATUS_CLASS[status] ?? "pending"}`}>{status}</span>
        {open && <div className="ack-note">{appointment.acknowledged ? "นักกายภาพรับทราบแล้ว" : "รอนักกายภาพรับทราบ"}</div>}
        {appointment.noShowResolution && <div className="ack-note">{appointment.noShowResolution === "deducted" ? "ตัดคอร์สแล้ว" : "ไม่ตัดคอร์ส"}</div>}
      </div>
      <div role="cell" className="line-cell">
        {line.patient && <LineChip who="ผู้ป่วย" status={line.patient} />}
        {line.therapist && <LineChip who="นักกายภาพ" status={line.therapist} />}
      </div>
      <div role="cell" className="appointment-actions">
        {/* Six fixed slots: a button that does not apply leaves an empty cell, so nothing reflows when status changes. */}
        {slot(awaitingNoShowDecision && role === "admin"
          ? <button className="row-action" disabled={busy} onClick={() => onResolveNoShow(true)}>ตัดคอร์ส</button>
          : open && !appointment.acknowledged && role !== "staff"
            ? <button className="row-action" disabled={busy} onClick={onAcknowledge}>ยืนยันรับทราบ</button>
            : null)}
        {slot(awaitingNoShowDecision && role === "admin"
          ? <button className="row-action" disabled={busy} onClick={() => onResolveNoShow(false)}>ไม่ตัดคอร์ส</button>
          : status === "ยืนยันแล้ว" && role !== "staff"
            ? <button className="row-action" disabled={busy || notYetDay} onClick={onComplete} title={notYetHint ?? "บันทึกว่าให้บริการเสร็จและตัดคอร์ส 1 ครั้ง"}>ให้บริการแล้ว</button>
            : null)}
        {slot(open && role !== "therapist" ? <button className="row-action" disabled={busy} onClick={onReschedule}>เลื่อนนัด</button> : null)}
        {slot(open && role !== "therapist" ? <button className="row-action danger" disabled={busy || notYetDay} onClick={onNoShow} title={notYetHint}>ไม่มาตามนัด</button> : null)}
        {slot(open && role !== "therapist" ? <button className="row-action danger" disabled={busy} onClick={onCancel}>ยกเลิก</button> : null)}
        {slot(awaitingNoShowDecision && role !== "admin"
          ? <span className="ack-note">รอแอดมินตัดสิน</span>
          : open && role === "admin"
            ? <button className="row-action line" disabled={busy} onClick={onRemind} title="ส่งข้อความแจ้งเตือนนัดนี้ทาง LINE ทันที">ส่ง LINE</button>
            : null)}
      </div>
    </article>
  );
}

function formatDay(date: string): string {
  return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", timeZone: "Asia/Bangkok" }).format(new Date(`${date}T12:00:00+07:00`));
}

function slot(content: React.ReactNode) {
  return <div className="action-slot">{content}</div>;
}

const LINE_LABEL: Record<LineStatus["state"], string> = {
  sent: "ส่งแล้ว",
  queued: "รอส่ง",
  failed: "ส่งไม่สำเร็จ",
  skipped: "ไม่ได้ส่ง",
  unlinked: "ยังไม่ผูก LINE",
  none: "ยังไม่มีการแจ้ง",
};

function LineChip({ who, status }: { who: string; status: LineStatus }) {
  const when = status.at
    ? new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }).format(new Date(status.at))
    : undefined;
  const title = [status.detail, when && `ส่งล่าสุด ${when}`].filter(Boolean).join(" · ") || LINE_LABEL[status.state];
  return (
    <div className={`line-chip ${status.state}`} title={title}>
      <span className="line-dot" aria-hidden="true" />
      <span><strong>{who}</strong> {LINE_LABEL[status.state]}{when ? <small> {when}</small> : null}</span>
    </div>
  );
}
