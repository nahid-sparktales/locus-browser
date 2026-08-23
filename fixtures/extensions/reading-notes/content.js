document.documentElement.dataset.locusReadingNotes = "available";
const badge = document.createElement("div");
badge.id = "locus-reading-notes-fixture";
badge.textContent = "Locus extension active";
Object.assign(badge.style, {
  position: "fixed",
  right: "16px",
  bottom: "16px",
  zIndex: "2147483647",
  border: "1px solid #171914",
  borderRadius: "999px",
  padding: "7px 10px",
  color: "#171914",
  background: "#c9f54a",
  font: "600 12px system-ui, sans-serif",
});
document.documentElement.append(badge);
