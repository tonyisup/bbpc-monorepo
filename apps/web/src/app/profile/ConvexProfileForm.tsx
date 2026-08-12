"use client";

import { useConvex } from "convex/react";
import { Camera } from "lucide-react";
import { useEffect, useState } from "react";

import { useBbpcAuth } from "@/components/auth/BbpcAuthContext";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  assertConvexProfileImageUploadAllowed,
  discardConvexProfileImageUpload,
  getConvexIdentityIssue,
  updateConvexProfileName,
  updateConvexProfileWithImage,
} from "@/convex/identity";
import { useUploadThing } from "@/utils/uploadthing";

interface ConvexProfileFormProps {
  initialName: string;
  initialImage: string | null;
}

function saveErrorMessage(error: unknown): string {
  switch (getConvexIdentityIssue(error)) {
    case "linking-disabled":
      return "Profile updates are paused while this environment is read-only.";
    case "stale-client":
      return "This page is out of date. Refresh it before saving again.";
    case "account-disabled":
    case "identity-conflict":
      return "This account needs an administrator to resolve it.";
    default:
      return "Your profile could not be updated. Please try again.";
  }
}

class ProfileImageAdoptionError extends Error {
  constructor(readonly cleanupQueued: boolean) {
    super("profile-image-adoption-failed");
  }
}

export function ConvexProfileForm({
  initialName,
  initialImage,
}: ConvexProfileFormProps) {
  const convex = useConvex();
  const { refreshAccount } = useBbpcAuth();
  const [userName, setUserName] = useState(initialName);
  const [image, setImage] = useState(initialImage);
  const [temporaryImage, setTemporaryImage] = useState<File | null>(
    null
  );
  const [temporaryImageUrl, setTemporaryImageUrl] = useState<
    string | null
  >(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { startUpload, isUploading } =
    useUploadThing("imageUploader");

  useEffect(() => {
    if (!isEditing) {
      setUserName(initialName);
      setImage(initialImage);
    }
  }, [initialImage, initialName, isEditing]);

  useEffect(
    () => () => {
      if (temporaryImageUrl !== null) {
        URL.revokeObjectURL(temporaryImageUrl);
      }
    },
    [temporaryImageUrl]
  );

  const clearTemporaryImage = () => {
    if (temporaryImageUrl !== null) {
      URL.revokeObjectURL(temporaryImageUrl);
    }
    setTemporaryImage(null);
    setTemporaryImageUrl(null);
  };

  const save = async () => {
    const normalizedName = userName.trim();
    if (normalizedName.length < 1 || normalizedName.length > 100) {
      setErrorMessage("Display name must contain 1 through 100 characters.");
      return;
    }
    setIsSaving(true);
    setSaved(false);
    setErrorMessage(null);
    try {
      if (temporaryImage === null) {
        const result = await updateConvexProfileName(
          convex,
          normalizedName
        );
        setUserName(result.name);
      } else {
        await assertConvexProfileImageUploadAllowed(convex);
        const uploadId = crypto.randomUUID();
        const uploadedFiles = await startUpload([temporaryImage]);
        const uploadedFile = uploadedFiles?.[0];
        if (
          uploadedFile === undefined ||
          uploadedFile.key.length === 0 ||
          uploadedFile.url.length === 0
        ) {
          throw new Error("profile-image-upload-failed");
        }
        try {
          const result = await updateConvexProfileWithImage(convex, {
            name: normalizedName,
            image: uploadedFile.url,
            fileKey: uploadedFile.key,
            uploadId,
            expectedImage: initialImage,
          });
          setUserName(result.name);
          setImage(result.image);
        } catch {
          let cleanupQueued = false;
          try {
            await discardConvexProfileImageUpload(convex, {
              fileKey: uploadedFile.key,
              uploadId,
            });
            cleanupQueued = true;
          } catch {
            // The user-facing error below calls out manual recovery.
          }
          throw new ProfileImageAdoptionError(cleanupQueued);
        }
      }
      clearTemporaryImage();
      setIsEditing(false);
      setSaved(true);
      refreshAccount();
    } catch (error) {
      setErrorMessage(
        error instanceof ProfileImageAdoptionError
          ? error.cleanupQueued
            ? "The new image was not adopted. Its remote cleanup has been queued; refresh before trying again."
            : "The new image was not adopted and automatic cleanup could not be queued. Ask an administrator to review External Cleanup."
          : saveErrorMessage(error)
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-row items-end justify-between gap-4">
        <div className="relative flex">
          <Avatar className="h-24 w-24">
            <AvatarImage
              src={temporaryImageUrl ?? image ?? ""}
              alt={userName}
            />
            <AvatarFallback>
              {userName.charAt(0).toUpperCase() || "P"}
            </AvatarFallback>
          </Avatar>
          <label className="absolute bottom-0 right-0 cursor-pointer rounded-full bg-gray-800 p-2 hover:bg-gray-700">
            <input
              accept="image/*"
              aria-label="Choose a profile image"
              className="hidden"
              disabled={isSaving || isUploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file === undefined) {
                  return;
                }
                if (temporaryImageUrl !== null) {
                  URL.revokeObjectURL(temporaryImageUrl);
                }
                setTemporaryImage(file);
                setTemporaryImageUrl(URL.createObjectURL(file));
                setIsEditing(true);
                setSaved(false);
                setErrorMessage(null);
              }}
              type="file"
            />
            <Camera className="h-4 w-4" />
          </label>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="name" className="text-sm font-medium">
            Display Name
          </label>
          <input
            id="name"
            type="text"
            value={userName}
            maxLength={100}
            onChange={(event) => {
              setUserName(event.target.value);
              setIsEditing(true);
              setSaved(false);
              setErrorMessage(null);
            }}
            className="rounded-md border border-gray-700 bg-gray-800 px-4 py-2 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>
      </div>

      {isEditing ? (
        <div className="flex flex-row justify-center gap-4">
          <Button
            variant="destructive"
            onClick={() => {
              setUserName(initialName);
              setImage(initialImage);
              clearTemporaryImage();
              setIsEditing(false);
              setErrorMessage(null);
            }}
            disabled={isSaving || isUploading}
          >
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={save}
            disabled={isSaving || isUploading}
          >
            {isUploading
              ? "Uploading..."
              : isSaving
                ? "Saving..."
                : "Save changes"}
          </Button>
        </div>
      ) : null}

      {saved ? (
        <p className="text-center text-sm text-green-400" role="status">
          Profile updated successfully.
        </p>
      ) : null}
      {errorMessage ? (
        <p className="text-center text-sm text-red-300" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
