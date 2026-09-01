import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const script = await readFile(
  new URL("./prepare-agent-runtime.sh", import.meta.url),
  "utf8",
);
const signingScript = await readFile(
  new URL("./sign-agent-runtime.mjs", import.meta.url),
  "utf8",
);

test("the distributable speech runtime uses a portable Apple Silicon baseline", () => {
  assert.match(script, /speech_cpu_baseline="armv8\.2-a\+dotprod"/);
  assert.match(script, /-DGGML_NATIVE=OFF/);
  assert.match(script, /-DGGML_CPU_ARM_ARCH="\$\{speech_cpu_baseline\}"/);
});

test("the speech cache is invalidated when the build contract changes", () => {
  assert.match(
    script,
    /speech_build_contract="v2 \$\{speech_sha256\} metal \$\{speech_cpu_baseline\}"/,
  );
  assert.match(
    script,
    /"\$\(<"\$\{speech_cache\}\/\.stamp"\)" != "\$\{speech_build_contract\}"/,
  );
  assert.match(
    script,
    /print -r -- "\$\{speech_build_contract\}" > "\$\{speech_cache\}\/\.stamp"/,
  );
});

test("every standalone managed runtime executable enters the hardened signing pass", () => {
  for (const name of ["codex", "codex-code-mode-host", "whisper-cli", "locus-semantic-helper"]) {
    assert.match(signingScript, new RegExp(`name === ["']${name}["']`));
  }
  assert.match(signingScript, /name === "codex" \|\| name === "codex-code-mode-host"/);
  assert.match(signingScript, /--preserve-metadata=entitlements/);
  assert.match(signingScript, /--options", "runtime/);
  assert.match(signingScript, /--timestamp/);
});
