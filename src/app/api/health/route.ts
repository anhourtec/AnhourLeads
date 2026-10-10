import { NextResponse } from "next/server";

/** Liveness: never touches Postgres, Redis or the network. */
export function GET() {
  return NextResponse.json({ status: "ok", version: process.env.GIT_SHA || process.env.npm_package_version || "dev" });
}
