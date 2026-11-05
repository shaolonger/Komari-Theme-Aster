const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createReportAssets,reportToken,safeSvg}=require('../src/report-assets.js');
test('report images accept only canonical stored TcpQuality report URLs',()=>{
  assert.equal(reportToken('https://tcpquality.ibsgss.uk/r/example'),'example');
  for(const url of ['http://tcpquality.ibsgss.uk/r/example','https://evil.test/r/a','https://tcpquality.ibsgss.uk@evil.test/r/a','https://tcpquality.ibsgss.uk/r/a?url=evil'])assert.equal(reportToken(url),'');
});
test('vector exports retain artwork while removing navigation and rejecting active content',()=>{
  assert.equal(safeSvg('<svg xmlns="http://www.w3.org/2000/svg"><text><a href="https://example.com">label</a></text></svg>'),'<svg xmlns="http://www.w3.org/2000/svg"><text><g>label</g></text></svg>');
  for(const svg of ['<svg><script>alert(1)</script></svg>','<svg onload="a()"></svg>','<svg><image href="file:///etc/passwd"/></svg>','<svg><foreignObject/></svg>','<svg><style>x{fill:url(https://evil)}</style></svg>'])assert.throws(()=>safeSvg(svg));
});
test('only fixed official section URLs are fetched, with redirects forbidden',async()=>{
  const calls=[];
  const client=createReportAssets({fetcher:async(url,options)=>{
    calls.push({url,options});
    return {ok:true,text:async()=>url.endsWith('/example')?'const reportSections = [{"id":"ipv4","label":"IPv4"},{"id":"intl","label":"国际"}];':'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="200"><text>Actual</text></svg>'};
  }});
  const result=await client.collect('https://tcpquality.ibsgss.uk/r/example');
  assert.equal(result.pages.length,2);assert.match(result.pages[1].svg,/Actual/);
  assert.deepEqual(calls.map(call=>call.url),['https://tcpquality.ibsgss.uk/r/example','https://tcpquality.ibsgss.uk/r/example.svg?section=ipv4','https://tcpquality.ibsgss.uk/r/example.svg?section=intl']);
  assert(calls.every(call=>call.options.redirect==='error'));
});
test('upstream absence or malformed sections fail without fabricating images',async()=>{
  for(const payload of ['not a report','const reportSections = [{"id":"../private"}];']){
    const client=createReportAssets({fetcher:async()=>({ok:true,text:async()=>payload})});
    await assert.rejects(()=>client.collect('https://tcpquality.ibsgss.uk/r/example'));
  }
});
test('NodeQuality requests the same public signed archive as its report page',async()=>{
 const crypto=require('node:crypto'),calls=[];
 const client=createReportAssets({fetcher:async(url,options)=>{
  calls.push({url,options});
  return {ok:true,text:async()=>JSON.stringify(url.endsWith('/ipinfo')?{ip:'192.0.2.1',ts:1793836800000}:{success:true,data:{result:'UEsDBA=='}})};
 }});
 assert.equal(reportToken('https://www.nodequality.com/r/node','nodequality-full'),'node');
 assert.equal(reportToken('https://nodequality.com.evil/r/node','nodequality-full'),'');
 assert.deepEqual(await client.collect('https://nodequality.com/r/node','nodequality-full'),{nodeArchive:'UEsDBA=='});
 assert.deepEqual(calls.map(c=>c.url),['https://api.nodequality.com/api/v1/ipinfo','https://api.nodequality.com/api/v1/record/node']);
 const headers=calls[1].options.headers;
 const expected=crypto.createHash('sha1').update(['GET',calls[1].url,headers['user-agent'],'192.0.2.1'+'1793836800000',''].join('\n\n')).digest('hex');
 assert.equal(headers['x-dynamic-sign-v'],expected);assert(calls.every(c=>c.options.redirect==='error'));
});
test('NodeQuality missing or blocked upstream never substitutes local JSON as an original report',async()=>{
 const client=createReportAssets({fetcher:async()=>({ok:false,status:403})});
 await assert.rejects(()=>client.collect('https://nodequality.com/r/node','nodequality-full'),/HTTP 403/);
});
