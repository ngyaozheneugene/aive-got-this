-- 0002: who actioned an approval is free text until sign-in exists.
--
-- The desk records its decisions as `desk_coordinator`, which is not an
-- app_user row, so the foreign key refused every approval on Postgres. The
-- in-memory adapter never enforced it. status_event.actor_id is already free
-- text; this brings approval.actioned_by in line. Restore the key when demo
-- sign-in (G6 P3) gives every actor a user row.
ALTER TABLE approval DROP CONSTRAINT IF EXISTS approval_actioned_by_fkey;
