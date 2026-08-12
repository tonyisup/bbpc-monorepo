'use client'

import { type FC } from "react";
import { Button } from "./ui/button";
import Link from "next/link";

interface UserPointsProps {
  points: number | null;
  showSpendButton?: boolean;
  className?: string;
}

const UserPoints: FC<UserPointsProps> = ({
  points,
  showSpendButton = true,
  className = ""
}) => {
  const pointsValue = points ? Number(points) : 0;

  return (
    <div className={`flex gap-4 items-center space-around ${className}`}>
      <div className="p-4 flex gap-2 items-center">
        <span className="text-3xl font-bold text-red-500">{pointsValue}</span>
        <span className="text-xl font-semibold">pts</span>
      </div>
      {showSpendButton && (
        <Button variant="outline">
          <Link href="/game">
            Go {pointsValue > 0 ? "Spend Them" : "Play"}
          </Link>
        </Button>
      )}
    </div>
  );
};

export default UserPoints; 