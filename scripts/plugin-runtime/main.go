package main

import (
	"fmt"
	jsruntime "github.com/komari-monitor/komari/pkg/jsruntime"
	"os"
	"path/filepath"
	"runtime/debug"
	"strings"
	"time"
)

func main() {
	if info, ok := debug.ReadBuildInfo(); ok {
		for _, dep := range info.Deps {
			if dep.Path == "github.com/komari-monitor/komari" {
				fmt.Println("Testing official Komari runtime", dep.Version)
			}
		}
	}
	base, err := filepath.Abs(os.Args[1])
	if err != nil {
		panic(err)
	}
	checkNetwork(base)
	checkRounds(base)
	checkController(base)
	entry, err := os.ReadFile(filepath.Join(base, "script.js"))
	if err != nil {
		panic(err)
	}
	source := string(entry)
	helper := source[strings.Index(source, "function isMissingFile("):strings.Index(source, "function readState(")]
	storage, err := os.MkdirTemp("", "aster-archive-go143-")
	if err != nil {
		panic(err)
	}
	defer os.RemoveAll(storage)
	storage, err = filepath.EvalSymlinks(storage)
	if err != nil {
		panic(err)
	}
	script := `const fs=require("fs"), path=require("path");` + helper + `
 function run() {
   const a=require("./src/native-archive.js").archive(__storageDir__,isMissingFile);
   const uuid="c388e74d-a922-4ae1-bd10-1fb30e2e53de";
   a.append({id:"test-first-report",nodeUuid:uuid,completedAt:new Date().toISOString(),fingerprint:"website-google",operation:"website",target:"www.google.com",source:{provider:"runner"},direction:"VPS→网站",data:{kind:"website",state:"ok",timingsMs:{ttfb:12}}});
   const h=a.history(uuid);
   if(h.records.length!==1 || h.summaries.length!==1 || h.summaries[0].samples!==1) throw new Error("archive mismatch");
   console.log("Official Komari runtime: first report and summary saved successfully");
   return true;
 }
 `
	runtime, err := jsruntime.New(script, jsruntime.Options{BaseDir: base, StorageDir: storage, NodeJS: true, Timeout: 10 * time.Second, Console: os.Stdout})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer runtime.Close()
	if err = runtime.Call("run"); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
