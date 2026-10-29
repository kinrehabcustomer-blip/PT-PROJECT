import { runAction } from "@/app/api/_lib/respond";
import type { NotificationSettings } from "@/domain/models";

export async function PUT(request: Request) {
  return runAction(request, (data, body, ctx) => {
    if (ctx.actor.role !== "admin") {
      return { ok: false, message: "เฉพาะผู้ดูแลระบบเท่านั้นที่ตั้งค่าการแจ้งเตือนได้" };
    }
    const eveningTime = String(body.eveningTime ?? "");
    const leadHours = Number(body.leadHours);
    const patientReminder = body.patientReminder;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(eveningTime)) {
      return { ok: false, message: "เวลาแจ้งเตือนช่วงเย็นไม่ถูกต้อง" };
    }
    if (![0, 1, 2].includes(leadHours)) return { ok: false, message: "ต้องเลือกแจ้งก่อนนัด 0, 1 หรือ 2 ชั่วโมง" };
    if (patientReminder !== "evening" && patientReminder !== "lead" && patientReminder !== "both") {
      return { ok: false, message: "รูปแบบการแจ้งเตือนผู้ป่วยไม่ถูกต้อง" };
    }
    if (patientReminder === "lead" && leadHours === 0) {
      return { ok: false, message: "เลือก \"ก่อนนัด\" ต้องกำหนดเวลาเตือนก่อนนัด 1 หรือ 2 ชั่วโมง" };
    }
    const contactPhone = String(body.contactPhone ?? "").trim();
    if (!contactPhone) return { ok: false, message: "กรุณาระบุเบอร์ติดต่อสำหรับเลื่อนหรือยกเลิกนัด" };
    const settings: NotificationSettings = {
      channel: "LINE",
      eveningTime,
      leadHours: leadHours as 0 | 1 | 2,
      patientReminder,
      contactPhone,
    };
    return { ok: true, data: { ...data, settings } };
  }, ["admin"]);
}
