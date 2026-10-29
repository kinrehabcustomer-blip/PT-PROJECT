import { createAppointment } from "@/application/appointment-use-cases";
import { runAction } from "@/app/api/_lib/respond";

export async function POST(request: Request) {
  return runAction(request, (data, body, ctx) =>
    createAppointment(
      data,
      {
        patientId: String(body.patientId ?? ""),
        therapistId: String(body.therapistId ?? ""),
        date: String(body.date ?? ""),
        time: String(body.time ?? ""),
        location: String(body.location ?? ""),
        address: String(body.address ?? ""),
        courseId: typeof body.courseId === "string" && body.courseId ? body.courseId : undefined,
        mapUrl: typeof body.mapUrl === "string" ? body.mapUrl : undefined,
      },
      ctx,
    ),
    ["admin", "staff"],
  );
}
