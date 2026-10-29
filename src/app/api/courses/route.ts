import { createCourse } from "@/application/directory-use-cases";
import { runAction } from "@/app/api/_lib/respond";

export async function POST(request: Request) {
  return runAction(
    request,
    (data, body, ctx) =>
      createCourse(
        data,
        {
          patientId: String(body.patientId ?? ""),
          serviceName: String(body.serviceName ?? ""),
          totalSessions: Number(body.totalSessions),
        },
        ctx,
      ),
    ["admin", "staff"],
  );
}
