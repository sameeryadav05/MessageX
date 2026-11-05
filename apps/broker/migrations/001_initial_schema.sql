
-- 1. Broker users
-- Stores credentials for clients connecting to the broker.
CREATE TABLE IF NOT EXISTS broker_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(64) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Exchanges
-- Exchanges route published messages to queues.
CREATE TABLE IF NOT EXISTS exchanges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL UNIQUE,
    type VARCHAR(20) NOT NULL
        CHECK (type IN ('direct', 'fanout', 'topic', 'headers')),
    durable BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Queues
-- Queues store messages until consumers process them.
CREATE TABLE IF NOT EXISTS queues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL UNIQUE,
    durable BOOLEAN NOT NULL DEFAULT TRUE,
    exclusive BOOLEAN NOT NULL DEFAULT FALSE,
    auto_delete BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Bindings
-- Connects exchanges to queues using routing keys.
CREATE TABLE IF NOT EXISTS bindings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exchange_id UUID NOT NULL REFERENCES exchanges(id) ON DELETE CASCADE,
    queue_id UUID NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
    routing_key VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (exchange_id, queue_id, routing_key)
);

-- 5. Messages
-- BYTEA allows us to store arbitrary message payloads.
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    queue_id UUID NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
    payload BYTEA NOT NULL,
    headers JSONB NOT NULL DEFAULT '{}'::jsonb,
    routing_key VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivery_count INTEGER NOT NULL DEFAULT 0
);

-- Indexes for common broker operations.
CREATE INDEX IF NOT EXISTS idx_messages_queue_created
    ON messages (queue_id, created_at, id);

CREATE INDEX IF NOT EXISTS idx_bindings_exchange
    ON bindings (exchange_id);

CREATE INDEX IF NOT EXISTS idx_bindings_queue
    ON bindings (queue_id);
