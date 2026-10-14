-- Explicit vehicle rental dates reuse canonical application booking guards.
CREATE OR REPLACE FUNCTION pcs.vehicle_offer_booking(start_date text,end_date text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
DECLARE first_day date; last_day date;
BEGIN
 IF coalesce(start_date,'') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR coalesce(end_date,'') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'vehicle_offer_dates_invalid' USING ERRCODE='22023';END IF;
 BEGIN first_day:=start_date::date;last_day:=end_date::date;
 EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RAISE EXCEPTION 'vehicle_offer_dates_invalid' USING ERRCODE='22023';END;
 IF last_day<=first_day THEN RAISE EXCEPTION 'vehicle_offer_dates_invalid' USING ERRCODE='22023';END IF;
 RETURN jsonb_build_object('booking',jsonb_build_object('start_date',start_date,'end_date',end_date));
END $fn$;
REVOKE ALL ON FUNCTION pcs.vehicle_offer_booking(text,text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION pcs.bind_selected_vehicle_offer() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
DECLARE offer public.pcs_partner_offers%ROWTYPE; vehicle public.catalog_items%ROWTYPE; booking jsonb;
BEGIN
 IF TG_OP='UPDATE' AND OLD.accepted_offer_snapshot#>>'{availability_snapshot,booking,start_date}' IS NOT NULL AND NEW.selected_partner_offer_id IS DISTINCT FROM OLD.selected_partner_offer_id THEN RAISE EXCEPTION 'vehicle_offer_agreement_immutable' USING ERRCODE='23514';END IF;
 IF NEW.selected_partner_offer_id IS NULL THEN RETURN NEW;END IF;
 -- No backfill of historical agreements. Bind only on explicit selection.
 IF TG_OP='UPDATE' AND OLD.selected_partner_offer_id=NEW.selected_partner_offer_id THEN
  IF OLD.accepted_offer_snapshot#>>'{availability_snapshot,booking,start_date}' IS NOT NULL THEN
   IF NEW.category IS DISTINCT FROM OLD.category OR NEW.item_id IS DISTINCT FROM OLD.item_id OR
      NEW.accepted_offer_snapshot IS DISTINCT FROM OLD.accepted_offer_snapshot OR
      NEW.qualification_data->>'start_date' IS DISTINCT FROM OLD.qualification_data->>'start_date' OR
      NEW.qualification_data->>'end_date' IS DISTINCT FROM OLD.qualification_data->>'end_date' OR
      NEW.qualification_data->>'booking_quantity' IS DISTINCT FROM OLD.qualification_data->>'booking_quantity' OR
      NEW.qualification_data->>'resource_capacity_booking' IS DISTINCT FROM OLD.qualification_data->>'resource_capacity_booking' THEN
    RAISE EXCEPTION 'vehicle_offer_agreement_immutable' USING ERRCODE='23514';
   END IF;
  END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO offer FROM public.pcs_partner_offers WHERE id=NEW.selected_partner_offer_id AND application_id=NEW.id;
 IF NOT FOUND OR offer.catalog_item_id IS NULL THEN RETURN NEW;END IF;
 SELECT * INTO vehicle FROM public.catalog_items WHERE id=offer.catalog_item_id FOR UPDATE;
 IF vehicle.entity_type NOT IN ('VEHICLE','PROPERTY','SERVICE') THEN RETURN NEW;END IF;
 IF vehicle.entity_type IN ('PROPERTY','SERVICE') AND vehicle.booking_capacity IS NULL THEN RAISE EXCEPTION 'resource_capacity_unconfirmed' USING ERRCODE='23514';END IF;
 IF offer.status<>'ACCEPTED' OR vehicle.owner_partner_id IS DISTINCT FROM offer.partner_id OR vehicle.publication_status<>'PUBLISHED' OR vehicle.moderation_status<>'APPROVED' OR vehicle.availability_status<>'AVAILABLE' THEN RAISE EXCEPTION 'vehicle_offer_unavailable' USING ERRCODE='23514';END IF;
 booking:=pcs.vehicle_offer_booking(offer.availability_snapshot#>>'{booking,start_date}',offer.availability_snapshot#>>'{booking,end_date}')->'booking';
 IF NEW.accepted_offer_snapshot->>'offer_id' IS DISTINCT FROM offer.id::text OR NEW.accepted_offer_snapshot->>'catalog_item_id' IS DISTINCT FROM vehicle.id::text OR NEW.accepted_offer_snapshot#>'{availability_snapshot,booking}' IS DISTINCT FROM booking OR NEW.accepted_offer_snapshot#>>'{availability_snapshot,booking_quantity}' IS DISTINCT FROM offer.availability_snapshot->>'booking_quantity' THEN RAISE EXCEPTION 'vehicle_offer_snapshot_invalid' USING ERRCODE='23514';END IF;
 IF vehicle.entity_type='VEHICLE' THEN NEW.category:='booking';END IF;NEW.item_id:=vehicle.id;
 NEW.qualification_data:=coalesce(NEW.qualification_data,'{}'::jsonb)||booking||jsonb_build_object('booking_quantity',coalesce(offer.availability_snapshot->>'booking_quantity','1'));
 IF vehicle.entity_type IN ('PROPERTY','SERVICE') THEN NEW.qualification_data:=NEW.qualification_data||jsonb_build_object('resource_capacity_booking',true);END IF;
 IF coalesce(NEW.qualification_data->>'booking_quantity','') !~ '^[1-9][0-9]{0,4}$' OR vehicle.entity_type='VEHICLE' AND NEW.qualification_data->>'booking_quantity'<>'1' THEN RAISE EXCEPTION 'resource_booking_invalid' USING ERRCODE='22023';END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION pcs.bind_selected_vehicle_offer() FROM PUBLIC;
-- Runs before guard_vehicle_booking sets reserved_vehicle_id and checks dates.
CREATE OR REPLACE TRIGGER a_pcs_selected_vehicle_booking BEFORE INSERT OR UPDATE OF selected_partner_offer_id,item_id,category,qualification_data,accepted_offer_snapshot
ON public.applications FOR EACH ROW EXECUTE FUNCTION pcs.bind_selected_vehicle_offer();
