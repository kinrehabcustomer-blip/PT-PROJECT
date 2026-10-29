import { NextResponse } from "next/server";
import { viewFor } from "@/application/data-view";
import { currentUser } from "@/infrastructure/auth/session";
import { loadData } from "@/infrastructure/repositories/store";
import { unauthorized } from "@/app/api/_lib/respond";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ user, data: viewFor(user, await loadData()) });
}
