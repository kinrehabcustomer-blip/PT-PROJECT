import type { LinkTarget } from "@/domain/models";
import { issueLinkCode, unlinkLine } from "@/application/directory-use-cases";
import { runAction } from "@/app/api/_lib/respond";

const TARGETS: LinkTarget[] = ["patient", "relative", "therapist"];

export async function POST(request: Request) {
  return runAction(
    request,
    (data, body, ctx) => {
      const target = body.target as LinkTarget;
      if (!TARGETS.includes(target)) return { ok: false, message: "ประเภทผู้รับไม่ถูกต้อง" };
      const id = String(body.targetId ?? "");
      return body.unlink === true ? unlinkLine(data, target, id, ctx) : issueLinkCode(data, target, id, ctx);
    },
    ["admin", "staff"],
  );
}
