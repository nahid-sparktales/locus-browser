export interface PageCredentialCandidate {
  origin: string;
  username: string;
  password: string;
}

export function credentialObserverSource(bindingName: string): string {
  if (!/^__locusCredential_[a-zA-Z0-9_]+$/.test(bindingName)) throw new Error("Invalid credential binding name");
  return `(() => {
    if (globalThis.__locusCredentialObserverInstalled) return true;
    globalThis.__locusCredentialObserverInstalled = true;
    let lastSignature = "";
    let lastCapturedAt = 0;
    const usable = (input) => input instanceof HTMLInputElement && !input.disabled && input.type !== "hidden";
    const capture = (form) => {
      if (!(form instanceof HTMLFormElement)) return;
      const inputs = Array.from(form.querySelectorAll("input")).filter(usable);
      const passwords = inputs.filter((input) => input.type === "password" && input.value);
      if (!passwords.length) return;
      const passwordInput = passwords.find((input) => input.autocomplete === "current-password")
        || passwords.find((input) => input.autocomplete === "new-password")
        || passwords[0];
      const usernameInput = inputs.find((input) => input.autocomplete === "username")
        || inputs.find((input) => input.type === "email")
        || inputs.find((input) => ["text", "tel", "url"].includes(input.type) && input.compareDocumentPosition(passwordInput) & Node.DOCUMENT_POSITION_FOLLOWING);
      const candidate = {
        origin: location.origin,
        username: usernameInput?.value || "",
        password: passwordInput.value,
      };
      const signature = candidate.origin + "\\n" + candidate.username + "\\n" + candidate.password;
      const now = Date.now();
      if (signature === lastSignature && now - lastCapturedAt < 2000) return;
      lastSignature = signature;
      lastCapturedAt = now;
      const notify = globalThis[${JSON.stringify(bindingName)}];
      if (typeof notify === "function") notify(JSON.stringify(candidate));
    };
    document.addEventListener("submit", (event) => capture(event.target), true);
    document.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target.closest("button, input[type='submit'], input[type='image']") : null;
      if (!target) return;
      const form = target instanceof HTMLButtonElement || target instanceof HTMLInputElement ? target.form : target.closest("form");
      capture(form);
    }, true);
    return true;
  })()`;
}

export function credentialAutofillInvocation(username: string, password: string): string {
  return `(() => {
    const usable = (input) => input instanceof HTMLInputElement && !input.disabled && input.type !== "hidden";
    const passwords = Array.from(document.querySelectorAll("input[type='password']")).filter(usable);
    const passwordInput = passwords.find((input) => input.autocomplete === "current-password") || passwords[0];
    if (!passwordInput) return { filled: false, usernameFilled: false };
    const form = passwordInput.form || document;
    const inputs = Array.from(form.querySelectorAll("input")).filter(usable);
    const usernameInput = inputs.find((input) => input.autocomplete === "username")
      || inputs.find((input) => input.type === "email")
      || inputs.find((input) => ["text", "tel", "url"].includes(input.type) && input.compareDocumentPosition(passwordInput) & Node.DOCUMENT_POSITION_FOLLOWING);
    const setValue = (input, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (setter) setter.call(input, value); else input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    if (usernameInput) setValue(usernameInput, ${JSON.stringify(username)});
    setValue(passwordInput, ${JSON.stringify(password)});
    passwordInput.focus();
    return { filled: true, usernameFilled: Boolean(usernameInput) };
  })()`;
}

export function parseCredentialCandidate(value: unknown): PageCredentialCandidate | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.origin !== "string" || typeof candidate.username !== "string" || typeof candidate.password !== "string") return undefined;
  if (!candidate.password || candidate.password.length > 4096 || candidate.username.length > 512) return undefined;
  try {
    const origin = new URL(candidate.origin).origin;
    if (origin !== candidate.origin) return undefined;
    return { origin, username: candidate.username, password: candidate.password };
  } catch {
    return undefined;
  }
}
