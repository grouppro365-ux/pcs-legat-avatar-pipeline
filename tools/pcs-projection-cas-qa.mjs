import {readFileSync} from 'node:fs';
const migration=readFileSync(new URL('../supabase/migrations/20261014000000_reservation_status_projection_audit.sql',import.meta.url),'utf8');
const fn=migration.slice(0,migration.indexOf('REVOKE'));
console.log(JSON.stringify({query:`DO $outer$ BEGIN BEGIN EXECUTE $migration$${fn}$migration$;
DO $qa$ DECLARE target uuid:=gen_random_uuid(); car uuid:=gen_random_uuid(); before_version timestamptz; touched integer;BEGIN
 CREATE TEMP TABLE projection_reservations(LIKE public.pcs_reservations INCLUDING DEFAULTS INCLUDING CONSTRAINTS) ON COMMIT DROP;
 CREATE TRIGGER projection_qa_audit AFTER UPDATE OF status ON projection_reservations FOR EACH ROW EXECUTE FUNCTION public.pcs_audit_reservation_status_projection();
 INSERT INTO projection_reservations(id,catalog_item_id,source,status,start_date,end_date,total_amount,deposit_amount,currency,payment_status,notes)
 VALUES(target,car,'neon_contract_projection','confirmed','2113-01-10','2113-01-12',1000,200,'THB','paid','QA retained');
 SELECT updated_at INTO before_version FROM projection_reservations WHERE id=target;
 UPDATE projection_reservations SET status='active',updated_at=clock_timestamp() WHERE id=target AND status='confirmed' AND updated_at=before_version AND source='neon_contract_projection' AND catalog_item_id=car AND start_date='2113-01-10' AND end_date='2113-01-12';
 GET DIAGNOSTICS touched=ROW_COUNT;IF touched<>1 THEN RAISE EXCEPTION 'QA current CAS failed';END IF;
 UPDATE projection_reservations SET status='cancelled',updated_at=clock_timestamp() WHERE id=target AND status='confirmed' AND updated_at=before_version;
 GET DIAGNOSTICS touched=ROW_COUNT;IF touched<>0 THEN RAISE EXCEPTION 'QA stale CAS overwrote active';END IF;
 IF NOT EXISTS(SELECT 1 FROM projection_reservations WHERE id=target AND status='active' AND total_amount=1000 AND deposit_amount=200 AND payment_status='paid' AND notes='QA retained') THEN RAISE EXCEPTION 'QA projection changed money/notes';END IF;
 IF (SELECT count(*) FROM public.pcs_audit_logs WHERE entity_id=target::text AND action='reservation_projection_status_changed')<>1 THEN RAISE EXCEPTION 'QA atomic audit missing';END IF;
 UPDATE projection_reservations SET status='active' WHERE id=target;
 IF (SELECT count(*) FROM public.pcs_audit_logs WHERE entity_id=target::text AND action='reservation_projection_status_changed')<>1 THEN RAISE EXCEPTION 'QA unchanged status duplicated audit';END IF;
 UPDATE projection_reservations SET source='manual' WHERE id=target;UPDATE projection_reservations SET status='cancelled' WHERE id=target;
 IF (SELECT count(*) FROM public.pcs_audit_logs WHERE entity_id=target::text AND action='reservation_projection_status_changed')<>1 THEN RAISE EXCEPTION 'QA unrelated source audited as projection';END IF;
END $qa$;
RAISE EXCEPTION 'QA rollback complete' USING ERRCODE='Z0001';EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL;END;END $outer$;`}));
