import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const ensureLeadingSlash = (value: string) => (value.startsWith('/') ? value : `/${value}`)
const ensureTrailingSlash = (value: string) => (value.endsWith('/') ? value : `${value}/`)

const normalizeBasePath = (value: string) => ensureTrailingSlash(ensureLeadingSlash(value.trim()))

const resolveGithubRepoBase = (repository: string | undefined) => {
  const repoName = repository?.split('/')[1]?.trim()
  return repoName ? `/${repoName}/` : '/'
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const configuredBase = env.VITE_PUBLIC_BASE_PATH?.trim()
  const isGithubPagesBuild = env.VITE_ROUTER_MODE === 'hash'

  return {
    plugins: [react()],
    base: configuredBase
      ? normalizeBasePath(configuredBase)
      : isGithubPagesBuild
        ? resolveGithubRepoBase(env.GITHUB_REPOSITORY)
        : '/',
  }
})
