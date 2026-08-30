export const FINDINGS_SCHEMA = {
  type: "object",
  required: ["summary", "verdict", "findings"],
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    verdict: {
      type: "string",
      enum: ["approve", "comment", "request_changes"],
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        required: [
          "path",
          "line",
          "side",
          "severity",
          "category",
          "title",
          "body",
          "confidence",
        ],
        additionalProperties: false,
        properties: {
          path: { type: "string" },
          line: { type: "integer" },
          side: { type: "string", enum: ["LEFT", "RIGHT"] },
          severity: {
            type: "string",
            enum: ["critical", "high", "medium", "low"],
          },
          category: {
            type: "string",
            enum: [
              "bug",
              "security",
              "performance",
              "missing_test",
              "correctness",
              "api_misuse",
            ],
          },
          title: { type: "string" },
          body: { type: "string" },
          suggestion: { type: "string" },
          confidence: { type: "number" },
        },
      },
    },
  },
} as const;

export function findingsSchemaJson(): string {
  return JSON.stringify(FINDINGS_SCHEMA);
}
