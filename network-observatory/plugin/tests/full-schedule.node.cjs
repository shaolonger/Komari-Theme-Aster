const { test } = require('node:test');
const assert = require('node:assert/strict');
const { timing, next } = require('../src/native-model.js');
const timestamp = value => Date.parse(value);
const days = (days, date, time, timezone = 'Asia/Shanghai') => ({type:'every-days',days,startDate:date,time,timezone});

test('multi-rule schedules keep independent interval anchors and deduplicate coincidences', () => {
 const base = timestamp('2026-10-28T00:00:00Z');
 const schedule = timing({type:'rules',rules:[{type:'interval',minutes:120,anchor:base},days(2,'2026-10-28','09:00')]},'nodequality-full');
 assert.equal(next(schedule,base), timestamp('2026-10-28T01:00:00Z'));
 assert.equal(next(schedule,timestamp('2026-10-28T01:00:00Z')), timestamp('2026-10-28T02:00:00Z'));
 assert.equal(next(schedule,timestamp('2026-10-28T02:00:00Z')), timestamp('2026-10-28T04:00:00Z'));
 const collision=timing({type:'rules',rules:[{type:'interval',minutes:60,anchor:base},{type:'daily',times:['09:00'],timezone:'Asia/Shanghai'}]},'tcpquality-full');
 assert.equal(next(collision,base),timestamp('2026-10-28T01:00:00Z'));
 assert.equal(next(collision,timestamp('2026-10-28T01:00:00Z')),timestamp('2026-10-28T02:00:00Z'));
});

test('N-day calendar schedule uses its start date and timezone', () => {
 const schedule=timing({type:'rules',rules:[days(3,'2026-10-28','21:30')]},'tcpquality-full');
 assert.equal(next(schedule,timestamp('2026-10-27T00:00:00Z')),timestamp('2026-10-28T13:30:00Z'));
 assert.equal(next(schedule,timestamp('2026-10-28T13:30:00Z')),timestamp('2026-10-31T13:30:00Z'));
 assert.equal(next(schedule,timestamp('2026-11-01T00:00:00Z')),timestamp('2026-11-03T13:30:00Z'));
});

test('N-day schedule handles spring DST gaps and autumn repeated times', () => {
 const spring=timing({type:'rules',rules:[days(1,'2026-03-06','02:30','America/Los_Angeles')]},'tcpquality-full');
 assert.equal(next(spring,timestamp('2026-03-08T08:00:00Z')),timestamp('2026-03-09T09:30:00Z'));
 const fall=timing({type:'rules',rules:[days(1,'2026-10-31','01:30','America/Los_Angeles')]},'nodequality-full');
 assert.equal(next(fall,timestamp('2026-11-01T07:00:00Z')),timestamp('2026-11-01T08:30:00Z'));
 assert.equal(next(fall,timestamp('2026-11-01T08:30:00Z')),timestamp('2026-11-01T09:30:00Z'));
});

test('invalid rules are rejected and legacy schedules stay compatible', () => {
 assert.deepEqual(timing({type:'daily',times:['03:00'],timezone:'UTC'},'tcpquality-full'),{type:'daily',times:['03:00'],timezone:'UTC'});
 assert.deepEqual(timing({type:'interval',minutes:120},'tcpquality-full'),{type:'interval',minutes:120});
 for(const rule of [days(0,'2026-10-28','09:00'),days(366,'2026-10-28','09:00'),days(3,'2026-02-30','09:00'),days(3,'2026-10-28','25:00'),{type:'interval',minutes:30}])
  assert.throws(()=>timing({type:'rules',rules:[rule]},'nodequality-full'));
 assert.throws(()=>timing({type:'rules',rules:[]},'tcpquality-full'));
 assert.throws(()=>timing({type:'rules',rules:[days(2,'2026-10-28','09:00')]},'routes'));
 assert.throws(()=>timing({type:'rules',rules:[{type:'rules',rules:[]}]},'tcpquality-full'));
});

test('weekly schedules support multiple weekdays and DST', () => {
 const schedule=timing({type:'rules',rules:[{type:'weekly',weekdays:[5,1,1],time:'21:00',timezone:'Asia/Shanghai'}]},'nodequality-full');
 assert.deepEqual(schedule.rules[0].weekdays,[1,5]);
 assert.equal(next(schedule,timestamp('2026-10-28T00:00:00Z')),timestamp('2026-10-30T13:00:00Z'));
 assert.equal(next(schedule,timestamp('2026-10-30T13:00:00Z')),timestamp('2026-11-02T13:00:00Z'));
 const gap=timing({type:'rules',rules:[{type:'weekly',weekdays:[7],time:'02:30',timezone:'America/Los_Angeles'}]},'nodequality-full');
 assert.equal(next(gap,timestamp('2026-03-08T08:00:00Z')),timestamp('2026-03-15T09:30:00Z'));
 assert.throws(()=>timing({type:'rules',rules:[{type:'weekly',weekdays:[],time:'21:00',timezone:'UTC'}]},'tcpquality-full'));
});

test('optimized daily scheduling matches the original minute scan across zones and DST', () => {
 const {offset}=require('../src/native-model.js');
 for(const zone of ['UTC','Asia/Shanghai','America/Los_Angeles','Europe/London','America/New_York']) {
  for(const date of ['2026-03-08T08:00:45Z','2026-11-01T08:30:00Z','2026-07-15T15:50:10Z']) {
   const now=timestamp(date), plan=timing({type:'daily',times:['01:30','02:30','21:00'],timezone:zone},'routes');
   let expected;
   for(let at=Math.floor(now/60000)*60000+60000;at<now+49*3600000;at+=60000) {
    const d=new Date(at+offset(zone,at)*60000), clock=String(d.getUTCHours()).padStart(2,'0')+':'+String(d.getUTCMinutes()).padStart(2,'0');
    if(plan.times.includes(clock)){expected=at;break;}
   }
   assert.equal(next(plan,now),expected,zone+' '+date);
  }
 }
});
