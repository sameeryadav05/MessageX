-- Track the TCP connection that declared an exclusive queue.
-- NULL means the queue is not connection-owned.
ALTER TABLE queues
ADD COLUMN IF NOT EXISTS owner_connection_id UUID;

-- NOT VALID avoids rejecting pre-existing rows during migration.
-- PostgreSQL still enforces this constraint for new and updated rows.
ALTER TABLE queues
ADD CONSTRAINT queues_exclusive_owner_check
CHECK (
    (exclusive = TRUE AND owner_connection_id IS NOT NULL)
    OR
    (exclusive = FALSE AND owner_connection_id IS NULL)
) NOT VALID;
