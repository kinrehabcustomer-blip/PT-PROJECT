import { createPatient } from "@/application/directory-use-cases";
import { runAction } from "@/app/api/_lib/respond";
import { parsePatient } from "@/app/api/patients/parse";

export async function POST(request: Request) {
  return runAction(request, (data, body, ctx) => createPatient(data, parsePatient(body), ctx), ["admin", "staff"]);
}
