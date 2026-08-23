import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { managedChatGPTEnvironment } from "./AgentRuntime.js";

describe("packaged managed ChatGPT runtime", () => {
  it("passes the bundled helper and profile-owned credential home to the agent", () => {
    const value = managedChatGPTEnvironment("/Applications/Locus Browser.app/Contents/Resources/AgentRuntime", "/profile/agent", true);
    expect(value).toEqual({
      LOCUS_CODEX_APP_SERVER_PATH: join(
        "/Applications/Locus Browser.app/Contents/Resources/AgentRuntime",
        "components",
        "codex-app-server",
        "codex",
      ),
      LOCUS_CODEX_HOME: join("/profile/agent", "chatgpt-plan"),
    });
  });

  it("does not silently discover an unmanaged helper in development", () => {
    expect(managedChatGPTEnvironment("/source/locus-platform", "/profile/agent", false)).toEqual({});
  });
});
