"""Pure text helpers: sentences, words, fragments. No model, no I/O."""

from __future__ import annotations

import re
from dataclasses import dataclass

WORD = re.compile(r"[A-Za-zА-Яа-яЁё0-9]+(?:[-'][A-Za-zА-Яа-яЁё0-9]+)*")
# A sentence ends at . ! ? … followed by a space and a capital, a digit or a
# quote — «М10х12х40 мм. Для бетона» splits, «ГОСТ 7798-70, т.е. болт» and
# «1.5 кВт» do not.
SENTENCE_END = re.compile(r"(?<=[.!?…])\s+(?=[«\"(A-ZА-ЯЁ0-9])")
PARAGRAPH = re.compile(r"\n\s*\n|\n(?=\s*(?:[-*•–—]|\d{1,3}[.)])\s)")


@dataclass(frozen=True)
class Span:
    start: int
    end: int
    text: str


def words(text: str) -> list[str]:
    return WORD.findall(text)


def sentences(text: str) -> list[Span]:
    spans: list[Span] = []
    for para in _split(text, PARAGRAPH, 0):
        spans.extend(_split(para.text, SENTENCE_END, para.start))
    return [s for s in spans if words(s.text)]


def _split(text: str, pattern: re.Pattern[str], offset: int) -> list[Span]:
    out: list[Span] = []
    pos = 0
    for match in pattern.finditer(text):
        out.append(_span(text, pos, match.start(), offset))
        pos = match.end()
    out.append(_span(text, pos, len(text), offset))
    return [s for s in out if s.text]


def _span(text: str, start: int, end: int, offset: int) -> Span:
    chunk = text[start:end]
    lead = len(chunk) - len(chunk.lstrip())
    chunk = chunk.strip()
    return Span(offset + start + lead, offset + start + lead + len(chunk), chunk)


def fragments(text: str, *, min_words: int = 40, max_words: int = 150) -> list[Span]:
    """The text cut into pieces worth scoring on their own.

    Sentences are packed in order into pieces of `min_words`..`max_words`
    words, starting a new piece at a paragraph break once the current one is
    big enough. A classifier is unreliable on a dozen words (the model card:
    accuracy 0.94 under 50 words, 0.98 over 150), so a trailing scrap is
    merged into the piece before it rather than scored alone.
    """
    spans = sentences(text)
    if not spans:
        return []
    paragraph_starts = {p.start for p in _split(text, PARAGRAPH, 0)}
    pieces: list[list[Span]] = [[]]
    count = 0
    for span in spans:
        n = len(words(span.text))
        current = pieces[-1]
        if current and (
            count + n > max_words
            or (count >= min_words and span.start in paragraph_starts)
        ):
            pieces.append([])
            count = 0
        pieces[-1].append(span)
        count += n
    if len(pieces) > 1 and sum(len(words(s.text)) for s in pieces[-1]) < min_words:
        tail = pieces.pop()
        pieces[-1].extend(tail)
    return [
        Span(group[0].start, group[-1].end, text[group[0].start : group[-1].end])
        for group in pieces
    ]
