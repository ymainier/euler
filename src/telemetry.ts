import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";

let sdk: NodeSDK | null = null;

export function setupTelemetry() {
  if (sdk) return;

  const endpoint = "http://localhost:3000/api/public/otel";
  if (!endpoint) return;

  sdk = new NodeSDK({
    spanProcessors: [new LangfuseSpanProcessor()],
  });

  sdk.start();
}
