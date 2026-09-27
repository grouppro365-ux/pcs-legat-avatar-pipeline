import test from 'node:test';
import assert from 'node:assert/strict';
import {transferAmountLine} from './payment-amount.mjs';
const rub={payment_currency:'RUB',exchange_rate_from_thb:3};
test('RUB is three per THB, not reversed or added to the deposit',()=>{
  assert.match(transferAmountLine(1000,rub),/3\s000 RUB/);
  assert.match(transferAmountLine(2000,rub),/6\s000 RUB/);
  assert.match(transferAmountLine(660,rub),/1\s980 RUB/);
  assert.match(transferAmountLine(1000,rub),/не залог/);
});
test('unknown currency or missing rate fails closed',()=>{
  for(const r of [{payment_currency:'RUB'}, {...rub,exchange_rate_from_thb:0}, {...rub,payment_currency:'USD'}])
    assert.throws(()=>transferAmountLine(1000,r));
  assert.throws(()=>transferAmountLine(0,rub));
  assert.equal(transferAmountLine(1000,{payment_currency:'THB',exchange_rate_from_thb:1}),'К переводу: 1 000 THB.');
});
