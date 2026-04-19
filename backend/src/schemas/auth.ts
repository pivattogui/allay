import { t } from 'elysia'

// Login/Setup request body
export const LoginBody = t.Object({
  username: t.String({ minLength: 3, maxLength: 50, description: 'Username (3-50 characters)' }),
  password: t.String({ minLength: 6, maxLength: 100, description: 'Password (6-100 characters)' }),
})

// Auth status response
export const AuthStatusResponse = t.Object({
  setupRequired: t.Boolean({ description: 'Whether initial setup is required' }),
})

// Setup response
export const SetupResponse = t.Object({
  message: t.String({ description: 'Success message' }),
})

// Login response
export const LoginResponse = t.Object({
  token: t.String({ description: 'JWT access token' }),
  user: t.Object({
    id: t.String({ description: 'User UUID' }),
    username: t.String({ description: 'Username' }),
  }),
})

// Current user response
export const MeResponse = t.Object({
  user: t.Object({
    id: t.String({ description: 'User UUID' }),
    username: t.String({ description: 'Username' }),
    createdAt: t.Date({ description: 'Account creation date' }),
  }),
})
