import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FileUploader } from './FileUploader'

class FakeEventTarget {
  private listeners = new Map<string, EventListener[]>()

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  dispatch(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

class FakeXMLHttpRequest extends FakeEventTarget {
  static instances: FakeXMLHttpRequest[] = []

  readonly upload = new FakeEventTarget()
  readonly headers = new Map<string, string>()
  method = ''
  url = ''
  body: Document | XMLHttpRequestBodyInit | null = null
  status = 0
  responseText = ''

  constructor() {
    super()
    FakeXMLHttpRequest.instances.push(this)
  }

  open(method: string, url: string): void {
    this.method = method
    this.url = url
  }

  setRequestHeader(name: string, value: string): void {
    this.headers.set(name, value)
  }

  send(body: Document | XMLHttpRequestBodyInit | null): void {
    this.body = body
  }

  progress(loaded: number, total: number): void {
    this.upload.dispatch('progress', { lengthComputable: true, loaded, total } as ProgressEvent)
  }

  complete(): void {
    this.status = 200
    this.responseText = JSON.stringify({ success: true })
    this.dispatch('load', new Event('load'))
  }
}

describe('FileUploader', () => {
  beforeEach(() => {
    FakeXMLHttpRequest.instances = []
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uploads files sequentially with encoded paths and progress', async () => {
    const onUploadComplete = vi.fn()
    render(
      <FileUploader
        serverId="server-id"
        currentPath="plugins/config"
        open
        onOpenChange={vi.fn()}
        onUploadComplete={onUploadComplete}
      />,
    )

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    if (!input) throw new Error('file input not rendered')

    fireEvent.change(input, {
      target: {
        files: [new File(['first'], 'first file.txt'), new File(['second'], 'second.txt')],
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }))

    await waitFor(() => expect(FakeXMLHttpRequest.instances).toHaveLength(1))
    const first = FakeXMLHttpRequest.instances[0]
    expect(first.method).toBe('PUT')
    expect(first.url).toContain('/api/servers/server-id/files/upload/plugins/config/first%20file.txt')

    act(() => first.progress(5, 10))
    expect(screen.getByText('50%')).toBeInTheDocument()

    act(() => first.complete())
    await waitFor(() => expect(FakeXMLHttpRequest.instances).toHaveLength(2))

    const second = FakeXMLHttpRequest.instances[1]
    expect(second.url).toContain('/api/servers/server-id/files/upload/plugins/config/second.txt')
    act(() => second.complete())

    await waitFor(() => expect(onUploadComplete).toHaveBeenCalledOnce())
  })
})
