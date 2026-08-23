(() => {
  const manifest = chrome.runtime.getManifest();
  chrome.storage.local.set({ canaryCompatibility: manifest.version }, () => {
    chrome.storage.local.get("canaryCompatibility", (value) => {
      document.documentElement.dataset.locusCompatibility = JSON.stringify({
        runtime: Boolean(chrome.runtime.id && chrome.runtime.getURL("manifest.json")),
        storageLocal: value.canaryCompatibility === manifest.version,
        contentScript: true,
      });
    });
  });
})();
