DECLARE client uuid:=gen_random_uuid(); app uuid:=gen_random_uuid(); unknown_app uuid:=gen_random_uuid(); r record; app_rows int:=0; unknown_rows int:=0;
BEGIN
 INSERT INTO client_profiles(id,display_name,contact) VALUES(client,'QA finance','test only');
 INSERT INTO applications(id,public_id,client_profile_id,category,operational_status,accepted_offer_snapshot) VALUES(app,'QA-'||app,client,'general','CONFIRMED',jsonb_build_object('client_price_thb','1000.25','deposit_thb','2000.00')),
 (unknown_app,'QA-'||unknown_app,client,'general','CONFIRMED',jsonb_build_object('client_price_thb','invalid'));
 INSERT INTO pcs.application_payment_claims(application_id,client_profile_id,amount_thb,reference,status) VALUES
 (app,client,400.10,'qa-a','VERIFIED'),(app,client,100.05,'qa-b','VERIFIED'),(app,client,500.10,'qa-pending','PENDING'),(app,client,900,'qa-rejected','REJECTED'),(unknown_app,client,10,'qa-unknown','PENDING');
 FOR r IN EXECUTE $finance$__FINANCE__$finance$ USING 'all',0 LOOP
  IF r.application_id=app THEN
   app_rows:=app_rows+1;
   IF r.verified_amount::numeric<>500.15 OR r.pending_amount::numeric<>500.10 OR r.remaining::numeric<>500.10 OR r.deposit::numeric<>2000 OR r.balance_status<>'PARTIAL' THEN RAISE EXCEPTION 'QA incorrect balance or deposit credit';END IF;
  ELSIF r.application_id=unknown_app THEN
   unknown_rows:=unknown_rows+1;
   IF r.agreed_price IS NOT NULL OR r.remaining IS NOT NULL OR r.balance_status<>'UNKNOWN' THEN RAISE EXCEPTION 'QA unknown price claimed paid';END IF;
  END IF;
 END LOOP;
 IF app_rows<>4 OR unknown_rows<>1 THEN RAISE EXCEPTION 'QA financial rows missing';END IF;
 INSERT INTO pcs.application_payment_claims(application_id,client_profile_id,amount_thb,reference,status) VALUES(app,client,1000,'qa-overpayment','VERIFIED');
 FOR r IN EXECUTE $finance$__FINANCE__$finance$ USING 'PENDING',0 LOOP
  IF r.status<>'PENDING' THEN RAISE EXCEPTION 'QA payment filter';END IF;
  IF r.application_id=app AND (r.remaining::numeric<>0 OR r.overpayment::numeric<>499.90 OR r.balance_status<>'OVERPAID') THEN RAISE EXCEPTION 'QA overpayment hidden';END IF;
 END LOOP;
END;
