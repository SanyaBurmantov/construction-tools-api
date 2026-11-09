"""One text in, one report out: the model's probability for the whole text
and for each fragment, the readable markers and the rhythm measures."""

from __future__ import annotations

from typing import Protocol

from . import signals
from .text import fragments, words

# Bands for the UI. The model's own threshold is 0.5; the wide middle band is
# deliberate — the published false-positive rate (3.4% of human texts called
# AI at 0.5) was measured on articles, news and reviews, not on product
# cards, and a short supplier blurb is exactly where it is least sure.
BANDS = [
    (0.85, "ai", "Похоже на текст нейросети"),
    (0.6, "likely-ai", "Скорее нейросеть"),
    (0.4, "unclear", "Не понять"),
    (0.15, "likely-human", "Скорее человек"),
    (0.0, "human", "Похоже на текст человека"),
]

SHORT_TEXT_WORDS = 50
FRAGMENT_BATCH = 8


class Scorer(Protocol):
    name: str
    window: int

    def probabilities(self, texts: list[str]) -> list[tuple[float, int]]: ...


def band(probability: float) -> dict:
    for floor, key, label in BANDS:
        if probability >= floor:
            return {"key": key, "label": label}
    return {"key": BANDS[-1][1], "label": BANDS[-1][2]}


def analyze(text: str, scorer: Scorer, *, with_fragments: bool = True) -> dict:
    text = text.strip()
    word_count = len(words(text))
    pieces = fragments(text) if with_fragments else []
    # The whole text on its own, then the fragments in small batches: a batch
    # is padded to its longest row, and one 2 000-token text beside thirty
    # fragments padded all of them to 2 000 (4.8 GB peak, 25 s). A single
    # fragment is the whole text — no point scoring it twice.
    probability, tokens = scorer.probabilities([text])[0]
    scores: list[tuple[float, int]] = [(probability, tokens)]
    if len(pieces) > 1:
        for i in range(0, len(pieces), FRAGMENT_BATCH):
            scores.extend(
                scorer.probabilities([p.text for p in pieces[i : i + FRAGMENT_BATCH]])
            )

    warnings = []
    if word_count < SHORT_TEXT_WORDS:
        warnings.append(
            f"Мало текста ({word_count} слов): на коротких текстах модель ошибается чаще, "
            "оценка ориентировочная."
        )
    if tokens >= scorer.window:
        warnings.append(
            f"Текст длинный: модель прочитала первые {scorer.window} токенов, "
            "фрагменты ниже оценены каждый целиком."
        )

    found = signals.markers(text)
    return {
        "probability": round(probability, 4),
        "verdict": band(probability),
        "model": scorer.name,
        "tokens": tokens,
        "words": word_count,
        "warnings": warnings,
        "fragments": [
            {
                "start": piece.start,
                "end": piece.end,
                "words": len(words(piece.text)),
                "probability": round(score, 4),
                "verdict": band(score),
            }
            for piece, (score, _) in zip(pieces, scores[1:])
        ]
        if len(pieces) > 1
        else [],
        "markers": found,
        "markerSummary": signals.summary(found, word_count),
        "rhythm": signals.rhythm(text),
    }


def score_many(texts: list[str], scorer: Scorer) -> list[dict]:
    """Bare probabilities for a batch — catalogue scans and site crawls."""
    out = []
    scores: list[tuple[float, int]] = []
    # Sorted by length so each small batch pads to a similar width.
    order = sorted(range(len(texts)), key=lambda i: len(texts[i]))
    by_index: dict[int, tuple[float, int]] = {}
    for i in range(0, len(order), FRAGMENT_BATCH):
        chunk = order[i : i + FRAGMENT_BATCH]
        for k, score in zip(chunk, scorer.probabilities([texts[k] for k in chunk])):
            by_index[k] = score
    scores = [by_index[i] for i in range(len(texts))]
    for text, (probability, tokens) in zip(texts, scores):
        out.append(
            {
                "probability": round(probability, 4),
                "verdict": band(probability)["key"],
                "tokens": tokens,
                "words": len(words(text)),
            }
        )
    return out
