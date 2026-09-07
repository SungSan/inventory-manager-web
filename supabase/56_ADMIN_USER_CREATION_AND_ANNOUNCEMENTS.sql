-- SAN WMS V5.1.9: admin-created accounts and login announcements
begin;

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 120),
  content text not null check (length(trim(content)) between 1 and 5000),
  is_active boolean not null default true,
  allow_never_show boolean not null default false,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.announcement_dismissals (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  dismissed_at timestamptz not null default clock_timestamp(),
  primary key (announcement_id,user_id)
);

create index if not exists announcements_active_created_idx
  on public.announcements(is_active,created_at desc);
create index if not exists announcement_dismissals_user_idx
  on public.announcement_dismissals(user_id,announcement_id);

alter table public.announcements enable row level security;
alter table public.announcement_dismissals enable row level security;

create or replace function public.get_login_announcement()
returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce((
    select jsonb_build_object(
      'id',a.id,'title',a.title,'content',a.content,
      'allow_never_show',a.allow_never_show,'created_at',a.created_at
    )
    from public.announcements a
    where a.is_active
      and (
        not a.allow_never_show
        or not exists (
          select 1 from public.announcement_dismissals d
          where d.announcement_id=a.id and d.user_id=auth.uid()
        )
      )
    order by a.created_at desc
    limit 1
  ),'null'::jsonb);
$$;

create or replace function public.dismiss_login_announcement(p_announcement_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  if not exists (
    select 1 from public.announcements
    where id=p_announcement_id and is_active and allow_never_show
  ) then raise exception '다시 보지 않기를 사용할 수 없는 공지입니다.'; end if;
  insert into public.announcement_dismissals(announcement_id,user_id)
  values(p_announcement_id,auth.uid()) on conflict do nothing;
end; $$;

create or replace function public.admin_list_announcements()
returns table(
  id uuid,title text,content text,is_active boolean,allow_never_show boolean,
  created_at timestamptz,updated_at timestamptz,created_by_label text
) language plpgsql security definer set search_path=public as $$
begin
  perform public.require_role(array['admin']);
  return query
  select a.id,a.title,a.content,a.is_active,a.allow_never_show,
         a.created_at,a.updated_at,public.user_label(a.created_by)
  from public.announcements a
  order by a.created_at desc;
end; $$;

create or replace function public.admin_save_announcement(
  p_id uuid,p_title text,p_content text,p_is_active boolean,p_allow_never_show boolean
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_before jsonb;
begin
  perform public.require_role(array['admin']);
  if nullif(trim(p_title),'') is null or length(trim(p_title))>120 then
    raise exception '공지 제목은 1~120자로 입력하세요.';
  end if;
  if nullif(trim(p_content),'') is null or length(trim(p_content))>5000 then
    raise exception '공지 내용은 1~5,000자로 입력하세요.';
  end if;
  if p_id is null then
    insert into public.announcements(title,content,is_active,allow_never_show,created_by,updated_by)
    values(trim(p_title),trim(p_content),coalesce(p_is_active,true),coalesce(p_allow_never_show,false),auth.uid(),auth.uid())
    returning id into v_id;
    perform public.write_audit('ANNOUNCEMENT_CREATED','announcement',v_id::text,trim(p_title),null,
      jsonb_build_object('is_active',p_is_active,'allow_never_show',p_allow_never_show));
  else
    select to_jsonb(a) into v_before from public.announcements a where a.id=p_id for update;
    if v_before is null then raise exception '공지를 찾을 수 없습니다.'; end if;
    update public.announcements
       set title=trim(p_title),content=trim(p_content),is_active=coalesce(p_is_active,false),
           allow_never_show=coalesce(p_allow_never_show,false),updated_by=auth.uid(),updated_at=clock_timestamp()
     where id=p_id returning id into v_id;
    -- 내용 또는 다시 보지 않기 정책을 수정하면 모든 사용자에게 새 내용이 다시 표시됩니다.
    delete from public.announcement_dismissals where announcement_id=p_id;
    perform public.write_audit('ANNOUNCEMENT_UPDATED','announcement',v_id::text,trim(p_title),v_before,
      jsonb_build_object('title',trim(p_title),'content',trim(p_content),'is_active',p_is_active,'allow_never_show',p_allow_never_show));
  end if;
  return v_id;
end; $$;

revoke all on table public.announcements,public.announcement_dismissals from public,anon,authenticated;
revoke all on function public.get_login_announcement(),public.dismiss_login_announcement(uuid),
  public.admin_list_announcements(),public.admin_save_announcement(uuid,text,text,boolean,boolean)
  from public,anon,authenticated;
grant execute on function public.get_login_announcement(),public.dismiss_login_announcement(uuid),
  public.admin_list_announcements(),public.admin_save_announcement(uuid,text,text,boolean,boolean)
  to authenticated;

notify pgrst,'reload schema';
commit;
select 'SAN WMS V5.1.9 admin accounts and announcements completed' as result;
