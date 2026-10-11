DO $qa$ DECLARE n int; m int; app uuid:=gen_random_uuid(); ev uuid; BEGIN BEGIN
CREATE TEMP TABLE qa_apps(LIKE public.applications INCLUDING ALL);
CREATE TEMP TABLE qa_outbox(LIKE public.pcs_workflow_outbox INCLUDING ALL);
CREATE TEMP TABLE qa_notices(LIKE public.notifications INCLUDING ALL);
CREATE TEMP TABLE qa_audit(LIKE public.audit_events INCLUDING ALL);
INSERT INTO qa_apps(id,public_id,category) VALUES(app,'QA-ONLY','general');
INSERT INTO qa_outbox(aggregate_type,aggregate_id,event_type,idempotency_key) SELECT 'APPLICATION',app,x,'qa:'||x FROM unnest(ARRAY['PARTNER_OFFER_ACCEPTED','PARTNER_FINAL_CONFIRMED','PARTNER_FINAL_DECLINED','CLIENT_BOOKING_CONFIRMED']) x;
EXECUTE $q$with due as materialized (
 select e.id,e.aggregate_id,e.event_type,a.public_id,'workflow-operator:'||e.id::text dedupe_key
 from qa_outbox e join qa_apps a on a.id=e.aggregate_id
 where e.aggregate_type='APPLICATION' and e.status in ('PENDING','FAILED')
 and e.event_type=any(ARRAY['PARTNER_OFFER_ACCEPTED','PARTNER_FINAL_CONFIRMED','PARTNER_FINAL_DECLINED','CLIENT_BOOKING_CONFIRMED']::text[]) and not(e.payload ? 'operator_notification_id')
 order by e.created_at,e.id limit 50 for update of e skip locked
 ),created as (
 insert into qa_notices(event_key,entity_type,entity_id,channel,title,body,status,dedupe_key)
 select 'workflow.operator_notice','qa_apps',aggregate_id::text,'IN_APP',
 case event_type when 'PARTNER_OFFER_ACCEPTED' then 'Клиент выбрал предложение'
 when 'PARTNER_FINAL_CONFIRMED' then 'Партнёр подтвердил условия'
 when 'PARTNER_FINAL_DECLINED' then 'Партнёр отказался: нужна альтернатива'
 when 'CLIENT_BOOKING_CONFIRMED' then 'Сделка подтверждена: подготовить оплату' end,
 'Заявка '||coalesce(public_id,'PCS')||'. '||case event_type
 when 'PARTNER_OFFER_ACCEPTED' then 'Проверьте подтверждение выбранных условий партнёром.'
 when 'PARTNER_FINAL_CONFIRMED' then 'Проверьте финальное подтверждение клиента.'
 when 'PARTNER_FINAL_DECLINED' then 'Подберите и согласуйте альтернативное предложение.'
 when 'CLIENT_BOOKING_CONFIRMED' then 'Откройте «Кабинеты и сделка», проверьте получателя и сохраните реквизиты.' end,
 'PENDING',dedupe_key from due on conflict(dedupe_key) do nothing returning id,dedupe_key
 ),receipts as (
 select id,dedupe_key from created union all
 select n.id,n.dedupe_key from qa_notices n join due d on d.dedupe_key=n.dedupe_key
 ),marked as (
 update qa_outbox e set payload=e.payload||jsonb_build_object('operator_notification_id',r.id,'operator_notified_at',clock_timestamp())
 from due d join receipts r on r.dedupe_key=d.dedupe_key where e.id=d.id returning e.id
 ),audited as (
 insert into qa_audit(actor_role,action,entity_type,entity_id,patch,reason,result)
 select 'SYSTEM','workflow_operator_notice_created','qa_notices',n.id::text,
 jsonb_build_object('outbox_id',d.id,'application_id',d.aggregate_id,'event_type',d.event_type),
 'Existing PCS workflow event projected to operator inbox','SUCCESS'
 from created n join due d on d.dedupe_key=n.dedupe_key returning entity_id
 ) select (select count(*)::int from created where exists(select 1 from audited a where a.entity_id=created.id::text)) created,
 (select count(*)::int from marked) marked$q$ INTO n,m;
IF n<>4 OR m<>4 THEN RAISE EXCEPTION 'QA missing notices %, %',n,m; END IF;
IF EXISTS(SELECT 1 FROM qa_outbox WHERE status<>'PENDING' OR attempts<>0 OR sent_at IS NOT NULL) THEN RAISE EXCEPTION 'QA external queue consumed'; END IF;
EXECUTE $q$with due as materialized (
 select e.id,e.aggregate_id,e.event_type,a.public_id,'workflow-operator:'||e.id::text dedupe_key
 from qa_outbox e join qa_apps a on a.id=e.aggregate_id
 where e.aggregate_type='APPLICATION' and e.status in ('PENDING','FAILED')
 and e.event_type=any(ARRAY['PARTNER_OFFER_ACCEPTED','PARTNER_FINAL_CONFIRMED','PARTNER_FINAL_DECLINED','CLIENT_BOOKING_CONFIRMED']::text[]) and not(e.payload ? 'operator_notification_id')
 order by e.created_at,e.id limit 50 for update of e skip locked
 ),created as (
 insert into qa_notices(event_key,entity_type,entity_id,channel,title,body,status,dedupe_key)
 select 'workflow.operator_notice','qa_apps',aggregate_id::text,'IN_APP',
 case event_type when 'PARTNER_OFFER_ACCEPTED' then 'Клиент выбрал предложение'
 when 'PARTNER_FINAL_CONFIRMED' then 'Партнёр подтвердил условия'
 when 'PARTNER_FINAL_DECLINED' then 'Партнёр отказался: нужна альтернатива'
 when 'CLIENT_BOOKING_CONFIRMED' then 'Сделка подтверждена: подготовить оплату' end,
 'Заявка '||coalesce(public_id,'PCS')||'. '||case event_type
 when 'PARTNER_OFFER_ACCEPTED' then 'Проверьте подтверждение выбранных условий партнёром.'
 when 'PARTNER_FINAL_CONFIRMED' then 'Проверьте финальное подтверждение клиента.'
 when 'PARTNER_FINAL_DECLINED' then 'Подберите и согласуйте альтернативное предложение.'
 when 'CLIENT_BOOKING_CONFIRMED' then 'Откройте «Кабинеты и сделка», проверьте получателя и сохраните реквизиты.' end,
 'PENDING',dedupe_key from due on conflict(dedupe_key) do nothing returning id,dedupe_key
 ),receipts as (
 select id,dedupe_key from created union all
 select n.id,n.dedupe_key from qa_notices n join due d on d.dedupe_key=n.dedupe_key
 ),marked as (
 update qa_outbox e set payload=e.payload||jsonb_build_object('operator_notification_id',r.id,'operator_notified_at',clock_timestamp())
 from due d join receipts r on r.dedupe_key=d.dedupe_key where e.id=d.id returning e.id
 ),audited as (
 insert into qa_audit(actor_role,action,entity_type,entity_id,patch,reason,result)
 select 'SYSTEM','workflow_operator_notice_created','qa_notices',n.id::text,
 jsonb_build_object('outbox_id',d.id,'application_id',d.aggregate_id,'event_type',d.event_type),
 'Existing PCS workflow event projected to operator inbox','SUCCESS'
 from created n join due d on d.dedupe_key=n.dedupe_key returning entity_id
 ) select (select count(*)::int from created where exists(select 1 from audited a where a.entity_id=created.id::text)) created,
 (select count(*)::int from marked) marked$q$ INTO n,m;IF n<>0 OR m<>0 THEN RAISE EXCEPTION 'QA duplicate notices'; END IF;
INSERT INTO qa_outbox(aggregate_type,aggregate_id,event_type,idempotency_key) VALUES('APPLICATION',app,'CLIENT_BOOKING_CONFIRMED','qa:repair') RETURNING id INTO ev;
INSERT INTO qa_notices(event_key,title,dedupe_key) VALUES('workflow.operator_notice','QA existing notice','workflow-operator:'||ev::text);
EXECUTE $q$with due as materialized (
 select e.id,e.aggregate_id,e.event_type,a.public_id,'workflow-operator:'||e.id::text dedupe_key
 from qa_outbox e join qa_apps a on a.id=e.aggregate_id
 where e.aggregate_type='APPLICATION' and e.status in ('PENDING','FAILED')
 and e.event_type=any(ARRAY['PARTNER_OFFER_ACCEPTED','PARTNER_FINAL_CONFIRMED','PARTNER_FINAL_DECLINED','CLIENT_BOOKING_CONFIRMED']::text[]) and not(e.payload ? 'operator_notification_id')
 order by e.created_at,e.id limit 50 for update of e skip locked
 ),created as (
 insert into qa_notices(event_key,entity_type,entity_id,channel,title,body,status,dedupe_key)
 select 'workflow.operator_notice','qa_apps',aggregate_id::text,'IN_APP',
 case event_type when 'PARTNER_OFFER_ACCEPTED' then 'Клиент выбрал предложение'
 when 'PARTNER_FINAL_CONFIRMED' then 'Партнёр подтвердил условия'
 when 'PARTNER_FINAL_DECLINED' then 'Партнёр отказался: нужна альтернатива'
 when 'CLIENT_BOOKING_CONFIRMED' then 'Сделка подтверждена: подготовить оплату' end,
 'Заявка '||coalesce(public_id,'PCS')||'. '||case event_type
 when 'PARTNER_OFFER_ACCEPTED' then 'Проверьте подтверждение выбранных условий партнёром.'
 when 'PARTNER_FINAL_CONFIRMED' then 'Проверьте финальное подтверждение клиента.'
 when 'PARTNER_FINAL_DECLINED' then 'Подберите и согласуйте альтернативное предложение.'
 when 'CLIENT_BOOKING_CONFIRMED' then 'Откройте «Кабинеты и сделка», проверьте получателя и сохраните реквизиты.' end,
 'PENDING',dedupe_key from due on conflict(dedupe_key) do nothing returning id,dedupe_key
 ),receipts as (
 select id,dedupe_key from created union all
 select n.id,n.dedupe_key from qa_notices n join due d on d.dedupe_key=n.dedupe_key
 ),marked as (
 update qa_outbox e set payload=e.payload||jsonb_build_object('operator_notification_id',r.id,'operator_notified_at',clock_timestamp())
 from due d join receipts r on r.dedupe_key=d.dedupe_key where e.id=d.id returning e.id
 ),audited as (
 insert into qa_audit(actor_role,action,entity_type,entity_id,patch,reason,result)
 select 'SYSTEM','workflow_operator_notice_created','qa_notices',n.id::text,
 jsonb_build_object('outbox_id',d.id,'application_id',d.aggregate_id,'event_type',d.event_type),
 'Existing PCS workflow event projected to operator inbox','SUCCESS'
 from created n join due d on d.dedupe_key=n.dedupe_key returning entity_id
 ) select (select count(*)::int from created where exists(select 1 from audited a where a.entity_id=created.id::text)) created,
 (select count(*)::int from marked) marked$q$ INTO n,m;IF n<>0 OR m<>1 THEN RAISE EXCEPTION 'QA existing receipt not repaired'; END IF;
INSERT INTO qa_outbox(aggregate_type,aggregate_id,event_type,idempotency_key) VALUES('APPLICATION',app,'CLIENT_BOOKING_CONFIRMED','qa:audit-failure') RETURNING id INTO ev;
ALTER TABLE qa_audit ADD CONSTRAINT qa_block CHECK(action<>'workflow_operator_notice_created') NOT VALID;
BEGIN EXECUTE $q$with due as materialized (
 select e.id,e.aggregate_id,e.event_type,a.public_id,'workflow-operator:'||e.id::text dedupe_key
 from qa_outbox e join qa_apps a on a.id=e.aggregate_id
 where e.aggregate_type='APPLICATION' and e.status in ('PENDING','FAILED')
 and e.event_type=any(ARRAY['PARTNER_OFFER_ACCEPTED','PARTNER_FINAL_CONFIRMED','PARTNER_FINAL_DECLINED','CLIENT_BOOKING_CONFIRMED']::text[]) and not(e.payload ? 'operator_notification_id')
 order by e.created_at,e.id limit 50 for update of e skip locked
 ),created as (
 insert into qa_notices(event_key,entity_type,entity_id,channel,title,body,status,dedupe_key)
 select 'workflow.operator_notice','qa_apps',aggregate_id::text,'IN_APP',
 case event_type when 'PARTNER_OFFER_ACCEPTED' then 'Клиент выбрал предложение'
 when 'PARTNER_FINAL_CONFIRMED' then 'Партнёр подтвердил условия'
 when 'PARTNER_FINAL_DECLINED' then 'Партнёр отказался: нужна альтернатива'
 when 'CLIENT_BOOKING_CONFIRMED' then 'Сделка подтверждена: подготовить оплату' end,
 'Заявка '||coalesce(public_id,'PCS')||'. '||case event_type
 when 'PARTNER_OFFER_ACCEPTED' then 'Проверьте подтверждение выбранных условий партнёром.'
 when 'PARTNER_FINAL_CONFIRMED' then 'Проверьте финальное подтверждение клиента.'
 when 'PARTNER_FINAL_DECLINED' then 'Подберите и согласуйте альтернативное предложение.'
 when 'CLIENT_BOOKING_CONFIRMED' then 'Откройте «Кабинеты и сделка», проверьте получателя и сохраните реквизиты.' end,
 'PENDING',dedupe_key from due on conflict(dedupe_key) do nothing returning id,dedupe_key
 ),receipts as (
 select id,dedupe_key from created union all
 select n.id,n.dedupe_key from qa_notices n join due d on d.dedupe_key=n.dedupe_key
 ),marked as (
 update qa_outbox e set payload=e.payload||jsonb_build_object('operator_notification_id',r.id,'operator_notified_at',clock_timestamp())
 from due d join receipts r on r.dedupe_key=d.dedupe_key where e.id=d.id returning e.id
 ),audited as (
 insert into qa_audit(actor_role,action,entity_type,entity_id,patch,reason,result)
 select 'SYSTEM','workflow_operator_notice_created','qa_notices',n.id::text,
 jsonb_build_object('outbox_id',d.id,'application_id',d.aggregate_id,'event_type',d.event_type),
 'Existing PCS workflow event projected to operator inbox','SUCCESS'
 from created n join due d on d.dedupe_key=n.dedupe_key returning entity_id
 ) select (select count(*)::int from created where exists(select 1 from audited a where a.entity_id=created.id::text)) created,
 (select count(*)::int from marked) marked$q$ INTO n,m;RAISE EXCEPTION 'QA audit failure accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
IF EXISTS(SELECT 1 FROM qa_notices WHERE dedupe_key='workflow-operator:'||ev::text) OR EXISTS(SELECT 1 FROM qa_outbox WHERE id=ev AND payload ? 'operator_notification_id') THEN RAISE EXCEPTION 'QA atomic rollback failed'; END IF;
RAISE EXCEPTION 'QA complete rollback' USING ERRCODE='Z0001';
EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL; END; END $qa$
