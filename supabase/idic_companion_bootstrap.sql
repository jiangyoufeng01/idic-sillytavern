create table if not exists public.idic_companion_role_snapshots (
    owner_user_id text not null,
    char_id text not null,
    char_name text not null default '',
    display_name text not null default '',
    hippocampus_enabled boolean not null default false,
    snapshot jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    primary key (owner_user_id, char_id)
);

create index if not exists idic_companion_role_snapshots_updated_at_idx
    on public.idic_companion_role_snapshots (updated_at desc);

alter table public.idic_companion_role_snapshots enable row level security;

do $$
begin
    if not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'idic_companion_role_snapshots'
          and policyname = 'idic_companion_role_snapshots_owner_rw'
    ) then
        create policy idic_companion_role_snapshots_owner_rw
            on public.idic_companion_role_snapshots
            for all
            to authenticated
            using (owner_user_id = auth.uid()::text)
            with check (owner_user_id = auth.uid()::text);
    end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on public.idic_companion_role_snapshots to authenticated, service_role;
