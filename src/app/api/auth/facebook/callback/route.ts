import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    { error: "Facebook OAuth disabled." },
    { status: 410 },
  );
}
