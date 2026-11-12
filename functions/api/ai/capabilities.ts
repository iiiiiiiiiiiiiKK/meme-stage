/// <reference types="@cloudflare/workers-types" />
/**
 * AI capabilities probe.
 *
 * Reports only what the server is actually configured for. When no key is set it
 * answers `configured: false` and the UI disables the whole feature — it never
 * pretends an image API exists.
 */
import type { FunctionContext } from "../../_lib/http";
import { fail, json } from "../../_lib/http";
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
      return json({
        ...publicCapabilities(config),
        verified: false,
        reason: `图像服务返回 ${response.status}，请检查密钥是否有效`,
      });
    }
    const payload = (await response.json()) as { data?: Array<{ id?: string }> };
    const available = new Set((payload.data ?? []).map((item) => item.id).filter(Boolean) as string[]);
    const usable = config.models.filter((model) => available.has(model));
    if (usable.length === 0) {
      return json({
        configured: false,
        models: [],
        sizes: publicCapabilities(config).sizes,
        verified: false,
        reason: `账号里没有可用模型：允许列表为 ${config.models.join(", ")}`,
      });
    }
    return json({
      ...publicCapabilities({ ...config, models: usable }),
      verified: true,
    });
  } catch {
    return fail(502, "provider_unreachable", "无法连接图像服务，请稍后重试");
  }
}
