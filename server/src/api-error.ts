import { HttpException } from '@nestjs/common'

export function apiError(status: number, code: string, message: string): HttpException {
  return new HttpException({ error: { code, message } }, status)
}
