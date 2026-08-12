"use client";

import { useState, type KeyboardEvent } from "react";

/**
 * Shared admin-only collapse state and header interaction props.
 * Non-admins get a non-interactive header and always-visible content.
 */
export function useAdminCollapse(isAdmin: boolean) {
  const [isAdminCollapsed, setIsAdminCollapsed] = useState(true);

  const toggleAdminCollapse = () => {
    if (!isAdmin) return;
    setIsAdminCollapsed((value) => !value);
  };

  const onHeaderKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isAdmin) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleAdminCollapse();
    }
  };

  return {
    isAdminCollapsed,
    isContentVisible: !isAdmin || !isAdminCollapsed,
    headerProps: {
      role: isAdmin ? ("button" as const) : undefined,
      tabIndex: isAdmin ? 0 : -1,
      onClick: toggleAdminCollapse,
      onKeyDown: onHeaderKeyDown,
    },
  };
}
