import type { AppData, Appointment, CourseHistoryEntry, TreatmentCourse } from "@/domain/models";

/*
 * Demo data. Every person, phone number and address below is invented; it only
 * exists to make the screens look like a working clinic. "Today" is 2026-10-29.
 */

const HOME = "เข้ารับบริการที่บ้าน";
const CLINIC = "คลินิก KIN สาขาบางนา";
const CLINIC_ADDRESS = "อาคาร KIN ชั้น 2 บางนา กรุงเทพฯ";

function daysBefore(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Builds `used` history entries, newest first. `recent` are visits that have
 * matching appointments in the list; older visits are filled in every 2 days.
 */
function course(
  id: string,
  patientId: string,
  serviceName: string,
  totalSessions: number,
  usedSessions: number,
  therapistName: string,
  time: string,
  recent: Array<{ appointmentId: string; date: string }> = [],
  firstHistoryId?: string,
): TreatmentCourse {
  const history: CourseHistoryEntry[] = [];
  for (let i = 0; i < usedSessions; i++) {
    const r = recent[i];
    const date = r ? r.date : daysBefore("2026-10-27", (i - recent.length) * 2);
    history.push({
      id: i === 0 && firstHistoryId ? firstHistoryId : `h-${id}-${i + 1}`,
      appointmentId: r ? r.appointmentId : `old-${id}-${i + 1}`,
      date: `${date} ${time}`,
      therapistName,
      serviceName,
    });
  }
  return { id, patientId, serviceName, totalSessions, usedSessions, history };
}

function appt(
  id: string,
  patientId: string,
  therapistId: string,
  courseId: string,
  date: string,
  time: string,
  serviceName: string,
  where: "home" | "clinic",
  address: string,
  status: Appointment["status"],
  acknowledged: boolean,
  extra: Partial<Appointment> = {},
): Appointment {
  return {
    id, patientId, therapistId, courseId, date, time, serviceName,
    location: where === "home" ? HOME : CLINIC,
    address: where === "home" ? address : CLINIC_ADDRESS,
    status, acknowledged, ...extra,
  };
}

export const seedData: AppData = {
  patients: [
    { id: "p-1", name: "คุณสมชาย ใจดี", phone: "081-234-5678", condition: "ฟื้นฟูหลังผ่าตัดเปลี่ยนข้อเข่าเทียมซ้าย (สัปดาห์ที่ 6) งอเข่าได้ประมาณ 95 องศา เดินใช้ไม้เท้า" },
    { id: "p-2", name: "คุณสุภาวดี แสงทอง", phone: "089-456-1234", condition: "ออฟฟิศซินโดรม ปวดคอบ่าไหล่ร้าวขึ้นศีรษะ นั่งทำงานหน้าจอวันละ 9 ชม." },
    { id: "p-3", name: "คุณประเสริฐ มีสุข", phone: "086-789-0123", condition: "ฟื้นฟูโรคหลอดเลือดสมอง (อัมพาตครึ่งซีกขวา) เดินได้ระยะสั้น ต้องมีผู้ดูแลช่วยพยุง" },
    { id: "p-4", name: "คุณอรทัย พูนผล", phone: "095-321-6789", condition: "กายภาพบำบัดทั่วไป ปวดเมื่อยกล้ามเนื้อหลังจากออกกำลังกาย" },
    { id: "p-5", name: "คุณวิชัย มั่นคง", phone: "082-654-9870", condition: "ปวดหลังส่วนล่างเรื้อรัง ยกของหนักไม่ได้" },
    { id: "p-6", name: "คุณยายบุญเลี้ยง ศรีสุข", phone: "083-100-2001", condition: "อายุ 82 ปี ฟื้นฟูหลังผ่าตัดข้อสะโพกเทียมขวา เสี่ยงหกล้ม ใช้วอล์กเกอร์ ลูกสาวเป็นผู้ติดต่อ" },
    { id: "p-7", name: "คุณธนพล วงศ์ใหญ่", phone: "084-100-2002", condition: "ผ่าตัดเอ็นไขว้หน้าเข่า (ACL) เมื่อ 3 เดือนก่อน เป้าหมายกลับไปเล่นฟุตซอล" },
    { id: "p-8", name: "ด.ช.ภูริ แก้วมณี", phone: "085-100-2003", condition: "อายุ 7 ปี สมองพิการชนิดเกร็ง (Spastic CP) ฝึกทรงตัวและการเดิน คุณแม่เป็นผู้ติดต่อ" },
    { id: "p-9", name: "คุณพรทิพย์ จันทร์เพ็ญ", phone: "086-100-2004", condition: "ข้อไหล่ติดข้างซ้าย (Frozen shoulder) ยกแขนได้ไม่เกิน 90 องศา ปวดตอนกลางคืน" },
    { id: "p-10", name: "คุณสมศักดิ์ รุ่งเรือง", phone: "087-100-2005", condition: "โรคพาร์กินสัน ระยะ 2–3 ก้าวเดินสั้น ทรงตัวไม่มั่นคง ระวังหกล้ม" },
    { id: "p-11", name: "คุณนภัสสร เลิศล้ำ", phone: "088-100-2006", condition: "ปวดหลังและกระดูกเชิงกรานหลังคลอด 2 เดือน ให้นมบุตร ไม่ควรใช้เครื่องมือบางชนิด" },
    { id: "p-12", name: "คุณอำนวย ทองดี", phone: "089-100-2007", condition: "หมอนรองกระดูกสันหลังส่วนเอวทับเส้นประสาท ปวดร้าวลงขาขวา ชาปลายเท้า" },
  ],
  therapists: [
    { id: "t-1", name: "กภ. พิมพ์ชนก", initials: "พช", color: "violet", phone: "090-111-2222" },
    { id: "t-2", name: "กภ. ธนกร", initials: "ธก", color: "blue", phone: "090-333-4444" },
    { id: "t-3", name: "กภ. ณัฐชา", initials: "ณช", color: "rose", phone: "090-555-6666" },
    { id: "t-4", name: "กภ. วรเทพ", initials: "วท", color: "violet", phone: "090-777-8888" },
    { id: "t-5", name: "กภ. ชลธิชา", initials: "ชธ", color: "blue", phone: "090-999-0000" },
  ],
  courses: [
    course("c-1", "p-1", "ฟื้นฟูหลังผ่าตัดเข่า", 10, 7, "กภ. พิมพ์ชนก", "10:00", [], "h-1"),
    course("c-2", "p-2", "กายภาพบำบัดออฟฟิศซินโดรม", 10, 9, "กภ. ธนกร", "13:30"),
    course("c-3", "p-3", "ฟื้นฟูโรคหลอดเลือดสมอง", 20, 17, "กภ. ณัฐชา", "15:00"),
    course("c-4", "p-4", "กายภาพบำบัดทั่วไป", 10, 4, "กภ. พิมพ์ชนก", "16:30"),
    course("c-5", "p-5", "กายภาพบำบัดอาการปวดหลัง", 10, 10, "กภ. ธนกร", "09:00"),
    course("c-6", "p-6", "ฟื้นฟูหลังผ่าตัดสะโพก", 20, 4, "กภ. วรเทพ", "09:00"),
    course("c-7", "p-7", "ฟื้นฟูเอ็นไขว้หน้าเข่า (ACL)", 30, 12, "กภ. ชลธิชา", "10:00", [{ appointmentId: "a-h1", date: "2026-10-28" }]),
    course("c-8", "p-8", "กระตุ้นพัฒนาการเด็ก (CP)", 20, 5, "กภ. วรเทพ", "14:00"),
    course("c-9", "p-9", "ไหล่ติด", 10, 6, "กภ. ชลธิชา", "14:00", [{ appointmentId: "a-h2", date: "2026-10-28" }]),
    course("c-10", "p-10", "ฟื้นฟูโรคพาร์กินสัน", 30, 9, "กภ. ณัฐชา", "10:00", [{ appointmentId: "a-h3", date: "2026-10-28" }]),
    course("c-11", "p-11", "ปวดหลังหลังคลอด", 10, 4, "กภ. ธนกร", "15:00"),
    course("c-12", "p-12", "ปวดหลังร้าวลงขา (HNP)", 20, 8, "กภ. พิมพ์ชนก", "09:30"),
    course("c-13", "p-12", "ออกกำลังกายเสริมความแข็งแรง", 10, 2, "กภ. พิมพ์ชนก", "09:30"),
  ],
  appointments: [
    // Yesterday: finished visits, a no-show waiting for an admin decision, and a cancellation.
    appt("a-h1", "p-7", "t-5", "c-7", "2026-10-28", "10:00", "ฟื้นฟูเอ็นไขว้หน้าเข่า (ACL)", "clinic", "", "เสร็จสิ้น", true),
    appt("a-h2", "p-9", "t-5", "c-9", "2026-10-28", "14:00", "ไหล่ติด", "clinic", "", "เสร็จสิ้น", true),
    appt("a-h3", "p-10", "t-3", "c-10", "2026-10-28", "10:00", "ฟื้นฟูโรคพาร์กินสัน", "home", "55/7 หมู่บ้านสราญสุข ซอยบางนา-ตราด 14 กรุงเทพฯ", "เสร็จสิ้น", true),
    appt("a-h4", "p-11", "t-2", "c-11", "2026-10-28", "15:00", "ปวดหลังหลังคลอด", "home", "120/3 คอนโดสุขสบาย ซอยอุดมสุข 40 กรุงเทพฯ", "ไม่มาตามนัด", true),
    appt("a-h5", "p-8", "t-4", "c-8", "2026-10-28", "09:00", "กระตุ้นพัฒนาการเด็ก (CP)", "home", "9/45 หมู่บ้านภูเขาทอง บางพลี สมุทรปราการ", "ยกเลิก", false),

    // Today
    appt("a-6", "p-6", "t-4", "c-6", "2026-10-29", "09:00", "ฟื้นฟูหลังผ่าตัดสะโพก", "home", "14 ซอยสุขุมวิท 101/1 บางนา กรุงเทพฯ (บ้านสองชั้น ประตูสีเขียว มีบันไดหน้าบ้าน 3 ขั้น)", "ยืนยันแล้ว", true),
    appt("a-1", "p-1", "t-1", "c-1", "2026-10-29", "10:00", "ฟื้นฟูหลังผ่าตัดเข่า", "home", "88/12 ถนนสุขุมวิท บางนา กรุงเทพฯ", "ยืนยันแล้ว", true),
    appt("a-7", "p-7", "t-5", "c-7", "2026-10-29", "11:30", "ฟื้นฟูเอ็นไขว้หน้าเข่า (ACL)", "clinic", "", "ยืนยันแล้ว", true),
    appt("a-2", "p-2", "t-2", "c-2", "2026-10-29", "13:30", "ออฟฟิศซินโดรม", "clinic", "", "รอยืนยัน", false),
    appt("a-8", "p-8", "t-4", "c-8", "2026-10-29", "14:00", "กระตุ้นพัฒนาการเด็ก (CP)", "home", "9/45 หมู่บ้านภูเขาทอง บางพลี สมุทรปราการ", "รอยืนยัน", false),
    appt("a-3", "p-3", "t-3", "c-3", "2026-10-29", "15:00", "ฟื้นฟูโรคหลอดเลือดสมอง", "home", "32/8 หมู่บ้านร่มเย็น สมุทรปราการ", "ยืนยันแล้ว", false),
    appt("a-4", "p-4", "t-1", "c-4", "2026-10-29", "16:30", "กายภาพบำบัดทั่วไป", "clinic", "", "รอยืนยัน", false),
    appt("a-9", "p-9", "t-5", "c-9", "2026-10-29", "17:30", "ไหล่ติด", "clinic", "", "ยืนยันแล้ว", true),

    // Next days
    appt("a-5", "p-5", "t-2", "c-5", "2026-10-30", "09:00", "กายภาพบำบัดอาการปวดหลัง", "home", "19/4 ซอยอ่อนนุช กรุงเทพฯ", "ยืนยันแล้ว", true),
    appt("a-10", "p-10", "t-3", "c-10", "2026-10-30", "10:00", "ฟื้นฟูโรคพาร์กินสัน", "home", "55/7 หมู่บ้านสราญสุข ซอยบางนา-ตราด 14 กรุงเทพฯ", "รอยืนยัน", false),
    appt("a-11", "p-11", "t-2", "c-11", "2026-10-30", "13:00", "ปวดหลังหลังคลอด", "home", "120/3 คอนโดสุขสบาย ซอยอุดมสุข 40 กรุงเทพฯ", "รอยืนยัน", false),
    appt("a-12", "p-12", "t-1", "c-12", "2026-10-31", "09:30", "ปวดหลังร้าวลงขา (HNP)", "clinic", "", "รอยืนยัน", false),
    appt("a-13", "p-6", "t-4", "c-6", "2026-11-02", "09:00", "ฟื้นฟูหลังผ่าตัดสะโพก", "home", "14 ซอยสุขุมวิท 101/1 บางนา กรุงเทพฯ (บ้านสองชั้น ประตูสีเขียว มีบันไดหน้าบ้าน 3 ขั้น)", "รอยืนยัน", false),
  ],
  notifications: [],
  courseAudit: [],
  users: [],
  linkCodes: [],
  settings: {
    channel: "LINE",
    eveningTime: "18:00",
    leadHours: 2,
    patientReminder: "both",
    contactPhone: "02-000-0000",
  },
};
