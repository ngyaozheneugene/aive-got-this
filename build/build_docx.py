"""Render docs/implementation-plan.md into Dispatch_Coordinator_Implementation_Plan.docx.

Styles are copied from the historical v0.4 proposal docx. That file is not overwritten.

Usage:  python build/build_docx.py
"""

import html
import os
import re
import shutil
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
README = os.path.join(ROOT, "docs", "implementation-plan.md")
STYLE_DOCX = os.path.join(ROOT, "docs", "Dispatch_Coordinator_Agent_Proposal.docx")
DOCX = os.path.join(ROOT, "docs", "Dispatch_Coordinator_Implementation_Plan.docx")

# Design tokens lifted from the existing document.
FONT = '<w:rFonts w:ascii="Arial" w:cs="Arial" w:eastAsia="Arial" w:hAnsi="Arial"/>'
MONO = '<w:rFonts w:ascii="Consolas" w:cs="Consolas" w:eastAsia="Consolas" w:hAnsi="Consolas"/>'
INK = "111111"
ACCENT = "B45309"
HEAD_FILL = "16325C"
CELL_BORDER = "C9D2DC"
TEXT_W = 9360  # printable width in DXA

SUBTITLE = "Agent-assisted recovery for a Singapore HVAC field-service day"

BODY_SZ = 22
CELL_SZ = 17

NS = (
    '<w:document mc:Ignorable="w14 w15" '
    'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" '
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
    'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" '
    'xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">'
)

SECTPR = (
    '<w:sectPr><w:headerReference w:type="default" r:id="rId7"/>'
    '<w:footerReference w:type="default" r:id="rId8"/>'
    '<w:pgSz w:w="12240" w:h="15840" w:orient="portrait"/>'
    '<w:pgMar w:top="1000" w:right="1000" w:bottom="1000" w:left="1000" '
    'w:header="708" w:footer="708" w:gutter="0"/>'
    "<w:pgNumType/><w:docGrid w:linePitch=\"360\"/></w:sectPr>"
)


def esc(text):
    return html.escape(text, quote=False)


def run(text, *, bold=False, italic=False, mono=False, sz=BODY_SZ, color=INK):
    """One <w:r>. Explicit false flags mirror how the original file was written."""
    rpr = [MONO if mono else FONT]
    rpr.append("<w:b/><w:bCs/>" if bold else '<w:b w:val="false"/><w:bCs w:val="false"/>')
    if italic:
        rpr.append("<w:i/><w:iCs/>")
    rpr.append('<w:color w:val="%s"/>' % color)
    rpr.append('<w:sz w:val="%d"/><w:szCs w:val="%d"/>' % (sz, sz))
    return '<w:r><w:rPr>%s</w:rPr><w:t xml:space="preserve">%s</w:t></w:r>' % (
        "".join(rpr),
        esc(text),
    )


TOKEN = re.compile(r"(\*\*.+?\*\*|`[^`]+`)")


def runs(text, *, sz=BODY_SZ, color=INK, bold_all=False):
    """Convert inline **bold** and `code` into runs."""
    out = []
    for part in TOKEN.split(text):
        if not part:
            continue
        if part.startswith("**") and part.endswith("**") and len(part) > 4:
            out.append(run(part[2:-2], bold=True, sz=sz, color=color))
        elif part.startswith("`") and part.endswith("`") and len(part) > 2:
            out.append(run(part[1:-1], mono=True, sz=sz - 2, color=color, bold=bold_all))
        else:
            out.append(run(part, bold=bold_all, sz=sz, color=color))
    return "".join(out)


def para(content, *, before=0, after=140, style=None, extra="", ind=""):
    """One <w:p>.

    CT_PPrBase fixes the child order, so pStyle / numPr / pBdr / shd go in
    `extra` ahead of spacing, and any indent goes in `ind` after it.
    """
    ppr = []
    if style:
        ppr.append('<w:pStyle w:val="%s"/>' % style)
    ppr.append(extra)
    ppr.append('<w:spacing w:after="%d" w:before="%d"/>' % (after, before))
    ppr.append(ind)
    return "<w:p><w:pPr>%s</w:pPr>%s</w:p>" % ("".join(ppr), content)


def heading1(text):
    return para(
        run(text, bold=True, sz=32),
        style="Heading1",
        before=360,
        after=140,
    )


def heading2(text):
    return para(run(text, bold=True, sz=24), before=220, after=90)


def bullet(text):
    extra = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>'
    return para(runs(text), style="ListParagraph", after=70, extra=extra)


def numbered(index, text):
    return para(
        run("%d. " % index, bold=True) + runs(text),
        after=70,
        ind='<w:ind w:left="260" w:hanging="260"/>',
    )


def callout(text):
    extra = (
        '<w:pBdr><w:left w:val="single" w:sz="18" w:space="6" w:color="%s"/></w:pBdr>'
        '<w:shd w:val="clear" w:fill="FDF6EC"/>' % ACCENT
    )
    return para(
        runs(text),
        before=120,
        after=160,
        extra=extra,
        ind='<w:ind w:left="200" w:right="120"/>',
    )


def code_block(lines):
    extra = '<w:shd w:val="clear" w:fill="F4F5F7"/>'
    ind = '<w:ind w:left="160" w:right="120"/>'
    out = []
    for n, line in enumerate(lines):
        out.append(
            para(
                run(line or " ", mono=True, sz=18),
                before=120 if n == 0 else 0,
                after=140 if n == len(lines) - 1 else 0,
                extra=extra,
                ind=ind,
            )
        )
    return "".join(out)


def col_widths(rows):
    """Proportional widths summing to TEXT_W, floored so no column collapses."""
    ncol = len(rows[0])
    weights = []
    for c in range(ncol):
        longest = max(len(strip_marks(r[c])) for r in rows)
        weights.append(min(max(longest, 6), 58))
    total = sum(weights)
    widths = [max(int(TEXT_W * w / total), 620) for w in weights]
    widths[-1] += TEXT_W - sum(widths)
    return widths


def strip_marks(text):
    return text.replace("**", "").replace("`", "")


def cell(text, width, *, header=False):
    if header:
        borders = "".join(
            '<w:%s w:val="single" w:color="%s" w:sz="8"/>' % (side, HEAD_FILL)
            for side in ("top", "left", "bottom", "right")
        )
        shd = '<w:shd w:fill="%s" w:val="clear"/>' % HEAD_FILL
        body = run(strip_marks(text), bold=True, sz=CELL_SZ, color="FFFFFF")
    else:
        borders = "".join(
            '<w:%s w:val="single" w:color="%s" w:sz="4"/>' % (side, CELL_BORDER)
            for side in ("top", "left", "bottom", "right")
        )
        shd = ""
        body = runs(text, sz=CELL_SZ)
    return (
        "<w:tc><w:tcPr>"
        '<w:tcW w:type="dxa" w:w="%d"/><w:tcBorders>%s</w:tcBorders>%s'
        '<w:tcMar><w:top w:type="dxa" w:w="55"/><w:left w:type="dxa" w:w="70"/>'
        '<w:bottom w:type="dxa" w:w="55"/><w:right w:type="dxa" w:w="70"/></w:tcMar>'
        "</w:tcPr><w:p>%s</w:p></w:tc>" % (width, borders, shd, body)
    )


def table(rows):
    widths = col_widths(rows)
    grid = "".join('<w:gridCol w:w="%d"/>' % w for w in widths)
    borders = "".join(
        '<w:%s w:val="single" w:color="auto" w:sz="4"/>' % side
        for side in ("top", "left", "bottom", "right", "insideH", "insideV")
    )
    out = [
        '<w:tbl><w:tblPr><w:tblW w:type="auto" w:w="100"/>'
        "<w:tblBorders>%s</w:tblBorders></w:tblPr><w:tblGrid>%s</w:tblGrid>"
        % (borders, grid)
    ]
    for n, row in enumerate(rows):
        cells = "".join(cell(v, widths[i], header=(n == 0)) for i, v in enumerate(row))
        trpr = "<w:trPr><w:tblHeader/></w:trPr>" if n == 0 else ""
        out.append("<w:tr>%s%s</w:tr>" % (trpr, cells))
    out.append("</w:tbl>")
    # Word needs a paragraph after a table to keep spacing sane.
    out.append(para("", after=120))
    return "".join(out)


MERMAID_STEPS = [
    "An event or the 15-minute tick starts the run.",
    "Load the job, the board snapshot and the history.",
    "PLAN. Pick exactly one named playbook and log it.",
    "ACT. Call tools. Each one re-validates against Postgres.",
    "VERIFY. Read the board back. Invariants must still hold.",
    "If the policy says needs-desk, call request_desk_approval, interrupt and wait.",
    "The desk approves or rejects, the same thread_id resumes, and decision_log is written.",
]


def parse(md):
    """Walk the Markdown line by line and emit body XML."""
    lines = md.split("\n")
    body = []
    i = 0
    ordinal = 0

    # Title block, rebuilt to match the original cover.
    body.append(
        para(
            run("SHOW ME YOUR AGENTS  ·  NUS-ISS", bold=True, sz=16, color=ACCENT),
            after=80,
        )
    )
    body.append(para(run("Dispatch Coordinator", bold=True, sz=48), after=60))
    body.append(para(run(SUBTITLE, sz=26), after=120))

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if stripped.startswith("# "):
            i += 1
            continue

        if stripped.endswith("<br>") or stripped.startswith("**Status:**"):
            meta = []
            while i < len(lines) and lines[i].strip():
                meta.append(lines[i].strip().replace("<br>", ""))
                i += 1
            # Status is a sentence, so it gets its own line under the short fields.
            short = [m for m in meta if not m.startswith("**Status:**")]
            status = [m for m in meta if m.startswith("**Status:**")]
            if short:
                body.append(para(runs("  ·  ".join(short), sz=18), after=40))
            for s in status:
                body.append(para(runs(s, sz=18), after=200))
            continue

        if stripped == "---" or not stripped:
            i += 1
            continue

        if stripped.startswith("### "):
            body.append(heading2(stripped[4:]))
            i += 1
            continue

        if stripped.startswith("## "):
            body.append(heading1(stripped[3:]))
            ordinal = 0
            i += 1
            continue

        if stripped.startswith("```"):
            lang = stripped[3:].strip()
            i += 1
            block = []
            while i < len(lines) and not lines[i].strip().startswith("```"):
                block.append(lines[i])
                i += 1
            i += 1
            if lang == "mermaid":
                for n, step in enumerate(MERMAID_STEPS, 1):
                    body.append(numbered(n, step))
            else:
                body.append(code_block(block))
            continue

        if stripped.startswith("> "):
            quote = []
            while i < len(lines) and lines[i].strip().startswith("> "):
                quote.append(lines[i].strip()[2:])
                i += 1
            body.append(callout(" ".join(quote)))
            continue

        if stripped.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                raw = lines[i].strip().strip("|")
                if not re.fullmatch(r"[\s|:-]+", raw):
                    rows.append([c.strip() for c in raw.split("|")])
                i += 1
            if rows:
                body.append(table(rows))
            continue

        if stripped.startswith("- "):
            while i < len(lines) and lines[i].strip().startswith("- "):
                body.append(bullet(lines[i].strip()[2:]))
                i += 1
            body.append(para("", after=60))
            continue

        m = re.match(r"^(\d+)\.\s+(.*)$", stripped)
        if m:
            ordinal += 1
            body.append(numbered(ordinal, m.group(2)))
            i += 1
            continue

        # The cover already carries the subtitle, so drop the clause that repeats it.
        if stripped.startswith(SUBTITLE + "."):
            stripped = stripped[len(SUBTITLE) + 1 :].lstrip()

        body.append(para(runs(stripped), after=140))
        i += 1

    return "".join(body)


def main():
    with open(README, encoding="utf-8") as fh:
        md = fh.read()

    document = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + NS
    document += "<w:body>" + parse(md) + SECTPR + "</w:body></w:document>"

    tmp = DOCX + ".tmp"
    with zipfile.ZipFile(STYLE_DOCX) as src, zipfile.ZipFile(
        tmp, "w", zipfile.ZIP_DEFLATED
    ) as dst:
        for item in src.infolist():
            if item.filename.endswith("/"):
                continue
            if item.filename == "word/document.xml":
                dst.writestr(item, document.encode("utf-8"))
            else:
                dst.writestr(item, src.read(item.filename))
    shutil.move(tmp, DOCX)
    print("wrote %s (%d bytes of body XML)" % (DOCX, len(document)))


if __name__ == "__main__":
    main()
