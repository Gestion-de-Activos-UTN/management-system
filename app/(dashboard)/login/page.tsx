'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  Alert,
  Box,
  Button,
  Card,
  Flex,
  Group,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { useLogin } from '@/modules/auth/hooks/use-login'
import { Logo } from '@/components/ui/Logo'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const router = useRouter()
  const login = useLogin()

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    login.mutate(
      { email, password },
      { onSuccess: session => router.replace(session.collection === 'admins' ? '/' : '/portal') }
    )
  }

  return (
    <Flex h="100vh" wrap="nowrap">
      <Box
        visibleFrom="sm"
        w="45%"
        bg="pine.7"
        style={{
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.08) 1.5px, transparent 1.5px)',
          backgroundSize: '24px 24px',
        }}
      >
        <Stack h="100%" justify="center" align="center" ta="center" p={60} gap="xs">
          <Group gap="md" align="center">
            <Logo height={96} color="white" />
            <Title c="white" order={1} fz="4rem" style={{ lineHeight: 1 }}>
              SIAM
            </Title>
          </Group>
          <Text c="pine.1" maw={320}>
            Track assets, monitor risk, and keep every organization&apos;s inventory audit-ready
            from one place.
          </Text>
        </Stack>
      </Box>
      <Flex
        flex={1}
        align="center"
        justify="center"
        p="md"
        pos="relative"
        style={{ overflow: 'hidden' }}
      >
        <Box
          pos="absolute"
          top="50%"
          left="47%"
          style={{ transform: 'translate(-50%, -50%)', opacity: 0.04, pointerEvents: 'none' }}
        >
          <Logo height={1300} color="var(--mantine-color-pine-7)" />
        </Box>
        <Card
          withBorder
          shadow="md"
          radius="md"
          padding="xl"
          w={360}
          className="login-card"
          pos="relative"
        >
          <form onSubmit={handleSubmit}>
            <Stack gap="md">
              <Stack gap={0}>
                <Group gap="xs" hiddenFrom="sm">
                  <Logo height={24} />
                  <Title order={3}>SIAM</Title>
                </Group>
                <Title order={2} visibleFrom="sm">
                  Welcome back
                </Title>
                <Text c="dimmed" size="sm">
                  Sign in to continue
                </Text>
              </Stack>
              <TextInput
                label="Email"
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.currentTarget.value)}
              />
              <PasswordInput
                label="Password"
                required
                value={password}
                onChange={e => setPassword(e.currentTarget.value)}
              />
              {login.isError && (
                <Alert color="red" title="Login failed">
                  {login.error.message}
                </Alert>
              )}
              <Button type="submit" loading={login.isPending} fullWidth>
                Sign in
              </Button>
            </Stack>
          </form>
        </Card>
      </Flex>
    </Flex>
  )
}
