const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateResult } = require('../src/native-model.js');
const { createEnricher } = require('../src/route-enrichment.js');
const { html } = require('../src/report-share.js');

test('missing BGP origin preserves independent GeoIP evidence through enrichment and sharing', async () => {
  const hop = {ttl:5,address:'59.43.246.117',asn:'',rttMs:699.75,avgMs:699.75,lossPercent:20,
    network:'中国电信',location:'中国 · 上海',whois:'CN2-BackBone',domain:'chinatelecom.com.cn',
    geoSource:'NextTrace / NextTrace-API',geoQueriedAt:'2026-10-23T05:06:42Z',geoStatus:'available'};
  const data = {kind:'route',state:'partial',hops:[hop],metadataObservation:{state:'ok',matchedIps:[hop.address],exitCode:0,stdout:'<unsafe>',hops:[hop]}};
  validateResult(data, 'route');
  const { enrich } = createEnricher({fetcher:async url=>({ok:true,text:async()=>JSON.stringify(url.includes('ripe.net')?{data:{asns:[]}}:{Status:3,Answer:[]})})});
  const result = await enrich(data);
  assert.equal(result.hops[0].asn,'');
  assert.equal(result.hops[0].asnStatus,'not-found');
  assert.equal(result.hops[0].geoSource,hop.geoSource);
  assert.equal(result.hops[0].location,hop.location);
  const round={module:'routes',plannedAt:hop.geoQueriedAt,state:'partial',counts:{completed:1,expected:1},
    slots:[{id:'x',source:{provider:'test'},direction:'VPS→大陆',state:'partial'}],measurements:[{slotId:'x',data:result}]};
  const page=html(round,Date.now()+1000,'/share.json');
  for(const text of ['中国电信','中国 · 上海','CN2-BackBone','chinatelecom.com.cn','NextTrace / NextTrace-API','独立 NextTrace'])assert.ok(page.includes(text),text);
  assert.ok(!page.includes('<unsafe>'));
  assert.ok(page.includes('&lt;unsafe&gt;'));
  assert.throws(()=>validateResult({...data,hops:[{...hop,geoSource:{bad:true}}]},'route'));
  assert.throws(()=>validateResult({...data,metadataObservation:{hops:[{...hop,location:{bad:true}}]}},'route'));
});
