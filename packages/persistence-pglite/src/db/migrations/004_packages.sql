-- Packages, v4. An archive the app has unpacked: the package shares the
-- archive's hash with its blob, `kind` names the plugin that understood it
-- and `manifest` holds what that plugin parsed — fixed columns only for
-- what every kind needs, jsonb for the rest.

create table package (
  hash text primary key references blob(hash) on delete cascade,
  kind text not null,
  manifest jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table package_entry (
  hash text not null references package(hash) on delete cascade,
  path text not null,
  size bigint not null,
  mime text not null,
  primary key (hash, path)
);

-- Runtime state a package keeps per context (a document it is embedded
-- in, or '' for the package on its own): a course's progress, a viewer's
-- position — whatever the kind's bridge stores.
create table package_state (
  hash text not null references package(hash) on delete cascade,
  context text not null default '',
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (hash, context)
);

-- What package content asked the bridge for. Every request goes through
-- one gate; refused ones are the interesting rows.
create table package_audit (
  id bigserial primary key,
  hash text not null references package(hash) on delete cascade,
  op text not null,
  path text not null,
  allowed boolean not null,
  at timestamptz not null default now()
);
create index package_audit_hash_idx on package_audit (hash, at desc);
