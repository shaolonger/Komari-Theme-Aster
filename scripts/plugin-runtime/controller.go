package main

import (
	jsruntime "github.com/komari-monitor/komari/pkg/jsruntime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func checkController(base string) {
	entry, err := os.ReadFile(filepath.Join(base, "script.js"))
	if err != nil {
		panic(err)
	}
	source := string(entry)
	helper := source[strings.Index(source, "function isMissingFile("):strings.Index(source, "function readState(")]
	scenario, err := os.ReadFile(filepath.Join(base, "tests/go143-controller-scenario.js"))
	if err != nil {
		panic(err)
	}
	storage, err := os.MkdirTemp("", "aster-controller-runtime-")
	if err != nil {
		panic(err)
	}
	defer os.RemoveAll(storage)
	storage, err = filepath.EvalSymlinks(storage)
	if err != nil {
		panic(err)
	}
	runtime, err := jsruntime.New(`const fs=require("fs");`+helper+string(scenario), jsruntime.Options{BaseDir: base, StorageDir: storage, NodeJS: true, Timeout: 30 * time.Second, Console: os.Stdout, HTTPClient: &http.Client{Transport: dnsTransport{}}})
	if err != nil {
		panic(err)
	}
	defer runtime.Close()
	if err = runtime.Call("runControllerScenario"); err != nil {
		panic(err)
	}
}
