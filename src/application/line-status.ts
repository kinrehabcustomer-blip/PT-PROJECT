import type { AppData } from "@/domain/models";

export type LineState = "sent" | "queued" | "failed" | "skipped" | "unlinked" | "none";

export interface LineStatus {
  state: LineState;
  /** When the latest message reached LINE (state "sent"). */
  at?: string;
  detail?: string;
}

/**
 * Has this appointment been announced on LINE to the patient/relative or the
 * therapist? "sent" wins once any message got through; otherwise the most
 * telling problem is shown so staff know whom to call instead.
 */
export function lineStatus(
  data: AppData,
  appointmentId: string,
  audience: "patient" | "therapist",
): LineStatus {
  const appointment = data.appointments.find(({ id }) => id === appointmentId);
  if (!appointment) return { state: "none" };

  const mine = data.notifications.filter(
    (n) => n.appointmentId === appointmentId && n.audience === audience && !(n.status === "skipped" && n.dedupeKey.includes("|superseded:")),
  );
  const sent = mine.filter((n) => n.status === "sent").sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? ""));
  if (sent.length) return { state: "sent", at: sent[0].sentAt };

  const linked =
    audience === "therapist"
      ? Boolean(data.therapists.find(({ id }) => id === appointment.therapistId)?.lineUserId)
      : Boolean(data.patients.find(({ id }) => id === appointment.patientId)?.lineUserId ||
          data.patients.find(({ id }) => id === appointment.patientId)?.relativeLineUserId);
  if (!linked) return { state: "unlinked", detail: "ยังไม่ผูกบัญชี LINE" };

  const failed = mine.find((n) => n.status === "failed");
  if (failed) return { state: "failed", detail: failed.detail };
  const queued = mine.find((n) => n.status === "queued");
  if (queued) return { state: "queued", detail: queued.detail };
  const skipped = mine.find((n) => n.status === "skipped");
  if (skipped) return { state: "skipped", detail: skipped.detail };
  return { state: "none" };
}
