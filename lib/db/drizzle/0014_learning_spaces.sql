CREATE TABLE learning_spaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id uuid NOT NULL REFERENCES centers(id),
  school_year_id uuid NOT NULL REFERENCES school_years(id),
  kind text NOT NULL CHECK (kind IN ('ateca','fablab')),
  name text NOT NULL,
  purpose text NOT NULL DEFAULT '',
  reference_schedule text NOT NULL DEFAULT '',
  responsibles text NOT NULL DEFAULT '',
  resources text NOT NULL DEFAULT '',
  services text NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1,
  updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX learning_spaces_year_kind_uq ON learning_spaces(school_year_id,kind);
CREATE TABLE space_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id uuid NOT NULL REFERENCES centers(id),
  school_year_id uuid NOT NULL REFERENCES school_years(id),
  title text NOT NULL,
  space_kinds text[] NOT NULL CHECK (
    cardinality(space_kinds) BETWEEN 1 AND 2 AND
    space_kinds <@ ARRAY['ateca','fablab']::text[] AND
    (cardinality(space_kinds)=1 OR space_kinds[1]<>space_kinds[2])
  ),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at AND ends_at <= starts_at + interval '24 hours'),
  professional_family text NOT NULL,
  group_label text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'reservada' CHECK (status IN ('reservada','realizado','cancelada')),
  activity_id uuid REFERENCES activities(id) ON DELETE RESTRICT,
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'realizado' OR activity_id IS NOT NULL)
);
CREATE INDEX space_reservations_year_start_idx ON space_reservations(school_year_id,starts_at);
CREATE TABLE space_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id uuid NOT NULL REFERENCES centers(id),
  school_year_id uuid NOT NULL REFERENCES school_years(id),
  entity_id uuid NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('space','reservation')),
  revision integer NOT NULL,
  content jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX space_versions_entity_revision_uq ON space_versions(entity_id,revision);
