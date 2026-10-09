import "server-only";

// Config-driven list of OpenAI-compatible AI providers. A provider is enabled only when its API key
// env var is set, so adding one is an env var plus an entry here.
// IMPORTANT: every limit below must be verified against the provider's current docs and terms
// (including commercial use) before relying on it. Free tiers change without notice.
// A limit of 0 means "unknown or not tracked": the router never blocks on it.

export type Capability = "chat" | "json" | "vision" | "audio";

export type Provider = {
  id: string;
  label: string;
  baseUrl: string;
  apiKeyEnv: string;
  models: { chat?: string; vision?: string; audio?: string; /** Optional safety classifier (for example Llama Guard). Used only if the account lists it. */ safety?: string };
  limits: { rpm: number; tpm: number; tpd: number; rpd: number };
  capabilities: Capability[];
  /** Lower number is tried first within the same purpose ordering. */
  priority: number;
  enabled: boolean;
  /** "free" providers form the shared pool for free students; "paid" ones serve Pro and admin first. */
  tier: "free" | "paid";
  /** Extra body fields some providers need (or reject). */
  chatExtras?: Record<string, unknown>;
  /** Extra body fields for vision requests (for example hiding a reasoning model's thinking). */
  visionExtras?: Record<string, unknown>;
  /**
   * Which take_ai_slot bucket this entry draws from. Defaults to the provider id. Entries that belong to
   * one account (for example NVIDIA chat and NVIDIA vision) share a slotKey so their requests are counted together.
   */
  slotKey?: string;
};

/** The slot bucket a provider counts against. */
export const slotOf = (p: Provider) => p.slotKey ?? p.id;

const has = (env: string) => !!process.env[env];

export const PROVIDERS: Provider[] = [
  {
    // Paid Groq account (billed per use). Same models as the free one; enabled only when GROQ_PAID_API_KEY is set.
    // Limits are 0 (unknown): the paid account's own limits apply and the router never blocks on them.
    id: "groq-paid",
    label: "Groq (paid)",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKeyEnv: "GROQ_PAID_API_KEY",
    models: { chat: "openai/gpt-oss-120b", vision: "qwen/qwen3.8-27b", audio: "whisper-large-v3-turbo", safety: process.env.GROQ_SAFETY_MODEL || "meta-llama/llama-guard-4-12b" },
    limits: { rpm: 0, tpm: 0, tpd: 0, rpd: 0 },
    capabilities: ["chat", "json", "vision", "audio"],
    priority: 0,
    enabled: has("GROQ_PAID_API_KEY"),
    tier: "paid",
    chatExtras: { reasoning_effort: "low" },
    visionExtras: { reasoning_format: "hidden" },
  },
  {
    // Verify limits at https://console.groq.com/docs/rate-limits
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKeyEnv: "GROQ_API_KEY",
    models: { chat: "openai/gpt-oss-120b", vision: "qwen/qwen3.8-27b", audio: "whisper-large-v3-turbo", safety: process.env.GROQ_SAFETY_MODEL || "meta-llama/llama-guard-4-12b" },
    limits: { rpm: 30, tpm: 0, tpd: 200000, rpd: 0 },
    capabilities: ["chat", "json", "vision", "audio"],
    priority: 1,
    enabled: has("GROQ_API_KEY"),
    tier: "free",
    chatExtras: { reasoning_effort: "low" },
    visionExtras: { reasoning_format: "hidden" },
  },
  {
    // Verify limits at https://inference-docs.cerebras.ai/support/rate-limits
    id: "cerebras",
    label: "Cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    apiKeyEnv: "CEREBRAS_API_KEY",
    models: { chat: "gpt-oss-120b" },
    limits: { rpm: 5, tpm: 60000, tpd: 1000000, rpd: 0 },
    capabilities: ["chat", "json"],
    priority: 2,
    enabled: has("CEREBRAS_API_KEY"),
    tier: "free",
    chatExtras: { reasoning_effort: "low" },
  },
  {
    // Verify limits at https://build.nvidia.com (account rate limits)
    id: "nvidia",
    label: "NVIDIA",
    // NVIDIA_BASE_URL and NVIDIA_MODEL override these, for a dedicated endpoint or a different model.
    baseUrl: process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1",
    apiKeyEnv: "NVIDIA_API_KEY",
    models: { chat: process.env.NVIDIA_MODEL || "openai/gpt-oss-120b" },
    limits: { rpm: 40, tpm: 0, tpd: 0, rpd: 10000 },
    capabilities: ["chat", "json"],
    priority: 3,
    enabled: has("NVIDIA_API_KEY"),
    tier: "free",
    slotKey: "nvidia",
  },
  {
    // NVIDIA vision. Enabled only when both NVIDIA_API_KEY and NVIDIA_VISION_MODEL are set; paste whichever
    // vision model your endpoint page lists. NVIDIA's free limit is per account, so this shares the "nvidia"
    // slot bucket with the chat entry above (same slotKey, same limits).
    // FALLBACK ONLY: an 11B model such as meta/llama-3.2-11b-vision-instruct is likely weaker than Groq's
    // qwen vision at handwriting, photographed timetables and scanned pages. Vision routing follows
    // `priority`, so this must stay numerically higher (tried later) than both Groq entries.
    id: "nvidia-vision",
    label: "NVIDIA (vision)",
    baseUrl: process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1",
    // NVIDIA can issue a separate key per model: set NVIDIA_VISION_API_KEY when the vision model
    // has its own. With one key for everything, leave it unset and NVIDIA_API_KEY is used.
    apiKeyEnv: has("NVIDIA_VISION_API_KEY") ? "NVIDIA_VISION_API_KEY" : "NVIDIA_API_KEY",
    models: { vision: process.env.NVIDIA_VISION_MODEL },
    limits: { rpm: 40, tpm: 0, tpd: 0, rpd: 10000 },
    capabilities: ["vision", "json"],
    priority: 10,
    enabled: (has("NVIDIA_VISION_API_KEY") || has("NVIDIA_API_KEY")) && has("NVIDIA_VISION_MODEL"),
    tier: "free",
    slotKey: "nvidia",
  },
  {
    // Verify at https://developers.cloudflare.com/workers-ai/platform/pricing/ (quota is in neurons, not tokens)
    id: "cloudflare",
    label: "Cloudflare Workers AI",
    baseUrl: `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID ?? ""}/ai/v1`,
    apiKeyEnv: "CLOUDFLARE_API_KEY",
    models: { chat: "@cf/openai/gpt-oss-120b" },
    limits: { rpm: 0, tpm: 0, tpd: 0, rpd: 0 },
    capabilities: ["chat", "json"],
    priority: 4,
    enabled: has("CLOUDFLARE_API_KEY") && has("CLOUDFLARE_ACCOUNT_ID"),
    tier: "free",
  },
];

export const providerKey = (p: Provider) => process.env[p.apiKeyEnv] ?? "";
export const getProvider = (id: string) => PROVIDERS.find((p) => p.id === id);
