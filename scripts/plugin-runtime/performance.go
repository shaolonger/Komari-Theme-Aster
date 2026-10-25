package main

import (
	"os"
	"path/filepath"
	"strings"
	"time"

	jsruntime "github.com/komari-monitor/komari/pkg/jsruntime"
)

func checkPollingPerformance(base string) {
	checkPerformanceScenario(base, "go143-polling-performance.js", "runPollingPerformance")
}

func checkNativeMaintenancePerformance(base string) {
	checkPerformanceScenario(base, "go143-native-maintenance-performance.js", "runNativeMaintenancePerformance")
}

func checkStorePerformance(base string) {
	checkPerformanceScenario(base, "go143-store-performance.js", "runStorePerformance")
}

func checkDispatchPerformance(base string) {
	checkPerformanceScenario(base, "go143-dispatch-performance.js", "runDispatchPerformance")
}

func checkQueueStatePerformance(base string) {
	checkPerformanceScenario(base, "go143-queue-state-performance.js", "runQueueStatePerformance")
}

func checkPerformanceScenario(base, filename, entrypoint string) {
	entry, err := os.ReadFile(filepath.Join(base, "script.js"))
	if err != nil {
		panic(err)
	}
	source := string(entry)
	helper := source[strings.Index(source, "function isMissingFile("):strings.Index(source, "function readState(")]
	scenario, err := os.ReadFile(filepath.Join(base, "tests", filename))
	if err != nil {
		panic(err)
	}
	storage, err := os.MkdirTemp("", "aster-polling-runtime-")
	if err != nil {
		panic(err)
	}
	defer os.RemoveAll(storage)
	storage, err = filepath.EvalSymlinks(storage)
	if err != nil {
		panic(err)
	}
	runtime, err := jsruntime.New(`const fs=require("fs");`+helper+string(scenario), jsruntime.Options{
		BaseDir: base, StorageDir: storage, NodeJS: true, Timeout: 120 * time.Second, Console: os.Stdout,
	})
	if err != nil {
		panic(err)
	}
	defer runtime.Close()
	if err = runtime.Call(entrypoint); err != nil {
		panic(err)
	}
}
