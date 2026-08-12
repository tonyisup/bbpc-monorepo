import {
  generateUploadButton,
  generateUploadDropzone,
} from "@uploadthing/react";
import { generateReactHelpers } from "@uploadthing/react";

import type { ConvexFileRouter } from "@/server/upload/convexUploadthing";

export const UploadButton = generateUploadButton<ConvexFileRouter>();
export const UploadDropzone = generateUploadDropzone<ConvexFileRouter>();
export const { useUploadThing, uploadFiles } =
  generateReactHelpers<ConvexFileRouter>();
