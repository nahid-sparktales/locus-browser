import { execFile } from "node:child_process";

interface NativeSecretPromptOptions {
  title: string;
  message: string;
  confirmLabel?: string;
}

interface NativeSecretPromptResult {
  cancelled?: boolean;
  value?: string;
}

export async function promptForNativeSecret(options: NativeSecretPromptOptions): Promise<string | undefined> {
  if (process.platform !== "darwin") throw new Error("Provider-key setup currently requires macOS");
  const source = nativeSecretPromptSource(options);
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile("/usr/bin/osascript", ["-l", "JavaScript", "-e", source], { timeout: 120_000, maxBuffer: 32_768 }, (error, output) => {
      if (error) {
        reject(new Error(error.killed ? "The provider-key prompt timed out" : "The provider-key prompt could not open"));
        return;
      }
      resolve(output);
    });
  });
  const result = parseNativeSecretPromptResult(stdout);
  return result.cancelled ? undefined : result.value ?? "";
}

export function parseNativeSecretPromptResult(value: string): NativeSecretPromptResult {
  try {
    const parsed = JSON.parse(value.trim()) as NativeSecretPromptResult;
    if (parsed.cancelled === true) return { cancelled: true };
    if (typeof parsed.value === "string" && parsed.value.length <= 16_384) return { value: parsed.value.trim() };
  } catch {
    // The prompt is a strict local boundary; malformed output is rejected.
  }
  throw new Error("The provider-key prompt returned an invalid response");
}

function nativeSecretPromptSource(options: NativeSecretPromptOptions): string {
  const title = JSON.stringify(options.title.slice(0, 120));
  const message = JSON.stringify(options.message.slice(0, 500));
  const confirm = JSON.stringify((options.confirmLabel ?? "Save").slice(0, 40));
  return `(() => {
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    app.activate();
    try {
      const result = app.displayDialog(${title} + "\\n\\n" + ${message}, {
        defaultAnswer: "",
        hiddenAnswer: true,
        buttons: ["Cancel", ${confirm}],
        defaultButton: ${confirm},
        cancelButton: "Cancel"
      });
      return JSON.stringify({ value: result.textReturned });
    } catch (_error) {
      return JSON.stringify({ cancelled: true });
    }
  })();`;
}
