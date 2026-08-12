# High-volume write queue

RabbitMQ runs in GKE Autopilot because it requires persistent storage; the API and `start:queue-worker` remain separate Cloud Run services. Memorystore Redis stores idempotency and completion state. The API publishes persistent messages and waits for a broker publisher-confirmation before returning `202`-style accepted data.

Set `HIGH_VOLUME_QUEUE_ENABLED=true`, `REDIS_URL`, `RABBITMQ_URL`, and `QUEUE_PREFETCH=50` in both Cloud Run services. The app must send a unique 16+ character `Idempotency-Key` header for queued clock-ins and negative inventory movements. Retrying the same key returns the original result; the consumer only acknowledges after PostgreSQL succeeds. Counts remain synchronous reconciliation writes.

Provisioning order: enable `container.googleapis.com` and `redis.googleapis.com`; create a private GKE Autopilot cluster; apply `infra/rabbitmq/rabbitmq.yaml` after replacing the placeholder from Secret Manager; create a private Memorystore instance in the same VPC; deploy a Cloud Run queue worker using the API image and `node dist/async-write/worker.js`; configure the API and worker with VPC access and Secret Manager references. Do not expose RabbitMQ management externally.
