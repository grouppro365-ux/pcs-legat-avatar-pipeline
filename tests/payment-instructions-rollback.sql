DO $qa$ DECLARE n int; claimed_payload jsonb; claimed_attempts int; ev uuid; owner text; app uuid:=gen_random_uuid(); client uuid:=gen_random_uuid(); contact uuid:=gen_random_uuid(); rev text; BEGIN BEGIN
CREATE TEMP TABLE qa_apps(LIKE public.applications INCLUDING ALL);
CREATE TEMP TABLE qa_clients(LIKE public.client_profiles INCLUDING ALL);
CREATE TEMP TABLE qa_outbox(LIKE public.pcs_workflow_outbox INCLUDING ALL);
CREATE TEMP TABLE qa_notices(LIKE public.notifications INCLUDING ALL);
CREATE TEMP TABLE qa_audit(LIKE public.audit_events INCLUDING ALL);
CREATE TEMP TABLE qa_instructions(application_id uuid PRIMARY KEY,recipient text,instructions text,updated_at timestamptz);
INSERT INTO qa_clients(id,source_contact_id) VALUES(client,contact);
INSERT INTO qa_apps(id,public_id,category,client_profile_id,operational_status,client_payment_status,accepted_offer_snapshot) VALUES(app,'QA-PAYMENT','general',client,'CONFIRMED','INSTRUCTIONS_SENT','{"client_price_thb":1200.50,"deposit_thb":2000.00}');
INSERT INTO qa_instructions VALUES(app,'PARTNER','QA bank details',now());
EXECUTE $query$insert into qa_outbox(aggregate_type,aggregate_id,event_type,idempotency_key,payload)
 select 'APPLICATION',a.id,'PAYMENT_INSTRUCTIONS_READY',
 'payment-instructions:'||a.id::text||':'||md5(i.updated_at::text),
 jsonb_build_object('application_id',a.id,'public_id',a.public_id,'client_profile_id',c.id,'contact_id',c.source_contact_id,
 'revision',i.updated_at::text,'instructions',i.instructions,'recipient',i.recipient,
 'price',a.accepted_offer_snapshot->>'client_price_thb','deposit',a.accepted_offer_snapshot->>'deposit_thb')
 from qa_apps a join qa_instructions i on i.application_id=a.id
 join qa_clients c on c.id=a.client_profile_id
 where a.operational_status='CONFIRMED' and a.client_payment_status in ('AWAITING_PAYMENT','INSTRUCTIONS_SENT','PARTIALLY_PAID')
 and c.blocked is not true and c.merged_into_id is null and c.source_contact_id is not null
 and i.recipient='PARTNER' and not exists(select 1 from qa_outbox e where e.idempotency_key='payment-instructions:'||a.id::text||':'||md5(i.updated_at::text))
 order by i.updated_at,a.id limit 50 on conflict(idempotency_key) do nothing returning id$query$ INTO ev;
IF ev IS NULL THEN RAISE EXCEPTION 'QA enqueue missing'; END IF;
EXECUTE $query$insert into qa_outbox(aggregate_type,aggregate_id,event_type,idempotency_key,payload)
 select 'APPLICATION',a.id,'PAYMENT_INSTRUCTIONS_READY',
 'payment-instructions:'||a.id::text||':'||md5(i.updated_at::text),
 jsonb_build_object('application_id',a.id,'public_id',a.public_id,'client_profile_id',c.id,'contact_id',c.source_contact_id,
 'revision',i.updated_at::text,'instructions',i.instructions,'recipient',i.recipient,
 'price',a.accepted_offer_snapshot->>'client_price_thb','deposit',a.accepted_offer_snapshot->>'deposit_thb')
 from qa_apps a join qa_instructions i on i.application_id=a.id
 join qa_clients c on c.id=a.client_profile_id
 where a.operational_status='CONFIRMED' and a.client_payment_status in ('AWAITING_PAYMENT','INSTRUCTIONS_SENT','PARTIALLY_PAID')
 and c.blocked is not true and c.merged_into_id is null and c.source_contact_id is not null
 and i.recipient='PARTNER' and not exists(select 1 from qa_outbox e where e.idempotency_key='payment-instructions:'||a.id::text||':'||md5(i.updated_at::text))
 order by i.updated_at,a.id limit 50 on conflict(idempotency_key) do nothing returning id$query$ INTO ev;
IF ev IS NOT NULL THEN RAISE EXCEPTION 'QA duplicate enqueue'; END IF;
EXECUTE $query$with due as (
 select id from qa_outbox where event_type='PAYMENT_INSTRUCTIONS_READY' and aggregate_type='APPLICATION'
 and status in ('PENDING','FAILED','PROCESSING') and next_attempt_at<=now() order by created_at,id limit 10 for update skip locked
 ) update qa_outbox e set status='PROCESSING',attempts=e.attempts+1,next_attempt_at=now()+interval '10 minutes',
 payload=e.payload||jsonb_build_object('payment_worker_owner',gen_random_uuid()),last_error=null from due d where e.id=d.id returning e.id,e.payload,e.attempts$query$ INTO ev,claimed_payload,claimed_attempts;
SELECT payload->>'payment_worker_owner' INTO owner FROM qa_outbox WHERE id=ev;
IF owner IS NULL OR NOT EXISTS(SELECT 1 FROM qa_outbox WHERE id=ev AND attempts=1 AND status='PROCESSING' AND next_attempt_at>now()) THEN RAISE EXCEPTION 'QA claim missing lease'; END IF;
EXECUTE $query$with due as (
 select id from qa_outbox where event_type='PAYMENT_INSTRUCTIONS_READY' and aggregate_type='APPLICATION'
 and status in ('PENDING','FAILED','PROCESSING') and next_attempt_at<=now() order by created_at,id limit 10 for update skip locked
 ) update qa_outbox e set status='PROCESSING',attempts=e.attempts+1,next_attempt_at=now()+interval '10 minutes',
 payload=e.payload||jsonb_build_object('payment_worker_owner',gen_random_uuid()),last_error=null from due d where e.id=d.id returning e.id,e.payload,e.attempts$query$ INTO ev,claimed_payload,claimed_attempts;
IF ev IS NOT NULL THEN RAISE EXCEPTION 'QA active lease stolen'; END IF;
SELECT id,payload->>'revision' INTO ev,rev FROM qa_outbox;
EXECUTE $query$select a.id from qa_apps a join qa_instructions i on i.application_id=a.id
 join qa_clients c on c.id=a.client_profile_id where a.id=$1::uuid and a.client_profile_id=$2::uuid
 and a.operational_status='CONFIRMED' and a.client_payment_status in ('AWAITING_PAYMENT','INSTRUCTIONS_SENT','PARTIALLY_PAID')
 and i.updated_at::text=$3 and c.source_contact_id=$4::uuid and c.blocked is not true and c.merged_into_id is null
 and i.recipient='PARTNER'$query$ INTO ev USING app,client,rev,contact;
IF ev IS NULL THEN RAISE EXCEPTION 'QA valid revision blocked'; END IF;
EXECUTE $query$select a.id from qa_apps a join qa_instructions i on i.application_id=a.id
 join qa_clients c on c.id=a.client_profile_id where a.id=$1::uuid and a.client_profile_id=$2::uuid
 and a.operational_status='CONFIRMED' and a.client_payment_status in ('AWAITING_PAYMENT','INSTRUCTIONS_SENT','PARTIALLY_PAID')
 and i.updated_at::text=$3 and c.source_contact_id=$4::uuid and c.blocked is not true and c.merged_into_id is null
 and i.recipient='PARTNER'$query$ INTO ev USING app,client,'stale',contact;
IF ev IS NOT NULL THEN RAISE EXCEPTION 'QA stale revision allowed'; END IF;
SELECT id INTO ev FROM qa_outbox;
EXECUTE $query$with changed as (
 update qa_outbox set status=$3,sent_at=case when $3='SENT' then clock_timestamp() else sent_at end,
 last_error=$4,next_attempt_at=case when $3='FAILED' then now()+interval '5 minutes' else next_attempt_at end
 where id=$1::uuid and status='PROCESSING' and payload->>'payment_worker_owner'=$2 returning id,aggregate_id
 ),notified as (
 insert into qa_notices(event_key,entity_type,entity_id,title,body,status,dedupe_key)
 select 'payment.instructions_review','qa_apps',aggregate_id::text,'Проверить отправку реквизитов',
 'Откройте заявку и проверьте адрес канала или историю доставки перед повтором.','PENDING','payment-send-review:'||id::text
 from changed where $3='CANCELLED' and $4<>'superseded' on conflict(dedupe_key) do nothing returning id
 ),audited as (
 insert into qa_audit(actor_role,action,entity_type,entity_id,patch,result)
 select 'SYSTEM','payment_instructions_delivery','qa_apps',aggregate_id::text,jsonb_build_object('outbox_id',id,'delivery_status',$3,'reason',$4),'SUCCESS' from changed returning entity_id
 ) select id from changed where exists(select 1 from audited where entity_id=changed.aggregate_id::text)$query$ INTO ev USING ev,'wrong-owner','SENT',NULL::text;
IF ev IS NOT NULL THEN RAISE EXCEPTION 'QA wrong owner allowed'; END IF;
SELECT id INTO ev FROM qa_outbox;
EXECUTE $query$with changed as (
 update qa_outbox set status=$3,sent_at=case when $3='SENT' then clock_timestamp() else sent_at end,
 last_error=$4,next_attempt_at=case when $3='FAILED' then now()+interval '5 minutes' else next_attempt_at end
 where id=$1::uuid and status='PROCESSING' and payload->>'payment_worker_owner'=$2 returning id,aggregate_id
 ),notified as (
 insert into qa_notices(event_key,entity_type,entity_id,title,body,status,dedupe_key)
 select 'payment.instructions_review','qa_apps',aggregate_id::text,'Проверить отправку реквизитов',
 'Откройте заявку и проверьте адрес канала или историю доставки перед повтором.','PENDING','payment-send-review:'||id::text
 from changed where $3='CANCELLED' and $4<>'superseded' on conflict(dedupe_key) do nothing returning id
 ),audited as (
 insert into qa_audit(actor_role,action,entity_type,entity_id,patch,result)
 select 'SYSTEM','payment_instructions_delivery','qa_apps',aggregate_id::text,jsonb_build_object('outbox_id',id,'delivery_status',$3,'reason',$4),'SUCCESS' from changed returning entity_id
 ) select id from changed where exists(select 1 from audited where entity_id=changed.aggregate_id::text)$query$ INTO ev USING ev,owner,'CANCELLED','delivery_review_required';
IF ev IS NULL OR (SELECT count(*) FROM qa_notices)<>1 OR (SELECT count(*) FROM qa_audit)<>1 THEN RAISE EXCEPTION 'QA review/audit not atomic'; END IF;
UPDATE qa_instructions SET updated_at=updated_at+interval '1 second';
EXECUTE $query$insert into qa_outbox(aggregate_type,aggregate_id,event_type,idempotency_key,payload)
 select 'APPLICATION',a.id,'PAYMENT_INSTRUCTIONS_READY',
 'payment-instructions:'||a.id::text||':'||md5(i.updated_at::text),
 jsonb_build_object('application_id',a.id,'public_id',a.public_id,'client_profile_id',c.id,'contact_id',c.source_contact_id,
 'revision',i.updated_at::text,'instructions',i.instructions,'recipient',i.recipient,
 'price',a.accepted_offer_snapshot->>'client_price_thb','deposit',a.accepted_offer_snapshot->>'deposit_thb')
 from qa_apps a join qa_instructions i on i.application_id=a.id
 join qa_clients c on c.id=a.client_profile_id
 where a.operational_status='CONFIRMED' and a.client_payment_status in ('AWAITING_PAYMENT','INSTRUCTIONS_SENT','PARTIALLY_PAID')
 and c.blocked is not true and c.merged_into_id is null and c.source_contact_id is not null
 and i.recipient='PARTNER' and not exists(select 1 from qa_outbox e where e.idempotency_key='payment-instructions:'||a.id::text||':'||md5(i.updated_at::text))
 order by i.updated_at,a.id limit 50 on conflict(idempotency_key) do nothing returning id$query$ INTO ev;
IF ev IS NULL OR (SELECT count(*) FROM qa_outbox)<>2 THEN RAISE EXCEPTION 'QA new revision missing'; END IF;
EXECUTE $query$with due as (
 select id from qa_outbox where event_type='PAYMENT_INSTRUCTIONS_READY' and aggregate_type='APPLICATION'
 and status in ('PENDING','FAILED','PROCESSING') and next_attempt_at<=now() order by created_at,id limit 10 for update skip locked
 ) update qa_outbox e set status='PROCESSING',attempts=e.attempts+1,next_attempt_at=now()+interval '10 minutes',
 payload=e.payload||jsonb_build_object('payment_worker_owner',gen_random_uuid()),last_error=null from due d where e.id=d.id returning e.id,e.payload,e.attempts$query$ INTO ev,claimed_payload,claimed_attempts;
SELECT payload->>'payment_worker_owner' INTO owner FROM qa_outbox WHERE id=ev;
ALTER TABLE qa_audit ADD CONSTRAINT qa_block CHECK(action<>'payment_instructions_delivery') NOT VALID;
BEGIN
EXECUTE $query$with changed as (
 update qa_outbox set status=$3,sent_at=case when $3='SENT' then clock_timestamp() else sent_at end,
 last_error=$4,next_attempt_at=case when $3='FAILED' then now()+interval '5 minutes' else next_attempt_at end
 where id=$1::uuid and status='PROCESSING' and payload->>'payment_worker_owner'=$2 returning id,aggregate_id
 ),notified as (
 insert into qa_notices(event_key,entity_type,entity_id,title,body,status,dedupe_key)
 select 'payment.instructions_review','qa_apps',aggregate_id::text,'Проверить отправку реквизитов',
 'Откройте заявку и проверьте адрес канала или историю доставки перед повтором.','PENDING','payment-send-review:'||id::text
 from changed where $3='CANCELLED' and $4<>'superseded' on conflict(dedupe_key) do nothing returning id
 ),audited as (
 insert into qa_audit(actor_role,action,entity_type,entity_id,patch,result)
 select 'SYSTEM','payment_instructions_delivery','qa_apps',aggregate_id::text,jsonb_build_object('outbox_id',id,'delivery_status',$3,'reason',$4),'SUCCESS' from changed returning entity_id
 ) select id from changed where exists(select 1 from audited where entity_id=changed.aggregate_id::text)$query$ INTO ev USING ev,owner,'SENT',NULL::text;
RAISE EXCEPTION 'QA audit failure ignored';
EXCEPTION WHEN check_violation THEN NULL; END;
IF NOT EXISTS(SELECT 1 FROM qa_outbox WHERE id=ev AND status='PROCESSING' AND sent_at IS NULL) THEN RAISE EXCEPTION 'QA rollback failed'; END IF;
RAISE EXCEPTION 'QA complete rollback' USING ERRCODE='Z0001';
EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL; END; END $qa$
