import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { StoredPasskey } from "./types.js";

export interface PasskeyConfig {
  rpName: string;
  rpId: string;
  origin: string;
  callbackScheme: string;
}

export interface RegistrationResult {
  verified: boolean;
  credential?: {
    id: string;
    publicKey: string;
    counter: number;
    transports: string[];
    deviceType: string;
    backedUp: boolean;
  };
}

export interface AuthenticationResult {
  verified: boolean;
  newCounter?: number;
}

export interface PasskeyToolkit {
  registrationOptions(input: {
    config: PasskeyConfig;
    userId: string;
    displayName: string;
  }): Promise<Record<string, unknown> & { challenge: string }>;
  authenticationOptions(input: { config: PasskeyConfig }): Promise<Record<string, unknown> & { challenge: string }>;
  verifyRegistration(input: {
    config: PasskeyConfig;
    challenge: string;
    response: unknown;
  }): Promise<RegistrationResult>;
  verifyAuthentication(input: {
    config: PasskeyConfig;
    challenge: string;
    response: unknown;
    passkey: StoredPasskey;
  }): Promise<AuthenticationResult>;
}

export const simpleWebAuthnToolkit: PasskeyToolkit = {
  async registrationOptions({ config, userId, displayName }) {
    return await generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpId,
      userID: decode(userId),
      userName: `locus-${userId.slice(0, 12)}`,
      userDisplayName: displayName,
      timeout: 5 * 60_000,
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "required",
        requireResidentKey: true,
        userVerification: "required",
      },
    }) as unknown as Record<string, unknown> & { challenge: string };
  },

  async authenticationOptions({ config }) {
    return await generateAuthenticationOptions({
      rpID: config.rpId,
      timeout: 5 * 60_000,
      userVerification: "required",
      allowCredentials: [],
    }) as Record<string, unknown> & { challenge: string };
  },

  async verifyRegistration({ config, challenge, response }) {
    const verification = await verifyRegistrationResponse({
      response: response as RegistrationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpId,
      requireUserVerification: true,
    });
    if (!verification.verified) return { verified: false };
    const info = verification.registrationInfo;
    return {
      verified: true,
      credential: {
        id: info.credential.id,
        publicKey: encode(info.credential.publicKey),
        counter: info.credential.counter,
        transports: info.credential.transports ?? [],
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
      },
    };
  },

  async verifyAuthentication({ config, challenge, response, passkey }) {
    const verification = await verifyAuthenticationResponse({
      response: response as AuthenticationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpId,
      requireUserVerification: true,
      credential: {
        id: passkey.credentialId,
        publicKey: decode(passkey.publicKey),
        counter: passkey.counter,
        transports: passkey.transports as never[],
      },
    });
    return { verified: verification.verified, newCounter: verification.authenticationInfo.newCounter };
  },
};

export function passkeyCeremonyHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Locus Sync</title>
  <link rel="stylesheet" href="/v1/auth/passkeys/client.css">
</head>
<body>
  <main>
    <div class="mark" aria-hidden="true">✦</div>
    <p class="eyebrow">Locus Browser</p>
    <h1>Continue with a passkey</h1>
    <p id="description">Your passkey confirms this device without sharing a password.</p>
    <button id="continue" type="button">Continue</button>
    <p id="status" role="status" aria-live="polite"></p>
  </main>
  <script src="/v1/auth/passkeys/client.js" defer></script>
</body>
</html>`;
}

export function passkeyClientCss(): string {
  return `:root{color-scheme:light dark;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;--bg:#f8f6f0;--surface:#fffefa;--text:#161814;--muted:#5f6258;--line:#d9d5ca;--brand:#c9f54a;--ink:#161814}@media(prefers-color-scheme:dark){:root{--bg:#1b1b17;--surface:#292820;--text:#f2eee4;--muted:#9c988a;--line:#3d3b32}}*{box-sizing:border-box}body{min-height:100vh;margin:0;display:grid;place-items:center;padding:24px;color:var(--text);background:radial-gradient(circle at 80% 10%,rgba(201,245,74,.14),transparent 35%),var(--bg)}main{width:min(430px,100%);padding:30px;border:1px solid var(--line);border-radius:18px;background:var(--surface);box-shadow:0 22px 64px rgba(0,0,0,.14);text-align:center}.mark{width:48px;height:48px;margin:0 auto 14px;display:grid;place-items:center;border-radius:14px;color:var(--ink);background:var(--brand);font-size:24px}.eyebrow{margin:0;color:var(--muted);font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}h1{margin:5px 0 10px;font-size:27px;letter-spacing:-.025em}p{color:var(--muted);line-height:1.5}button{min-height:42px;margin-top:10px;padding:0 18px;border:0;border-radius:10px;color:var(--ink);background:var(--brand);font:inherit;font-weight:700;cursor:pointer}button:disabled{opacity:.5}button:focus-visible{outline:2px solid #5274d7;outline-offset:2px}#status{min-height:21px;margin:14px 0 0;font-size:13px}`;
}

export function passkeyClientScript(): string {
  return `(() => {
  const button = document.querySelector("#continue");
  const status = document.querySelector("#status");
  const ceremonyId = location.pathname.split("/").filter(Boolean).at(-1);
  const decode = (value) => {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
    const binary = atob(base64);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  };
  const encode = (value) => {
    const bytes = new Uint8Array(value);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).split("+").join("-").split("/").join("_").replace(/=+$/g, "");
  };
  const prepare = (kind, options) => {
    options.challenge = decode(options.challenge);
    if (kind === "register") {
      options.user.id = decode(options.user.id);
      options.excludeCredentials = (options.excludeCredentials || []).map(item => ({ ...item, id: decode(item.id) }));
    } else {
      options.allowCredentials = (options.allowCredentials || []).map(item => ({ ...item, id: decode(item.id) }));
    }
    return options;
  };
  const serialize = (credential, kind) => {
    const common = {
      id: credential.id,
      rawId: encode(credential.rawId),
      type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment || undefined,
      clientExtensionResults: credential.getClientExtensionResults(),
    };
    if (kind === "register") return { ...common, response: {
      clientDataJSON: encode(credential.response.clientDataJSON),
      attestationObject: encode(credential.response.attestationObject),
      transports: credential.response.getTransports ? credential.response.getTransports() : [],
    }};
    return { ...common, response: {
      clientDataJSON: encode(credential.response.clientDataJSON),
      authenticatorData: encode(credential.response.authenticatorData),
      signature: encode(credential.response.signature),
      userHandle: credential.response.userHandle ? encode(credential.response.userHandle) : undefined,
    }};
  };
  button.addEventListener("click", async () => {
    button.disabled = true;
    status.textContent = "Waiting for your passkey…";
    try {
      const optionResponse = await fetch("/v1/auth/passkeys/ceremonies/" + encodeURIComponent(ceremonyId) + "/options", { cache: "no-store" });
      if (!optionResponse.ok) throw new Error("This passkey request expired. Return to Locus Browser and try again.");
      const ceremony = await optionResponse.json();
      const options = prepare(ceremony.kind, ceremony.options);
      const credential = ceremony.kind === "register"
        ? await navigator.credentials.create({ publicKey: options })
        : await navigator.credentials.get({ publicKey: options });
      if (!credential) throw new Error("No passkey was returned.");
      status.textContent = "Verifying…";
      const verification = await fetch("/v1/auth/passkeys/ceremonies/" + encodeURIComponent(ceremonyId) + "/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credential: serialize(credential, ceremony.kind) }),
      });
      const result = await verification.json();
      if (!verification.ok) throw new Error(result.error || "Passkey verification failed.");
      location.href = result.callbackUrl;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Passkey verification failed.";
      button.disabled = false;
    }
  });
})();`;
}

function encode(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  const bytes = Buffer.from(value, "base64url");
  const output = new Uint8Array(bytes.byteLength);
  output.set(bytes);
  return output;
}
