import pino from 'pino'
import { config } from './config.js'

export const logger = pino({
  level: config.logLevel,
  ...(config.isDev && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname',
      },
    },
  }),
})

export function createLogger(module: string) {
  return logger.child({ module })
}
