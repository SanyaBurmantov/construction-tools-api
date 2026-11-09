import unittest

from detector.analyze import analyze, band, score_many
from detector.signals import markers, rhythm, summary
from detector.text import fragments, sentences, words


class SentencesTest(unittest.TestCase):
    def test_splits_on_sentence_end_not_on_numbers_or_abbreviations(self):
        text = "Анкер М10х12х40 мм. Для бетона, т.е. для опор. Мощность 1.5 кВт! Готово?"
        self.assertEqual(
            [s.text for s in sentences(text)],
            ["Анкер М10х12х40 мм.", "Для бетона, т.е. для опор.", "Мощность 1.5 кВт!", "Готово?"],
        )

    def test_offsets_point_back_into_the_text(self):
        text = "  Первое предложение.\n\nВторое — после абзаца. Третье."
        for span in sentences(text):
            self.assertEqual(text[span.start : span.end], span.text)

    def test_list_items_are_sentences(self):
        text = "Комплект:\n- перфоратор\n- кейс"
        self.assertEqual([s.text for s in sentences(text)], ["Комплект:", "- перфоратор", "- кейс"])


class FragmentsTest(unittest.TestCase):
    def sentence(self, n, word="слово"):
        return " ".join([word.capitalize()] + [word] * (n - 2)) + " конец."

    def test_short_text_is_one_fragment(self):
        text = "Короткий текст. Ещё одно предложение."
        self.assertEqual(len(fragments(text)), 1)

    def test_long_text_is_cut_and_offsets_hold(self):
        text = " ".join(self.sentence(20) for _ in range(30))
        pieces = fragments(text)
        self.assertGreater(len(pieces), 2)
        for piece in pieces:
            self.assertEqual(text[piece.start : piece.end], piece.text)
            self.assertLessEqual(len(words(piece.text)), 150)

    def test_trailing_scrap_joins_the_piece_before(self):
        text = " ".join(self.sentence(25) for _ in range(6)) + " Хвост."
        pieces = fragments(text)
        self.assertTrue(pieces[-1].text.endswith("Хвост."))
        self.assertGreaterEqual(len(words(pieces[-1].text)), 40)

    def test_paragraph_break_starts_a_piece_once_big_enough(self):
        first = " ".join(self.sentence(15) for _ in range(3))
        second = " ".join(self.sentence(15, "другое") for _ in range(3))
        pieces = fragments(first + "\n\n" + second)
        self.assertEqual([p.text for p in pieces], [first, second])


class MarkersTest(unittest.TestCase):
    def test_finds_stock_phrases_with_offsets(self):
        text = (
            "В современном мире дрель является незаменимым помощником. "
            "Она играет ключевую роль и подходит для широкого спектра задач."
        )
        found = markers(text)
        kinds = {m["kind"] for m in found}
        self.assertEqual(kinds, {"opener", "bureaucratese", "praise", "cliche"})
        for m in found:
            self.assertEqual(text[m["start"] : m["end"]], m["text"])

    def test_facts_are_not_markers(self):
        text = "Перфоратор SDS-plus, 800 Вт, энергия удара 2,7 Дж. В комплекте кейс и три бура."
        self.assertEqual(markers(text), [])

    def test_does_not_match_inside_a_word(self):
        self.assertEqual(markers("бездонный, обданный"), [])

    def test_summary_counts_per_100_words(self):
        text = "Кроме того, кроме того, таким образом. " + "слово " * 94
        entry = summary(markers(text), len(words(text)))[0]
        self.assertEqual(entry["kind"], "hedge")
        self.assertEqual(entry["count"], 3)
        self.assertEqual(entry["examples"], ["кроме того", "таким образом"])
        self.assertEqual(entry["per100Words"], 3.0)


class RhythmTest(unittest.TestCase):
    def test_burstiness_needs_five_sentences(self):
        self.assertIsNone(rhythm("Одно. Два. Три.")["burstiness"])

    def test_even_sentences_have_low_burstiness(self):
        even = " ".join("Это предложение из шести слов." for _ in range(6))
        uneven = "Да. " + "Это очень длинное предложение " * 6 + "конец. Нет. Ладно. " + "Ещё одно длинное " * 5 + "здесь."
        self.assertEqual(rhythm(even)["burstiness"], 0.0)
        self.assertGreater(rhythm(uneven)["burstiness"], 0.5)


class FakeScorer:
    name = "fake"
    window = 2046

    def __init__(self):
        self.calls = []

    def probabilities(self, texts):
        self.calls.append(texts)
        return [(0.9 if "нейросеть" in t else 0.1, len(t.split())) for t in texts]


class AnalyzeTest(unittest.TestCase):
    def test_bands(self):
        self.assertEqual(band(0.99)["key"], "ai")
        self.assertEqual(band(0.5)["key"], "unclear")
        self.assertEqual(band(0.01)["key"], "human")

    def test_whole_text_alone_then_fragments(self):
        human = " ".join("Человек пишет как умеет, коротко." for _ in range(8))
        machine = " ".join("Здесь писала нейросеть длинными ровными фразами." for _ in range(8))
        scorer = FakeScorer()
        report = analyze(human + "\n\n" + machine, scorer)
        self.assertEqual(len(scorer.calls[0]), 1)  # never padded beside fragments
        self.assertEqual(len(scorer.calls), 2)
        self.assertEqual(len(report["fragments"]), 2)
        self.assertEqual(report["fragments"][0]["verdict"]["key"], "human")
        self.assertEqual(report["fragments"][1]["verdict"]["key"], "ai")

    def test_short_text_warns_and_has_no_fragments(self):
        report = analyze("Короткое описание товара.", FakeScorer())
        self.assertEqual(report["fragments"], [])
        self.assertTrue(any("Мало текста" in w for w in report["warnings"]))

    def test_score_many(self):
        out = score_many(["нейросеть тут", "человек тут"], FakeScorer())
        self.assertEqual([r["verdict"] for r in out], ["ai", "human"])


if __name__ == "__main__":
    unittest.main()
