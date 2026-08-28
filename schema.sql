create table if not exists users (
  id bigserial primary key,
  name varchar(120) not null,
  email varchar(255) unique not null,
  password_hash text not null,
  role varchar(20) not null check (role in ('client','professional','admin')),
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists jobs (
  id bigserial primary key,
  client_id bigint not null references users(id) on delete cascade,
  professional_id bigint references users(id) on delete set null,
  service varchar(100) not null,
  description text not null,
  locality varchar(120) not null,
  status varchar(30) not null default 'requested',
  amount numeric(12,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists claims (
  id bigserial primary key,
  job_id bigint not null references jobs(id) on delete cascade,
  created_by bigint not null references users(id) on delete cascade,
  reason varchar(120) not null,
  description text not null,
  status varchar(30) not null default 'open',
  created_at timestamptz not null default now()
);

create index if not exists idx_jobs_client on jobs(client_id);
create index if not exists idx_jobs_professional on jobs(professional_id);
create index if not exists idx_claims_job on claims(job_id);
