import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error: "Copilot runtime moved",
      message:
        "The Copilot runtime is now served by the dedicated Express backend. Point NEXT_PUBLIC_COPILOTKIT_URL to http://localhost:4000/copilotkit during development.",
    },
    { status: 503 },
  );
}