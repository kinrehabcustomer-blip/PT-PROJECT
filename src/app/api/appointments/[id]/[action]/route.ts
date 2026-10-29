import { NextResponse } from "next/server";
import {
  acknowledgeAppointment,
  cancelAppointment,
  completeAppointment,
  markNoShow,
  rescheduleAppointment,
  resolveNoShow,
} from "@/application/appointment-use-cases";
import { queueManualReminder } from "@/application/manual-notification";
import { dispatchDueNotifications } from "@/application/dispatch-notifications";
import { lineGateway } from "@/infrastructure/line/line-gateway";
import { runAction } from "@/app/api/_lib/respond";

type Params = { params: Promise<{ id: string; action: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id, action } = await params;
  switch (action) {
    case "acknowledge":
      return runAction(request, (data, _body, ctx) => acknowledgeAppointment(data, id, ctx));
    case "complete":
      return runAction(request, (data, _body, ctx) => completeAppointment(data, id, ctx));
    case "cancel":
      return runAction(request, (data, _body, ctx) => cancelAppointment(data, id, ctx));
    case "no-show":
      return runAction(request, (data, _body, ctx) => markNoShow(data, id, ctx));
    case "resolve-no-show":
      return runAction(request, (data, body, ctx) => resolveNoShow(data, id, body.deduct === true, ctx));
    case "reschedule":
      return runAction(request, (data, body, ctx) =>
        rescheduleAppointment(data, id, { date: String(body.date ?? ""), time: String(body.time ?? "") }, ctx),
      );
    case "remind":
      return runAction(
        request,
        async (data, body, ctx) => {
          const audiences = Array.isArray(body.audiences) ? body.audiences.map(String) : [];
          const queued = queueManualReminder(
            data,
            id,
            { audiences: audiences as ("patient" | "therapist")[], note: typeof body.note === "string" ? body.note : undefined },
            ctx,
          );
          if (!queued.ok) return queued;
          // Send immediately so the admin sees the real outcome in the response.
          return { ok: true, data: await dispatchDueNotifications(queued.data, lineGateway, ctx.now) };
        },
        ["admin"],
      );
    default:
      return NextResponse.json({ message: "ไม่รู้จักการดำเนินการนี้" }, { status: 404 });
  }
}
