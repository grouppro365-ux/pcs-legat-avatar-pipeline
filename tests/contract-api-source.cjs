const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../server/supabase/pcs-contract-api/index.ts'), 'utf8');
assert.match(source, /deposit:m\.security_deposit_thb==null\?null:Number\(m\.security_deposit_thb\)/);
assert.doesNotMatch(source, /deposit:Number\(r\.deposit_amount/);
assert.match(source, /registration_no:m\.registration_no\|\|m\.reg_no\|\|m\.plate/);
assert.match(source, /\['renter\.license_no','Водительские права'\]/);
console.log('Contract snapshot source checks passed');
