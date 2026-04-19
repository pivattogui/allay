export interface WSClient {
  readonly id: string
  send(data: string | ArrayBuffer | Uint8Array): void
  readonly readyState: number
}

export const WS_OPEN = 1
