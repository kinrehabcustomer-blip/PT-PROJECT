import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { viewFor } from "@/application/data-view";
import { sessionUserId } from "@/infrastructure/auth/session";
import { loadData } from "@/infrastructure/repositories/store";
import { unauthorized } from "@/app/api/_lib/respond";

export const dynamic = "force-dynamic";

/**
 * The app state for the signed-in user. Tagged with an ETag so a refresh that
 * finds nothing new costs a 304 with no body instead of the whole payload.
 */
export async function GET(request: Request) {
  // The token proves who is asking; one read then gives both the user and the data.
  const userId = await sessionUserId();
  if (!userId) return unauthorized();
  const all = await loadData();
  const user = all.users.find((u) => u.id === userId);
  if (!user?.active) return unauthorized();

  const body = JSON.stringify({ user, data: viewFor(user, all) });
  const etag = `"${createHash("sha1").update(body).digest("hex").slice(0, 20)}"`;
  const headers = { ETag: etag, "Cache-Control": "private, max-age=0, must-revalidate" };

  if (request.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers });
  return new NextResponse(body, { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
}
