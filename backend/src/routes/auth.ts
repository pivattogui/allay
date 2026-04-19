import { jwt } from '@elysiajs/jwt'
import { count, eq } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { config } from '../config.js'
import { db } from '../db/index.js'
import { users } from '../db/schema.js'
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from '../errors.js'
import { AuthStatusResponse, LoginBody, LoginResponse, MeResponse, SetupResponse } from '../schemas/auth.js'
import { ErrorResponse } from '../schemas/common.js'
import type { JwtPayload } from '../types/index.js'
import { LoginSchema } from '../types/index.js'

export const authRoutes = new Elysia({ prefix: '/api/auth', detail: { tags: ['auth'] } })
  .use(
    jwt({
      name: 'jwt',
      secret: config.jwt.secret,
      exp: config.jwt.expiresIn,
    }),
  )
  .get(
    '/status',
    async () => {
      const [result] = await db.select({ count: count() }).from(users)
      return {
        setupRequired: result.count === 0,
      }
    },
    {
      response: {
        200: AuthStatusResponse,
      },
      detail: {
        summary: 'Check setup status',
        description: 'Check if initial admin setup is required',
      },
    },
  )
  .post(
    '/setup',
    async ({ body }) => {
      const [result] = await db.select({ count: count() }).from(users)

      if (result.count > 0) {
        throw new ConflictError('Setup already completed', 'SETUP_COMPLETED')
      }

      const parsed = LoginSchema.safeParse(body)
      if (!parsed.success) {
        throw new ValidationError('Validation Error', 'VALIDATION_ERROR', parsed.error.flatten())
      }

      const { username, password } = parsed.data
      const passwordHash = await Bun.password.hash(password, { algorithm: 'bcrypt', cost: 10 })

      await db.insert(users).values({ username, passwordHash })

      return { message: 'Setup completed successfully' }
    },
    {
      body: LoginBody,
      response: {
        200: SetupResponse,
        400: ErrorResponse,
        409: ErrorResponse,
      },
      detail: {
        summary: 'Initial setup',
        description: 'Create the initial admin account. Only works if no users exist.',
      },
    },
  )
  .post(
    '/login',
    async ({ body, jwt }) => {
      const parsed = LoginSchema.safeParse(body)
      if (!parsed.success) {
        throw new ValidationError('Validation Error', 'VALIDATION_ERROR', parsed.error.flatten())
      }

      const { username, password } = parsed.data

      const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1)

      if (!user) {
        throw new UnauthorizedError('Invalid credentials', 'INVALID_CREDENTIALS')
      }

      const validPassword = await Bun.password.verify(password, user.passwordHash)
      if (!validPassword) {
        throw new UnauthorizedError('Invalid credentials', 'INVALID_CREDENTIALS')
      }

      const token = await jwt.sign({
        userId: user.id,
        username: user.username,
      })

      return { token, user: { id: user.id, username: user.username } }
    },
    {
      body: LoginBody,
      response: {
        200: LoginResponse,
        400: ErrorResponse,
        401: ErrorResponse,
      },
      detail: {
        summary: 'Login',
        description: 'Authenticate with username and password to receive a JWT token',
      },
    },
  )
  .resolve(async ({ jwt: jwtPlugin, headers }) => {
    const auth = headers.authorization
    if (!auth?.startsWith('Bearer ')) {
      throw new UnauthorizedError()
    }

    const payload = await jwtPlugin.verify(auth.slice(7))
    if (!payload) {
      throw new UnauthorizedError()
    }

    return { user: payload as unknown as JwtPayload }
  })
  .get(
    '/me',
    async ({ user }) => {
      const [found] = await db
        .select({ id: users.id, username: users.username, createdAt: users.createdAt })
        .from(users)
        .where(eq(users.id, user.userId))
        .limit(1)

      if (!found) {
        throw new NotFoundError('User not found', 'USER_NOT_FOUND')
      }

      return { user: found }
    },
    {
      response: {
        200: MeResponse,
        401: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Get current user',
        description: 'Get the currently authenticated user information',
        security: [{ bearerAuth: [] }],
      },
    },
  )
