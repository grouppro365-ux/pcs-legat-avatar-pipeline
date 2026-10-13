DECLARE car uuid:=gen_random_uuid(); other_car uuid:=gen_random_uuid(); app uuid:=gen_random_uuid(); draft uuid:=gen_random_uuid(); hold uuid:=gen_random_uuid(); adjacent uuid:=gen_random_uuid();
BEGIN
 INSERT INTO public.catalog_items(id,public_id,title,entity_type,availability_status,publication_status,moderation_status,client_price_thb) VALUES(car,'QA-'||car,'QA calendar car','VEHICLE','AVAILABLE','PUBLISHED','APPROVED',1000),(other_car,'QA-'||other_car,'QA other car','VEHICLE','AVAILABLE','PUBLISHED','APPROVED',1000);
 INSERT INTO public.availability_periods(item_id,starts_at,ends_at,status) VALUES(car,'2110-01-10 00:00+07','2110-01-20 00:00+07','BLOCKED');
 BEGIN
  INSERT INTO public.applications(public_id,category,item_id,operational_status,qualification_data) VALUES('QA-'||gen_random_uuid(),'booking',car,'CONFIRMED','{"start_date":"2110-01-12","end_date":"2110-01-14"}');
  RAISE EXCEPTION 'QA booking ignores calendar block';
 EXCEPTION WHEN exclusion_violation THEN NULL;END;
 INSERT INTO public.applications(id,public_id,category,item_id,operational_status,qualification_data) VALUES(adjacent,'QA-'||adjacent,'booking',car,'CONFIRMED','{"start_date":"2110-01-20","end_date":"2110-01-22"}');
 INSERT INTO public.applications(id,public_id,category,item_id,operational_status,qualification_data) VALUES(draft,'QA-'||draft,'booking',car,'NEW','{"start_date":"2110-01-12","end_date":"2110-01-14"}');
 BEGIN UPDATE public.applications SET operational_status='CONFIRMED' WHERE id=draft;RAISE EXCEPTION 'QA draft promotion ignores block';EXCEPTION WHEN exclusion_violation THEN NULL;END;
 UPDATE public.applications SET operational_status='CANCELLED_BY_CLIENT' WHERE id=adjacent;
 INSERT INTO public.availability_periods(item_id,starts_at,ends_at,status) VALUES(car,'2110-01-20 00:00+07','2110-01-22 00:00+07','BLOCKED');
 BEGIN UPDATE public.applications SET operational_status='CONFIRMED' WHERE id=adjacent;RAISE EXCEPTION 'QA cancelled booking restored under block';EXCEPTION WHEN exclusion_violation THEN NULL;END;
 INSERT INTO public.availability_periods(id,item_id,starts_at,ends_at,status,quantity,hold_until) VALUES(hold,car,'2110-02-10 00:00+07','2110-02-20 00:00+07','HOLD',0,now()-interval '1 minute');
 INSERT INTO public.applications(id,public_id,category,item_id,operational_status,qualification_data) VALUES(app,'QA-'||app,'booking',car,'CONFIRMED','{"start_date":"2110-02-12","end_date":"2110-02-14"}');
 BEGIN UPDATE public.availability_periods SET hold_until=now()+interval '1 hour' WHERE id=hold;RAISE EXCEPTION 'QA active hold overwrites booking';EXCEPTION WHEN exclusion_violation THEN NULL;END;
 BEGIN INSERT INTO public.availability_periods(item_id,starts_at,ends_at,status) VALUES(car,'2110-02-13 00:00+07','2110-02-15 00:00+07','UNAVAILABLE');RAISE EXCEPTION 'QA calendar overwrites active booking';EXCEPTION WHEN exclusion_violation THEN NULL;END;
 -- Positive availability with unspecified capacity is not a blocking period.
 INSERT INTO public.availability_periods(item_id,starts_at,ends_at,status) VALUES(car,'2110-02-12 00:00+07','2110-02-14 00:00+07','AVAILABLE');
 BEGIN INSERT INTO public.availability_periods(item_id,starts_at,ends_at,status,quantity) VALUES(car,'2110-02-12 00:00+07','2110-02-14 00:00+07','AVAILABLE',0);RAISE EXCEPTION 'QA zero capacity overwrites active booking';EXCEPTION WHEN exclusion_violation THEN NULL;END;
 BEGIN INSERT INTO public.availability_periods(item_id,starts_at,ends_at,status,quantity) VALUES(car,'2110-03-12 00:00+07','2110-03-14 00:00+07','AVAILABLE',2);RAISE EXCEPTION 'QA vehicle shared capacity accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN INSERT INTO public.availability_periods(item_id,starts_at,ends_at,status) VALUES(car,'2110-03-14 00:00+07','2110-03-12 00:00+07','AVAILABLE');RAISE EXCEPTION 'QA backwards calendar accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 INSERT INTO public.availability_periods(item_id,starts_at,ends_at,status,quantity) VALUES(car,'2110-03-12 00:00+07','2110-03-14 00:00+07','AVAILABLE',0);
 BEGIN INSERT INTO public.applications(public_id,category,item_id,operational_status,qualification_data) VALUES('QA-'||gen_random_uuid(),'booking',car,'CONFIRMED','{"start_date":"2110-03-12","end_date":"2110-03-14"}');RAISE EXCEPTION 'QA booking ignores zero availability';EXCEPTION WHEN exclusion_violation THEN NULL;END;
 INSERT INTO public.applications(public_id,category,item_id,operational_status,qualification_data) VALUES('QA-'||gen_random_uuid(),'booking',other_car,'CONFIRMED','{"start_date":"2110-01-12","end_date":"2110-01-14"}');
 BEGIN INSERT INTO public.applications(public_id,category,item_id,operational_status,qualification_data) VALUES('QA-'||gen_random_uuid(),'booking',car,'CONFIRMED','{"start_date":"2110-02-12","end_date":"2110-02-14"}');RAISE EXCEPTION 'QA existing booking exclusion lost';EXCEPTION WHEN exclusion_violation THEN NULL;END;
END;
