'use client';

import { useEffect, useState } from 'react';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClientProvider } from '@tanstack/react-query';
import { theme } from './theme';
import { makeQueryClient } from './query-client';
import { httpClient } from './http-client';
import { clearSession, setSession } from './session';

type SessionEndpointResponse = { isPlatformAdmin: boolean } | null;

// The session moved from localStorage (synchronously readable) to an httpOnly cookie
// (lib/http-client.ts), so lib/session.ts's module store can't self-hydrate anymore —
// this runs once per page load to ask the server "who am I" and seed that store.
// `isPlatformAdmin` (access/tenant/resolveTenantContext.ts) is the actual identity signal —
// it's true only for the `admins` collection, so it doubles as the users/admins
// disambiguation the old localStorage-based session used to need `collection` for.
function SessionBootstrap() {
  useEffect(() => {
    httpClient
      .get<SessionEndpointResponse>('/api/v1/session')
      .then((ctx) => setSession({ collection: ctx?.isPlatformAdmin ? 'admins' : 'users' }))
      .catch(() => clearSession());
  }, []);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <MantineProvider theme={theme} defaultColorScheme="light">
        <Notifications position="top-right" />
        <SessionBootstrap />
        {children}
      </MantineProvider>
    </QueryClientProvider>
  );
}
