FROM node:22-alpine AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package.json ./
COPY frontend/tsconfig.json ./
COPY frontend/tsconfig.node.json ./
COPY frontend/vite.config.ts ./
COPY frontend/components.json ./
COPY frontend/index.html ./

RUN npm install

COPY frontend/src ./src
RUN npm run build

FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .
COPY static ./static
COPY --from=frontend-builder /app/frontend/dist ./static/app

ENV APP_PORT=8080
EXPOSE 8080

CMD ["gunicorn", "-w", "1", "-b", "0.0.0.0:8080", "app:app"]
