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
export interface ModelCard {
  id: string;
  vendor: ModelVendor;
  name: string;
  apiUrl: string;
  hasApiKey: boolean;
  model: string;
  revision: number;
}
export interface ModelBinding {
  scriptId: string;
  name: string;
  cardId: string;
  revision: number;
}
export interface ModelCardsState {
  cards: ModelCard[];
  bindings: ModelBinding[];
}
export type ModelCardDraft = Omit<ModelCard, "id" | "hasApiKey"> & { apiKey: string };
const BASE = "/api/workflow-admin/model-connections";
async function request(path: string, init?: RequestInit): Promise<ModelCardsState> {
  const response = await fetch(BASE + path, {
    ...init, credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { detail?: unknown } | null;
    throw new Error(typeof data?.detail === "string" ? data.detail : "模型配置请求失败");
  }
  return response.json() as Promise<ModelCardsState>;
}
export const modelCardsApi = {
  list: () => request(""),
  save: (id: string | null, draft: ModelCardDraft) => request(id ? `/cards/${encodeURIComponent(id)}` : "/cards", {
    method: id ? "PUT" : "POST", body: JSON.stringify(draft),
  }),
  delete: (card: ModelCard) => request(`/cards/${encodeURIComponent(card.id)}?revision=${card.revision}`, { method: "DELETE" }),
  bind: (binding: ModelBinding, cardId: string) => request(`/bindings/${encodeURIComponent(binding.scriptId)}`, {
    method: "PUT", body: JSON.stringify({ cardId, revision: binding.revision }),
  }),
};
