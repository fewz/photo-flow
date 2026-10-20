'use strict';

// MSYS2's MinGW Node reports shlib_suffix=dll.a, so napi-rs loads
// @scope/binding-win32-x64-gnu. Rolldown and oxc-parser only publish the
// MSVC package. The MSVC binary is what actually loads here.
// Rolldown 1.1.5's binary also fails to resolve Node-API symbols on this
// Node, so that copy reuses a newer binding of the same package when one exists.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'node_modules');
const mingwNode =
  process.platform === 'win32' &&
  process.config &&
  process.config.variables &&
  (process.config.variables.shlib_suffix === 'dll.a' ||
    process.config.variables.node_target_type === 'shared_library');

function findMsvcBindings(dir, found) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.name === 'binding-win32-x64-msvc') {
      found.push(fullPath);
      continue;
    }
    findMsvcBindings(fullPath, found);
  }
}

function readPackage(dir) {
  const packageJsonPath = path.join(dir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
}

function bindingLoads(dir) {
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      'const binding = require(process.argv[1]); process.exit(Object.keys(binding).length > 0 ? 0 : 2);',
      dir,
    ],
    { encoding: 'utf8', stdio: 'pipe' },
  );
  return result.status === 0;
}

function writeShim(msvcDir, targetDir) {
  const msvcPackage = readPackage(msvcDir);
  if (!msvcPackage || !msvcPackage.name || !msvcPackage.name.endsWith('win32-x64-msvc')) {
    return;
  }

  const gnuDir = path.join(path.dirname(msvcDir), 'binding-win32-x64-gnu');
  fs.mkdirSync(gnuDir, { recursive: true });
  fs.writeFileSync(
    path.join(gnuDir, 'package.json'),
    JSON.stringify(
      {
        name: msvcPackage.name.replace(/win32-x64-msvc$/, 'win32-x64-gnu'),
        version: msvcPackage.version,
        main: 'index.js',
        description: 'Local shim that loads the MSVC binding on MSYS2 Node.',
      },
      null,
      2,
    ) + '\n',
  );
  fs.writeFileSync(
    path.join(gnuDir, 'index.js'),
    `'use strict';\nmodule.exports = require(${JSON.stringify(targetDir)});\n`,
  );
}

if (!fs.existsSync(root)) {
  process.exit(0);
}

const bindings = [];
findMsvcBindings(root, bindings);

function isCachePath(dir) {
  return dir.split(path.sep).some((part) => part.startsWith('.vite'));
}

function versionParts(version) {
  return String(version || '0').split('.').map((part) => Number.parseInt(part, 10) || 0);
}

function isBetterBinding(current, next) {
  if (!current) {
    return true;
  }
  if (isCachePath(current.dir) !== isCachePath(next.dir)) {
    return isCachePath(current.dir);
  }
  const currentParts = versionParts(current.version);
  const nextParts = versionParts(next.version);
  const length = Math.max(currentParts.length, nextParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (nextParts[index] || 0) - (currentParts[index] || 0);
    if (difference !== 0) {
      return difference > 0;
    }
  }
  return false;
}

const workingByName = new Map();
if (mingwNode) {
  for (const binding of bindings) {
    const pkg = readPackage(binding);
    if (!pkg || !pkg.name || !bindingLoads(binding)) {
      continue;
    }
    const candidate = { dir: binding, version: pkg.version };
    if (isBetterBinding(workingByName.get(pkg.name), candidate)) {
      workingByName.set(pkg.name, candidate);
    }
  }
}

for (const binding of bindings) {
  const pkg = readPackage(binding);
  let target = binding;
  if (mingwNode && pkg && pkg.name && !bindingLoads(binding)) {
    const fallback = workingByName.get(pkg.name);
    if (fallback) {
      target = fallback.dir;
    }
  }
  writeShim(binding, target);
}
