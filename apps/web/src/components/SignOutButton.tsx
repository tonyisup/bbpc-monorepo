"use client";

import { Button } from "./ui/button";
import { type FC } from "react";
import { useBbpcAuth } from "@/components/auth/BbpcAuthContext";

interface SignOutButtonProps {
  variant?:
    | "default"
    | "destructive"
    | "outline"
    | "secondary"
    | "ghost"
    | "link";
  className?: string;
}

const SignOutButton: FC<SignOutButtonProps> = ({
  variant = "outline",
  className,
}) => {
  const { signOut } = useBbpcAuth();
  return (
    <Button variant={variant} onClick={signOut} className={className}>
      Sign Out
    </Button>
  );
};

export default SignOutButton;
