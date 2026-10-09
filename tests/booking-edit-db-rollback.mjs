import {readAudit} from '../server/supabase/pcs-manager-live2/operations-read.mjs';
import {bookingEditQuery} from '../server/supabase/pcs-manager-live2/booking-edit.mjs';
const id='90000000-0000-4000-8000-000000000061';
const b={id,expected_version:'2000-01-01',operational_status:'CONFIRMED',status:'CANCELLED_BY_CLIENT',client_name:'QA updated',client_contact:'QA private',internal_notes:'QA private notes',qualification_data:{start_date:'2026-10-11',end_date:'2026-10-21',total_amount:100,deposit_amount:10,currency:'THB'}};
const literal=v=>v===null?'null':Array.isArray(v)?'ARRAY['+v.map(literal).join(',')+']':"'"+String(v).replaceAll("'","''")+"'";
const statement=kind=>{const x=bookingEditQuery(b,kind);return x.query.replace(/\$(\d+)/g,(_,n)=>n==='2'?'v_version':literal(x.params[Number(n)-1])).replace(' ) select s.id,',' ) select count(*) into v_count from (select s.id,')+') result;';};
const edit=statement('edit'),status=statement('status');
let scopedRead;await readAudit(null,{query:async q=>{scopedRead=q;return[]}},'business','0',id);
let auditRead;await readAudit(null,{query:async q=>{auditRead=q;return[]}},'business');
const query=`DO $qa$ DECLARE v_version text;v_count int;v_before jsonb;v_finance jsonb;v_history jsonb;BEGIN BEGIN
 CREATE TEMP TABLE applications (LIKE public.applications INCLUDING ALL) ON COMMIT DROP;
 CREATE TEMP TABLE audit_events (LIKE public.audit_events INCLUDING ALL) ON COMMIT DROP;
 INSERT INTO applications(id,public_id,client_name,client_contact,category,operational_status,qualification_data) VALUES('${id}','APP-QA-BOOKING-AUDIT','QA original','QA original private','booking','NEW','{"start_date":"2026-10-10","end_date":"2026-10-20"}'::jsonb);
 SELECT updated_at::text,to_jsonb(a),jsonb_build_object('client_payment_status',client_payment_status,'partner_response_status',partner_response_status,'settlement_status',settlement_status) INTO v_version,v_before,v_finance FROM applications a WHERE id='${id}';
 ALTER TABLE audit_events ADD CONSTRAINT qa_audit_fail CHECK(action NOT IN ('booking_updated','booking_status_updated')) NOT VALID;
 BEGIN ${edit} RAISE EXCEPTION 'audit failure expected'; EXCEPTION WHEN check_violation THEN NULL; END;
 IF (SELECT to_jsonb(a) FROM applications a WHERE id='${id}') IS DISTINCT FROM v_before OR (SELECT count(*) FROM audit_events)<>0 THEN RAISE EXCEPTION 'edit audit rollback failed'; END IF;
 ALTER TABLE audit_events DROP CONSTRAINT qa_audit_fail;
 ${edit}
 IF v_count<>1 OR (SELECT client_name FROM applications WHERE id='${id}')<>'QA updated' OR (SELECT qualification_data->>'start_date' FROM applications WHERE id='${id}')<>'2026-10-11' THEN RAISE EXCEPTION 'edit receipt failed'; END IF;
 IF (SELECT updated_at::text FROM applications WHERE id='${id}')=v_version OR (SELECT count(*) FROM audit_events WHERE action='booking_updated')<>1 THEN RAISE EXCEPTION 'edit version or audit failed'; END IF;
 IF (SELECT patch->'before'->>'start_date' FROM audit_events WHERE action='booking_updated')<>'2026-10-10' OR (SELECT patch->'after'->>'start_date' FROM audit_events WHERE action='booking_updated')<>'2026-10-11' OR EXISTS(SELECT 1 FROM audit_events WHERE patch::text LIKE '%QA private%' OR patch::text LIKE '%total_amount%') THEN RAISE EXCEPTION 'audit snapshot failed'; END IF;
 IF (SELECT jsonb_build_object('client_payment_status',client_payment_status,'partner_response_status',partner_response_status,'settlement_status',settlement_status) FROM applications WHERE id='${id}') IS DISTINCT FROM v_finance THEN RAISE EXCEPTION 'financial statuses changed'; END IF;
 ${edit}
 IF v_count<>0 OR (SELECT count(*) FROM audit_events)<>1 THEN RAISE EXCEPTION 'stale edit wrote twice'; END IF;
 SELECT updated_at::text,to_jsonb(a) INTO v_version,v_before FROM applications a WHERE id='${id}';
 ALTER TABLE audit_events ADD CONSTRAINT qa_status_fail CHECK(action<>'booking_status_updated') NOT VALID;
 BEGIN ${status} RAISE EXCEPTION 'status audit failure expected'; EXCEPTION WHEN check_violation THEN NULL; END;
 IF (SELECT to_jsonb(a) FROM applications a WHERE id='${id}') IS DISTINCT FROM v_before OR (SELECT count(*) FROM audit_events)<>1 THEN RAISE EXCEPTION 'status audit rollback failed'; END IF;
 ALTER TABLE audit_events DROP CONSTRAINT qa_status_fail;
 ${status}
 IF v_count<>1 OR (SELECT operational_status FROM applications WHERE id='${id}')<>'CANCELLED_BY_CLIENT' OR (SELECT count(*) FROM audit_events WHERE action='booking_status_updated')<>1 THEN RAISE EXCEPTION 'status receipt failed'; END IF;
 IF (SELECT to_jsonb(a)-'updated_at'-'operational_status' FROM applications a WHERE id='${id}') IS DISTINCT FROM (v_before-'updated_at'-'operational_status') THEN RAISE EXCEPTION 'status changed other fields'; END IF;
 SELECT jsonb_agg(to_jsonb(r)) INTO v_history FROM (${auditRead.replaceAll('$1','0')}) r;
 IF jsonb_array_length(v_history)<>2 OR v_history::text LIKE '%QA private%' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_history) e WHERE e->>'action'='booking_status_updated' AND e#>>'{booking_change,after,operational_status}'='CANCELLED_BY_CLIENT') THEN RAISE EXCEPTION 'audit read projection failed'; END IF;
 SELECT updated_at::text INTO v_version FROM applications WHERE id='${id}';
 ${edit}
 IF v_count<>0 OR (SELECT count(*) FROM audit_events)<>2 THEN RAISE EXCEPTION 'locked booking changed'; END IF;
 INSERT INTO audit_events(actor_role,action,entity_type,entity_id,patch,reason,result) SELECT 'ADMIN','booking_create','applications','90000000-0000-4000-8000-000000000099','{}'::jsonb,'QA unrelated','SUCCESS' FROM generate_series(1,60);
 INSERT INTO audit_events(actor_role,action,entity_type,entity_id,patch,reason,result) VALUES('ADMIN','catalog_media_add','catalog_items','${id}','{}'::jsonb,'QA other entity','SUCCESS');
 SELECT jsonb_agg(to_jsonb(r)) INTO v_history FROM (${scopedRead.replaceAll('$1','0').replaceAll('$2',literal(id))}) r;
 IF jsonb_array_length(v_history)<>2 OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_history) e WHERE e->>'entity_id'<>'${id}' OR e->>'entity_type'<>'applications') THEN RAISE EXCEPTION 'scoped pagination leaked other records'; END IF;
 SELECT count(*) INTO v_count FROM (${scopedRead.replaceAll('$1','50').replaceAll('$2',literal(id))}) r;
 IF v_count<>0 THEN RAISE EXCEPTION 'scoped second page includes unrelated records'; END IF;
 RAISE EXCEPTION USING ERRCODE='Z0001',MESSAGE='QA passed; rollback all temporary data';
 EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL; END; END $qa$;`;
process.stdout.write(JSON.stringify({query}));
