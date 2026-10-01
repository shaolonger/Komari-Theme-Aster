package main

import (
	jsruntime "github.com/komari-monitor/komari/pkg/jsruntime"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func checkRounds(base string) {
	entry, e := os.ReadFile(filepath.Join(base, "script.js"))
	if e != nil {
		panic(e)
	}
	source := string(entry)
	helper := source[strings.Index(source, "function isMissingFile("):strings.Index(source, "function readState(")]
	scenario, e := os.ReadFile(filepath.Join(base, "tests/go143-round-scenario.js"))
	if e != nil {
		panic(e)
	}
	storage, e := os.MkdirTemp("", "aster-round-go143-")
	if e != nil {
		panic(e)
	}
	defer os.RemoveAll(storage)
	storage, e = filepath.EvalSymlinks(storage)
	if e != nil {
		panic(e)
	}
	rt, e := jsruntime.New(`const fs=require("fs");`+helper+string(scenario), jsruntime.Options{BaseDir: base, StorageDir: storage, NodeJS: true, Timeout: 30 * time.Second, Console: os.Stdout})
	if e != nil {
		panic(e)
	}
	defer rt.Close()
	if e = rt.Call("runRoundScenario"); e != nil {
		panic(e)
	}
}
