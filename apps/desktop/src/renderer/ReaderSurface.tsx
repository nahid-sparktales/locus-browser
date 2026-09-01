import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, X } from "lucide-react";
import type { AccentSelectionState, ReaderArticleState, ReaderPreferencesState } from "../shared/types.js";
import { DEFAULT_ACCENT_SELECTION, accentCssVariables } from "../shared/accent.js";

export function ReaderSurface() {
  const [article, setArticle] = useState<ReaderArticleState>();
  const [preferences, setPreferences] = useState<ReaderPreferencesState>({ theme: "locus", textScale: 1, columnWidth: "medium", lineSpacing: 1.6, rate: 1 });
  const [accent, setAccent] = useState<AccentSelectionState>(DEFAULT_ACCENT_SELECTION);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [playing, setPlaying] = useState(false);
  const [sentenceIndex, setSentenceIndex] = useState(0);
  const speechGeneration = useRef(0);

  useEffect(() => {
    void window.locusBrowser.query({ type: "reader-current" }).then((value) => {
      const next = value as ReaderArticleState | undefined;
      if (next) { setArticle(next); setPreferences(next.preferences); setAccent(next.accent); }
    });
    const unsubscribeAccent = window.locusBrowser.onReaderAccent(setAccent);
    const loadVoices = () => setVoices(speechSynthesis.getVoices());
    loadVoices(); speechSynthesis.addEventListener("voiceschanged", loadVoices);
    return () => { unsubscribeAccent(); speechGeneration.current += 1; speechSynthesis.cancel(); speechSynthesis.removeEventListener("voiceschanged", loadVoices); };
  }, []);

  const sentences = useMemo(() => article ? sentenceRanges(article.text) : [], [article]);
  const updatePreferences = (patch: Partial<ReaderPreferencesState>) => {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    void window.locusBrowser.command({ type: "set-reader-preferences", ...patch });
  };
  const speak = (index = sentenceIndex) => {
    if (!article || !sentences.length) return;
    const safeIndex = Math.max(0, Math.min(index, sentences.length - 1));
    const generation = ++speechGeneration.current;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(sentences.slice(safeIndex).map((range) => article.text.slice(range.start, range.end)).join(" "));
    utterance.rate = preferences.rate;
    utterance.lang = article.lang || "";
    utterance.voice = voices.find((voice) => voice.voiceURI === preferences.voice) ?? null;
    utterance.onboundary = (event) => {
      if (generation !== speechGeneration.current || event.name !== "sentence") return;
      const base = sentences[safeIndex]?.start ?? 0;
      const absolute = base + event.charIndex;
      const indexAtBoundary = sentences.findIndex((range) => absolute >= range.start && absolute < range.end);
      if (indexAtBoundary >= 0) setSentenceIndex(indexAtBoundary);
    };
    utterance.onend = () => { if (generation === speechGeneration.current) setPlaying(false); };
    utterance.onerror = () => { if (generation === speechGeneration.current) setPlaying(false); };
    setSentenceIndex(safeIndex); setPlaying(true); speechSynthesis.speak(utterance);
  };
  const toggleSpeech = () => {
    if (playing) { speechGeneration.current += 1; speechSynthesis.cancel(); setPlaying(false); }
    else speak();
  };

  if (!article) return <main className="reader-surface reader-loading">Preparing Reader Mode…</main>;
  const current = sentences[sentenceIndex];
  return (
    <main
      className={`reader-surface reader-theme-${preferences.theme}`}
      style={{ ...accentCssVariables(accent), "--reader-scale": preferences.textScale, "--reader-line": preferences.lineSpacing } as React.CSSProperties}
    >
      <header className="reader-toolbar">
        <button className="reader-close" onClick={() => void window.locusBrowser.command({ type: "toggle-reader" })} aria-label="Exit Reader Mode"><X size={17} /></button>
        <div className="reader-title"><strong>{article.title}</strong><span>{article.byline || new URL(article.url).hostname}</span></div>
        <div className="reader-controls" aria-label="Reader appearance and speech controls">
          <select value={preferences.theme} onChange={(event) => updatePreferences({ theme: event.target.value as ReaderPreferencesState["theme"] })} aria-label="Reader theme">
            <option value="locus">Locus</option><option value="paper">Paper</option><option value="dark">Dark</option>
          </select>
          <button onClick={() => updatePreferences({ textScale: Math.max(0.8, preferences.textScale - 0.1) })} aria-label="Decrease text size">A−</button>
          <button onClick={() => updatePreferences({ textScale: Math.min(2, preferences.textScale + 0.1) })} aria-label="Increase text size">A+</button>
          <select value={preferences.columnWidth} onChange={(event) => updatePreferences({ columnWidth: event.target.value as ReaderPreferencesState["columnWidth"] })} aria-label="Column width">
            <option value="narrow">Narrow</option><option value="medium">Medium</option><option value="wide">Wide</option>
          </select>
          <button onClick={() => { setSentenceIndex(Math.max(0, sentenceIndex - 1)); if (playing) speak(Math.max(0, sentenceIndex - 1)); }} aria-label="Previous sentence"><ChevronLeft size={17} /></button>
          <button className="reader-play" onClick={toggleSpeech} aria-label={playing ? "Pause read aloud" : "Read aloud"}>{playing ? <Pause size={17} /> : <Play size={17} />}</button>
          <button onClick={() => { const next = Math.min(sentences.length - 1, sentenceIndex + 1); setSentenceIndex(next); if (playing) speak(next); }} aria-label="Next sentence"><ChevronRight size={17} /></button>
          <select value={preferences.voice || ""} onChange={(event) => updatePreferences({ voice: event.target.value })} aria-label="System voice">
            <option value="">System voice</option>{voices.map((voice) => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name}</option>)}
          </select>
          <input type="range" min="0.5" max="2" step="0.1" value={preferences.rate} onChange={(event) => updatePreferences({ rate: Number(event.target.value) })} aria-label="Speech rate" />
          <button onClick={() => { setSentenceIndex(0); speechSynthesis.cancel(); setPlaying(false); }} aria-label="Restart read aloud"><RotateCcw size={16} /></button>
        </div>
      </header>
      <article
        className={`reader-article reader-width-${preferences.columnWidth}`}
        onClick={(event) => {
          const anchor = (event.target as Element).closest("a[href]") as HTMLAnchorElement | null;
          if (!anchor) return; event.preventDefault(); void window.locusBrowser.command({ type: "reader-open-link", url: anchor.href });
        }}
      >
        <h1>{article.title}</h1>{article.byline ? <p className="reader-byline">{article.byline}</p> : null}
        {playing && current ? <p className="reader-now" aria-live="polite">{article.text.slice(current.start, current.end)}</p> : null}
        <div dangerouslySetInnerHTML={{ __html: article.html }} />
      </article>
    </main>
  );
}

function sentenceRanges(text: string): Array<{ start: number; end: number }> {
  const output: Array<{ start: number; end: number }> = [];
  const segmenter = "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "sentence" }) : undefined;
  if (segmenter) {
    for (const segment of segmenter.segment(text)) output.push({ start: segment.index, end: segment.index + segment.segment.length });
  } else {
    const pattern = /[^.!?]+[.!?]+|[^.!?]+$/g; let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) output.push({ start: match.index, end: match.index + match[0].length });
  }
  return output;
}
