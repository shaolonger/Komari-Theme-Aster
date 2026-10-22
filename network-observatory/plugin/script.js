const server = require("server");
const fs = require("fs");
const path = require("path");
const { readAdminPrincipal } = require("./src/model.js");
const storageDir = __storageDir__;
const statePath = path.join(storageDir, "state.json");
function isMissingFile(error, file) {
  if (error?.code === "ENOENT") return true;
  // Komari 1.4.3 exposes a Go PathError. Its Err serializes as 2 in logs,
  // but is an object in JavaScript, so strict numeric comparison does not work.
  const pathError = error?.value;
  if (pathError?.Path !== file || !["lstat", "open"].includes(pathError?.Op))
    return false;
  try {
    // Unlike readFileSync, Komari's accessSync gives missing files a Node-style code.
    fs.accessSync(file);
  } catch (probeError) {
    return probeError?.code === "ENOENT";
  }
  return false;
}

function readState() {
  try {
    const s = JSON.parse(fs.readFileSync(statePath, "utf8"));
    if (!s || typeof s.nodes !== "object" || !s.nodes)
      throw new Error("探测器凭证状态格式无效");
    return { nodes: s.nodes };
  } catch (e) {
    if (isMissingFile(e, statePath)) return { nodes: {} };
    throw e;
  }
}
function writeState(state) {
  fs.mkdirSync(storageDir, { recursive: true });
  fs.writeFileSync(statePath + ".tmp", JSON.stringify({ nodes: state.nodes }), {
    mode: 0o600,
  });
  fs.renameSync(statePath + ".tmp", statePath);
}
function respond(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}
function authorized(req, res) {
  if (readAdminPrincipal(req.context?.principal)) return true;
  respond(res, req.context?.principal?.type === "anonymous" ? 401 : 403, {
    error: "管理员身份必需",
  });
  return false;
}
function readBody(req) {
  if (!req.body || req.body.length > 131072)
    throw new Error("请求内容为空或超过 128 KiB");
  return JSON.parse(req.body);
}
function load() {
  const worker = require("./src/native-controller.js").registerNativeController(
    {
      server,
      storageDir,
      isMissingFile,
      respond,
      authorized,
      readBody,
      readState,
      writeState,
    },
  );
  server.cron("* * * * *", () => {
    void worker.tick();
  });
}
