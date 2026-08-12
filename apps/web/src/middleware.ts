import { clerkMiddleware } from "@clerk/nextjs/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";

const vercelDeploymentOrigin = process.env.VERCEL_URL
  ? [`https://${process.env.VERCEL_URL}`]
  : [];
const authorizedParties =
  process.env.NODE_ENV === "production"
    ? [
        "https://badboyspodcast.com",
        "https://www.badboyspodcast.com",
        ...vercelDeploymentOrigin,
      ]
    : ["http://localhost:3000"];
const handleClerkRequest = clerkMiddleware({ authorizedParties });

export default function middleware(
  request: NextRequest,
  event: NextFetchEvent
) {
  if (
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY === undefined ||
    process.env.CLERK_SECRET_KEY === undefined
  ) {
    throw new Error("BBPC requires Clerk publishable and secret keys.");
  }
  if (
    request.nextUrl.pathname.startsWith("/api/auth") ||
    request.nextUrl.pathname.startsWith("/api/trpc")
  ) {
    return new NextResponse(null, {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }
  return handleClerkRequest(request, event);
}

export const config = {
  matcher: [
    {
      source:
        "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
      locale: false,
    },
    { source: "/(api|trpc)(.*)", locale: false },
    { source: "/__clerk/(.*)", locale: false },
  ],
};
