import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LogEntry } from '@/types/server'
import { ServerStateBanner } from './ServerStateBanner'

function makeLog(message: string, level = 'INFO'): LogEntry {
  return { timestamp: new Date().toISOString(), level, message }
}

describe('ServerStateBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders nothing for running state', () => {
    const { container } = render(<ServerStateBanner serverState="running" logs={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing for stopped state', () => {
    const { container } = render(<ServerStateBanner serverState="stopped" logs={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders starting banner with label', () => {
    render(<ServerStateBanner serverState="starting" logs={[]} />)
    expect(screen.getByText('Starting server')).toBeDefined()
  })

  it('shows elapsed time for starting state', () => {
    render(<ServerStateBanner serverState="starting" logs={[]} />)
    expect(screen.getByText('0s')).toBeDefined()

    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(screen.getByText('5s')).toBeDefined()
  })

  it('renders crash banner with exit code', () => {
    render(<ServerStateBanner serverState="crashed" lastError="Process exited with code 1, signal null" logs={[]} />)
    expect(screen.getByText('Server crashed')).toBeDefined()
    expect(screen.getByText(/exit code 1/)).toBeDefined()
  })

  it('extracts error class from logs', () => {
    const logs = [makeLog('java.lang.OutOfMemoryError: Java heap space', 'ERROR')]
    render(<ServerStateBanner serverState="crashed" lastError="Process exited with code 1, signal null" logs={logs} />)
    expect(screen.getByText(/OutOfMemoryError/)).toBeDefined()
  })

  it('shows only exit code when no error class found', () => {
    const logs = [makeLog('Something went wrong', 'ERROR')]
    render(
      <ServerStateBanner serverState="crashed" lastError="Process exited with code 137, signal SIGKILL" logs={logs} />,
    )
    expect(screen.getByText('exit code 137')).toBeDefined()
  })
})
