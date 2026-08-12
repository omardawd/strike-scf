-- Deeper task detail: labels, a checklist, and a combined comment/activity
-- feed. Same board-scoped RLS pattern as 00000000000054_board.sql (tenancy
-- only — role gating for "who can add a checklist item vs. just check one
-- off" lives in the API layer, same convention as the rest of Board).

ALTER TABLE public.board_tasks ADD COLUMN labels TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE public.board_task_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.board_tasks(id) ON DELETE CASCADE,
  text TEXT NOT NULL CHECK (char_length(text) BETWEEN 1 AND 200),
  is_done BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL DEFAULT 0,
  created_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX board_task_checklist_items_task_idx ON public.board_task_checklist_items (task_id, position);

CREATE TRIGGER trg_board_task_checklist_items_updated_at
  BEFORE UPDATE ON public.board_task_checklist_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- One table for both user comments and system-generated activity lines
-- (created/moved/assigned/etc) so a task's detail view reads as a single
-- chronological feed, same reasoning as agent_task_messages combining
-- narration and chat in one stream. author_user_id is NULL for system rows.
CREATE TABLE public.board_task_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.board_tasks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment', 'activity')),
  author_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX board_task_comments_task_idx ON public.board_task_comments (task_id, created_at);

ALTER TABLE public.board_task_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_task_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "board_task_checklist_items_scoped_read" ON public.board_task_checklist_items
  FOR SELECT TO public USING (
    EXISTS (
      SELECT 1 FROM public.board_tasks
      JOIN public.boards ON boards.id = board_tasks.board_id
      WHERE board_tasks.id = board_task_checklist_items.task_id
        AND ((boards.org_id = current_org_id()) OR (boards.bank_id = current_bank_id()) OR is_strike_admin())
    )
  );

CREATE POLICY "board_task_checklist_items_scoped_write" ON public.board_task_checklist_items
  FOR ALL TO public USING (
    EXISTS (
      SELECT 1 FROM public.board_tasks
      JOIN public.boards ON boards.id = board_tasks.board_id
      WHERE board_tasks.id = board_task_checklist_items.task_id
        AND ((boards.org_id = current_org_id()) OR (boards.bank_id = current_bank_id()) OR is_strike_admin())
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.board_tasks
      JOIN public.boards ON boards.id = board_tasks.board_id
      WHERE board_tasks.id = board_task_checklist_items.task_id
        AND ((boards.org_id = current_org_id()) OR (boards.bank_id = current_bank_id()) OR is_strike_admin())
    )
  );

CREATE POLICY "board_task_comments_scoped_read" ON public.board_task_comments
  FOR SELECT TO public USING (
    EXISTS (
      SELECT 1 FROM public.board_tasks
      JOIN public.boards ON boards.id = board_tasks.board_id
      WHERE board_tasks.id = board_task_comments.task_id
        AND ((boards.org_id = current_org_id()) OR (boards.bank_id = current_bank_id()) OR is_strike_admin())
    )
  );

CREATE POLICY "board_task_comments_scoped_write" ON public.board_task_comments
  FOR ALL TO public USING (
    EXISTS (
      SELECT 1 FROM public.board_tasks
      JOIN public.boards ON boards.id = board_tasks.board_id
      WHERE board_tasks.id = board_task_comments.task_id
        AND ((boards.org_id = current_org_id()) OR (boards.bank_id = current_bank_id()) OR is_strike_admin())
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.board_tasks
      JOIN public.boards ON boards.id = board_tasks.board_id
      WHERE board_tasks.id = board_task_comments.task_id
        AND ((boards.org_id = current_org_id()) OR (boards.bank_id = current_bank_id()) OR is_strike_admin())
    )
  );
