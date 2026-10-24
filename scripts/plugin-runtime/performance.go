package main

import (
	"os"
	"path/filepath"
	"strings"
	"time"

	jsruntime "github.com/komari-monitor/komari/pkg/jsruntime"
)

func checkPollingPerformance(base string) {
	entry, err := os.ReadFile(filepath.Join(base, "script.js"))
	if err != nil {
		panic(err)
	}
	source := string(entry)
	helper := source[strings.Index(source, "function isMissingFile("):strings.Index(source, "function readState(")]
	scenario, err := os.ReadFile(filepath.Join(base, "tests/go143-polling-performance.js"))
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
	if err = runtime.Call("runPollingPerformance"); err != nil {
		panic(err)
	}
}
