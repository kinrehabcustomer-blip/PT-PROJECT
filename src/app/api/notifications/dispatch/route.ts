import { NextResponse } from "next/server";
import { dispatchDueNotifications, mergeDispatchResult } from "@/application/dispatch-notifications";
import { syncCourseAlerts } from "@/application/notification-planner";
import { lineGateway } from "@/infrastructure/line/line-gateway";
import { loadData, transact, tryLock } from "@/infrastructure/repositories/store";
import { guard } from "@/app/api/_lib/respond";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function dispatch() {
  // One run at a time across all server instances, or people could get a message twice.
  const run = await tryLock("dispatch", 55, async () => {
    const now = new Date();
    const snapshot = await loadData();
    const sent = await dispatchDueNotifications(syncCourseAlerts(snapshot, now), lineGateway, now);
    // Sending is slow; merge into whatever is stored now instead of overwriting it.
    return transact((fresh) => {
      const merged = mergeDispatchResult(fresh, snapshot, sent);
      const count = (status: string) => merged.notifications.filter((n) => n.status === status).length;
      return {
        result: { ok: true as const, sent: count("sent"), skipped: count("skipped"), failed: count("failed"), queued: count("queued") },
        data: merged,
      };
    });
  });
  if (!run.ran) return NextResponse.json({ message: "กำลังส่งอยู่ กรุณารอสักครู่" }, { status: 409 });
  return NextResponse.json(run.value);
}

/** Cron entry point. Requires `Authorization: Bearer $CRON_SECRET`. */
export async function GET(request: Request) {
  // Trim: a pasted secret often carries a trailing newline or space.
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ message: "CRON_SECRET not set" }, { status: 503 });
  if (request.headers.get("authorization")?.trim() !== `Bearer ${secret}`) {
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
