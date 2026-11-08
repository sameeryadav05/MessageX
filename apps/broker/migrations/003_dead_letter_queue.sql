
-- Configure retry limits and optional dead-letter queues.
-- Existing queues receive a default retry limit of 5.

ALTER TABLE queues
ADD COLUMN max_delivery_count INTEGER NOT NULL DEFAULT 5
CHECK (max_delivery_count >= 1);

ALTER TABLE queues
ADD COLUMN dead_letter_queue_id UUID
REFERENCES queues(id)
ON DELETE SET NULL;

-- Allow messages to be retained as dead when no DLQ is configured.
ALTER TABLE messages
DROP CONSTRAINT IF EXISTS messages_status_check;

ALTER TABLE messages
ADD CONSTRAINT messages_status_check
CHECK (status IN ('ready', 'in_flight', 'dead'));

CREATE INDEX idx_queues_dead_letter_queue
ON queues (dead_letter_queue_id)
WHERE dead_letter_queue_id IS NOT NULL;
