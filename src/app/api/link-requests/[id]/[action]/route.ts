import { NextResponse } from "next/server";
import { approveLinkRequest, rejectLinkRequest } from "@/application/line-linking";
import { lineGateway } from "@/infrastructure/line/line-gateway";
import { runAction } from "@/app/api/_lib/respond";

type Params = { params: Promise<{ id: string; action: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id, action } = await params;
  const roles = ["admin", "staff"] as const;
  if (action === "approve") {
    return runAction(
      request,
      async (data, _body, ctx) => {
        const result = approveLinkRequest(data, id, ctx);
        if (result.ok && result.request) {
          // Tell the person they are connected. Best effort: the link is already decided.
          await lineGateway
            .send(result.request.lineUserId, "เจ้าหน้าที่ยืนยันการเชื่อมต่อ LINE ของคุณแล้ว ต่อไปนี้คุณจะได้รับแจ้งเตือนนัดหมายทางนี้")
            .catch(() => undefined);
        }
        return result;
      },
      [...roles],
    );
  }
  if (action === "reject") {
    return runAction(request, (data, _body, ctx) => rejectLinkRequest(data, id, ctx), [...roles]);
  }
  return NextResponse.json({ message: "ไม่รู้จักการดำเนินการนี้" }, { status: 404 });
}
