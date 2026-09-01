import { useEffect, useRef, useState } from "react";
import { CircleAlert, X } from "lucide-react";
import type { BrowserCommand } from "../shared/ipc.js";

export interface SettingsConfirmationRequest {
  title: string;
  consequence: string;
  confirmLabel: string;
  command: BrowserCommand;
  tone?: "danger" | "standard";
}

export interface SettingsInputRequest {
  title: string;
  detail: string;
  label: string;
  placeholder?: string;
  submitLabel: string;
  validate: (value: string) => string | undefined;
  submit: (value: string) => BrowserCommand;
}

export type SettingsDialogRequest =
  | ({ kind: "confirmation" } & SettingsConfirmationRequest)
  | ({ kind: "input" } & SettingsInputRequest);

export function SettingsDialog({ request, onClose }: { request: SettingsDialogRequest; onClose: () => void }) {
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  busyRef.current = busy;

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ) ?? []);
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      returnFocusRef.current?.focus();
    };
  }, [onClose]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (request.kind === "input") {
      const validation = request.validate(value);
      if (validation) { setError(validation); return; }
    }
    setBusy(true);
    setError("");
    try {
      const nextCommand = request.kind === "confirmation" ? request.command : request.submit(value.trim());
      await window.locusBrowser.command(nextCommand);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The change could not be completed.");
      setBusy(false);
    }
  };

  return <div className="settings-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={dialogRef} className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-dialog-title" aria-describedby="settings-dialog-detail">
      <header>
        <span className={`settings-dialog-mark ${request.kind === "confirmation" && request.tone === "danger" ? "danger" : ""}`}><CircleAlert size={17} /></span>
        <span><h2 id="settings-dialog-title">{request.title}</h2><p id="settings-dialog-detail">{request.kind === "confirmation" ? request.consequence : request.detail}</p></span>
        <button type="button" aria-label="Close dialog" disabled={busy} onClick={onClose}><X size={15} /></button>
      </header>
      <form onSubmit={(event) => void submit(event)}>
        {request.kind === "input" ? <label className="settings-dialog-input"><span>{request.label}</span><input value={value} placeholder={request.placeholder} onChange={(event) => { setValue(event.target.value); setError(""); }} /></label> : null}
        {error ? <p className="settings-dialog-error" role="alert">{error}</p> : null}
        <footer>
          <button ref={cancelRef} type="button" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className={request.kind === "confirmation" && request.tone === "danger" ? "danger" : "primary"} disabled={busy}>{busy ? "Working…" : request.kind === "confirmation" ? request.confirmLabel : request.submitLabel}</button>
        </footer>
      </form>
    </section>
  </div>;
}
