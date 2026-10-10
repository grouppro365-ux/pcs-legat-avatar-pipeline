import {createBooking} from '../server/supabase/pcs-manager-live2/booking-create.mjs';
const item='90000000-0000-4000-8000-000000000070',request='90000000-0000-4000-8000-000000000071';
let prepared;
await createBooking({query:async(query,params)=>{
 if(query.startsWith('select id from catalog_items'))return[{id:item}];
 if(query.startsWith('select'))return[];
 prepared={query,params};return[{id:params[0],public_id:params[1]}];
}},{category:'booking',item_id:item,request_id:request,operational_status:'AWAITING_PARTNER_CONFIRMATION',qualification_data:{start_date:'2026-10-10',end_date:'2026-10-20'}},null);
const literal=x=>x===null?'null':"'"+String(x).replaceAll("'","''")+"'";
const write=prepared.query.replace(/\$(\d+)/g,(_,n)=>literal(prepared.params[n-1])).replace(' ) select c.id,',' ) select count(*) into v_count from (select c.id,')+') receipt;';
const sql=`DO $qa$ DECLARE v_count int;v_patch jsonb;BEGIN BEGIN
 CREATE TEMP TABLE catalog_items (LIKE public.catalog_items INCLUDING ALL) ON COMMIT DROP;
 CREATE TEMP TABLE catalog_revisions (LIKE public.catalog_revisions INCLUDING ALL) ON COMMIT DROP;
 CREATE TEMP TABLE applications (LIKE public.applications INCLUDING ALL) ON COMMIT DROP;
 CREATE TEMP TABLE audit_events (LIKE public.audit_events INCLUDING ALL) ON COMMIT DROP;
 ${write}
 IF v_count<>0 OR EXISTS(SELECT 1 FROM applications) OR EXISTS(SELECT 1 FROM audit_events) THEN RAISE EXCEPTION 'missing vehicle created booking'; END IF;
 INSERT INTO catalog_items(id,public_id,title,entity_type,availability_status,publication_status,moderation_status,client_price_thb) VALUES('${item}','CAT-QA-CREATE','QA rental','VEHICLE','AVAILABLE','PUBLISHED','APPROVED',100);
 FOR v_patch IN SELECT value FROM jsonb_array_elements('[{"entity_type":"PROPERTY"},{"availability_status":"UNAVAILABLE"},{"publication_status":"DRAFT"},{"moderation_status":"DRAFT"},{"client_price_thb":0},{"client_price_thb":null},{"publication_starts_at":"2099-01-01"},{"publication_ends_at":"2000-01-01"}]'::jsonb) LOOP
 UPDATE catalog_items SET entity_type=coalesce(v_patch->>'entity_type','VEHICLE'),availability_status=coalesce(v_patch->>'availability_status','AVAILABLE'),publication_status=coalesce(v_patch->>'publication_status','PUBLISHED'),moderation_status=coalesce(v_patch->>'moderation_status','APPROVED'),client_price_thb=case when v_patch ? 'client_price_thb' then (v_patch->>'client_price_thb')::numeric else 100 end,publication_starts_at=(v_patch->>'publication_starts_at')::timestamptz,publication_ends_at=(v_patch->>'publication_ends_at')::timestamptz WHERE id='${item}';
 ${write}
 IF v_count<>0 OR EXISTS(SELECT 1 FROM applications) OR EXISTS(SELECT 1 FROM audit_events) THEN RAISE EXCEPTION 'ineligible vehicle created booking: %',v_patch; END IF;
 END LOOP;
 UPDATE catalog_items SET entity_type='VEHICLE',availability_status='AVAILABLE',publication_status='PUBLISHED',moderation_status='APPROVED',client_price_thb=100,publication_starts_at=null,publication_ends_at=null WHERE id='${item}';
 INSERT INTO catalog_revisions(id,item_id,version,status,payload) VALUES('90000000-0000-4000-8000-000000000072','${item}',1,'APPROVED','{"ui":{"category":"car_sale"}}'::jsonb);
 ${write}
 IF v_count<>0 OR EXISTS(SELECT 1 FROM applications) OR EXISTS(SELECT 1 FROM audit_events) THEN RAISE EXCEPTION 'sale vehicle created rental'; END IF;
 UPDATE catalog_revisions SET payload='{"ui":{"category":"car_rent"}}'::jsonb WHERE item_id='${item}';
 ALTER TABLE audit_events ADD CONSTRAINT qa_create_audit_failure CHECK(action<>'booking_create') NOT VALID;
 BEGIN ${write} RAISE EXCEPTION 'audit failure expected'; EXCEPTION WHEN check_violation THEN NULL; END;
 IF EXISTS(SELECT 1 FROM applications) OR EXISTS(SELECT 1 FROM audit_events) THEN RAISE EXCEPTION 'audit failure left partial booking'; END IF;
 ALTER TABLE audit_events DROP CONSTRAINT qa_create_audit_failure;
 ${write}
 IF v_count<>1 OR (SELECT count(*) FROM applications)<>1 OR (SELECT count(*) FROM audit_events WHERE action='booking_create')<>1 THEN RAISE EXCEPTION 'eligible booking or audit missing'; END IF;
 ${write}
 IF v_count<>0 OR (SELECT count(*) FROM applications)<>1 OR (SELECT count(*) FROM audit_events)<>1 THEN RAISE EXCEPTION 'retry duplicated booking or audit'; END IF;
 RAISE EXCEPTION USING ERRCODE='Z0001',MESSAGE='QA passed; rollback all temporary data';
 EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL;END;END $qa$;`;
process.stdout.write(JSON.stringify({query:sql}));
