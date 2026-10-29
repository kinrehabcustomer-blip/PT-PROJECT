import type { AppData, DashboardAppointment } from "@/domain/models";
import { MANUAL_NOTE_MAX } from "@/application/manual-notification";
import { lineStatus } from "@/application/line-status";

export function RemindModal({
  data,
  appointment,
  busy,
  onClose,
  onSubmit,
}: {
  data: AppData;
  appointment: DashboardAppointment;
  busy: boolean;
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
}) {
  const patientLinked = Boolean(appointment.patient.lineUserId || appointment.patient.relativeLineUserId);
  const therapistLinked = Boolean(appointment.therapist.lineUserId);
  const patientLine = lineStatus(data, appointment.id, "patient");
  const therapistLine = lineStatus(data, appointment.id, "therapist");

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="modal" action={onSubmit}>
        <h2>ส่งแจ้งเตือนทาง LINE</h2>
        <p>{appointment.patient.name} · {appointment.date} {appointment.time} น. ข้อความจะถูกส่งทันที</p>

        <label className="check-field">
          <input type="checkbox" name="audiences" value="patient" defaultChecked={patientLinked} disabled={!patientLinked} />
          <span>ผู้ป่วย / ญาติ{!patientLinked && <em> — ยังไม่ผูก LINE ส่งไม่ได้</em>}{patientLine.state === "sent" && <em> — เคยส่งแล้ว</em>}</span>
        </label>
        <label className="check-field">
          <input type="checkbox" name="audiences" value="therapist" defaultChecked={therapistLinked} disabled={!therapistLinked} />
          <span>{appointment.therapist.name}{!therapistLinked && <em> — ยังไม่ผูก LINE ส่งไม่ได้</em>}{therapistLine.state === "sent" && <em> — เคยส่งแล้ว</em>}</span>
        </label>

        <label className="form-field">ข้อความเพิ่มเติม (ถ้ามี)
          <textarea name="note" rows={3} maxLength={MANUAL_NOTE_MAX} placeholder="เช่น กรุณาเตรียมผ้าขนหนูและสวมใส่เสื้อผ้าสบาย" />
        </label>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>ปิด</button>
          <button className="primary-button" disabled={busy || (!patientLinked && !therapistLinked)}>{busy ? "กำลังส่ง..." : "ส่งเลย"}</button>
        </div>
      </form>
    </div>
  );
}
