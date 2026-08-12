'use client';

import { useCallback, useRef } from 'react';

/**
 * Generates unique IDs combining timestamp + incrementing counter.
 * Guarantees uniqueness even when called multiple times in the same millisecond.
 */
export function useUniqueId(prefix: string) {
  const counterRef = useRef(0);

  return useCallback(() => {
    counterRef.current += 1;
    return `${prefix}-${Date.now()}-${counterRef.current}`;
  }, [prefix]);
}
