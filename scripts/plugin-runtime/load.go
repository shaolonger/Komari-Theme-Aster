package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/require"
	"github.com/gin-gonic/gin"
	jsruntime "github.com/komari-monitor/komari/pkg/jsruntime"
)

// Komari keeps Gin slots across unloads and reuses an exact method/path on
// reload (internal/plugin/server.go). A Map-only server mock misses wildcard
// conflicts between a prior installation and the new plugin's complete load().
type retainedRoutes struct {
	engine *gin.Engine
	slots  map[string]bool
}

func (r *retainedRoutes) register(method, path string) (err error) {
	key := method + " " + path
	if r.slots[key] {
		return nil
	}
	defer func() {
		if problem := recover(); problem != nil {
			err = fmt.Errorf("register route %s %s: %v", method, path, problem)
		}
	}()
	r.engine.Handle(method, path, func(c *gin.Context) { c.Status(http.StatusNoContent) })
	r.slots[key] = true
	return nil
}

func checkPluginLoad(base string) {
	gin.SetMode(gin.TestMode)
	entry, err := os.ReadFile(filepath.Join(base, "script.js"))
	if err != nil {
		panic(err)
	}
	for _, scenario := range []string{"clean", "upgrade-from-1.8", "upgrade-from-clean-1.9"} {
		routes := &retainedRoutes{engine: gin.New(), slots: map[string]bool{}}
		if scenario != "clean" {
			param := ":uuid"
			if scenario == "upgrade-from-clean-1.9" {
				param = ":id"
			}
			for _, action := range []string{"verify", "heartbeat"} {
				if err := routes.register("POST", "/api/aster-network-observatory/v1/nodes/"+param+"/"+action); err != nil {
					panic(err)
				}
			}
			// The old v2 report prefix also remains when new credential routes load.
			if err := routes.register("GET", "/api/aster-network-observatory/v2/nodes/:uuid/reports"); err != nil {
				panic(err)
			}
		}
		storage, err := os.MkdirTemp("", "aster-load-runtime-")
		if err != nil {
			panic(err)
		}
		storage, err = filepath.EvalSymlinks(storage)
		if err != nil {
			panic(err)
		}
		for reload := 0; reload < 3; reload++ {
			rt, err := jsruntime.New(string(entry)+`
function runLoadRegression() { load(); return true; }
function runBodyRegression() {
  const body = JSON.stringify({id:"x",data:{kind:"tcpquality-full",state:"ok",cleanLog:"测".repeat(140000)}});
  if (readBody({url:"/api/aster-network-observatory/v2/workers/node/c388e74d-a922-4ae1-bd10-1fb30e2e53de/result",body}).data.cleanLog.length !== 140000) throw Error("large worker result rejected");
  try { readBody({url:"/api/aster-network-observatory/v3/suites",body}); throw Error("admin body limit bypassed"); } catch (e) { if (String(e).includes("bypassed")) throw e; }
}`, jsruntime.Options{
				BaseDir: base, StorageDir: storage, NodeJS: true, Timeout: 10 * time.Second, Console: os.Stdout,
				ConfigureRequire: func(registry *require.Registry) {
					registry.RegisterNativeModule("server", func(vm *goja.Runtime, module *goja.Object) {
						exports := vm.NewObject()
						_ = exports.Set("route", func(call goja.FunctionCall) goja.Value {
							method, path := strings.ToUpper(call.Argument(0).String()), call.Argument(1).String()
							if _, ok := goja.AssertFunction(call.Argument(2)); !ok {
								panic(vm.NewTypeError("route handler required"))
							}
							if err := routes.register(method, path); err != nil {
								panic(vm.NewGoError(err))
							}
							return goja.Undefined()
						})
						_ = exports.Set("call", func() []any { return []any{} })
						_ = exports.Set("cron", func(call goja.FunctionCall) goja.Value {
							if call.Argument(0).String() != "* * * * *" {
								panic(vm.NewTypeError("unexpected cron"))
							}
							if _, ok := goja.AssertFunction(call.Argument(1)); !ok {
								panic(vm.NewTypeError("cron callback required"))
							}
							return goja.Undefined()
						})
						_ = module.Set("exports", exports)
					})
				},
			})
			if err != nil {
				panic(err)
			}
			err = rt.Call("runLoadRegression")
			rt.Close()
			if err != nil {
				panic(fmt.Errorf("full load %s reload %d: %w", scenario, reload, err))
			}
			// A failed alternative wildcard registration must leave Gin's retained
			// tree usable, as well as allowing the rest of load() to complete.
			for _, action := range []string{"verify", "heartbeat"} {
				rec := httptest.NewRecorder()
				routes.engine.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/aster-network-observatory/v1/nodes/c388e74d-a922-4ae1-bd10-1fb30e2e53de/"+action, nil))
				if rec.Code != http.StatusNoContent {
					panic(fmt.Errorf("retained Gin tree stopped matching %s: %d", action, rec.Code))
				}
			}

			// Verify registration reached the final v3 routes, beyond the old crash.
			if !routes.slots["GET /api/aster-network-observatory/v3/capabilities"] || !routes.slots["POST /api/aster-network-observatory/v2/workers/node/:id/heartbeat"] {
				panic("plugin registration stopped early")
			}
		}
		if err := os.RemoveAll(storage); err != nil {
			panic(err)
		}
		fmt.Println("Official Komari runtime + Gin: full load and repeated reload passed:", scenario)
	}
}
