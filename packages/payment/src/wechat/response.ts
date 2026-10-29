/**
 * Normalizes WeChat Pay APIv3 errors.
 *
 * The v3 API has no "business body code" convention: HTTP 2xx means success; failures are
 * expressed as non-2xx status codes plus a JSON body {code, message} (axios throws).
 * This module converts axios errors into WechatApiError uniformly.
 */
export class WechatApiError extends Error {
  /** HTTP status code (undefined for network-level errors) */
  readonly status?: number
  /** Error code, e.g. PARAM_ERROR / RESOURCE_NOT_EXISTS / NETWORK_ERROR */
  readonly code: string

  constructor(message: string, status: number | undefined, code: string) {
    super(message)
    this.name = 'WechatApiError'
    this.status = status
    this.code = code
  }
}

/** Normalize any request exception into WechatApiError */
export function toWechatApiError(error: unknown): WechatApiError {
  if (error instanceof WechatApiError) return error
  const axiosError = error as {
    response?: { status?: number; data?: { code?: string; message?: string } }
    code?: string
    message?: string
  }
  const status = axiosError?.response?.status
  const bizCode = axiosError?.response?.data?.code
  const bizMessage = axiosError?.response?.data?.message
  if (status !== undefined) {
    return new WechatApiError(
      `WeChat Pay API call failed: ${bizMessage ?? axiosError?.message ?? 'unknown error'} (${status}${bizCode ? `, ${bizCode}` : ''})`,
      status,
      bizCode ?? String(status)
    )
  }
  return new WechatApiError(
    `WeChat Pay request failed: ${axiosError?.message ?? 'unknown error'}${axiosError?.code ? ` (${axiosError.code})` : ''}`,
    undefined,
    axiosError?.code ?? 'NETWORK_ERROR'
  )
}

/** Wrap a request promise: throws WechatApiError on failure */
export async function unwrapV3<T>(promise: PromiseLike<T>): Promise<T> {
  try {
    return await promise
  } catch (error) {
    throw toWechatApiError(error)
  }
}
