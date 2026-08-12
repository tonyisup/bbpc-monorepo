import type { NextRequest } from "next/server";
import {
  createRouteHandler,
} from "uploadthing/next";

import { convexFileRouter } from "@/server/upload/convexUploadthing";

const routeHandlers = createRouteHandler({ router: convexFileRouter });

export async function GET(request: NextRequest) {
  return routeHandlers.GET(request);
}

export async function POST(request: NextRequest) {
  return routeHandlers.POST(request);
}
