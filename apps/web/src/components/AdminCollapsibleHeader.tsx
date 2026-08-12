"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import type { KeyboardEventHandler, ReactNode } from "react";

import { cn } from "@/lib/utils";

type AdminCollapsibleHeaderProps = {
  isAdmin: boolean;
  isAdminCollapsed: boolean;
  title: ReactNode;
  description?: ReactNode;
  className?: string;
  titleWrapperClassName?: string;
  role?: "button";
  tabIndex: number;
  onClick: () => void;
  onKeyDown: KeyboardEventHandler<HTMLDivElement>;
};

export function AdminCollapsibleHeader({
  isAdmin,
  isAdminCollapsed,
  title,
  description,
  className,
  titleWrapperClassName,
  role,
  tabIndex,
  onClick,
  onKeyDown,
}: AdminCollapsibleHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col",
        isAdmin ? "cursor-pointer select-none" : undefined,
        className
      )}
      role={role}
      tabIndex={tabIndex}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <div className="flex items-center justify-between">
        <div className={cn("flex flex-col gap-1", titleWrapperClassName)}>
          {title}
          {description}
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              Admin
            </span>
            {isAdminCollapsed ? (
              <ChevronDown className="h-5 w-5 text-gray-400" />
            ) : (
              <ChevronUp className="h-5 w-5 text-gray-400" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
