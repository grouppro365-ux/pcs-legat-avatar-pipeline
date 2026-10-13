DECLARE car uuid:=gen_random_uuid(); r jsonb; replay jsonb; key text:='qa-calendar:'||gen_random_uuid(); booking uuid;
BEGIN
 INSERT INTO public.catalog_items(id,public_id,title,entity_type,availability_status,publication_status,moderation_status,client_price_thb) VALUES(car,'QA-'||car,'QA calendar canonical car','VEHICLE','AVAILABLE','PUBLISHED','APPROVED',1000);
 INSERT INTO public.availability_periods(item_id,starts_at,ends_at,status) VALUES(car,'2113-01-09 00:00+07','2113-01-10 00:00+07','BLOCKED'),(car,'2113-01-12 00:00+07','2113-01-13 00:00+07','BLOCKED');
 r:=pcs.create_vehicle_booking(key,'qa-offer',car,'qa-contact','QA test','test-only','2113-01-10','2113-01-12',1000,'THB');booking:=(r->>'id')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.applications WHERE id=booking AND reserved_vehicle_id=car AND operational_status='AWAITING_PARTNER_CONFIRMATION') THEN RAISE EXCEPTION 'QA canonical booking not reserved';END IF;
 replay:=pcs.create_vehicle_booking(key,'qa-offer',car,'qa-contact','QA test','test-only','2113-01-10','2113-01-12',1000,'THB');
 IF replay->>'id'<>r->>'id' OR (replay->>'reused')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'QA canonical receipt changed';END IF;
 BEGIN INSERT INTO public.applications(public_id,category,item_id,operational_status,qualification_data) VALUES('QA-'||gen_random_uuid(),'booking',car,'CONFIRMED','{"start_date":"2113-01-11","end_date":"2113-01-12"}');RAISE EXCEPTION 'QA cabinet bypassed bot reservation';EXCEPTION WHEN exclusion_violation THEN NULL;END;
 UPDATE public.applications SET operational_status='CANCELLED_BY_CLIENT' WHERE id=booking;
 INSERT INTO public.availability_periods(item_id,starts_at,ends_at,status,quantity,hold_until) VALUES(car,'2113-02-10 00:00+07','2113-02-12 00:00+07','HELD',0,now()-interval '1 hour');
 PERFORM pcs.create_vehicle_booking('qa-calendar:'||gen_random_uuid(),'qa-expired',car,'qa-contact','QA test','test-only','2113-02-10','2113-02-12',1000,'THB');
 INSERT INTO public.availability_periods(item_id,starts_at,ends_at,status,quantity) VALUES(car,'2113-03-10 00:00+07','2113-03-12 00:00+07','AVAILABLE',0);
 BEGIN PERFORM pcs.create_vehicle_booking('qa-calendar:'||gen_random_uuid(),'qa-zero',car,'qa-contact','QA test','test-only','2113-03-10','2113-03-12',1000,'THB');RAISE EXCEPTION 'QA zero capacity accepted';EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'vehicle_period_unavailable' THEN RAISE;END IF;END;
 INSERT INTO public.availability_periods(item_id,starts_at,ends_at,status) VALUES(car,'2113-04-09 17:00+00','2113-04-09 18:00+00','BLOCKED');
 BEGIN PERFORM pcs.create_vehicle_booking('qa-calendar:'||gen_random_uuid(),'qa-time',car,'qa-contact','QA test','test-only','2113-04-10','2113-04-12',1000,'THB');RAISE EXCEPTION 'QA intra-day block ignored';EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'vehicle_period_unavailable' THEN RAISE;END IF;END;
 INSERT INTO public.applications(public_id,category,item_id,operational_status,qualification_data) VALUES('QA-'||gen_random_uuid(),'booking',car,'CONFIRMED','{"start_date":"2113-05-10","end_date":"2113-05-12"}');
 BEGIN PERFORM pcs.create_vehicle_booking('qa-calendar:'||gen_random_uuid(),'qa-active',car,'qa-contact','QA test','test-only','2113-05-10','2113-05-12',1000,'THB');RAISE EXCEPTION 'QA bot bypassed cabinet reservation';EXCEPTION WHEN exclusion_violation THEN NULL;END;
END;
