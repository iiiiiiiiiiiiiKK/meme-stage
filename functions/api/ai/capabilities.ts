/// <reference types="@cloudflare/workers-types" />
/**
 * AI capabilities probe.
 *
 * Reports only what the server is actually configured for. When no key is set it
 * answers `configured: false` and the UI disables the whole feature — it never
 * pretends an image API exists.
 */
import type { FunctionContext } from "../../_lib/http";
import { json } from "../../_lib/http";
import { publicCapabilities, readConfig } from "../../_lib/imageProvider";

export async function onRequestGet(context: FunctionContext): Promise<Response> {
  const config = readConfig(context.env);
  if (!config) return json(publicCapabilities(null));

  // Confirm the key actually works instead of trusting configuration alone.
  try {
    const response = await fetch(`${config.baseUrl}/v1/models`, {
      headers: { authorization: `Bearer ${config.apiKey}` },
    });
    if (!response.ok) {
      // A rejected key is a configuration fault; a 429/5xx is transient. Both must
      // reach the UI as *unusable but configured*, never as a working feature.
      const reason =
        response.status === 401 || response.status === 403
          ? "图像服务拒绝了当前密钥，请在服务端更新 IMAGE_API_KEY"
          : response.status === 429
            ? "图像服务限流中，请稍后重试"
            : `图像服务返回 ${response.status}，暂时不可用`;
      return json({
        ...publicCapabilities(config),
        configured: true,
        verified: false,
        models: [],
        reason,
        retryable: response.status !== 401 && response.status !== 403,
      });
    }
    const payload = (await response.json()) as { data?: Array<{ id?: string }> };
    const available = new Set((payload.data ?? []).map((item) => item.id).filter(Boolean) as string[]);
    const usable = config.models.filter((model) => available.has(model));
    if (usable.length === 0) {
      return json({
        configured: true,
        models: [],
        sizes: publicCapabilities(config).sizes,
        verified: false,
        reason: `账号里没有可用模型：允许列表为 ${config.models.join(", ")}`,
        retryable: false,
      });
    }
    return json({
      ...publicCapabilities({ ...config, models: usable }),
      verified: true,
    });
  } catch {
    // Network hiccup or gateway outage: report it as retryable instead of
    // pretending the feature is unconfigured forever.
    return json({
      ...publicCapabilities(config),
      configured: true,
      verified: false,
      models: [],
      reason: "暂时无法连接图像服务，请稍后重试",
      retryable: true,
    });
  }
}
