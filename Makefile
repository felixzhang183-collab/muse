.PHONY: up down logs api worker migrate seed install dev-api dev-worker fmt lint

# ─── Docker ──────────────────────────────────────────────
up:
	docker compose up -d postgres redis qdrant minio minio-init
	@echo "✓ Infrastructure up. Run 'make migrate' then 'make dev-api' and 'make dev-worker'."

down:
	docker compose down

logs:
	docker compose logs -f

up-all:
	docker compose up -d

# ─── Development (local Python) ──────────────────────────
dev-api:
	cd backend && poetry run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

dev-worker:
	cd backend && poetry run celery -A app.workers.celery_app worker --loglevel=info --concurrency=2

dev-beat:
	cd backend && poetry run celery -A app.workers.celery_app beat --loglevel=info

dev-flower:
	cd backend && poetry run celery -A app.workers.celery_app flower --port=5555

dev-frontend:
	cd frontend && npm run dev

# ─── Database ────────────────────────────────────────────
migrate:
	cd backend && poetry run alembic upgrade head

migration:
	cd backend && poetry run alembic revision --autogenerate -m "$(name)"

# ─── Python project setup ────────────────────────────────
install:
	cd backend && poetry install

# ─── Code quality ────────────────────────────────────────
fmt:
	cd backend && ruff format . && ruff check . --fix

lint:
	cd backend && ruff check .

# ─── Frontend ────────────────────────────────────────────
install-frontend:
	cd frontend && npm install

# ─── Copy env ────────────────────────────────────────────
env:
	cp .env.example .env
	@echo "Edit .env with your API keys."
