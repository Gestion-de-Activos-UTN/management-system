'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  Alert,
  Box,
  Button,
  Card,
  Flex,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { useLogin } from '@/modules/auth/hooks/use-login'

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
        <Stack h="100%" justify="center" p={60} gap="xs">
          <Title c="white" order={1}>
            SIAM
          </Title>
          <Text c="pine.1" maw={320}>
            Sistema de Gestión de Activos.
          </Text>
        </Stack>
      </Box>
      <Flex flex={1} align="center" justify="center" bg="bone.0" p="md">
        <Card withBorder shadow="md" radius="md" padding="xl" w={360}>
          <form onSubmit={handleSubmit}>
            <Stack gap="md">
              <Stack gap={0}>
                <Title order={3} hiddenFrom="sm">
                  SIAM
                </Title>
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
