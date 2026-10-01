package main

import (
	"fmt"
	jsruntime "github.com/komari-monitor/komari/pkg/jsruntime"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

type dnsTransport struct{}

func (dnsTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if strings.Contains(r.URL.Path, "network-info") {
		return response(r, `{"data":{"prefix":"8.8.8.0/24","asns":["15169"]}}`), nil
	}
	if strings.Contains(r.URL.Host, "routeviews") {
		return response(r, `[{"prefix":"8.8.8.0/24","reporting_peers":[{"collector":"route-views2","peer_addr":"1.1.1.1","peer_asn":3356,"as_path":"3356 15169","timestamp":"2026-09-30T00:00:00Z"}]}]`), nil
	}
	if strings.Contains(r.URL.Path, "bgp-state") {
		return response(r, `{"data":{"timestamp":"2026-09-30T00:00:00Z","bgp_state":[{"target_prefix":"8.8.8.0/24","source_id":"00-1.1.1.1","path":[3356,15169]}]}}`), nil
	}
	if strings.Contains(r.URL.Path, "rpki-validation") {
		return response(r, `{"data":{"status":"valid","validating_roas":[]}}`), nil
	}
	name := r.URL.Query().Get("name")
	data := `{"Status":0,"Answer":[{"type":16,"name":"` + name + `.","TTL":60,"data":"\"15169 | 8.8.8.0/24 | US | arin | 1992-12-01\""}]}`
	if strings.HasPrefix(name, "AS") {
		data = `{"Status":0,"Answer":[{"type":16,"name":"` + name + `.","TTL":60,"data":"\"15169 | US | arin | 2000-03-30 | GOOGLE - Google LLC, US\""}]}`
	}
	return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(data)), Request: r}, nil
}
func response(r *http.Request, data string) *http.Response {
	return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(data)), Request: r}
}
func checkNetwork(base string) {
	script := `async function run(){
  const m=require("./src/native-model.js");
  if(m.WEBSITE_CATALOG.length!==48)throw new Error("catalogue mismatch");
  const r=await require("./src/route-enrichment.js").createEnricher().enrich({kind:"route",state:"ok",hops:[{ttl:1,address:"8.8.8.8",asn:"",rttMs:1}]});
  if(r.hops[0].asn!=="15169"||r.hops[0].network.indexOf("GOOGLE")<0)throw new Error("ASN mismatch "+JSON.stringify(r));
  const bgp=await require("./src/bgp.js").createBgpCollector().collect("8.8.8.8");
  if(!bgp.prefix||bgp.paths.length!==2)throw new Error("BGP ABI mismatch "+JSON.stringify(bgp));
  const resource=require("./src/report-resources.js").normalizeResource({name:"test",city:"北京",address:"example.net",family:"4",method:"http",uses:["speed"],authorized:true,sourceUrl:"https://example.net/permission",conditions:"owned"});
  if(resource.method!=="http")throw new Error("resource ABI mismatch");
  if(require("./src/report-share.js").escape("<script>")!=="&lt;script&gt;")throw new Error("share escaping mismatch");
  console.log("Official Komari runtime: BGP/RPKI async dual provider, resource normalization and share HTML passed");
  console.log("Official Komari runtime: 48-target catalogue and asynchronous DoH enrichment passed");
  return true;
 }`
	rt, e := jsruntime.New(script, jsruntime.Options{BaseDir: base, NodeJS: true, Timeout: 10 * time.Second, Console: os.Stdout, HTTPClient: &http.Client{Transport: dnsTransport{}}})
	if e != nil {
		panic(e)
	}
	defer rt.Close()
	if e = rt.Call("run"); e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
}
