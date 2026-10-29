import { useState } from "react";
import type { AppData } from "@/domain/models";
import { remainingSessions } from "@/domain/models";

export function NewAppointmentModal({
  data,
  today,
  onClose,
  onSubmit,
}: {
  data: AppData;
  today: string;
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
}) {
  const patientsWithCourses = data.patients.filter((patient) =>
    data.courses.some((course) => course.patientId === patient.id && remainingSessions(course) > 0),
  );

  const [patientId, setPatientId] = useState(patientsWithCourses[0]?.id ?? "");
  const caring = data.assignments.filter((a) => a.patientId === patientId).map((a) => a.therapistId);
  const therapists = [...data.therapists].sort((a, b) => Number(caring.includes(b.id)) - Number(caring.includes(a.id)));
  const usableCourses = data.courses.filter((c) => c.patientId === patientId && remainingSessions(c) > 0);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="modal" action={onSubmit}>
        <h2>สร้างนัดหมายใหม่</h2><p>ข้อมูลนัดจะเชื่อมกับคอร์สที่ยังมีจำนวนครั้งคงเหลือ</p>
        {!patientsWithCourses.length && <p role="alert">ไม่มีผู้รับบริการที่มีคอร์สเหลือให้สร้างนัด</p>}
        <label className="form-field">ผู้รับบริการ<select name="patientId" required value={patientId} onChange={(e) => setPatientId(e.target.value)}>{patientsWithCourses.map((patient) => <option key={patient.id} value={patient.id}>{patient.name}</option>)}</select></label>
        <label className="form-field">คอร์สที่ใช้<select name="courseId" required>{usableCourses.map((c) => <option key={c.id} value={c.id}>{c.serviceName} (เหลือ {remainingSessions(c)}/{c.totalSessions})</option>)}</select></label>
        <label className="form-field">นักกายภาพบำบัด<select name="therapistId" required key={patientId} defaultValue={caring[0]}>{therapists.map((therapist) => <option key={therapist.id} value={therapist.id}>{therapist.name}{caring.includes(therapist.id) ? " ★ ดูแลอยู่" : ""}</option>)}</select></label>
        <label className="form-field">วันที่นัด<input name="date" type="date" defaultValue={today} required /></label>
        <label className="form-field">เวลานัด<input name="time" type="time" defaultValue="10:00" required /></label>
        <label className="form-field">สถานที่<select name="location"><option>เข้ารับบริการที่บ้าน</option><option>คลินิก KIN สาขาบางนา</option></select></label>
        <label className="form-field">ที่อยู่ / รายละเอียดสถานที่<input name="address" placeholder="ระบุที่อยู่สำหรับเข้ารับบริการ" required /></label>
        <label className="form-field">ลิงก์แผนที่ (ถ้ามี)<input name="mapUrl" type="url" placeholder="https://maps.google.com/..." /></label>
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>ยกเลิก</button><button type="submit" className="primary-button" disabled={!patientsWithCourses.length}>บันทึกนัดหมาย</button></div>
      </form>
    </div>
  );
}
