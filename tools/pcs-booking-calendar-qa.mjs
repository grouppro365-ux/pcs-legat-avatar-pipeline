import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
console.log(JSON.stringify({sql:'DO $outer$ BEGIN BEGIN EXECUTE $migration$'+read('server/sql/pcs_vehicle_booking_calendar.sql')+'$migration$; '+read('tests/booking-calendar-rollback.sql')+" RAISE EXCEPTION 'QA rollback complete' USING ERRCODE='Z0001'; EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL; END; END $outer$"}));
