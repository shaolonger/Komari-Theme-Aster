# Network observatory implementation audit

This release implements the three user requirements: measured mainland ↔ VPS
paths, measured mainland ↔ VPS throughput, and VPS → international websites,
with schedules and native reports inside the instance page. This checklist is
the completion contract, not a claim that public measurement infrastructure is
owned by this project.

## Measurement requirements

- [x] Native website measurements: DNS, connect, TLS, TTFB, HTTP status,
      resolved IP, IPv4/IPv6, error stage; 401/403 are application responses.
- [x] Native route measurements: 32-hop traces, protocol and source provenance,
      observed ASN data, incomplete paths, optional MTR endpoint statistics.
- [x] Mainland → VPS traces using filtered Globalping CN/ASN probes, with quotas,
      persisted asynchronous jobs, unavailable coverage and source metadata.
- [x] Registered controlled mainland workers, separate revocable credentials,
      one-command deployment, city/carrier/access-type/public-address metadata.
- [x] Paired traces for reachable controlled endpoints; show asymmetric or
      partial evidence, never infer a reverse trace from RTT or SYN responses.
- [x] Controlled iperf3 server sessions on the VPS and a mainland client;
      mainland → VPS and VPS → mainland, single/multiple streams, uncapped TCP,
      serialized jobs, expiring listener, measured bytes and receiver rates.
- [x] Public iperf and TcpQuality retained as explicitly identified references.

## Configuration and reports

- [x] Three native instance categories: mainland routes, mainland speed, websites.
- [x] Presets, single-node and bulk/group inheritance, low manual input,
      source/coverage preview, and immediate execution.
- [x] Interval or multiple daily times in an IANA timezone, next-run preview,
      migration of old fixed-offset plans without silently changing timing.
- [x] Native metrics, trends, paired paths, website stages and coverage matrix;
      full diagnostics available and native report export.
- [x] Structured per-day storage and 90-day summaries; bounded raw diagnostics,
      migration/read access for old reports, retention visible to administrators.
- [x] Setup and upgrade documentation describes actual resources, directions,
      traffic, NAT limitations, and the distinction between observed vs inferred.

## Verification and release

- [x] Meaningful unit/integration tests for API auth, schedules, provider polling,
      quotas, controlled two-worker sessions, failure recovery and retention.
- [x] Linux executions of native website and route checks plus a real local
      two-ended iperf3 test; provider contract verified against official schemas.
- [x] Browser verification of instance categories, bulk plans, source setup,
      reports, narrow screens and keyboard operation.
- [x] Full repository release gates and official Komari/agent compatibility gate.
Publication requires matching theme/plugin/runner versions, ZIP/checksum auditing,
commit/push, a new tag and Release via gh, successful CI, and a download audit.
These publication checks are recorded in the Release and its Actions run.

Runtime architecture: retain the legacy v1 API and schedules, add a v2 native
monitoring controller and structured archive in the plugin. Updated workers poll
native work before legacy work; old workers continue legacy schedules. Native
jobs identify the monitored VPS separately from the executing worker. Mainland
workers connect outbound to the panel and VPS; reverse traceroute requires a
reachable declared public endpoint and is marked partial when unavailable.


Evidence: theme 1.6.0 / plugin and runner 1.5.0. Node controller/provider/archive
integration tests and Python measurements/installer/coexisting-role tests pass.
Repository release gates include 370 frontend tests, types, lint, performance,
bundle/static-route contracts and browser scale gates; the native UI tests cover
403 status, timing stages, daily IANA preview/save, credentials, bulk range,
390px viewport and Escape. Linux Ubuntu 24.04 used actual curl, NextTrace 1.7.3,
20-cycle MTR and two container endpoints with authenticated iperf3: unauthenticated
access rejected, both directions for 1/4 streams measured, timer-only cleanup
verified. This lab tests execution, not mainland link capacity. Globalping's live
CN/AS4134 test returned Guangzhou/Chinanet Backbone/datacenter metadata and 20
incomplete hops, which remain incomplete. The provider adapter was corrected
against real API behavior: no ipVersion for IP targets, 422 no coverage, 429
backoff, a bounded 8MiB directory read with only CN entries persisted.

Practical limits: owned/authorized mainland nodes and VPS firewall configuration
are required for stable uncapped speed tests. Public sources are dynamic,
independent samples and cannot supply iperf3 or be treated as paired reverse
paths. Nine named IANA zones use bundled 2020–2040 transitions. Detailed storage
keeps seven days; the UI reads the latest 200 detailed rows with 90-day summaries.
Old fixed-offset/tool records remain readable without changing their timing or
pretending they are native measurements.
