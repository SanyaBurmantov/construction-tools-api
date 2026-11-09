"""Readable reasons beside the model's number.

The classifier gives one probability and no «why». These are the marks of
machine copy a person can see and fix — stock phrases, bureaucratese, empty
praise — plus two measures of rhythm. They are **explanations, not the
verdict**: rules of this kind alone separate human from AI text badly (the
aiw-ru rule score has ROC AUC 0.62 on LLMTrace against the model's 0.99), and
a supplier's sales copy is full of them without any model's help. What they
are good for is pointing at the sentence to rewrite.
"""

from __future__ import annotations

import re
import statistics
from dataclasses import dataclass

from .text import sentences, words


@dataclass(frozen=True)
class Marker:
    kind: str
    label: str
    pattern: re.Pattern[str]


def _m(kind: str, label: str, *alternatives: str) -> Marker:
    body = "|".join(alternatives)
    return Marker(kind, label, re.compile(rf"(?<![а-яёa-z])(?:{body})", re.IGNORECASE))


# Stems, matched case-insensitively at a word start. Kept to phrases that
# carry no information in a product or category text: «обеспечивает» is here,
# «обеспечивает 2800 об/мин» is not a reason to rewrite — so the UI shows the
# sentence and lets a person decide.
MARKERS: list[Marker] = [
    _m("praise", "Пустая похвала",
       r"высок(?:ое|ого|им|ом) качеств", r"высококачествен", r"превосходн",
       r"безупречн", r"отличн(?:ый|ым|ое) выбор", r"идеальн(?:о|ый|ым|ая|ое)\s+(?:подход|реш|выбор)",
       r"незаменим", r"надёжн\w*\s+и\s+долговечн", r"надежн\w*\s+и\s+долговечн",
       r"по достоинству оцен", r"верн\w+ помощник", r"надёжн\w+ помощник",
       r"надежн\w+ помощник", r"непревзойд", r"исключительн\w+ качеств",
       r"премиальн\w+ качеств", r"лучш(?:ий|ее|ая) выбор"),
    _m("cliche", "Штамп нейросети",
       r"игра\w+ (?:ключев|важн|значим)\w* рол", r"широк\w+ спектр",
       r"широк\w+ кру[гж]\w* задач", r"разнообразн\w+ задач",
       r"открыва\w+ (?:новые|широкие) возможност", r"неотъемлем\w+ част",
       r"на новый уровень", r"(?:важно|стоит|следует) отметить",
       r"(?:важно|стоит) подчеркнуть", r"в заключени", r"подводя итог",
       r"не просто\s+\w+,?\s+а", r"это не только\b", r"сочета\w+ в себе",
       r"гармоничн\w+ сочета", r"благодаря продуманн", r"продуманн\w+ (?:конструкц|дизайн)",
       r"современн\w+ технолог", r"инновацион"),
    _m("opener", "Разбег перед делом",
       r"в современном мире", r"в наше время", r"в наши дни", r"не секрет,? что",
       r"сегодня вс[её] больше", r"давайте (?:разберём|разберем|рассмотрим)",
       r"когда речь (?:идёт|идет) о", r"если вы ищете", r"хотите\s+\w+\?"),
    _m("bureaucratese", "Канцелярит",
       r"являет(?:ся|ются)", r"осуществля", r"данн(?:ый|ая|ое|ого|ой|ую|ым|ые|ых) ",
       r"в рамках", r"в целях", r"с целью", r"способству", r"посредством",
       r"обладает\s+\w+", r"характеризу\w+ ", r"представля\w+ собой"),
    _m("hedge", "Пустая связка",
       r"кроме того", r"более того", r"таким образом", r"помимо этого",
       r"в свою очередь", r"при этом стоит", r"в целом"),
]


def markers(text: str) -> list[dict]:
    found = []
    for marker in MARKERS:
        for match in marker.pattern.finditer(text):
            found.append(
                {
                    "kind": marker.kind,
                    "label": marker.label,
                    "start": match.start(),
                    "end": match.end(),
                    "text": match.group(0),
                }
            )
    found.sort(key=lambda m: m["start"])
    return found


def mattr(tokens: list[str], window: int = 50) -> float | None:
    """Moving-average type-token ratio: vocabulary variety that does not
    shrink just because a text is longer (plain TTR does)."""
    if len(tokens) < window:
        return round(len(set(tokens)) / len(tokens), 3) if tokens else None
    ratios = [
        len(set(tokens[i : i + window])) / window
        for i in range(0, len(tokens) - window + 1)
    ]
    return round(statistics.fmean(ratios), 3)


def rhythm(text: str) -> dict:
    lengths = [len(words(s.text)) for s in sentences(text)]
    tokens = [w.lower() for w in words(text)]
    mean = statistics.fmean(lengths) if lengths else 0.0
    # Burstiness: how much sentence length varies (coefficient of variation).
    # People alternate short and long sentences; models even them out. A
    # weak signal on its own and meaningless under ~5 sentences.
    burstiness = (
        round(statistics.pstdev(lengths) / mean, 3) if len(lengths) >= 5 and mean else None
    )
    return {
        "words": len(tokens),
        "sentences": len(lengths),
        "avgSentenceWords": round(mean, 1),
        "burstiness": burstiness,
        "lexicalVariety": mattr(tokens),
    }


def summary(found: list[dict], word_count: int) -> list[dict]:
    """Counts per kind and per 100 words, most frequent first."""
    by_kind: dict[str, dict] = {}
    for m in found:
        entry = by_kind.setdefault(
            m["kind"], {"kind": m["kind"], "label": m["label"], "count": 0, "examples": []}
        )
        entry["count"] += 1
        example = m["text"].lower()
        if example not in entry["examples"] and len(entry["examples"]) < 5:
            entry["examples"].append(example)
    for entry in by_kind.values():
        entry["per100Words"] = round(100 * entry["count"] / word_count, 2) if word_count else 0
    return sorted(by_kind.values(), key=lambda e: -e["count"])
