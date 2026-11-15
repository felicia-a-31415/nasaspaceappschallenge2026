# One image: the API plus the built page (when web/ is present).
# Build:  docker build -t fire-calendar .
# Run:    docker run -p 8080:8080 -e FIRMS_MAP_KEY=... fire-calendar

# --- the page, only if the frontend has been merged ---
FROM node:20-slim AS web
WORKDIR /src
COPY . .
RUN if [ -f web/package.json ]; then \
      cd web && npm ci && VITE_USE_MOCKS=false npm run build; \
    else \
      mkdir -p web/dist; \
    fi

# --- the server ---
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    FIRE_DATA_DIR=outputs/quebec FIRE_CACHE_DIR=/cache PORT=8080
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY harmonize/ harmonize/
COPY server/ server/
COPY outputs/quebec/ outputs/quebec/
COPY --from=web /src/web/dist/ web/dist/
RUN mkdir -p /cache
EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn server.app:app --host 0.0.0.0 --port ${PORT}"]
