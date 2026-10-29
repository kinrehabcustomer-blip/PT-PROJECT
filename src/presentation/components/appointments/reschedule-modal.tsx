import type { DashboardAppointment } from "@/domain/models";

export function RescheduleModal({
  appointment,
  onClose,
  onSubmit,
}: {
  appointment: DashboardAppointment;
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="modal" action={onSubmit}>
        <h2>เลื่อนนัดหมาย</h2>
        <p>{appointment.patient.name} · นัดเดิม {appointment.date} {appointment.time} น. ระบบจะแจ้งผู้ป่วยและนักกายภาพโดยอัตโนมัติ</p>
        <label className="form-field">วันที่ใหม่<input name="date" type="date" defaultValue={appointment.date} required /></label>
        <label className="form-field">เวลาใหม่<input name="time" type="time" defaultValue={appointment.time} required /></label>
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>ปิด</button><button type="submit" className="primary-button">ยืนยันเลื่อนนัด</button></div>
      </form>
    </div>
  );
}
