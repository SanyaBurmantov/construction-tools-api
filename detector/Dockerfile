# ИИ-детектор: русский классификатор (ONNX, CPU) за маленьким JSON API.
# Модель скачивается при сборке и сверяется по sha256 (models.json), так что
# образ сам по себе — вся установка: на сервере ничего не качается.

FROM python:3.12-slim-bookworm AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 ORT_DISABLE_TELEMETRY=1
WORKDIR /app
COPY requirements.txt ./
RUN pip install -r requirements.txt

FROM base AS models
COPY models.json ./
COPY scripts/fetch_model.py scripts/
# MODEL_FILES="" = everything but the fp32 export; add model.onnx to ship it.
ARG MODEL_FILES=""
RUN python scripts/fetch_model.py modernbert /models $MODEL_FILES

FROM base AS test
COPY . .
RUN python -m unittest discover -s tests -t .

FROM base AS production
COPY --from=models /models /models
COPY detector ./detector
RUN useradd --system --uid 10001 detector
USER detector
ENV DETECTOR_MODEL_DIR=/models/modernbert \
    DETECTOR_MODEL_FILE=model_int8.onnx \
    DETECTOR_MAX_TOKENS=1024 \
    DETECTOR_THREADS=1 \
    DETECTOR_PORT=8100
EXPOSE 8100
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8100/health', timeout=4).status == 200 else 1)"
CMD ["python", "-m", "detector.server"]
