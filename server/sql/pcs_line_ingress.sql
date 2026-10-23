-- Exact LINE identity, serialized without rewriting legacy contacts.
CREATE OR REPLACE FUNCTION public.pcs_line_ingress_contact(p_sender text,p_received_at timestamptz) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
DECLARE c public.pcs_contacts%ROWTYPE; matches integer;
BEGIN
 IF p_sender IS NULL OR p_sender !~ '^U[0-9a-fA-F]{32}$' OR p_received_at IS NULL OR p_received_at>clock_timestamp()+interval '5 minutes' OR p_received_at<'1970-01-01'::timestamptz THEN RAISE EXCEPTION 'line_sender_invalid' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('pcs-line-contact:'||p_sender,0));
 SELECT count(*) INTO matches FROM public.pcs_contacts WHERE line_contact=p_sender;
 IF matches>1 THEN RAISE EXCEPTION 'line_contact_conflict' USING ERRCODE='23505';END IF;
 SELECT * INTO c FROM public.pcs_contacts WHERE line_contact=p_sender FOR UPDATE;
 IF NOT FOUND THEN INSERT INTO public.pcs_contacts(name,line_contact,status,priority,preferred_channel,last_contact_at) VALUES('LINE '||right(p_sender,6),p_sender,'NEW','NORMAL','line',p_received_at) RETURNING * INTO c;END IF;
 RETURN jsonb_build_object('id',c.id,'name',c.name,'line_contact',c.line_contact);
END $fn$;
REVOKE ALL ON FUNCTION public.pcs_line_ingress_contact(text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pcs_line_ingress_contact(text,timestamptz) TO service_role;
