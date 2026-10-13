import {projectionLeaseQuery,projectionFinishQuery,projectionReviewQuery} from '../server/supabase/pcs-manager-live2/reservation-projection.mjs';
const claim=name=>projectionLeaseQuery.replaceAll('$1',name).replace("returning value->>'cursor' cursor",'returning value into receipt');
const finish=name=>projectionFinishQuery.replaceAll('$1',name).replaceAll('$2',"'11111111-1111-4111-8111-111111111111'").replaceAll('$3',"'{\"ok\":true}'").replace('returning key','returning key into finished');
const review=projectionReviewQuery.replaceAll('$1','app::text').replaceAll('$2',"'booking_terms_diverged'").replaceAll('$3',"'qa-version'");
console.log(JSON.stringify({sql:`DO $outer$ BEGIN BEGIN
DO $qa$ DECLARE lease_a text:=gen_random_uuid()::text;lease_b text:=gen_random_uuid()::text;receipt jsonb;finished text;app uuid:=gen_random_uuid();first_count integer;BEGIN
 DELETE FROM public.system_settings WHERE key='reservation_projection_sync';
 ${claim('lease_a')};IF receipt->>'lease'<>lease_a THEN RAISE EXCEPTION 'QA lease claim missing';END IF;
 ${claim('lease_b')};IF FOUND THEN RAISE EXCEPTION 'QA concurrent lease accepted';END IF;
 ${finish('lease_b')};IF FOUND THEN RAISE EXCEPTION 'QA foreign owner completed lease';END IF;
 ${finish('lease_a')};IF NOT FOUND THEN RAISE EXCEPTION 'QA lease finish failed';END IF;
 ${claim('lease_b')};IF receipt->>'cursor'<>'11111111-1111-4111-8111-111111111111' THEN RAISE EXCEPTION 'QA page cursor lost';END IF;
 UPDATE public.system_settings SET value=value||jsonb_build_object('lease_until',clock_timestamp()-interval '1 second') WHERE key='reservation_projection_sync';
 ${claim('lease_a')};IF receipt->>'lease'<>lease_a THEN RAISE EXCEPTION 'QA expired lease not reclaimed';END IF;
 ${review};${review};
 SELECT count(*) INTO first_count FROM public.notifications WHERE entity_id=app::text AND event_key='reservation.projection_review';IF first_count<>1 THEN RAISE EXCEPTION 'QA review dedupe failed';END IF;
 SELECT count(*) INTO first_count FROM public.audit_events WHERE patch->>'application_id'=app::text AND action='reservation_projection_review';IF first_count<>1 THEN RAISE EXCEPTION 'QA review audit dedupe failed';END IF;
END $qa$;
RAISE EXCEPTION 'QA rollback complete' USING ERRCODE='Z0001';EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL;END;END $outer$;`}));
