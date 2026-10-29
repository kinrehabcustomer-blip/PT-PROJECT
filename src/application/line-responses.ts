import type { AppData, Appointment } from "@/domain/models";
import { isValidDate, isValidTime } from "@/domain/calendar";
import { acknowledgeAppointment } from "@/application/appointment-use-cases";
import { appointmentInstant, formatThaiDate, makeNotification, withNotifications } from "@/application/notification-planner";

/**
 * What happens when someone taps "ยืนยันนัดหมาย" or "เลื่อนนัดหมาย" under an
 * appointment message in LINE.
 *
 * - Therapist, confirm: the appointment is acknowledged, as in the web app.
 * - Patient/relative, confirm: staff are told the patient confirmed.
 * - Anyone, reschedule: the new time they picked is passed to staff as a
 *   request. The appointment itself never moves on a tap, so the therapist's
 *   calendar and the course are only changed by staff.
 */

export interface PostbackInput {
  lineUserId: string;
  /** The postback data string, e.g. "act=confirm&a=a-1". */
  data: string;
  /** From the date-time picker: "2026-11-05T10:00" (Bangkok time). */
  datetime?: string;
}

export interface PostbackResult {
  reply: string;
  /** Present only when something must be saved. */
  data?: AppData;
}

type Who = { role: "patient" | "therapist"; name: string; therapistId?: string };

function whoIs(data: AppData, a: Appointment, lineUserId: string): Who | null {
  const therapist = data.therapists.find((t) => t.id === a.therapistId);
  if (therapist?.lineUserId === lineUserId) return { role: "therapist", name: therapist.name, therapistId: therapist.id };
  const patient = data.patients.find((p) => p.id === a.patientId);
  if (patient?.lineUserId === lineUserId) return { role: "patient", name: patient.name };
  if (patient?.relativeLineUserId === lineUserId) return { role: "patient", name: `ญาติของ ${patient.name}` };
  return null;
}

const when = (date: string, time: string) => `${formatThaiDate(date)} เวลา ${time} น.`;

export function handleAppointmentPostback(data: AppData, input: PostbackInput, now: Date = new Date()): PostbackResult {
  const params = new URLSearchParams(input.data);
  const action = params.get("act");
  const appointment = data.appointments.find(({ id }) => id === params.get("a"));
  if (!appointment || (action !== "confirm" && action !== "reschedule")) {
    return { reply: "ไม่พบนัดหมายนี้แล้ว กรุณาติดต่อเจ้าหน้าที่" };
  }
  const who = whoIs(data, appointment, input.lineUserId);
  if (!who) return { reply: "บัญชี LINE นี้ไม่ได้เกี่ยวข้องกับนัดหมายนี้" };

  const phone = data.settings.contactPhone ? ` หรือโทร ${data.settings.contactPhone}` : "";
  if (appointment.status !== "รอยืนยัน" && appointment.status !== "ยืนยันแล้ว") {
    return { reply: `นัดหมายนี้อยู่ในสถานะ "${appointment.status}" แล้ว กรุณาติดต่อเจ้าหน้าที่${phone}` };
  }
  if (appointmentInstant(appointment.date, appointment.time) <= now) {
    return { reply: `นัดหมายนี้เลยเวลาแล้ว กรุณาติดต่อเจ้าหน้าที่${phone}` };
  }
  const patient = data.patients.find(({ id }) => id === appointment.patientId);
  const current = when(appointment.date, appointment.time);

  /** An alert for staff; one per key, so a double tap never raises it twice. */
  const alert = (key: string, message: string) => {
    const n = makeNotification({ kind: "patient-response", audience: "admin", recipientId: "admin", appointmentId: appointment.id, message, scheduledAt: now.toISOString() });
    return { ...n, dedupeKey: key, id: `n-${key}` };
  };

  if (action === "confirm") {
    if (who.role === "therapist") {
      if (appointment.acknowledged) return { reply: `คุณรับทราบนัดหมายนี้ไปแล้ว (${current})` };
      const done = acknowledgeAppointment(data, appointment.id, { now, actor: { name: who.name, role: "therapist", therapistId: who.therapistId } });
      if (!done.ok) return { reply: done.message };
      return { reply: `รับทราบนัดหมายเรียบร้อย ${current}`, data: done.data };
    }
    // Keyed by the slot too, so confirming again after a reschedule is a new confirmation.
    const key = `patient-response|confirm|${appointment.id}|${appointment.date}T${appointment.time}|${who.name}`;
    if (data.notifications.some((n) => n.dedupeKey === key)) return { reply: `คุณยืนยันนัดหมายนี้ไปแล้ว (${current})` };
    const n = alert(key, `${who.name} ยืนยันนัดหมายแล้ว\nผู้ป่วย: ${patient?.name}\nวันเวลา: ${current}\nบริการ: ${appointment.serviceName}`);
    return { reply: `ขอบคุณค่ะ ยืนยันนัดหมาย ${current} เรียบร้อยแล้ว`, data: withNotifications(data, [n]) };
  }

  // reschedule
  const picked = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(input.datetime ?? "");
  if (!picked || !isValidDate(picked[1]) || !isValidTime(picked[2])) return { reply: "วันหรือเวลาที่เลือกไม่ถูกต้อง กรุณาเลือกใหม่" };
  const [, date, time] = picked;
  if (appointmentInstant(date, time) <= now) return { reply: "กรุณาเลือกวันและเวลาในอนาคต" };
  if (date === appointment.date && time === appointment.time) return { reply: "วันและเวลาที่เลือกตรงกับนัดเดิม" };

  const key = `patient-response|reschedule|${appointment.id}|${date}T${time}|${who.name}`;
  const wanted = when(date, time);
  if (data.notifications.some((n) => n.dedupeKey === key)) return { reply: `ส่งคำขอเลื่อนเป็น ${wanted} ไว้แล้ว เจ้าหน้าที่จะติดต่อกลับ` };
  const n = alert(
    key,
    `${who.name} ขอเลื่อนนัดหมาย\nผู้ป่วย: ${patient?.name}\nนัดเดิม: ${current}\nขอเลื่อนเป็น: ${wanted}\nกรุณาติดต่อกลับและเลื่อนนัดในระบบ`,
  );
  return {
    reply: `ส่งคำขอเลื่อนนัดเป็น ${wanted} ให้เจ้าหน้าที่แล้ว นัดเดิม (${current}) ยังคงอยู่จนกว่าเจ้าหน้าที่จะยืนยัน หากเร่งด่วนติดต่อเจ้าหน้าที่${phone}`,
    data: withNotifications(data, [n]),
  };
}
