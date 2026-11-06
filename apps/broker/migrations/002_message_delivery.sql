-- Add delivery state to messages.
-- Existing messages become ready automatically.

ALTER TABLE messages
ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'ready'
CHECK (status IN ('ready', 'in_flight'));

-- Unique token for each delivery attempt.
ALTER TABLE messages
ADD COLUMN delivery_tag UUID UNIQUE;

-- Connection currently responsible for the in-flight message.
ALTER TABLE messages
ADD COLUMN consumer_connection_id UUID;

-- Timestamp when the message was delivered.
ALTER TABLE messages
ADD COLUMN delivered_at TIMESTAMPTZ;

-- Efficiently find ready messages in a queue.
CREATE INDEX idx_messages_queue_status_created
ON messages (queue_id, status, created_at, id);

-- Efficiently find deliveries that have timed out.
CREATE INDEX idx_messages_inflight_delivered_at
ON messages (delivered_at)
WHERE status = 'in_flight';