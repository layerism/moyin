FROM node:24-bookworm-slim AS audit-node

WORKDIR /opt/audit-runtime
COPY runtime/javascript/package.json runtime/javascript/package-lock.json ./
RUN npm ci --omit=dev

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV NODE_PATH=/opt/audit-runtime/node_modules
ENV AUDIT_NODE_MODULES_PATH=/opt/audit-runtime/node_modules

WORKDIR /app

COPY --from=audit-node /usr/local/bin/node /usr/local/bin/node
COPY --from=audit-node /opt/audit-runtime/node_modules /opt/audit-runtime/node_modules

COPY pyproject.toml ./
RUN pip install --no-cache-dir .

COPY app ./app

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
