import { updatePatient } from "@/application/directory-use-cases";
import { runAction } from "@/app/api/_lib/respond";
import { parsePatient } from "@/app/api/patients/parse";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  return runAction(request, (data, body, ctx) => updatePatient(data, id, parsePatient(body), ctx), ["admin", "staff"]);
}
