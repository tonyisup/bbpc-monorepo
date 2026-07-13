'use client';

import { createContext, useContext } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';

export interface PresenceMember {
  id: string;
  name: string;
}

interface PresenceContextValue {
  members: PresenceMember[];
  connected: boolean;
  resetConnections: () => void;
}

const PresenceContext = createContext<PresenceContextValue>({
  members: [],
  connected: false,
  resetConnections: () => {},
});

interface PresenceProviderProps {
  children: React.ReactNode;
  sessionId: string;
  clientId: string;
  accessToken: string;
}

export function PresenceProvider({ children, sessionId, clientId, accessToken }: PresenceProviderProps) {
  const members = useQuery(api.sessions.listParticipants, {
    publicId: sessionId,
    clientId,
    accessToken,
  });

  return (
    <PresenceContext.Provider
      value={{
        members: members ?? [],
        connected: members !== undefined,
        resetConnections: () => {},
      }}
    >
      {children}
    </PresenceContext.Provider>
  );
}

export function usePresence(): PresenceContextValue {
  return useContext(PresenceContext);
}
