import { NextResponse } from "next/server";
import { adjustCourse, voidHistoryEntry } from "@/application/course-use-cases";
import { runAction } from "@/app/api/_lib/respond";

type Params = { params: Promise<{ id: string; action: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id, action } = await params;
  switch (action) {
    case "adjust":
      return runAction(request, (data, body, ctx) =>
        adjustCourse(
          data,
          id,
          {
            totalSessions: Number(body.totalSessions),
            usedSessions: Number(body.usedSessions),
            reason: String(body.reason ?? ""),
          },
          ctx,
        ),
        ["admin"],
      );
    case "void-history":
      return runAction(request, (data, body, ctx) =>
        voidHistoryEntry(data, id, String(body.historyId ?? ""), String(body.reason ?? ""), ctx),
        ["admin"],
      );
    default:
      return NextResponse.json({ message: "ไม่รู้จักการดำเนินการนี้" }, { status: 404 });
  }
}
