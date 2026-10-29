import { createTherapist } from "@/application/directory-use-cases";
import { runAction } from "@/app/api/_lib/respond";

export async function POST(request: Request) {
  return runAction(
    request,
    (data, body, ctx) => createTherapist(data, { name: String(body.name ?? ""), phone: String(body.phone ?? "") }, ctx),
    ["admin"],
  );
}
