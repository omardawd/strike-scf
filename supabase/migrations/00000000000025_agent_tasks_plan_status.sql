-- Extend agent_tasks for the two-gate negotiation flow: 'executing' covers a
-- task whose plan was approved and is now running autonomously (negotiation
-- rounds); single-shot tasks (financing advisory, etc.) never use this status,
-- they go straight from 'approved' to 'completed'/'failed' as they do today.
ALTER TABLE public.agent_tasks DROP CONSTRAINT agent_tasks_status_check;
ALTER TABLE public.agent_tasks ADD CONSTRAINT agent_tasks_status_check
  CHECK (status IN ('awaiting_approval','approved','executing','rejected','completed','failed'));

-- plan holds negotiation guardrails captured at proposal/approval time. NULL
-- for single-shot proposals — they're entirely unaffected by this feature.
-- Shape: { price_floor, price_ceiling, max_rounds, deadline_at,
--          guardrails_configured: boolean, preferences_snapshot: jsonb }
ALTER TABLE public.agent_tasks ADD COLUMN IF NOT EXISTS plan jsonb;
