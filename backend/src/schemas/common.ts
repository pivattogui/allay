import { t } from 'elysia'

// Common error response
export const ErrorResponse = t.Object({
  error: t.String({ description: 'Error message' }),
  code: t.String({ description: 'Error code' }),
  details: t.Optional(t.Unknown({ description: 'Additional error details' })),
})

// Common success message
export const MessageResponse = t.Object({
  message: t.String({ description: 'Success message' }),
})

// Server state enum
export const ServerState = t.Union(
  [t.Literal('stopped'), t.Literal('starting'), t.Literal('running'), t.Literal('stopping'), t.Literal('crashed')],
  { description: 'Current server state' },
)

// Server type enum
export const ServerType = t.Union([t.Literal('vanilla'), t.Literal('paper')], { description: 'Minecraft server type' })

// Server status
export const ServerStatus = t.Object({
  state: ServerState,
  pid: t.Optional(t.Number({ description: 'Process ID' })),
  uptime: t.Optional(t.Number({ description: 'Uptime in seconds' })),
  lastError: t.Optional(t.String({ description: 'Last error message' })),
})

// ID parameter
export const IdParam = t.Object({
  id: t.String({ description: 'Server UUID' }),
})

// Server ID parameter
export const ServerIdParam = t.Object({
  serverId: t.String({ description: 'Server UUID' }),
})

// Bearer auth header
export const BearerAuth = t.Object({
  authorization: t.String({ description: 'Bearer token' }),
})
