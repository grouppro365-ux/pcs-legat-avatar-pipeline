-- Supporting discovery records inside the existing operator DB; no parallel contacts CRM.
create table if not exists pcs_prospect_sources (
 id text primary key, username text not null unique check(username ~ '^[a-z][a-z0-9_]{3,31}$'),
 title text, city text, language text, topic text, discovery_url text, rules text,
 enabled boolean not null default true, access_status text not null default 'discovered'
 check(access_status in ('discovered','public_readable','unavailable','http_error','ai_error')),
 last_checked_at timestamptz, last_read_at timestamptz, next_scan_at timestamptz not null default now(),
 cursor_id bigint not null default 0, pending_before bigint, pending_top bigint,
 lease_id text, lease_until timestamptz, last_error text,
 messages_read bigint not null default 0, created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index if not exists pcs_prospect_source_due on pcs_prospect_sources(next_scan_at) where enabled;
create table if not exists pcs_prospect_requests (
 id text primary key, source_id text not null references pcs_prospect_sources(id),
 telegram_message_id bigint not null, message_url text not null, published_at timestamptz,
 message_text text not null check(length(message_text)<=12000),
 decision text not null check(decision in ('qualified','review','rejected')),
 direction text check(direction in ('CAR_RENTAL','PROPERTY_PURCHASE')),
 reason text not null, evidence text, facts jsonb not null default '{}',
 qualification_model text, qualification_version text not null,
 author_verified boolean not null default false,
 contact_id text references contacts(id) on delete set null,
 outreach_status text not null default 'blocked_identity'
 check(outreach_status in ('blocked_identity','blocked_context','blocked_route','not_applicable')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(source_id,telegram_message_id),
 check(decision<>'qualified' or direction is not null)
);
create index if not exists pcs_prospect_requests_feed on pcs_prospect_requests(decision,published_at desc,id);
create index if not exists pcs_prospect_requests_contact on pcs_prospect_requests(contact_id) where contact_id is not null;
create table if not exists pcs_prospect_runs (
 id text primary key, status text not null check(status in ('running','complete','partial','failed')),
 started_at timestamptz not null default now(),finished_at timestamptz,
 sources_checked integer not null default 0,messages_read integer not null default 0,
 qualified integer not null default 0,review integer not null default 0,rejected integer not null default 0,
 errors integer not null default 0,error text
);
insert into system_settings(id,key,value,version,created_at,updated_at)
values('pcs_telegram_prospecting','pcs_telegram_prospecting',
 '{"enabled":true,"directions":["CAR_RENTAL","PROPERTY_PURCHASE"],"lookback_days":7,"outreach_enabled":false,"outreach_blocker":"telegram_user_session_not_connected","followup_requires_confirmed_delivery":true,"fallback_followup_hours":48,"fallback_followup_limit":1,"business_reply_window_hours":24}'::jsonb,1,now(),now())
on conflict(id) do nothing;

alter table pcs_prospect_sources enable row level security;
alter table pcs_prospect_requests enable row level security;
alter table pcs_prospect_runs enable row level security;
revoke all on pcs_prospect_sources,pcs_prospect_requests,pcs_prospect_runs from public;
