import type { ConfigurableWorkModelProviderId } from "./WorkModelProviders.js";

export async function commitVerifiedProviderConnection<T>(options: {
  verify: () => Promise<void>;
  connect: () => Promise<T>;
  persist: (connected: T) => void;
  activate: () => void;
}): Promise<T> {
  await options.verify();
  const connected = await options.connect();
  options.persist(connected);
  options.activate();
  return connected;
}

export async function removeProviderCredential(options: {
  providerId: ConfigurableWorkModelProviderId;
  active: boolean;
  clearInMemory: () => Promise<void>;
  clearCredential: () => void;
  clearProvider: () => void;
}): Promise<void> {
  if (options.active) await options.clearInMemory();
  if (options.providerId === "vllm") options.clearProvider();
  else options.clearCredential();
}
