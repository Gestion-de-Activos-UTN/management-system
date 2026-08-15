'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Center, Loader } from '@mantine/core';

export default function PortalIndexPage() {
  const router = useRouter();
  const asOrganization = useSearchParams().get('asOrganization');

  useEffect(() => {
    const suffix = asOrganization ? `?asOrganization=${asOrganization}` : '';
    router.replace(`/portal/dashboard${suffix}`);
  }, [asOrganization, router]);

  return (
    <Center h="60vh">
      <Loader />
    </Center>
  );
}
