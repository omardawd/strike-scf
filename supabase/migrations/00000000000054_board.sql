-- Board feature: one team workflow board per org/bank. A board has columns
-- (workflow stages), edges between columns (the arrows in the flow-graph
-- view — the shape of the workflow), and tasks placed in a column and
-- optionally assigned to a user. Role gating (org_admin/bank_admin design
-- the workflow + assign tasks; everyone else views + moves their own
-- assigned tasks) lives in the API layer, per this repo's convention —
-- RLS below only encodes tenancy scope, not role.

CREATE TABLE public.boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  bank_id UUID REFERENCES public.banks(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Team Board' CHECK (char_length(name) BETWEEN 1 AND 80),
  created_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((org_id IS NOT NULL) OR (bank_id IS NOT NULL))
);

CREATE UNIQUE INDEX boards_org_unique ON public.boards (org_id) WHERE org_id IS NOT NULL;
CREATE UNIQUE INDEX boards_bank_unique ON public.boards (bank_id) WHERE bank_id IS NOT NULL;

CREATE TRIGGER trg_boards_updated_at
  BEFORE UPDATE ON public.boards
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE public.board_columns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  position INTEGER NOT NULL DEFAULT 0,
  color TEXT,
  position_x DOUBLE PRECISION,
  position_y DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX board_columns_board_idx ON public.board_columns (board_id, position);

CREATE TRIGGER trg_board_columns_updated_at
  BEFORE UPDATE ON public.board_columns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE public.board_column_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  from_column_id UUID NOT NULL REFERENCES public.board_columns(id) ON DELETE CASCADE,
  to_column_id UUID NOT NULL REFERENCES public.board_columns(id) ON DELETE CASCADE,
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (from_column_id, to_column_id),
  CHECK (from_column_id != to_column_id)
);

CREATE INDEX board_column_edges_board_idx ON public.board_column_edges (board_id);

CREATE TABLE public.board_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  column_id UUID NOT NULL REFERENCES public.board_columns(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  description TEXT,
  assignee_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  due_date DATE,
  position INTEGER NOT NULL DEFAULT 0,
  created_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX board_tasks_board_idx ON public.board_tasks (board_id);
CREATE INDEX board_tasks_column_idx ON public.board_tasks (column_id, position);
CREATE INDEX board_tasks_assignee_idx ON public.board_tasks (assignee_user_id);

CREATE TRIGGER trg_board_tasks_updated_at
  BEFORE UPDATE ON public.board_tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE public.boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_column_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "boards_scoped_read" ON public.boards
  FOR SELECT TO public USING (
    (org_id = current_org_id()) OR (bank_id = current_bank_id()) OR is_strike_admin()
  );

CREATE POLICY "boards_scoped_write" ON public.boards
  FOR ALL TO public USING (
    (org_id = current_org_id()) OR (bank_id = current_bank_id()) OR is_strike_admin()
  ) WITH CHECK (
    (org_id = current_org_id()) OR (bank_id = current_bank_id()) OR is_strike_admin()
  );

CREATE POLICY "board_columns_scoped_read" ON public.board_columns
  FOR SELECT TO public USING (
    EXISTS (
      SELECT 1 FROM public.boards
      WHERE boards.id = board_columns.board_id
        AND ((boards.org_id = current_org_id()) OR (boards.bank_id = current_bank_id()) OR is_strike_admin())
    )
  );

CREATE POLICY "board_columns_scoped_write" ON public.board_columns
  FOR ALL TO public USING (
    EXISTS (
      SELECT 1 FROM public.boards
      WHERE boards.id = board_columns.board_id
        AND ((boards.org_id = current_org_id()) OR (boards.bank_id = current_bank_id()) OR is_strike_admin())
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.boards
      WHERE boards.id = board_columns.board_id
        AND ((boards.org_id = current_org_id()) OR (boards.bank_id = current_bank_id()) OR is_strike_admin())
    )
  );

CREATE POLICY "board_column_edges_scoped_read" ON public.board_column_edges
  FOR SELECT TO public USING (
    EXISTS (
      SELECT 1 FROM public.boards
      WHERE boards.id = board_column_edges.board_id
        AND ((boards.org_id = current_org_id()) OR (boards.bank_id = current_bank_id()) OR is_strike_admin())
    )
  );

CREATE POLICY "board_column_edges_scoped_write" ON public.board_column_edges
  FOR ALL TO public USING (
    EXISTS (
      SELECT 1 FROM public.boards
      WHERE boards.id = board_column_edges.board_id
        AND ((boards.org_id = current_org_id()) OR (boards.bank_id = current_bank_id()) OR is_strike_admin())
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.boards
      WHERE boards.id = board_column_edges.board_id
        AND ((boards.org_id = current_org_id()) OR (boards.bank_id = current_bank_id()) OR is_strike_admin())
    )
  );

CREATE POLICY "board_tasks_scoped_read" ON public.board_tasks
  FOR SELECT TO public USING (
    EXISTS (
      SELECT 1 FROM public.boards
      WHERE boards.id = board_tasks.board_id
        AND ((boards.org_id = current_org_id()) OR (boards.bank_id = current_bank_id()) OR is_strike_admin())
    )
  );

CREATE POLICY "board_tasks_scoped_write" ON public.board_tasks
  FOR ALL TO public USING (
    EXISTS (
      SELECT 1 FROM public.boards
      WHERE boards.id = board_tasks.board_id
        AND ((boards.org_id = current_org_id()) OR (boards.bank_id = current_bank_id()) OR is_strike_admin())
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.boards
      WHERE boards.id = board_tasks.board_id
        AND ((boards.org_id = current_org_id()) OR (boards.bank_id = current_bank_id()) OR is_strike_admin())
    )
  );
