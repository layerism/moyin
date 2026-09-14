export const MODEL_VENDORS = [
  { id: "openai", name: "OpenAI" },
  { id: "deepseek", name: "DeepSeek" },
  { id: "qwen", name: "通义千问" },
  { id: "doubao", name: "豆包" },
  { id: "zhipu", name: "智谱" },
  { id: "moonshot", name: "Moonshot" },
  { id: "custom", name: "自定义" },
] as const;
export type ModelVendor = typeof MODEL_VENDORS[number]["id"];
export interface ModelThinking { mode: "default" | "off" | "on"; effort: string; budget: number | null }
export interface ThinkingProfile { id: string; modes: ModelThinking["mode"][]; efforts: string[]; budgetSupported: boolean; note: string; modeLabels: Record<ModelThinking["mode"], string>; effortLabels: Record<string, string>; defaultEffortLabel: string }
export interface ModelCard {
  id: string;
  vendor: ModelVendor;
  name: string;
  apiUrl: string;
  hasApiKey: boolean;
  hasBillingCredentials: boolean;
  model: string;
  revision: number;
  thinking: ModelThinking;
  thinkingProfile: ThinkingProfile;
  balanceCapability: { supported: boolean; reason: string };
}
export interface ModelBalance { available: boolean; checkedAt: string; balances: { currency: string; available: string; credit?: string; cash?: string; details?: { label: string; value: string }[] }[] }
export interface ModelTestResult { success: boolean; detail: string; elapsedMs: number | null }
export interface ModelNodeUsage {
  flowId: string;
  nodeKey: string;
  name: string;
  cardId: string;
}
export interface ModelCardsState {
  scripts: { id: string; name: string }[];
  cards: ModelCard[];
  usages: ModelNodeUsage[];
}
export type ModelCardDraft = Omit<ModelCard, "id" | "hasApiKey" | "hasBillingCredentials" | "balanceCapability" | "thinkingProfile"> & { apiKey: string; billingAccessKey: string; billingSecretKey: string; billingConsoleToken: string; clearBilling: boolean };
const BASE = "/api/workflow-admin/model-connections";
async function request<T = ModelCardsState>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(BASE + path, {
    ...init, credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { detail?: unknown } | null;
    throw new Error(typeof data?.detail === "string" ? data.detail : "模型配置请求失败");
  }
  return response.json() as Promise<T>;
}
export const modelCardsApi = {
  test: (card: ModelCard) => request<ModelTestResult>(`/cards/${encodeURIComponent(card.id)}/test?revision=${card.revision}`, { method: "POST" }),
  balance: (card: ModelCard) => request<ModelBalance>(`/cards/${encodeURIComponent(card.id)}/balance?revision=${card.revision}`, { cache: "no-store" }),
  list: () => request(""),
  save: (id: string | null, draft: ModelCardDraft) => request(id ? `/cards/${encodeURIComponent(id)}` : "/cards", {
    method: id ? "PUT" : "POST", body: JSON.stringify(draft),
  }),
  delete: (card: ModelCard) => request(`/cards/${encodeURIComponent(card.id)}?revision=${card.revision}`, { method: "DELETE" }),
  models: (cardId: string | null, draft: ModelCardDraft) => request<{ models: string[] }>("/models", {
    method: "POST", body: JSON.stringify({ cardId, revision: draft.revision, vendor: draft.vendor, apiUrl: draft.apiUrl, apiKey: draft.apiKey }),
  }),
  thinkingProfile: (vendor: ModelVendor, model: string) => request<ThinkingProfile>(`/thinking-profile?vendor=${encodeURIComponent(vendor)}&model=${encodeURIComponent(model)}`),
};

export function modelConsoleUrl(card: ModelCard): string | null {
  const consoles: Partial<Record<ModelVendor, string>> = {
    openai: "https://platform.openai.com/",
    deepseek: "https://platform.deepseek.com/",
    qwen: "https://bailian.console.aliyun.com/",
    doubao: "https://console.volcengine.com/ark",
    zhipu: "https://bigmodel.cn/console/overview",
  };
  if (card.vendor === "moonshot") {
    try {
      if (new URL(card.apiUrl).hostname === "api.moonshot.ai") return "https://platform.kimi.ai/console";
    } catch { /* An incomplete card can still link to the provider console. */ }
    return "https://platform.kimi.com/console";
  }
  return consoles[card.vendor] ?? null;
}
