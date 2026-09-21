import { describe, expect, it, vi } from "vitest";
import { registerTools } from "../src/server.js";

describe("Firefox environment tools", () => {
  it("creates Firefox-only environments and forwards custom locale values", async () => {
    const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
    const server = {
      registerTool(name: string, _definition: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) {
        handlers.set(name, handler);
      },
    };
    const callEnvironmentTool = vi.fn(async () => ({ ok: true }));
    const director = { callEnvironmentTool };

    registerTools(server as never, director as never);
    const create = handlers.get("frx_env_create");
    expect(create).toBeTypeOf("function");

    await create?.({
      name: "中文环境",
      randomize: true,
      language: "en-GB",
      languages: ["en-GB", "en"],
      locale: "en-GB",
      timezone: "Europe/London",
    });

    expect(callEnvironmentTool).toHaveBeenCalledWith({
      name: "env_create",
      args: {
        name: "中文环境",
        generateOptions: {
          randomize: true,
          language: "en-GB",
          languages: ["en-GB", "en"],
          locale: "en-GB",
          timezone: "Europe/London",
        },
      },
    });
    expect(JSON.stringify(callEnvironmentTool.mock.calls)).not.toContain("chromium");
    expect(callEnvironmentTool.mock.calls[0][0].args.generateOptions).not.toHaveProperty("consistencyMode");
    await create?.({ name: "native", consistencyMode: "native-consistent" });
    expect(callEnvironmentTool).toHaveBeenLastCalledWith(expect.objectContaining({ args: expect.objectContaining({ generateOptions: expect.objectContaining({ consistencyMode: "native-consistent" }) }) }));
    await create?.({ name: "legacy", consistencyMode: "legacy" });
    expect(callEnvironmentTool).toHaveBeenLastCalledWith(expect.objectContaining({ args: expect.objectContaining({ generateOptions: expect.objectContaining({ consistencyMode: "legacy" }) }) }));
  });
});
