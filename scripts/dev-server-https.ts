process.env.HTTPS = process.env.HTTPS || '1'

await import('./dev-server.ts')

export {}
