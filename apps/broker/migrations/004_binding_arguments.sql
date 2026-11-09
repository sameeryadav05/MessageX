
-- Add binding arguments for headers exchanges.
ALTER TABLE bindings
ADD COLUMN IF NOT EXISTS arguments JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Allow multiple bindings between the same exchange and queue
-- when their routing keys or arguments differ.
ALTER TABLE bindings
DROP CONSTRAINT IF EXISTS bindings_exchange_id_queue_id_routing_key_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bindings_unique_configuration
ON bindings (exchange_id, queue_id, routing_key, arguments);

CREATE INDEX IF NOT EXISTS idx_bindings_exchange_routing
ON bindings (exchange_id, routing_key);
