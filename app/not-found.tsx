'use client'

import { Box, Button, Container, Paper, Stack, Text, Title } from '@mantine/core'
import { ArrowLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Logo } from '@/components/ui/Logo'

export default function NotFound() {
  const router = useRouter()

  return (
    <Box
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background:
          'radial-gradient(circle at top, rgba(61,114,102,0.10), transparent 42%), linear-gradient(180deg, var(--mantine-color-body) 0%, var(--mantine-color-bone-0) 100%)',
      }}
      p="md"
    >
      <Container size={420} w="100%">
        <Paper
          withBorder
          shadow="lg"
          radius="lg"
          p={{ base: 'xl', sm: 'xl' }}
          h="100%"
          pos="relative"
          style={{
            overflow: 'hidden',
            minHeight: 260,
            background:
              'linear-gradient(180deg, rgba(255,255,255,0.88) 0%, rgba(250,248,244,0.96) 100%)',
          }}
        >
          <Box
            pos="absolute"
            top={-42}
            right={-32}
            style={{ opacity: 0.08, pointerEvents: 'none', transform: 'rotate(12deg)' }}
          >
            <Logo height={180} color="var(--mantine-color-pine-7)" />
          </Box>

          <Box
            style={{
              minHeight: 260,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
            }}
          >
            <Stack align="center" gap="sm">
              <Title order={1} fz={{ base: 48, sm: 64 }} c="pine.7">
                404
              </Title>
              <Text fw={600}>Page not found</Text>
              <Text size="sm" c="dimmed" ta="center">
                The page you're looking for doesn't exist or you don't have access to it.
              </Text>
              <Button
                mt="sm"
                leftSection={<ArrowLeft size={16} strokeWidth={1.5} />}
                variant="filled"
                onClick={() => router.back()}
              >
                Back
              </Button>
            </Stack>
          </Box>
        </Paper>
      </Container>
    </Box>
  )
}
