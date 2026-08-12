export type AppOptions = {
  devToken: string
  allowRegistration: boolean
  sessionLifetimeMs: number
  allowedHosts: readonly string[]
  allowedOrigins: readonly string[]
  aiAllowedHosts: readonly string[]
}
