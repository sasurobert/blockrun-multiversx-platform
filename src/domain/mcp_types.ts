import { z } from "zod";

export const McpRpcVersionSchema = z.literal("2.0");

export const McpPricingConfigSchema = z.object({
  microUsdc: z.string().regex(/^\d+$/, "microUsdc must be an integer string"),
  usdFormatted: z.string(),
  token: z.string().min(1),
  serviceId: z.number().int().nonnegative(),
  providerAgentNonce: z.number().int().nonnegative(),
});

export type McpPricingConfig = z.infer<typeof McpPricingConfigSchema>;

export const McpToolDefinitionSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  inputSchema: z.record(z.unknown()),
  pricing: McpPricingConfigSchema,
  payTo: z.string().optional(),
  endpointUrl: z.string().optional(),
  reputationScore: z.number().min(0).max(100).optional(),
  totalCompletedJobs: z.number().int().nonnegative().optional(),
});

export type McpToolDefinition = z.infer<typeof McpToolDefinitionSchema>;

export const McpRpcRequestSchema = z.object({
  jsonrpc: McpRpcVersionSchema,
  id: z.union([z.string(), z.number()]),
  method: z.enum(["tools/call", "resources/read", "tools/list"]),
  params: z
    .object({
      name: z.string().optional(),
      arguments: z.record(z.unknown()).optional(),
      uri: z.string().optional(),
    })
    .catchall(z.unknown())
    .optional(),
});

export type McpRpcRequest = z.infer<typeof McpRpcRequestSchema>;

export const McpContentItemSchema = z.object({
  type: z.string().default("text"),
  text: z.string(),
});

export const McpToolCallResultSchema = z.object({
  content: z.array(McpContentItemSchema),
  isError: z.boolean().default(false),
  paymentReceipt: z.string().optional(),
  errorCode: z.string().optional(),
});

export type McpToolCallResult = z.infer<typeof McpToolCallResultSchema>;

export const McpResourceContentSchema = z.object({
  uri: z.string(),
  mimeType: z.string().optional(),
  text: z.string().optional(),
  blob: z.string().optional(),
});

export const McpResourceReadResultSchema = z.object({
  contents: z.array(McpResourceContentSchema),
  paymentReceipt: z.string().optional(),
});

export type McpResourceReadResult = z.infer<typeof McpResourceReadResultSchema>;

export const McpToolsListResponseSchema = z.object({
  tools: z.array(McpToolDefinitionSchema),
});

export type McpToolsListResponse = z.infer<typeof McpToolsListResponseSchema>;

export const McpToolRegisterRequestSchema = z.object({
  name: z.string().min(1, "Tool name is required"),
  description: z.string().min(1, "Description is required"),
  inputSchema: z.record(z.unknown()).default({}),
  pricing: z.object({
    microUsdc: z.string().regex(/^\d+$/, "microUsdc must be an integer string"),
    token: z.string().default("USDC-350c4e"),
    serviceId: z.number().int().nonnegative().default(1),
    providerAgentNonce: z.number().int().nonnegative().default(1),
  }),
  payTo: z.string().min(1, "payTo address is required"),
  agentIdentity: z
    .object({
      agentNonce: z.number().int().nonnegative(),
      ownerAddress: z.string().optional(),
      signature: z.string().optional(),
      proof: z.string().optional(),
    })
    .optional(),
  endpointUrl: z.string().url().optional(),
});

export type McpToolRegisterRequest = z.infer<typeof McpToolRegisterRequestSchema>;

export interface ToolHealthStatus {
  name: string;
  status: "healthy" | "degraded" | "unreachable";
  latencyMs: number;
  lastHeartbeat: number;
  callCount: number;
  errorCount: number;
  uptimePct: number;
}
