/**
 * 微信支付 APIv3 错误归一化。
 *
 * v3 接口没有"业务体 code"约定：HTTP 2xx 即成功，失败以
 * 非 2xx 状态码 + JSON body {code, message} 表达（axios 会抛错）。
 * 本模块把 axios 错误统一转换为 WechatApiError。
 */
export class WechatApiError extends Error {
  /** HTTP 状态码（网络层错误时为 undefined） */
  readonly status?: number
  /** 错误码，如 PARAM_ERROR / RESOURCE_NOT_EXISTS / NETWORK_ERROR */
  readonly code: string

  constructor(message: string, status: number | undefined, code: string) {
    super(message)
    this.name = 'WechatApiError'
    this.status = status
    this.code = code
  }
}

/** 将任意请求异常归一化为 WechatApiError */
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
      `微信支付接口调用失败: ${bizMessage ?? axiosError?.message ?? '未知错误'} (${status}${bizCode ? `, ${bizCode}` : ''})`,
      status,
      bizCode ?? String(status)
    )
  }
  return new WechatApiError(
    `微信支付请求失败: ${axiosError?.message ?? '未知错误'}${axiosError?.code ? ` (${axiosError.code})` : ''}`,
    undefined,
    axiosError?.code ?? 'NETWORK_ERROR'
  )
}

/** 包装请求 promise：失败时抛出 WechatApiError */
export async function unwrapV3<T>(promise: PromiseLike<T>): Promise<T> {
  try {
    return await promise
  } catch (error) {
    throw toWechatApiError(error)
  }
}
