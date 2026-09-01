#!/usr/bin/env python3
"""Build the public Locus Browser architecture and feature guide."""

from pathlib import Path
from textwrap import wrap

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import landscape, letter
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "locus-browser-architecture-and-features.pdf"
PAGE = landscape(letter)
W, H = PAGE

INK = HexColor("#171914")
MUTED = HexColor("#62665a")
PANEL = HexColor("#f4f2e9")
SURFACE = HexColor("#fffef9")
LINE = HexColor("#d8d5ca")
LIME = HexColor("#c9f54a")
GREEN = HexColor("#3b7048")
BLUE = HexColor("#4e70c7")
CORAL = HexColor("#b95137")
VIOLET = HexColor("#7652a8")
DARK = HexColor("#20221c")
WHITE = HexColor("#f8f5eb")


def line_text(c, text, x, y, size=9, color=INK, font="Helvetica", max_width=None, leading=None):
    c.setFillColor(color)
    c.setFont(font, size)
    if max_width is None:
        c.drawString(x, y, text)
        return y
    chars = max(12, int(max_width / (size * 0.51)))
    lines = []
    for paragraph in text.split("\n"):
        lines.extend(wrap(paragraph, chars) or [""])
    step = leading or size * 1.28
    for index, value in enumerate(lines):
        c.drawString(x, y - index * step, value)
    return y - len(lines) * step


def title(c, kicker, heading, subtitle, page, dark=False):
    bg = DARK if dark else PANEL
    fg = WHITE if dark else INK
    muted = HexColor("#b9b9ac") if dark else MUTED
    c.setFillColor(bg)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    c.setFillColor(LIME)
    c.roundRect(34, H - 66, 34, 34, 9, fill=1, stroke=0)
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 23)
    c.drawCentredString(51, H - 57, "L")
    c.setFillColor(muted)
    c.setFont("Helvetica-Bold", 7.5)
    c.drawString(82, H - 40, kicker.upper())
    c.setFillColor(fg)
    c.setFont("Helvetica-Bold", 21)
    c.drawString(82, H - 62, heading)
    c.setFillColor(muted)
    c.setFont("Helvetica", 8.5)
    c.drawRightString(W - 34, H - 42, subtitle)
    c.setStrokeColor(HexColor("#3b3c34") if dark else LINE)
    c.line(34, H - 77, W - 34, H - 77)
    c.setFillColor(muted)
    c.setFont("Helvetica", 7)
    c.drawString(34, 20, "Locus Browser - public architecture and feature guide")
    c.drawRightString(W - 34, 20, f"Page {page}")


def card(c, x, y, w, h, heading, body="", accent=LIME, dark=False, badge=None, body_size=8):
    fill = HexColor("#2a2c25") if dark else SURFACE
    stroke = HexColor("#44463d") if dark else LINE
    fg = WHITE if dark else INK
    muted = HexColor("#babbb0") if dark else MUTED
    c.setFillColor(fill)
    c.setStrokeColor(stroke)
    c.setLineWidth(0.8)
    c.roundRect(x, y, w, h, 10, fill=1, stroke=1)
    c.setFillColor(accent)
    c.roundRect(x + 11, y + h - 28, 18, 18, 5, fill=1, stroke=0)
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 8)
    c.drawCentredString(x + 20, y + h - 22, badge or heading[:1].upper())
    c.setFillColor(fg)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(x + 36, y + h - 21, heading)
    if body:
        line_text(c, body, x + 12, y + h - 44, body_size, muted, max_width=w - 24, leading=body_size * 1.32)


def pill(c, x, y, text, color=LIME, dark=False):
    width = max(42, len(text) * 4.8 + 15)
    c.setFillColor(color)
    c.roundRect(x, y, width, 17, 8.5, fill=1, stroke=0)
    c.setFillColor(INK if color == LIME or not dark else WHITE)
    c.setFont("Helvetica-Bold", 6.8)
    c.drawCentredString(x + width / 2, y + 5.4, text)
    return width


def arrow(c, x1, y1, x2, y2, color=MUTED, label=None):
    c.setStrokeColor(color)
    c.setFillColor(color)
    c.setLineWidth(1.2)
    c.line(x1, y1, x2, y2)
    dx, dy = x2 - x1, y2 - y1
    length = max((dx * dx + dy * dy) ** 0.5, 1)
    ux, uy = dx / length, dy / length
    px, py = -uy, ux
    c.line(x2, y2, x2 - ux * 7 + px * 3, y2 - uy * 7 + py * 3)
    c.line(x2, y2, x2 - ux * 7 - px * 3, y2 - uy * 7 - py * 3)
    if label:
        c.setFont("Helvetica-Bold", 6.5)
        c.drawCentredString((x1 + x2) / 2, (y1 + y2) / 2 + 5, label)


def bullet_list(c, items, x, y, width, size=8, color=MUTED, gap=5):
    cursor = y
    for item in items:
        c.setFillColor(LIME)
        c.circle(x + 3, cursor + 2, 2, fill=1, stroke=0)
        cursor = line_text(c, item, x + 11, cursor + 5, size, color, max_width=width - 11, leading=size * 1.28) - gap
    return cursor


def page_cover(c):
    c.setFillColor(DARK)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    c.setFillColor(LIME)
    c.roundRect(48, H - 118, 58, 58, 16, fill=1, stroke=0)
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 40)
    c.drawCentredString(77, H - 104, "L")
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 34)
    c.drawString(126, H - 88, "Locus Browser")
    c.setFont("Helvetica", 14)
    c.setFillColor(HexColor("#b9b9ac"))
    c.drawString(127, H - 110, "Architecture, modularization, and performance guide - Intelligence and Productivity Canary")
    c.setStrokeColor(HexColor("#3a3c34"))
    c.line(48, H - 143, W - 48, H - 143)

    nodes = [
        (48, 244, 130, 92, "Browse", "Two live panes, profiles, history, bookmarks, downloads and Reader Mode.", BLUE, "1"),
        (193, 244, 130, 92, "Recall", "Encrypted on-device content search with Apple Natural Language embeddings.", GREEN, "2"),
        (338, 244, 130, 92, "Research", "Immutable shared-tab evidence with exact claim citations and local boards.", LIME, "3"),
        (483, 244, 130, 92, "Work", "Solo agent dock, explicit grants, live context, models, files and terminal.", CORAL, "4"),
        (628, 244, 116, 92, "Sync", "Optional opaque ciphertext through Cloudflare, Supabase and private R2.", VIOLET, "5"),
    ]
    for x, y, w, h, heading, body, accent, badge in nodes:
        card(c, x, y, w, h, heading, body, accent, dark=True, badge=badge, body_size=7.2)
    for index in range(len(nodes) - 1):
        x = nodes[index][0] + nodes[index][2]
        arrow(c, x + 4, 290, nodes[index + 1][0] - 4, 290, LIME)

    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 15)
    c.drawString(48, 196, "Browser first. Local intelligence by default. Explicit authority always.")
    c.setFillColor(HexColor("#b9b9ac"))
    c.setFont("Helvetica", 9)
    c.drawString(48, 176, "This document describes the implemented Apple Silicon macOS canary and the boundaries that keep browsing, AI, and cloud services separate.")
    x = 48
    for label in ["macOS 14+", "Apple Silicon", "Electron + React", "Apache-2.0", "Canary 0.1.0-canary.6"]:
        x += pill(c, x, 126, label, LIME, dark=True) + 7
    c.setFillColor(HexColor("#85877b"))
    c.setFont("Helvetica", 7.5)
    c.drawString(48, 48, "Updated 2026-09-01 | Public source guide | locushost.co")


def page_processes(c):
    title(c, "System map", "Processes, views, and authority boundaries", "No remote page receives Node or a privileged preload", 2, dark=True)
    bands = [
        (34, 342, 724, 142, "TRUSTED LOCAL UI", HexColor("#252820")),
        (34, 201, 724, 125, "BROKERED LOCAL SERVICES", HexColor("#242720")),
        (34, 62, 724, 122, "UNTRUSTED CONTENT AND NETWORK", HexColor("#23251f")),
    ]
    for x, y, w, h, label, fill in bands:
        c.setFillColor(fill); c.setStrokeColor(HexColor("#42443b")); c.roundRect(x, y, w, h, 12, fill=1, stroke=1)
        c.setFillColor(HexColor("#8f9186")); c.setFont("Helvetica-Bold", 7); c.drawString(x + 12, y + h - 15, label)

    card(c, 50, 363, 154, 92, "Shell renderer", "Permanent browser chrome, Settings, Research Board, Recall, Tab Steward and command palette.", LIME, True, "UI", 7.2)
    card(c, 219, 363, 134, 92, "Work dock", "Chat, Plan, Changes, Files and Terminal on a dedicated Work-state channel.", CORAL, True, "W", 7.2)
    card(c, 368, 363, 134, 92, "Reader view", "Sanitized article HTML and macOS speech synthesis. No page scripts or forms.", BLUE, True, "R", 7.2)
    card(c, 517, 363, 108, 92, "Recorder", "Hidden trusted compositor for redacted tab media.", VIOLET, True, "REC", 7.2)
    card(c, 640, 363, 102, 92, "Preload", "Typed commands, queries, and separate Shell/Work state APIs.", GREEN, True, "IPC", 6.8)

    card(c, 50, 219, 178, 82, "Electron main broker", "Validates sender, schema, tab grant, page class, permission and profile; builds the minimum state projection for each renderer.", LIME, True, "B", 6.9)
    card(c, 243, 219, 146, 82, "Browser database", "WAL-mode SQLite for normal browser state and safe restore.", BLUE, True, "DB", 7.1)
    card(c, 404, 219, 158, 82, "Intelligence utility", "One-page-at-a-time indexing, encrypted vault, search, boards and bundles.", GREEN, True, "AI", 7.1)
    card(c, 577, 219, 165, 82, "Agent runtime", "Authenticated loopback Python process using versioned locus-platform contracts.", CORAL, True, "AG", 7.1)

    card(c, 50, 80, 164, 76, "Sandboxed tab views", "One WebContentsView per live tab. nodeIntegration off, sandbox on, no preload.", CORAL, True, "WEB", 7)
    card(c, 229, 80, 142, 76, "Apple frameworks", "Natural Language embeddings, safeStorage and system speech voices.", LIME, True, "OS", 7)
    card(c, 386, 80, 168, 76, "Hosted model providers", "ChatGPT Plan, OpenAI API, Claude API, Kimi and validated vLLM endpoints.", BLUE, True, "LLM", 7)
    card(c, 569, 80, 173, 76, "Cloud services", "Cloudflare Workers, least-privilege Supabase Postgres and private R2.", VIOLET, True, "NET", 7)

    arrow(c, 691, 363, 139, 301, LIME, "schema-validated")
    arrow(c, 228, 259, 243, 259, HexColor("#8f9186"))
    arrow(c, 389, 259, 404, 259, HexColor("#8f9186"))
    arrow(c, 562, 259, 577, 259, HexColor("#8f9186"))
    arrow(c, 139, 219, 132, 156, CORAL, "bounded actions")
    arrow(c, 483, 219, 300, 156, GREEN, "native helper")
    arrow(c, 660, 219, 470, 156, BLUE, "typed messages")


def page_modularization(c):
    title(c, "2026-09 refactor", "State paths, module seams, and build performance", "External exports, SQLite schema, HTTP formats, and locus-platform contracts are unchanged", 3)

    c.setFillColor(INK); c.setFont("Helvetica-Bold", 11); c.drawString(34, 476, "Surface-specific state publication")
    c.setFillColor(MUTED); c.setFont("Helvetica", 7.5); c.drawString(34, 462, "A mutation is batched once, projected by trust boundary, and sent only to the renderer that consumes it.")

    card(c, 34, 326, 132, 112, "Domain change", "Tabs, settings, runtime events, persistence, recording, sync, extensions, or Work actions invalidate state.", BLUE, badge="1", body_size=7.1)
    card(c, 196, 326, 150, 112, "State publisher", "Same-turn requests are coalesced. Work-local commands skip the Shell path; shared changes request both surfaces.", LIME, badge="2", body_size=7.1)
    card(c, 378, 384, 148, 54, "Shell projection", "Browser state + compact Work summary", GREEN, badge="S", body_size=6.8)
    card(c, 378, 326, 148, 54, "Work projection", "Grants + full Work, model and recording state", CORAL, badge="W", body_size=6.6)
    card(c, 558, 384, 200, 54, "Trusted browser chrome", "getShellState / subscribeShellState", GREEN, badge="UI", body_size=6.7)
    card(c, 558, 326, 200, 54, "Trusted Work renderer", "getWorkState / subscribeWorkState", CORAL, badge="UI", body_size=6.7)
    arrow(c, 166, 382, 196, 382, BLUE)
    arrow(c, 346, 382, 378, 411, GREEN)
    arrow(c, 346, 382, 378, 353, CORAL)
    arrow(c, 526, 411, 558, 411, GREEN, "authorized")
    arrow(c, 526, 353, 558, 353, CORAL, "authorized")

    c.setStrokeColor(LINE); c.line(34, 298, W - 34, 298)
    c.setFillColor(INK); c.setFont("Helvetica-Bold", 11); c.drawString(34, 281, "Responsibility-focused modules behind stable entry points")
    module_groups = [
        (34, 135, 169, 128, "Extension contract", VIOLET, ["contract + trusted keys", "manifest validation", "archive verification", "gallery documents"]),
        (219, 135, 169, 128, "Sync cryptography", GREEN, ["encoding + readiness", "device/account keys", "record encryption", "recovery + HLC clocks"]),
        (404, 135, 169, 128, "Sync service", BLUE, ["request schemas", "request support", "domain models", "repository capabilities"]),
        (589, 135, 169, 128, "Desktop core", CORAL, ["database record models", "surface state types", "state publisher", "dynamic surface loader"]),
    ]
    for x, y, w, h, heading, accent, items in module_groups:
        card(c, x, y, w, h, heading, "", accent, badge=heading[0])
        bullet_list(c, items, x + 13, y + h - 47, w - 26, 7.1, MUTED, 4)

    card(c, 34, 55, 211, 62, "Before", "67 renderer assets and about 13 MB because old hashed files survived builds.", CORAL, badge="-", body_size=7.1)
    card(c, 260, 55, 211, 62, "After", "11 assets, 490.7 KiB total; one surface loads on demand and preview fixtures stay development-only.", LIME, badge="+", body_size=6.9)
    card(c, 486, 55, 272, 62, "Regression gates", "Cycle scans, hotspot budgets, export snapshots, IPC tests, clean builds, and a 750 KiB renderer ceiling protect CI and canary releases.", BLUE, badge="OK", body_size=6.6)


def page_intelligence(c):
    title(c, "Private intelligence", "Recall, Research Boards, and Tab Steward", "Local-only records never enter browser sync", 4)
    card(c, 34, 342, 226, 142, "Private Semantic Recall", "Opt-in on first use. Eligible pages visited after enablement are captured with strict extraction, canonical URL deduplication, encrypted text, full-text terms and one mean-pooled embedding.", GREEN, badge="R", body_size=8)
    bullet_list(c, [
        "Searches open tabs, bookmarks and history with natural language and time hints.",
        "Apple Natural Language embeddings; deterministic keyword fallback for unsupported languages.",
        "500 MB per-profile cap; oldest unbookmarked content is evicted first.",
        "Per-result delete, excluded sites, index size and Clear Recall Data controls.",
    ], 48, 320, 205, 7.3)

    card(c, 283, 342, 226, 142, "Cited Research Board", "Up to ten explicitly shared current-window tabs become immutable encrypted snapshots. Passage ranking keeps total source text below 120,000 characters before a read-only model request.", LIME, badge="C", body_size=8)
    bullet_list(c, [
        "Every factual claim must cite an exact source ID and passage ID.",
        "Uncited or invalid model output fails visibly instead of being displayed.",
        "Saved boards survive source navigation or closure and remain local to the profile.",
        "Exports sanitized Markdown footnotes or a rendered PDF through native save dialogs.",
    ], 297, 320, 205, 7.3)

    card(c, 532, 342, 226, 142, "AI Tab Steward", "Provider-independent suggestions use canonical URLs, host and title similarity. Page text and tab metadata never leave the Mac.", BLUE, badge="T", body_size=8)
    bullet_list(c, [
        "Quiet badges only for exact duplicates or high-confidence clusters of at least three.",
        "A full preview lists every move, group, rename and potential closure.",
        "Duplicate closure and Save-and-Close bundles each require separate confirmation.",
        "Resume Later reopens bundles without duplicating already-open canonical URLs.",
    ], 546, 320, 205, 7.3)

    y = 72
    c.setStrokeColor(LINE); c.line(34, 188, W - 34, 188)
    c.setFillColor(INK); c.setFont("Helvetica-Bold", 12); c.drawString(34, 168, "Shared local intelligence pipeline")
    stages = [
        (34, y, 112, 68, "1. Eligibility", "Normal http(s), non-private, non-internal, non-excluded."),
        (161, y, 112, 68, "2. Extraction", "No inputs, editable fields, hidden nodes, scripts or frames."),
        (288, y, 112, 68, "3. Embedding", "Signed Swift helper with Apple NLP or keyword fallback."),
        (415, y, 112, 68, "4. Encryption", "XChaCha20-Poly1305 record keys, OS-protected profile key."),
        (542, y, 112, 68, "5. Retrieval", "Hybrid lexical, semantic and recency ranking under 300 ms target."),
        (669, y, 89, 68, "6. Action", "Reuse an open tab or open the result."),
    ]
    for x, sy, w, h, heading, body in stages:
        card(c, x, sy, w, h, heading, body, GREEN, badge=heading[0], body_size=6.4)
    for index in range(len(stages) - 1):
        arrow(c, stages[index][0] + stages[index][2] + 2, 106, stages[index + 1][0] - 2, 106, GREEN)


def page_browser_productivity(c):
    title(c, "Browser productivity", "Split View, command palette, and Reader", "Both panes remain ordinary tabs with independent grants and audio", 5)
    card(c, 34, 330, 352, 154, "Two-page Split View", "Two live page panes share one window; the focused pane owns browser controls.", BLUE, badge="2", body_size=8.2)
    # miniature split view
    c.setFillColor(HexColor("#eef1f9")); c.setStrokeColor(BLUE); c.roundRect(52, 352, 145, 70, 6, fill=1, stroke=1)
    c.setFillColor(HexColor("#f7f8fb")); c.roundRect(207, 352, 159, 70, 6, fill=1, stroke=1)
    c.setFillColor(BLUE); c.rect(197, 352, 5, 70, fill=1, stroke=0)
    c.setFillColor(MUTED); c.setFont("Helvetica-Bold", 8); c.drawString(61, 404, "PRIMARY - focused"); c.drawString(216, 404, "SECONDARY")
    line_text(c, "Selecting a tab replaces only the focused pane.", 61, 387, 7, MUTED, max_width=122)
    line_text(c, "Drag a tab onto L or R to assign it explicitly.", 216, 387, 7, MUTED, max_width=136)
    bullet_list(c, ["Neither visible pane sleeps.", "Recording pauses before an unshared pane frame.", "Settings hides panes without destroying them."], 52, 310, 310, 7.2)

    card(c, 406, 330, 352, 154, "Universal Command Palette", "Command-K searches trusted browser data and allowlisted actions in place.", LIME, badge="K", body_size=8.2)
    c.setFillColor(DARK); c.roundRect(425, 358, 314, 66, 8, fill=1, stroke=0)
    c.setFillColor(WHITE); c.setFont("Helvetica", 8); c.drawString(440, 405, "Search tabs, history, settings, or run a command...")
    options = [("Google", "open tab"), ("Toggle Split View", "command"), ("Local models article", "private recall")]
    for index, (name, kind) in enumerate(options):
        yy = 386 - index * 15
        c.setFillColor(LIME if index == 0 else HexColor("#34362f")); c.roundRect(437, yy - 8, 295, 13, 4, fill=1, stroke=0)
        c.setFillColor(INK if index == 0 else WHITE); c.setFont("Helvetica-Bold", 6.5); c.drawString(445, yy - 4, name); c.drawRightString(724, yy - 4, kind)
    bullet_list(c, ["Exact and fuzzy matches rank before semantics.", "Existing canonical URLs are reused instead of duplicated.", "Private windows expose only current private tabs and ephemeral actions."], 424, 310, 310, 7.2)

    card(c, 34, 72, 724, 205, "Reader Mode with Read Aloud", "Safe extraction runs inside the isolated DOM bridge, then host-side sanitization applies a second strict allowlist. Reader replaces only the selected pane, so the other split page can remain live.", CORAL, badge="A", body_size=8.2)
    left = [
        "Locus, paper and dark appearances",
        "Adjustable text size, width and line spacing",
        "Links return through validated browser navigation",
        "Private windows keep article contents ephemeral",
    ]
    right = [
        "Installed macOS system voices - no AI provider",
        "Rate, play/pause and previous/next sentence",
        "Current sentence highlighting",
        "Speech stops on navigation, crash, close or exit",
    ]
    c.setFillColor(HexColor("#fbf7e8")); c.setStrokeColor(HexColor("#e1d7bc")); c.roundRect(54, 93, 350, 119, 8, fill=1, stroke=1)
    c.setFillColor(INK); c.setFont("Times-Bold", 15); c.drawString(71, 190, "A quieter page for focused reading")
    line_text(c, "Reader keeps the article central and trusted controls visible.", 71, 171, 8, MUTED, max_width=310)
    c.setFillColor(LIME); c.rect(71, 133, 4, 28, fill=1, stroke=0)
    line_text(c, "Read Aloud highlights the current sentence and uses voices already installed on this Mac.", 84, 154, 7.4, INK, max_width=286)
    bullet_list(c, left, 427, 194, 145, 7.3, MUTED, 4)
    bullet_list(c, right, 590, 194, 150, 7.3, MUTED, 4)


def page_privacy(c):
    title(c, "Privacy model", "What is stored, shared, synced, and excluded", "Private windows support only Split View, Palette and ephemeral Reader", 6, dark=True)
    columns = [50, 265, 474, 624]
    widths = [195, 189, 130, 118]
    headers = [("LOCAL ENCRYPTED", GREEN), ("NORMAL LOCAL", BLUE), ("OPTIONAL CLOUD", VIOLET), ("NEVER CAPTURED", CORAL)]
    rows = [
        ["Recall page text + vectors", "Tabs and groups", "Bookmarks", "Passwords / passkeys"],
        ["Research boards + evidence", "History and bookmarks", "History events", "Payment fields"],
        ["Resume Later bundles", "Downloads + permissions", "Tab groups", "Credential inputs"],
        ["Recording transcripts", "Reader preferences", "Remote-device tabs", "Private windows"],
        ["Provider credentials", "Extension installs", "Browser settings subset", "Internal / local files"],
        ["Sync account/device keys", "Crash restore state", "Gallery extension metadata", "Inaccessible frames"],
    ]
    for index, (heading, accent) in enumerate(headers):
        x, w = columns[index], widths[index]
        c.setFillColor(accent); c.roundRect(x, 447, w, 28, 7, fill=1, stroke=0)
        c.setFillColor(INK if accent == LIME or accent == GREEN else WHITE); c.setFont("Helvetica-Bold", 8); c.drawCentredString(x + w / 2, 457, heading)
    for row_index, row in enumerate(rows):
        y = 409 - row_index * 46
        for column_index, value in enumerate(row):
            x, w = columns[column_index], widths[column_index]
            c.setFillColor(HexColor("#292b25") if row_index % 2 == 0 else HexColor("#252720"))
            c.setStrokeColor(HexColor("#3c3f36")); c.roundRect(x, y, w, 36, 5, fill=1, stroke=1)
            line_text(c, value, x + 8, y + 20, 7.2, WHITE, max_width=w - 16)

    card(c, 50, 76, 224, 89, "OS-protected keys", "Random per-profile content keys and recording keys are wrapped by macOS secure storage. XChaCha20-Poly1305 associated data binds every record to its profile, kind and ID.", LIME, True, "KEY", 7.3)
    card(c, 289, 76, 224, 89, "Strict extraction", "Forms, inputs, editable regions, credential/payment shapes, hidden content, scripts and inaccessible frames are excluded before text reaches Recall or Research.", GREEN, True, "DOM", 7.3)
    card(c, 528, 76, 214, 89, "Pause instead of leak", "Indexing pauses during recording, intensive agent work or serious thermal pressure. Recording pauses when a focused pane becomes unshared or protected.", CORAL, True, "STOP", 7.3)


def page_full_product(c):
    title(c, "Implemented canary", "Current feature inventory and service topology", "Solo-agent scope - local models remain optional and off by default", 7)
    groups = [
        (34, 330, 230, 154, "Browser foundation", BLUE, ["Tabs, groups, profiles and private windows", "History, bookmarks, downloads and restore", "Permissions, passwords, zoom, find, media", "Print/PDF, tab sleeping and split panes"]),
        (281, 330, 230, 154, "Solo Work and live context", CORAL, ["Ask, Work, Plan and Build modes", "Chat, Plan, Changes, Files and Terminal", "Explicit read/interact tab grants", "Visible recording, transcript and redacted video"]),
        (528, 330, 230, 154, "Models and local intelligence", GREEN, ["ChatGPT Plan, OpenAI, Claude, Kimi, vLLM", "Optional Ollama Work models", "Private Recall and Tab Steward", "Cited Research and system Read Aloud"]),
        (34, 153, 230, 154, "Extensions", VIOLET, ["Signed .locusx package and inventory", "Publisher + gallery signatures", "Permission review, update and rollback", "Developer Mode isolated from private profiles"]),
        (281, 153, 230, 154, "Encrypted sync", LIME, ["Passkeys and X25519 device approval", "XChaCha20-Poly1305 client ciphertext", "Offline queue, HLC merge and tombstones", "Cloud/device/account deletion"]),
        (528, 153, 230, 154, "Release and quality", BLUE, ["Apple Silicon macOS 14+ direct download", "Signing, notarization and canary updater", "Contract, cycle, artifact and security gates", "VoiceOver, 200% scale and Reduced Motion"]),
    ]
    for x, y, w, h, heading, accent, items in groups:
        card(c, x, y, w, h, heading, "", accent, badge=heading[0])
        bullet_list(c, items, x + 13, y + h - 46, w - 26, 7.8, MUTED, 6)

    c.setStrokeColor(LINE); c.line(34, 132, W - 34, 132)
    c.setFillColor(INK); c.setFont("Helvetica-Bold", 11); c.drawString(34, 112, "Production service path")
    service_nodes = [
        (34, 55, 132, "Signed desktop", "Ciphertext + passkey auth", BLUE),
        (194, 55, 132, "Cloudflare Worker", "Validation + rate limits", VIOLET),
        (354, 55, 132, "Hyperdrive", "Least-privilege SQL path", GREEN),
        (514, 55, 116, "Supabase", "Private Postgres schema", LIME),
        (658, 55, 100, "Private R2", "Large opaque records", CORAL),
    ]
    for x, y, w, heading, body, accent in service_nodes:
        card(c, x, y, w, 54, heading, body, accent, badge=heading[0], body_size=6.3)
    for index in range(len(service_nodes) - 1):
        arrow(c, service_nodes[index][0] + service_nodes[index][2] + 3, 82, service_nodes[index + 1][0] - 3, 82, MUTED)


def build():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUTPUT), pagesize=PAGE, pageCompression=1)
    c.setTitle("Locus Browser Architecture and Feature Guide")
    c.setAuthor("Locus Browser")
    for renderer in [page_cover, page_processes, page_modularization, page_intelligence, page_browser_productivity, page_privacy, page_full_product]:
        renderer(c)
        c.showPage()
    c.save()
    print(OUTPUT)


if __name__ == "__main__":
    build()
