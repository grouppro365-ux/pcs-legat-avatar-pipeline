-- Preserve canonical booking receipts and locks; use exact Bangkok calendar bounds.
CREATE OR REPLACE FUNCTION pcs.create_vehicle_booking(event_key text, offer_key text, vehicle_id uuid, client_id text, customer_name text, customer_contact text, starts date, ends date, total numeric, currency_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE existing public.applications%ROWTYPE; vehicle public.catalog_items%ROWTYPE; created public.applications%ROWTYPE;
BEGIN
  IF event_key IS NULL OR length(event_key)<8 OR length(event_key)>400 OR coalesce(offer_key,'')='' OR coalesce(client_id,'')='' OR
     starts IS NULL OR ends IS NULL OR ends<=starts OR total IS NULL OR total<=0 OR total::text IN ('NaN','Infinity','-Infinity') OR currency_code IS DISTINCT FROM 'THB' THEN
    RAISE EXCEPTION 'booking_input_invalid' USING ERRCODE='22023';
  END IF;
  -- Serialize replay of an offer even if a caller changes the selected item.
  PERFORM pg_advisory_xact_lock(hashtextextended(event_key,0));
  SELECT * INTO existing FROM public.applications WHERE category='booking' AND qualification_data->>'booking_idempotency_key'=event_key;
  IF FOUND THEN
    IF existing.item_id IS DISTINCT FROM vehicle_id OR existing.qualification_data->>'contact_id' IS DISTINCT FROM client_id OR
       pcs.booking_date(existing.qualification_data->>'start_date') IS DISTINCT FROM starts OR pcs.booking_date(existing.qualification_data->>'end_date') IS DISTINCT FROM ends OR
       (existing.qualification_data->>'total_amount')::numeric IS DISTINCT FROM total OR existing.qualification_data->>'currency' IS DISTINCT FROM currency_code THEN
      RAISE EXCEPTION 'booking_idempotency_mismatch' USING ERRCODE='22023';
    END IF;
    RETURN jsonb_build_object('id',existing.id,'public_id',existing.public_id,'status',existing.operational_status,'reused',true);
  END IF;
  SELECT * INTO vehicle FROM public.catalog_items WHERE id=vehicle_id FOR UPDATE;
  IF NOT FOUND OR vehicle.entity_type<>'VEHICLE' OR vehicle.availability_status<>'AVAILABLE' OR vehicle.publication_status<>'PUBLISHED' THEN
    RAISE EXCEPTION 'vehicle_not_available' USING ERRCODE='P0001';
  END IF;
  IF EXISTS(SELECT 1 FROM public.availability_periods WHERE item_id=vehicle_id
    AND (upper(status) IS DISTINCT FROM 'AVAILABLE' OR quantity=0 OR quantity NOT IN (0,1))
    AND NOT (coalesce(upper(status),'') IN ('HOLD','HELD') AND hold_until IS NOT NULL AND hold_until<=clock_timestamp())
    AND (starts_at IS NULL OR ends_at IS NULL OR NOT isfinite(starts_at) OR NOT isfinite(ends_at) OR ends_at<=starts_at OR
      starts_at<(ends::timestamp AT TIME ZONE 'Asia/Bangkok') AND ends_at>(starts::timestamp AT TIME ZONE 'Asia/Bangkok'))) THEN
    RAISE EXCEPTION 'vehicle_period_unavailable' USING ERRCODE='P0001';
  END IF;
  INSERT INTO public.applications(public_id,client_name,client_contact,category,city,item_id,operational_status,
    service_code,intent_code,source_code,qualification_data,client_visible_notes,next_action_code)
  VALUES('AI-'||md5(event_key),customer_name,customer_contact,'booking',vehicle.city,vehicle_id,'AWAITING_PARTNER_CONFIRMATION',
    'car_rent','car_rent','conversation_hub',jsonb_build_object('start_date',starts,'end_date',ends,'total_amount',total,
      'currency',currency_code,'contact_id',client_id,'booking_idempotency_key',event_key,'offer_key',offer_key,
      'deposit_amount',0,'payment_status','unpaid','refundable_deposit',vehicle.deposit_thb),
    'Предварительная бронь. Оплата и документы ещё не подтверждены.','COLLECT_RENTAL_DOCUMENTS') RETURNING * INTO created;
  RETURN jsonb_build_object('id',created.id,'public_id',created.public_id,'status',created.operational_status,'reused',false);
END $function$
