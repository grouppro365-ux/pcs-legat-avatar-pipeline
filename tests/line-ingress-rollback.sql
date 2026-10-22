DO $qa$
DECLARE sender text:='U'||substr(md5(gen_random_uuid()::text),1,32); first_at timestamptz:=clock_timestamp()-interval '2 hours'; c jsonb; again jsonb; cid uuid; denied boolean; saved_at timestamptz; saved_need text;
BEGIN
 c:=public.pcs_line_ingress_contact(sender,first_at);cid:=(c->>'id')::uuid;
 again:=public.pcs_line_ingress_contact(sender,first_at+interval '1 minute');
 IF again->>'id'<>c->>'id' OR (SELECT count(*) FROM public.pcs_contacts WHERE line_contact=sender)<>1 THEN RAISE EXCEPTION 'LINE exact contact identity was not stable';END IF;
 SELECT last_contact_at INTO saved_at FROM public.pcs_contacts WHERE id=cid;
 IF saved_at<>first_at THEN RAISE EXCEPTION 'LINE first signed timestamp not preserved';END IF;
 UPDATE public.pcs_contacts SET last_contact_at=first_at,need='first request' WHERE id=cid AND (last_contact_at IS NULL OR last_contact_at<=first_at);
 UPDATE public.pcs_contacts SET last_contact_at=first_at+interval '10 minutes',need='new request' WHERE id=cid AND (last_contact_at IS NULL OR last_contact_at<=first_at+interval '10 minutes');
 UPDATE public.pcs_contacts SET last_contact_at=first_at+interval '1 minute',need='older request' WHERE id=cid AND (last_contact_at IS NULL OR last_contact_at<=first_at+interval '1 minute');
 SELECT last_contact_at,need INTO saved_at,saved_need FROM public.pcs_contacts WHERE id=cid;
 IF saved_at<>first_at+interval '10 minutes' OR saved_need<>'new request' THEN RAISE EXCEPTION 'LINE old event regressed contact summary';END IF;
 denied:=false;BEGIN PERFORM public.pcs_line_ingress_contact('invalid',first_at);EXCEPTION WHEN invalid_parameter_value THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'LINE invalid identity accepted';END IF;
 denied:=false;BEGIN PERFORM public.pcs_line_ingress_contact(sender,clock_timestamp()+interval '1 day');EXCEPTION WHEN invalid_parameter_value THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'LINE invalid timestamp accepted';END IF;
 INSERT INTO public.pcs_contacts(name,line_contact,status,priority,preferred_channel,last_contact_at) VALUES('Synthetic duplicate',sender,'NEW','NORMAL','line',first_at);
 denied:=false;BEGIN PERFORM public.pcs_line_ingress_contact(sender,first_at);EXCEPTION WHEN unique_violation THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'LINE ambiguous legacy identity did not fail closed';END IF;
 IF has_function_privilege('anon','public.pcs_line_ingress_contact(text,timestamptz)','EXECUTE') OR has_function_privilege('authenticated','public.pcs_line_ingress_contact(text,timestamptz)','EXECUTE') OR NOT has_function_privilege('service_role','public.pcs_line_ingress_contact(text,timestamptz)','EXECUTE') THEN RAISE EXCEPTION 'LINE RPC privileges invalid';END IF;
END $qa$;
