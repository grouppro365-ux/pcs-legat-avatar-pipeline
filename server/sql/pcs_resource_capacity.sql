-- Opt-in, explicit capacity for dated property/service bookings in the existing CRM.
ALTER TABLE public.catalog_items ADD COLUMN IF NOT EXISTS booking_capacity integer CHECK(booking_capacity BETWEEN 1 AND 99999);
CREATE OR REPLACE FUNCTION pcs.assert_resource_capacity(resource uuid,capacity integer) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
BEGIN
 IF capacity IS NULL THEN RETURN;END IF;
 IF EXISTS(SELECT 1 FROM public.availability_periods WHERE item_id=resource AND (starts_at IS NULL OR ends_at IS NULL OR NOT isfinite(starts_at) OR NOT isfinite(ends_at) OR ends_at<=starts_at OR status NOT IN ('AVAILABLE','UNAVAILABLE','BOOKED','BLOCKED','HOLD','HELD') OR quantity<0)) THEN RAISE EXCEPTION 'resource_calendar_invalid' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM public.applications WHERE item_id=resource AND (category='booking' OR qualification_data->>'resource_capacity_booking'='true') AND operational_status IN ('AWAITING_PARTNER_CONFIRMATION','CONFIRMED','SERVICE_IN_PROGRESS') AND
 (pcs.booking_range(qualification_data) IS NULL OR coalesce(qualification_data->>'booking_quantity','1') !~ '^[1-9][0-9]{0,4}$')) THEN RAISE EXCEPTION 'resource_booking_invalid' USING ERRCODE='22023';END IF;
 IF EXISTS(WITH bookings AS (
  SELECT lower(pcs.booking_range(qualification_data))::timestamp AT TIME ZONE 'Asia/Bangkok' a,upper(pcs.booking_range(qualification_data))::timestamp AT TIME ZONE 'Asia/Bangkok' b,coalesce(qualification_data->>'booking_quantity','1')::integer qty
  FROM public.applications WHERE item_id=resource AND (category='booking' OR qualification_data->>'resource_capacity_booking'='true') AND operational_status IN ('AWAITING_PARTNER_CONFIRMATION','CONFIRMED','SERVICE_IN_PROGRESS')
 ),points AS (SELECT a t FROM bookings UNION SELECT b FROM bookings UNION SELECT starts_at FROM public.availability_periods WHERE item_id=resource UNION SELECT ends_at FROM public.availability_periods WHERE item_id=resource),segments AS(SELECT t,lead(t) OVER(ORDER BY t) finish FROM points)
 SELECT 1 FROM segments s CROSS JOIN LATERAL(SELECT coalesce(sum(qty),0) used FROM bookings WHERE a<=s.t AND b>s.t) demand
 WHERE s.finish>s.t AND demand.used>0 AND (demand.used>capacity OR EXISTS(
  SELECT 1 FROM public.availability_periods p WHERE item_id=resource AND starts_at<=s.t AND ends_at>s.t AND
  (status IN ('UNAVAILABLE','BOOKED','BLOCKED') OR (status IN ('HOLD','HELD') AND (hold_until IS NULL OR hold_until>clock_timestamp())) OR (status='AVAILABLE' AND quantity IS NOT NULL AND quantity<demand.used))))) THEN RAISE EXCEPTION 'resource_capacity_conflict' USING ERRCODE='23P01';END IF;
END $fn$;
REVOKE ALL ON FUNCTION pcs.assert_resource_capacity(uuid,integer) FROM PUBLIC;
CREATE OR REPLACE FUNCTION pcs.guard_resource_capacity() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
DECLARE resource uuid; cap integer; kind text;
BEGIN
 IF TG_TABLE_NAME='applications' THEN
  resource:=NEW.item_id;
 ELSIF TG_TABLE_NAME='availability_periods' THEN
  IF TG_OP='DELETE' THEN resource:=OLD.item_id;ELSE resource:=NEW.item_id;END IF;
 ELSE resource:=NEW.id;END IF;
 PERFORM id FROM public.catalog_items WHERE id=resource FOR UPDATE;
 SELECT entity_type,booking_capacity INTO kind,cap FROM public.catalog_items WHERE id=resource;
 IF TG_TABLE_NAME='catalog_items' THEN
  kind:=NEW.entity_type;cap:=NEW.booking_capacity;
  IF TG_OP='UPDATE' AND OLD.booking_capacity IS NOT NULL AND (NEW.booking_capacity IS NULL OR NEW.entity_type IS DISTINCT FROM OLD.entity_type) AND EXISTS(SELECT 1 FROM public.applications WHERE item_id=resource AND (category='booking' OR qualification_data->>'resource_capacity_booking'='true') AND operational_status IN ('AWAITING_PARTNER_CONFIRMATION','CONFIRMED','SERVICE_IN_PROGRESS')) THEN RAISE EXCEPTION 'resource_capacity_in_use' USING ERRCODE='23514';END IF;
  IF cap IS NOT NULL AND kind NOT IN ('PROPERTY','SERVICE') THEN RAISE EXCEPTION 'resource_capacity_type_invalid' USING ERRCODE='22023';END IF;
 END IF;
 IF kind NOT IN ('PROPERTY','SERVICE') OR cap IS NULL THEN IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;END IF;
 IF TG_TABLE_NAME='availability_periods' AND TG_OP<>'DELETE' THEN
  IF NEW.starts_at IS NULL OR NEW.ends_at IS NULL OR NOT isfinite(NEW.starts_at) OR NOT isfinite(NEW.ends_at) OR NEW.ends_at<=NEW.starts_at OR NEW.status NOT IN ('AVAILABLE','UNAVAILABLE','BOOKED','BLOCKED','HOLD','HELD') OR NEW.quantity<0 THEN RAISE EXCEPTION 'resource_calendar_invalid' USING ERRCODE='22023';END IF;
 END IF;
 IF TG_WHEN='AFTER' THEN
  IF TG_TABLE_NAME='applications' THEN
   IF (NEW.category='booking' OR NEW.qualification_data->>'resource_capacity_booking'='true') AND NEW.operational_status IN ('AWAITING_PARTNER_CONFIRMATION','CONFIRMED','SERVICE_IN_PROGRESS') THEN PERFORM pcs.assert_resource_capacity(resource,cap);END IF;
  ELSE PERFORM pcs.assert_resource_capacity(resource,cap);END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
END $fn$;
REVOKE ALL ON FUNCTION pcs.guard_resource_capacity() FROM PUBLIC;
CREATE OR REPLACE TRIGGER pcs_resource_booking_lock BEFORE INSERT OR UPDATE OF item_id,category,qualification_data,operational_status ON public.applications FOR EACH ROW EXECUTE FUNCTION pcs.guard_resource_capacity();
CREATE OR REPLACE TRIGGER pcs_resource_booking_check AFTER INSERT OR UPDATE OF item_id,category,qualification_data,operational_status ON public.applications FOR EACH ROW EXECUTE FUNCTION pcs.guard_resource_capacity();
CREATE OR REPLACE TRIGGER pcs_resource_calendar_lock BEFORE INSERT OR UPDATE OR DELETE ON public.availability_periods FOR EACH ROW EXECUTE FUNCTION pcs.guard_resource_capacity();
CREATE OR REPLACE TRIGGER pcs_resource_calendar_check AFTER INSERT OR UPDATE OR DELETE ON public.availability_periods FOR EACH ROW EXECUTE FUNCTION pcs.guard_resource_capacity();
CREATE OR REPLACE TRIGGER pcs_resource_catalog_guard BEFORE INSERT OR UPDATE OF booking_capacity,entity_type ON public.catalog_items FOR EACH ROW EXECUTE FUNCTION pcs.guard_resource_capacity();
CREATE OR REPLACE TRIGGER pcs_resource_catalog_check AFTER INSERT OR UPDATE OF booking_capacity,entity_type ON public.catalog_items FOR EACH ROW EXECUTE FUNCTION pcs.guard_resource_capacity();

CREATE INDEX IF NOT EXISTS applications_resource_capacity_idx ON public.applications(item_id) WHERE (category='booking' OR qualification_data->>'resource_capacity_booking'='true') AND operational_status IN ('AWAITING_PARTNER_CONFIRMATION','CONFIRMED','SERVICE_IN_PROGRESS');
CREATE INDEX IF NOT EXISTS availability_resource_period_idx ON public.availability_periods(item_id,starts_at,ends_at);
