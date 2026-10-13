-- Reuse the existing VEHICLE exclusion constraint and its catalog row lock.
-- Protect reservations against manual calendar blocks in either write order.
CREATE OR REPLACE FUNCTION pcs.guard_vehicle_booking_availability() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
DECLARE vehicle boolean; period daterange;
BEGIN
 IF NEW.category<>'booking' OR NEW.item_id IS NULL OR NEW.operational_status NOT IN ('AWAITING_PARTNER_CONFIRMATION','CONFIRMED','SERVICE_IN_PROGRESS') THEN RETURN NEW;END IF;
 SELECT entity_type='VEHICLE' INTO vehicle FROM public.catalog_items WHERE id=NEW.item_id FOR UPDATE;
 IF vehicle IS NOT TRUE THEN RETURN NEW;END IF;
 period:=pcs.booking_range(NEW.qualification_data);
 IF period IS NULL THEN RAISE EXCEPTION 'booking_dates_invalid' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM public.availability_periods p WHERE p.item_id=NEW.item_id
 AND p.starts_at<(upper(period)::timestamp AT TIME ZONE 'Asia/Bangkok') AND p.ends_at>(lower(period)::timestamp AT TIME ZONE 'Asia/Bangkok')
 AND (p.status IN ('UNAVAILABLE','BOOKED','BLOCKED') OR (p.status='AVAILABLE' AND p.quantity=0) OR (p.status IN ('HOLD','HELD') AND (p.hold_until IS NULL OR p.hold_until>clock_timestamp())))) THEN
  RAISE EXCEPTION 'vehicle_availability_conflict' USING ERRCODE='23P01';
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION pcs.guard_vehicle_booking_availability() FROM PUBLIC;
CREATE OR REPLACE FUNCTION pcs.guard_vehicle_calendar_block() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
DECLARE vehicle boolean; old_item uuid;
BEGIN
 IF TG_OP='UPDATE' THEN old_item:=OLD.item_id;END IF;
 PERFORM id FROM public.catalog_items WHERE id IN (NEW.item_id,old_item) ORDER BY id FOR UPDATE;
 SELECT entity_type='VEHICLE' INTO vehicle FROM public.catalog_items WHERE id=NEW.item_id;
 IF vehicle IS NOT TRUE THEN RETURN NEW;END IF;
 IF NOT isfinite(NEW.starts_at) OR NOT isfinite(NEW.ends_at) OR NEW.ends_at<=NEW.starts_at THEN RAISE EXCEPTION 'vehicle_availability_range_invalid' USING ERRCODE='22023';END IF;
 IF NEW.status NOT IN ('AVAILABLE','UNAVAILABLE','BOOKED','BLOCKED','HOLD','HELD') THEN RAISE EXCEPTION 'vehicle_availability_status_invalid' USING ERRCODE='22023';END IF;
 IF NEW.quantity IS NOT NULL AND NEW.quantity NOT IN (0,1) THEN RAISE EXCEPTION 'vehicle_availability_quantity_invalid' USING ERRCODE='22023';END IF;
 IF (NEW.status IN ('UNAVAILABLE','BOOKED','BLOCKED') OR (NEW.status='AVAILABLE' AND NEW.quantity=0) OR (NEW.status IN ('HOLD','HELD') AND (NEW.hold_until IS NULL OR NEW.hold_until>clock_timestamp()))) IS NOT TRUE THEN RETURN NEW;END IF;
 IF EXISTS(SELECT 1 FROM public.applications a WHERE a.item_id=NEW.item_id AND a.category='booking'
 AND a.operational_status IN ('AWAITING_PARTNER_CONFIRMATION','CONFIRMED','SERVICE_IN_PROGRESS')
 AND (lower(pcs.booking_range(a.qualification_data))::timestamp AT TIME ZONE 'Asia/Bangkok')<NEW.ends_at
 AND (upper(pcs.booking_range(a.qualification_data))::timestamp AT TIME ZONE 'Asia/Bangkok')>NEW.starts_at) THEN
  RAISE EXCEPTION 'vehicle_availability_conflict' USING ERRCODE='23P01';
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION pcs.guard_vehicle_calendar_block() FROM PUBLIC;
CREATE OR REPLACE TRIGGER pcs_vehicle_booking_availability BEFORE INSERT OR UPDATE OF item_id,category,operational_status,qualification_data
ON public.applications FOR EACH ROW EXECUTE FUNCTION pcs.guard_vehicle_booking_availability();
CREATE OR REPLACE TRIGGER pcs_vehicle_calendar_block BEFORE INSERT OR UPDATE OF item_id,starts_at,ends_at,status,quantity,hold_until
ON public.availability_periods FOR EACH ROW EXECUTE FUNCTION pcs.guard_vehicle_calendar_block();
