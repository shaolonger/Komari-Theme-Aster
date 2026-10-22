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
	checkNetwork(base)
	checkRounds(base)
	checkController(base)
}
