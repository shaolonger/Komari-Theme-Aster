const fs = require("fs"), path = require("path");

// The plugin is the single writer. Cache the parsed state, check the file stamp
// on reads (including credential revocation), and forget it on failed writes or
// failed transactions. Never serialize a multi-megabyte queue for an idle read.
function jsonState(file, isMissingFile, blank, validate = value => value) {
  let cached, stamp;
  const fingerprint = () => {
    const stat = fs.statSync(file);
    return [stat.size, stat.mtimeMs, stat.ctimeMs, stat.ino].join(":");
  };
  function invalidate() { cached = undefined; stamp = undefined; }
  function read() {
    try {
      const current = fingerprint();
      if (cached !== undefined && current === stamp) return cached;
      const value = validate(JSON.parse(fs.readFileSync(file, "utf8")));
      cached = value; stamp = current;
      return value;
    } catch (error) {
      invalidate();
      if (isMissingFile(error, file)) return blank();
      throw error;
    }
  }
  function write(value) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file + ".tmp", JSON.stringify(value), { mode: 0o600 });
      fs.renameSync(file + ".tmp", file);
      stamp = fingerprint(); cached = value;
    } catch (error) {
      invalidate(); throw error;
    }
  }
  return { read, write, invalidate };
}
module.exports = { jsonState };
