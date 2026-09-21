import { describe, expect, it } from "vitest";
import {
  JS_CONFIG,
  JS_NEWTHREAD,
  JS_RUN,
  JS_TOOLS,
} from "../src/bridge/chromeScripts.js";

describe("Firefox Reverse module paths", () => {
  it("uses the grouped resource URIs from the current agentsidebar moz.build", () => {
    expect(JS_CONFIG).toContain(
      "resource:///modules/agentsidebar/providers/ConfigStore.sys.mjs",
    );
    expect(JS_RUN).toContain(
      "resource:///modules/agentsidebar/host/AgentSession.sys.mjs",
    );
    expect(JS_NEWTHREAD).toContain(
      "resource:///modules/agentsidebar/state/ConversationStore.sys.mjs",
    );
    expect(JS_TOOLS).toContain(
      "resource:///modules/agentsidebar/tools/Tools.sys.mjs",
    );
    expect(JS_TOOLS).toContain(
      "resource:///modules/agentsidebar/backends/Backends.sys.mjs",
    );
  });
});
