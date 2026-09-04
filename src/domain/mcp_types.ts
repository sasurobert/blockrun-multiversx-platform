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
