import { assignPatient, unassignPatient } from "@/application/directory-use-cases";
import { runAction } from "@/app/api/_lib/respond";

type Params = { params: Promise<{ id: string }> };

/** Body: { patientId, remove?: true }. Adds (or removes) a patient from this therapist's care. */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return runAction(
    request,
    (data, body, ctx) => {
      const patientId = String(body.patientId ?? "");
      return body.remove === true ? unassignPatient(data, id, patientId, ctx) : assignPatient(data, id, patientId, ctx);
    },
    ["admin", "staff"],
  );
}
