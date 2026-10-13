-- Record managed reservation status changes atomically, without client/financial data.
CREATE OR REPLACE FUNCTION public.pcs_audit_reservation_status_projection() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $fn$
BEGIN
 IF NEW.source='neon_contract_projection' AND OLD.status IS DISTINCT FROM NEW.status THEN
  INSERT INTO public.pcs_audit_logs(actor,action,entity_type,entity_id,payload)
  VALUES('pcs-reservation-status','reservation_projection_status_changed','pcs_reservations',NEW.id::text,
   jsonb_build_object('previous_status',OLD.status,'status',NEW.status,'source',NEW.source));
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.pcs_audit_reservation_status_projection() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pcs_audit_reservation_status_projection() TO service_role;
CREATE OR REPLACE TRIGGER pcs_reservation_status_projection_audit AFTER UPDATE OF status ON public.pcs_reservations
FOR EACH ROW EXECUTE FUNCTION public.pcs_audit_reservation_status_projection();
