"""The classifier: a fine-tuned Russian encoder in ONNX, run on the CPU.

The model and its `inference.json` come from the aiw-ru project
(toiletsandpaper/russian-ai-text-detector-*, MIT / Apache-2.0, trained on the
Russian part of the LLMTrace corpus). `inference.json` describes the whole
inference contract — tokenizer, special tokens, window size and the text
normalisation used in training — so this module follows it instead of
hard-coding any of it: the formatting of a text (markdown, dashes, quotes,
ё) told the training corpus where a human text came from, and a model fed
un-normalised text learns that instead of the writing.
"""

from __future__ import annotations

import json
import os
import re
import threading
from dataclasses import dataclass
from pathlib import Path

import numpy as np

os.environ.setdefault("ORT_DISABLE_TELEMETRY", "1")

import onnxruntime as ort  # noqa: E402
from tokenizers import Tokenizer  # noqa: E402


@dataclass(frozen=True)
class Rule:
    pattern: re.Pattern[str]
    replacement: str


def load_rules(spec: dict) -> list[Rule]:
    return [
        Rule(re.compile(rule["pattern"], re.MULTILINE), rule["replacement"])
        for rule in spec.get("normalize", [])
    ]


def normalize(text: str, rules: list[Rule]) -> str:
    for rule in rules:
        text = rule.pattern.sub(rule.replacement, text)
    return text.strip()


class Classifier:
    """Probability that a text was written by a language model.

    One ONNX session for the process; `run` is serialised by a lock because
    the session is already multi-threaded inside (`intra_op_num_threads`)
    and two parallel runs on a two-core box only fight for the same cores
    and double the peak memory.
    """

    def __init__(self, directory: str | Path, *, max_tokens: int, threads: int):
        directory = Path(directory)
        self.spec = json.loads((directory / "inference.json").read_text("utf-8"))
        self.name = directory.name
        self.rules = load_rules(self.spec)
        self.labels: list[str] = self.spec["labels"]
        self.ai_index = self.labels.index("ai")
        self.cls_id: int = self.spec["cls_id"]
        self.sep_id: int = self.spec["sep_id"]
        self.pad_id: int = self.spec["pad_id"]
        self.max_chars: int = self.spec.get("max_chars", 1_000_000)
        # The model reads up to `read_length` tokens; we cap it lower because
        # attention memory grows with the square of the window, and the box
        # this runs on has 2.9 GB for everything. The card shows the start of
        # a long text is as good a predictor as the average over windows.
        read_length = self.spec.get("read_length", self.spec["max_length"])
        self.window = min(read_length, max_tokens) - 2

        self.tokenizer = Tokenizer.from_file(str(directory / self.spec["tokenizer"]))
        self.tokenizer.no_truncation()
        self.tokenizer.no_padding()

        options = ort.SessionOptions()
        options.intra_op_num_threads = threads
        options.inter_op_num_threads = 1
        # The memory arena keeps the biggest batch's buffers for the life of
        # the process; without it the RSS returns to the baseline after a
        # long text instead of staying at its peak.
        options.enable_cpu_mem_arena = False
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        model_file = os.environ.get("DETECTOR_MODEL_FILE") or self.spec["file"]
        self.session = ort.InferenceSession(
            str(directory / model_file),
            sess_options=options,
            providers=["CPUExecutionProvider"],
        )
        self.input_names = {i.name for i in self.session.get_inputs()}
        self._lock = threading.Lock()

    def tokens(self, text: str) -> list[int]:
        text = normalize(text[: self.max_chars], self.rules)
        return self.tokenizer.encode(text, add_special_tokens=False).ids

    def probabilities(self, texts: list[str]) -> list[tuple[float, int]]:
        """(probability of «ai», tokens read) for each text, in one batch.

        A text longer than the window is read from its start.
        """
        if not texts:
            return []
        windows = [self.tokens(text)[: self.window] for text in texts]
        rows = [[self.cls_id, *ids, self.sep_id] for ids in windows]
        width = max(len(row) for row in rows)
        batch = np.full((len(rows), width), self.pad_id, dtype=np.int64)
        mask = np.zeros_like(batch)
        for k, row in enumerate(rows):
            batch[k, : len(row)] = row
            mask[k, : len(row)] = 1
        feed = {"input_ids": batch, "attention_mask": mask}
        if "token_type_ids" in self.input_names:
            feed["token_type_ids"] = np.zeros_like(batch)
        with self._lock:
            logits = self.session.run([self.spec["output"]], feed)[0]
        logits = logits - logits.max(axis=1, keepdims=True)
        p = np.exp(logits)
        p = p[:, self.ai_index] / p.sum(axis=1)
        return [(float(p[k]), len(windows[k])) for k in range(len(rows))]
