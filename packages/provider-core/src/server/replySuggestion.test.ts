import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { ProviderInstanceId } from "@t3tools/contracts";
import { decodeJsonReply, fromRunner } from "./textGenerationOperations.ts";
import { buildReplySuggestionPrompt } from "./textGenerationPrompts.ts";

const input = {
  cwd: "/repo",
  message: "ASSISTANT: Would you like me to do that?",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
};

describe("reply suggestion generation", () => {
  it.effect("decodes and normalizes the provider's suggestion", () =>
    Effect.gen(function* () {
      const generation = fromRunner("test", (request) => {
        expect(request.operation).toBe("generateReplySuggestion");
        expect(request.prompt).toContain(input.message);
        return decodeJsonReply(request, "test", '{"reply":"  Yes,\\n do that.  "}');
      });
      expect(yield* generation.generateReplySuggestion(input)).toEqual({ reply: "Yes, do that." });
    }),
  );
  it.effect("suppresses oversized or empty replies", () =>
    Effect.gen(function* () {
      for (const reply of [" ", "a".repeat(161)]) {
        const generation = fromRunner("test", (request) =>
          decodeJsonReply(request, "test", `{"reply":"${reply}"}`),
        );
        expect((yield* generation.generateReplySuggestion(input)).reply).toBe("");
      }
    }),
  );
  it("retains the newest assistant response when context is long", () => {
    const { prompt } = buildReplySuggestionPrompt("old".repeat(10_000) + input.message);
    expect(prompt).toContain(input.message);
    expect(prompt.length).toBeLessThan(14_000);
  });
});
