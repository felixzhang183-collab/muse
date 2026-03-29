FROM python:3.12-slim

# System deps for librosa / audio processing
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libsndfile1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Poetry
RUN pip install poetry==1.8.4

# Copy dependency files first (layer cache)
COPY pyproject.toml poetry.lock* ./

# Install deps (no virtualenv inside container)
RUN poetry config virtualenvs.create false \
    && poetry install --no-interaction --no-ansi --no-root

COPY . .

RUN chmod +x start.sh

EXPOSE 8000

CMD ["./start.sh"]
