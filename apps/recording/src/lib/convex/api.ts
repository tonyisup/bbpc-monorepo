import { api } from "@tonyisup/bbpc-convex-api";
import { BBPC_API_VERSION } from "@tonyisup/bbpc-convex-api/contracts";
import type { FunctionReturnType } from "convex/server";

export const BBPC_CLIENT_API_VERSION = BBPC_API_VERSION;
export const recordingApi = api.recording;

export type SounderCatalogItem = FunctionReturnType<
  typeof api.recording.sounders.list
>[number];
