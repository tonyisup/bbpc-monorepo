"use client";

import Link from "next/link";
import type { FC } from "react";

import {
  type BbpcAuthUser,
  useBbpcAuth,
} from "@/components/auth/BbpcAuthContext";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";

export const SignInButton: FC<{ className?: string }> = ({ className }) => {
  const { signIn } = useBbpcAuth();
  return (
    <button
      type="button"
      title="Sign in"
      className={`font-semibold text-red-600 no-underline transition hover:text-red-400 ${
        className ?? ""
      }`}
      onClick={signIn}
    >
      Sign in
    </button>
  );
};

export const Auth: React.FC = () => {
  const { status, user } = useBbpcAuth();

  if (status === "loading") {
    return <div className="h-8 w-8 animate-pulse rounded-full" />;
  }

  return <LoggedInAs user={user} />;
};

interface LoggedInAsProps {
  user: BbpcAuthUser | null;
}

const LoggedInAs: FC<LoggedInAsProps> = ({ user }) => {
  if (!user) return <SignInButton />;

  return (
    <Link
      className="cursor-pointer transition hover:text-red-400"
      href="/profile"
    >
      <Avatar>
        <AvatarImage
          src={user.image ?? ""}
          alt={(user.name || user.email) ?? ""}
        />
        <AvatarFallback>Profile</AvatarFallback>
      </Avatar>
    </Link>
  );
};

export function AuthAvatar() {
  return null;
}
