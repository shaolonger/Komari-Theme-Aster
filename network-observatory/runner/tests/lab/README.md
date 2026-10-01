# Linux measurement laboratory

From the repository root:

```sh
docker build -t aster-native-lab network-observatory/runner/tests/lab
docker run --rm -v "$PWD/network-observatory/runner:/runner:ro" aster-native-lab python3 /runner/tests/lab_report.py
```

The script validates authenticated iperf3 P1/P4 in both directions, receiver intervals, sender TCP statistics and HTTPS upload/download with a locally trusted laboratory certificate. It pins loopback only through explicit in-process test patches; production public-address and certificate verification remain enabled. A wrong Host/SNI must fail. The speeds are loopback laboratory values and do not establish mainland or international network coverage.

For real local MTR JSON acquisition (Docker needs raw-network capabilities):

```sh
docker run --rm --cap-add NET_RAW -v "$PWD/network-observatory/runner:/runner:ro" aster-native-lab python3 -c 'import native; r=native.mtr_route("127.0.0.1", {"family":"4", "protocol":"icmp", "packets":20}); print(r); assert r["hops"] and r["hops"][0]["sent"] == 20'
```

Run API and installer regressions with `npm run test:network-observatory`; run the actual official Komari 1.4.3 and 1.5.1 JavaScript runtimes with `npm run test:plugin-runtime` (Go 1.25+). The runtime checks use mocked HTTP provider responses; they verify the runtime ABI, not public API uptime.
