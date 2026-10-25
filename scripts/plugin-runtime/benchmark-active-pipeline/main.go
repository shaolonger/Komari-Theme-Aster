// Optional offline benchmark. Run from the parent plugin-runtime Go module.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/require"
	jsruntime "github.com/komari-monitor/komari/pkg/jsruntime"
)

type counters struct {
	Writes, WriteBytes, Reads, ReadBytes, Renames, Unlinks int64
}

var categories = []string{"nativeMetadata", "nativeQueue", "manifest", "index", "receipt", "measurement", "activeRoundPointer", "homeRouteProjection", "homeSpeedProjection", "retentionBookkeeping", "other"}

type meter struct {
	storage            string
	active             bool
	started            time.Time
	before             syscall.Rusage
	wall, user, system float64
	io                 map[string]*counters
	report             json.RawMessage
}

func category(name string) string {
	name = filepath.ToSlash(name)
	switch {
	case strings.Contains(name, "/native-queue/"):
		return "nativeQueue"
	case strings.HasSuffix(name, "/native-state.json.tmp") || strings.HasSuffix(name, "/native-state.json"):
		return "nativeMetadata"
	case strings.Contains(name, "/receipts/"):
		return "receipt"
	case strings.Contains(name, "/home-routes/"):
		return "homeRouteProjection"
	case strings.Contains(name, "/home-speeds/"):
		return "homeSpeedProjection"
	case strings.HasSuffix(name, "/manifest.json.tmp") || strings.HasSuffix(name, "/manifest.json"):
		return "manifest"
	case strings.Contains(name, "/measurements/"):
		return "measurement"
	case strings.Contains(name, "/indexes/"):
		return "index"
	case strings.HasSuffix(name, "/active.json.tmp") || strings.HasSuffix(name, "/active.json"):
		return "activeRoundPointer"
	case strings.HasSuffix(name, "/retention.json.tmp") || strings.HasSuffix(name, "/retention.json") || strings.HasSuffix(name, "/maintenance.json.tmp") || strings.HasSuffix(name, "/maintenance.json"):
		return "retentionBookkeeping"
	default:
		return "other"
	}
}

func (m *meter) note(operation, name string) {
	if !m.active {
		return
	}
	relative, err := filepath.Rel(m.storage, name)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return
	}
	key := category(name)
	row := m.io[key]
	if row == nil {
		row = &counters{}
		m.io[key] = row
	}
	switch operation {
	case "write", "read":
		// Stat measures exact UTF-8 file payload bytes without copying every
		// multi-megabyte JSON string a second time merely for accounting.
		info, err := os.Stat(name)
		if err != nil {
			panic(err)
		}
		if operation == "write" {
			row.Writes++
			row.WriteBytes += info.Size()
		} else {
			row.Reads++
			row.ReadBytes += info.Size()
		}
	case "rename":
		row.Renames++
	case "unlink":
		row.Unlinks++
	default:
		panic("unknown benchmark I/O operation")
	}
}

func seconds(value syscall.Timeval) float64 { return float64(value.Sec) + float64(value.Usec)/1e6 }

func (m *meter) register(registry *require.Registry) {
	registry.RegisterNativeModule("aster-benchmark-meter", func(vm *goja.Runtime, module *goja.Object) {
		exports := module.Get("exports").(*goja.Object)
		exports.Set("start", func() {
			runtime.GC() // Discard fixture-construction garbage before measuring.
			m.io = make(map[string]*counters)
			for _, key := range categories {
				m.io[key] = &counters{}
			}
			syscall.Getrusage(syscall.RUSAGE_SELF, &m.before)
			m.started = time.Now()
			m.active = true
		})
		exports.Set("stop", func() {
			var after syscall.Rusage
			m.active = false
			m.wall = time.Since(m.started).Seconds()
			syscall.Getrusage(syscall.RUSAGE_SELF, &after)
			m.user = seconds(after.Utime) - seconds(m.before.Utime)
			m.system = seconds(after.Stime) - seconds(m.before.Stime)
		})
		exports.Set("note", m.note)
		exports.Set("report", func(raw string) {
			if !json.Valid([]byte(raw)) {
				panic("invalid benchmark report")
			}
			m.report = json.RawMessage(raw)
		})
	})
}

type rejectNetwork struct{ attempts atomic.Int64 }

func (r *rejectNetwork) RoundTrip(_ *http.Request) (*http.Response, error) {
	r.attempts.Add(1)
	return nil, errors.New("offline benchmark forbids network")
}

func sourceFingerprints(base string) map[string]string {
	output := map[string]string{}
	for _, name := range []string{"native-controller.js", "report-controller.js", "round-store.js", "home-routes.js", "native-queue-state.js", "retention-store.js"} {
		data, err := os.ReadFile(filepath.Join(base, "src", name))
		if os.IsNotExist(err) {
			output[name] = "absent"
			continue
		}
		if err != nil {
			panic(err)
		}
		hash := sha256.Sum256(data)
		output[name] = hex.EncodeToString(hash[:])
	}
	return output
}

func main() {
	baseFlag := flag.String("plugin", "", "required local plugin directory")
	scenarioFlag := flag.String("scenario", "", "required shared benchmark-active-pipeline.js scenario")
	label := flag.String("label", "candidate", "label for this benchmark variant")
	processors := flag.Int("gomaxprocs", 1, "Go CPU concurrency (default: 1)")
	budgets := flag.Bool("enforce-budgets", false, "enforce current-release complete-pipeline work budgets")
	flag.Parse()
	if *baseFlag == "" || *scenarioFlag == "" || *processors < 1 {
		panic("--plugin, --scenario and positive --gomaxprocs are required")
	}
	runtime.GOMAXPROCS(*processors)
	base, err := filepath.Abs(*baseFlag)
	if err != nil {
		panic(err)
	}
	sources := sourceFingerprints(base)
	entry, err := os.ReadFile(filepath.Join(base, "script.js"))
	if err != nil {
		panic(err)
	}
	source := string(entry)
	start, end := strings.Index(source, "function isMissingFile("), strings.Index(source, "function readState(")
	if start < 0 || end <= start {
		panic("plugin missing the audited filesystem helper")
	}
	scenario, err := os.ReadFile(*scenarioFlag)
	if err != nil {
		panic(err)
	}
	storage, err := os.MkdirTemp("", "aster-real-pipeline-")
	if err != nil {
		panic(err)
	}
	defer os.RemoveAll(storage)
	storage, err = filepath.EvalSymlinks(storage)
	if err != nil {
		panic(err)
	}
	measurement := &meter{storage: storage}
	transport := &rejectNetwork{}
	_, queueError := os.Stat(filepath.Join(base, "src", "native-queue-state.js"))
	if queueError != nil && !os.IsNotExist(queueError) {
		panic(queueError)
	}
	prefix := fmt.Sprintf("const fs=require('fs');const __benchmarkShardedQueue__=%t;", queueError == nil)
	engine, err := jsruntime.New(prefix+source[start:end]+string(scenario), jsruntime.Options{
		BaseDir: base, StorageDir: storage, NodeJS: true, Timeout: 5 * time.Minute, Console: os.Stderr,
		ConfigureRequire: measurement.register, HTTPClient: &http.Client{Transport: transport, Timeout: time.Second},
	})
	if err != nil {
		panic(err)
	}
	defer engine.Close()
	if err = engine.Call("runFullActivePipelineBenchmark"); err != nil {
		panic(err)
	}
	if measurement.active || len(measurement.report) == 0 || transport.attempts.Load() != 0 {
		panic("incomplete or non-offline benchmark")
	}
	version := "unknown"
	if info, ok := debug.ReadBuildInfo(); ok {
		for _, dependency := range info.Deps {
			if dependency.Path == "github.com/komari-monitor/komari" {
				version = dependency.Version
			}
		}
	}
	for name, digest := range sourceFingerprints(base) {
		if digest != sources[name] {
			panic("plugin source changed during benchmark: " + name)
		}
	}
	scenarioHash := sha256.Sum256(scenario)
	total := counters{}
	for _, row := range measurement.io {
		total.Writes += row.Writes
		total.WriteBytes += row.WriteBytes
		total.Reads += row.Reads
		total.ReadBytes += row.ReadBytes
		total.Renames += row.Renames
		total.Unlinks += row.Unlinks
	}
	if *budgets && (total.WriteBytes > 64*1024*1024 || measurement.io["manifest"].ReadBytes > 64*1024 || measurement.io["index"].Writes > 800 || measurement.wall > 30) {
		panic(fmt.Sprintf("complete pipeline exceeded its 750-task budget: writes=%d, manifest reads=%d, index writes=%d, wall=%.3fs", total.WriteBytes, measurement.io["manifest"].ReadBytes, measurement.io["index"].Writes, measurement.wall))
	}
	output := map[string]any{"label": *label, "plugin": base, "runtime": version, "platform": runtime.GOOS + "/" + runtime.GOARCH, "gomaxprocs": *processors,
		"phase": map[string]float64{"wallMs": measurement.wall * 1000, "userCpuMs": measurement.user * 1000, "systemCpuMs": measurement.system * 1000, "totalCpuMs": (measurement.user + measurement.system) * 1000},
		"io":    measurement.io, "totalIo": total, "scenario": measurement.report, "sourceSha256": sources, "scenarioSha256": hex.EncodeToString(scenarioHash[:]), "httpTransportAttempts": transport.attempts.Load(),
		"accounting": "successful logical file payload bytes; one extra stat per measured read/write; prep, startup GC and verification excluded"}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(output); err != nil {
		panic(err)
	}
}
