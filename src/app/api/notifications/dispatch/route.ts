import { NextResponse } from "next/server";
import { syncCourseAlerts } from "@/application/notification-planner";
import { guard } from "@/app/api/_lib/respond";
import { dispatchDueNotifications } from "@/application/dispatch-notifications";
import { lineGateway } from "@/infrastructure/line/line-gateway";
import { transact } from "@/infrastructure/repositories/file-repository";

export const dynamic = "force-dynamic";

async function dispatch() {
  const summary = await transact(async (data) => {
    const next = await dispatchDueNotifications(syncCourseAlerts(data, new Date()), lineGateway);
    const count = (status: string) => next.notifications.filter((n) => n.status === status).length;
    return {
      result: { ok: true as const, sent: count("sent"), skipped: count("skipped"), failed: count("failed"), queued: count("queued") },
      data: next,
    };
  });
  return NextResponse.json(summary);
}

/** Cron entry point. Requires `Authorization: Bearer $CRON_SECRET`. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }
  return dispatch();
}

/** Manual "send now" from the admin screen. */
export async function POST(request: Request) {
  const user = await guard(request, ["admin"]);
  if (user instanceof Response) return user;
  return dispatch();
}
