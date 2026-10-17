CREATE TABLE software_catalogs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), center_id uuid NOT NULL REFERENCES centers(id),
  school_year_id uuid NOT NULL REFERENCES school_years(id), name text NOT NULL DEFAULT 'Innovando en FP',
  description text NOT NULL DEFAULT '', pic_project_id uuid REFERENCES pic_projects(id) ON DELETE RESTRICT,
  revision integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX software_catalogs_year_uq ON software_catalogs(school_year_id);
CREATE TABLE software_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), center_id uuid NOT NULL REFERENCES centers(id),
  school_year_id uuid NOT NULL REFERENCES school_years(id), catalog_id uuid NOT NULL REFERENCES software_catalogs(id),
  product_key text, name text NOT NULL, data jsonb NOT NULL, evidence jsonb NOT NULL DEFAULT '[]',
  revision integer NOT NULL DEFAULT 1, updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX software_products_year_name_uq ON software_products(school_year_id,lower(name));
CREATE UNIQUE INDEX software_products_year_key_uq ON software_products(school_year_id,product_key);
CREATE TABLE software_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), center_id uuid NOT NULL REFERENCES centers(id),
  school_year_id uuid NOT NULL REFERENCES school_years(id), product_id uuid NOT NULL REFERENCES software_products(id),
  kind text NOT NULL, data jsonb NOT NULL, evidence jsonb NOT NULL DEFAULT '[]', source text NOT NULL DEFAULT 'manual',
  source_key text, supersedes_id uuid, revision integer NOT NULL, created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX software_records_product_source_uq ON software_records(product_id,source_key);
CREATE TABLE software_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), center_id uuid NOT NULL REFERENCES centers(id),
  school_year_id uuid NOT NULL REFERENCES school_years(id), entity_id uuid NOT NULL, revision integer NOT NULL,
  content jsonb NOT NULL, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX software_versions_entity_revision_uq ON software_versions(entity_id,revision);
