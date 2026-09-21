/**
 * Zhipu (GLM) provider 兼容层
 *
 * 处理 provider:
 *   - provider === "zhipu"
 *   - baseUrl 包含 awcloudvip.com:9443（our zhipu/oneapi 网关）
 *
 * 解决的协议问题：
 *   1. utility 模式思考模式空响应（LLM_EMPTY_RESPONSE）
 *      zhipu glm53-flash 等思考模型，非流式调用时输出全部进入 JSON 的
 *      reasoning 字段，content 为空。utility 任务（lim记忆/摘要）只需短输出，
 *      思考链既无意义又耗光预算。
 *   2. 修复方式：utility 模式注入 enable_thinking: false（oneapi/vllm 标准参数）
 *
 * 接口契约：见 ../README.md
 */

function lower(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

export function matches(model) {
  if (!model || typeof model !== "object") return false;
  const provider = lower(model.provider);
  const baseUrl = lower(model.baseUrl || model.base_url);
  return provider === "zhipu"
    || (baseUrl.includes("awcloudvip.com") && baseUrl.includes(":9443"));
}

export function apply(payload, model, options = {}) {
  if (!Array.isArray(payload.messages)) return payload;
  const mode = options.mode || "chat";
  if (mode !== "utility") return payload;
  // 思考 model 才注入；非思考 model 注入也无害（网关忽略未知字段）
  if (model?.reasoning !== true) return payload;
  payload.enable_thinking = false;
  return payload;
}
