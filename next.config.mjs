/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lint corre aparte (`pnpm lint`, paso propio en pr-check.yml) sobre todo el repo.
  // `next build` solo mira app/, components/ y lib/, y no aplica eslint-suppressions.json.
  eslint: { ignoreDuringBuilds: true },
}

export default nextConfig
