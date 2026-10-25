package main

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime/debug"
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
	if os.Getenv("ASTER_NATIVE_MAINTENANCE_ONLY") == "1" {
		checkNativeMaintenancePerformance(base)
		return
	}
	if os.Getenv("ASTER_STORE_PERFORMANCE_ONLY") == "1" {
		checkStorePerformance(base)
		return
	}
	if os.Getenv("ASTER_DISPATCH_PERFORMANCE_ONLY") == "1" {
		checkDispatchPerformance(base)
		return
	}
	if os.Getenv("ASTER_QUEUE_STATE_PERFORMANCE_ONLY") == "1" {
		checkQueueStatePerformance(base)
		return
	}
	if os.Getenv("ASTER_POLLING_ONLY") == "1" {
		checkPollingPerformance(base)
		return
	}
	checkPluginLoad(base)
	checkNetwork(base)
	checkRounds(base)
	checkController(base)
	checkPollingPerformance(base)
	checkNativeMaintenancePerformance(base)
	checkStorePerformance(base)
	checkDispatchPerformance(base)
	checkQueueStatePerformance(base)
}
