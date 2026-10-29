import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { viewFor } from "@/application/data-view";
import { currentUser } from "@/infrastructure/auth/session";
import { loadData } from "@/infrastructure/repositories/store";
import { unauthorized } from "@/app/api/_lib/respond";

export const dynamic = "force-dynamic";

/**
 * The app state for the signed-in user. Tagged with an ETag so a refresh that
 * finds nothing new costs a 304 with no body instead of the whole payload.
 */
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return unauthorized();

  const body = JSON.stringify({ user, data: viewFor(user, await loadData()) });
  const etag = `"${createHash("sha1").update(body).digest("hex").slice(0, 20)}"`;
  const headers = { ETag: etag, "Cache-Control": "private, max-age=0, must-revalidate" };

  if (request.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers });
  return new NextResponse(body, { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
}
