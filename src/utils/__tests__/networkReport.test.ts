import { describe, expect, it } from 'vitest';
import { cleanNetworkOutput, parseNetworkReport } from '../networkReport';
import { installCommand, quoteShell } from '@/components/network/shared';

describe('network report interpretation', () => {
  it('separates HTTPS timing phases without labelling cumulative TTFB as a phase', () => {
    const report = parseNetworkReport({ mode: 'https', rawOutput: 'status=200 dns_seconds=0.010 connect_seconds=0.032 tls_seconds=0.081 ttfb_seconds=0.201' });
    expect(report.measurements).toEqual([
      { label: 'HTTP 状态', value: 200, unit: '' },
      { label: 'DNS', value: 10, unit: 'ms' },
      { label: 'TCP 建连', value: 22, unit: 'ms' },
      { label: 'TLS 握手', value: 49, unit: 'ms' },
      { label: '首字节累计', value: 201, unit: 'ms' },
    ]);
  });
  it('uses receiver upload rate and leaves unknown tool text readable', () => {
    const upload = parseNetworkReport({ mode: 'throughput', rawOutput: JSON.stringify({ end: { sum_received: { bits_per_second: 20_000_000 }, sum_sent: { retransmits: 2, bytes: 25_000_000, seconds: 10 } } }) });
    expect(upload.measurements.find((row) => row.label === '上传吞吐（接收端）')?.value).toBe(20);
    expect(upload.measurements.find((row) => row.label === 'TCP 重传')?.value).toBe(2);
    expect(parseNetworkReport({ mode: 'tcpquality-route', rawOutput: 'new upstream format' }).measurements).toEqual([]);
    expect(cleanNetworkOutput('\u001b[31mfailed\u001b[0m')).toBe('failed');
  });
  it('reports uncapped upload and download separately without changing legacy throughput', () => {
    const report = parseNetworkReport({ mode: 'speedtest', rawOutput: JSON.stringify({ schema: 'aster-speedtest-v1', streams: 4, upload: { bitsPerSecond: 900_000_000, bytes: 1_125_000_000, retransmits: 3 }, download: { bitsPerSecond: 810_000_000, bytes: 1_012_500_000 } }) });
    expect(report.measurements.find((row) => row.label === '上传速度')?.value).toBe(900);
    expect(report.measurements.find((row) => row.label === '下载速度')?.value).toBe(810);
    expect(report.note).toContain('不限速');
  });
  it('escapes installation arguments without embedding the secret', () => {
    expect(quoteShell("host'other")).toBe("'host'\"'\"'other'");
    const command = installCommand('id-123', 'https://host.example.net');
    expect(command).toContain("--server-url 'https://host.example.net' --node-uuid 'id-123'");
    expect(command).not.toContain('--token');
  });
});
