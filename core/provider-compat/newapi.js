/**
 * NewAPI / Kimi K3 网关兼容层
 *
 * 处理 provider:
 *   - provider === "newapi"
 *   - baseUrl 包含 30573（Kimi K3 路由网关特征端口）
 *
 * 解决的协议问题：
 *   1. utility 模式思考模型空响应（LLM_EMPTY_RESPONSE）
 *      Kimi K3 思考模型非流式调用时输出全部进入 reasoning 字段，
 *      content 为空。utility 任务（记忆/摘要）只需短输出。
 *   2. 修复方式：utility 模式注入 enable_thinking: false（vllm/openai-compat 标准参数）
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
  return provider === "newapi" || baseUrl.includes("30573");
}

export function apply(payload, model, options = {}) {
  if (!Array.isArray(payload.messages)) return payload;
  const mode = options.mode || "chat";
  if (mode !== "utility") return payload;
  // 思考 model 才注入；非思考 model 注入也无害
  if (model?.reasoning !== true) return payload;
  payload.enable_thinking = false;
  return payload;
}
