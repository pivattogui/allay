import { describe, expect, it } from 'vitest'
import { AppError, ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from './errors.js'

describe('AppError', () => {
  it('creates error with status code and code', () => {
    const err = new AppError('something broke', 500, 'INTERNAL')
    expect(err.message).toBe('something broke')
    expect(err.statusCode).toBe(500)
    expect(err.code).toBe('INTERNAL')
    expect(err.name).toBe('AppError')
    expect(err).toBeInstanceOf(Error)
  })
})

describe('NotFoundError', () => {
  it('defaults to 404 and NOT_FOUND', () => {
    const err = new NotFoundError('Server not found')
    expect(err.statusCode).toBe(404)
    expect(err.code).toBe('NOT_FOUND')
  })

  it('accepts custom code', () => {
    const err = new NotFoundError('Server not found', 'SERVER_NOT_FOUND')
    expect(err.code).toBe('SERVER_NOT_FOUND')
  })
})

describe('UnauthorizedError', () => {
  it('defaults to 401 and UNAUTHORIZED', () => {
    const err = new UnauthorizedError()
    expect(err.statusCode).toBe(401)
    expect(err.code).toBe('UNAUTHORIZED')
    expect(err.message).toBe('Unauthorized')
  })
})

describe('ForbiddenError', () => {
  it('defaults to 403 and FORBIDDEN', () => {
    const err = new ForbiddenError()
    expect(err.statusCode).toBe(403)
    expect(err.code).toBe('FORBIDDEN')
  })
})

describe('ValidationError', () => {
  it('defaults to 422 and includes details', () => {
    const details = { field: ['required'] }
    const err = new ValidationError('Invalid input', 'VALIDATION_ERROR', details)
    expect(err.statusCode).toBe(422)
    expect(err.details).toEqual(details)
  })
})

describe('ConflictError', () => {
  it('defaults to 409 and CONFLICT', () => {
    const err = new ConflictError('Already exists')
    expect(err.statusCode).toBe(409)
    expect(err.code).toBe('CONFLICT')
  })
})
