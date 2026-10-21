'use strict';

// `npm run android:live`: run the app on a USB-connected phone with live reload.
// Starts `ng serve` on this computer's LAN address, waits for it, then syncs, points the app's
// Capacitor config at the dev server, builds the debug APK and installs/opens it on the phone,
// so the phone loads the app from the dev server and reloads on every saved change.
//
//   npm run android:live                      pick the phone from the list
//   npm run android:live -- --target <id>     skip the prompt (id from `adb devices`)
//   LIVE_HOST=192.168.1.10 npm run android:live   force the address if the guess is wrong
//
// Stop with Ctrl+C. The app on the phone keeps pointing at the dev server until a normal
// build is installed again (npm run build, npx cap sync android, assembleDebug, adb install).

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const port = Number(process.env.LIVE_PORT || 4200);
const tools = path.join(root, '.tools');
const isWindows = process.platform === 'win32';

// Prefer the project's own Node (the MSYS Node cannot load the build's native bindings),
// JDK 21 and Android SDK when they exist under .tools/.
const env = { ...process.env };
const localNode = path.join(tools, 'node-v24.18.0-win-x64');
const node = fs.existsSync(path.join(localNode, isWindows ? 'node.exe' : 'node'))
  ? path.join(localNode, isWindows ? 'node.exe' : 'node')
  : process.execPath;
const extraPath = [];
if (node !== process.execPath) {
  extraPath.push(localNode);
}
const jdkRoot = path.join(tools, 'jdk');
if (!env.JAVA_HOME && fs.existsSync(jdkRoot)) {
  const jdk = fs.readdirSync(jdkRoot).find((name) => name.startsWith('jdk'));
  if (jdk) {
    env.JAVA_HOME = path.join(jdkRoot, jdk);
    extraPath.push(path.join(env.JAVA_HOME, 'bin'));
  }
}
const sdk = path.join(tools, 'android-sdk');
if (!env.ANDROID_HOME && fs.existsSync(sdk)) {
  env.ANDROID_HOME = sdk;
  extraPath.push(path.join(sdk, 'platform-tools'));
}
const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') || 'PATH';
env[pathKey] = [...extraPath, env[pathKey]].join(path.delimiter);

const host = process.env.LIVE_HOST || lanAddress();
if (!host) {
  console.error('Could not find a LAN address. Connect to Wi-Fi or set LIVE_HOST=<this computer IP>.');
  process.exit(1);
}

const children = [];
const stop = (code = 0) => {
  for (const child of children) {
    if (child.exitCode == null) {
      child.kill();
    }
  }
  process.exit(code);
};
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

console.log(`\nLive reload from http://${host}:${port} (the phone must be on the same network)\n`);

const ngCli = path.join(root, 'node_modules', '@angular', 'cli', 'bin', 'ng.js');
const serve = spawn(node, [ngCli, 'serve', '--host', '0.0.0.0', '--port', String(port)], {
  cwd: root,
  env,
  stdio: 'inherit',
});
children.push(serve);
serve.on('exit', (code) => {
  console.error(`\nDev server stopped (exit ${code}).`);
  stop(code ?? 1);
});

// `cap run --live-reload` shells out to `./gradlew`, which cmd.exe cannot run, so do its steps here.
waitForServer(`http://127.0.0.1:${port}/`, 180_000)
  .then(async () => {
    const target = targetArg(process.argv.slice(2));
    const adb = path.join(env.ANDROID_HOME || '', 'platform-tools', isWindows ? 'adb.exe' : 'adb');
    const adbArgs = target ? ['-s', target] : [];
    const capCli = path.join(root, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor');

    await run('Sync web assets', node, [capCli, 'sync', 'android'], root);
    pointAtDevServer(`http://${host}:${port}`);
    // Full path: cmd.exe may be set not to look in the current folder (NoDefaultCurrentDirectoryInExePath).
    const androidDir = path.join(root, 'android');
    const gradle = isWindows
      ? ['cmd', ['/c', path.join(androidDir, 'gradlew.bat'), 'assembleDebug']]
      : [path.join(androidDir, 'gradlew'), ['assembleDebug']];
    await run('Build debug APK', gradle[0], gradle[1], androidDir);
    const apk = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
    await run('Install on the phone', adb, [...adbArgs, 'install', '-r', apk], root);
    await run('Open PhotoFlow', adb, [...adbArgs, 'shell', 'monkey', '-p', 'app.photoflow', '-c', 'android.intent.category.LAUNCHER', '1'], root, true);
    console.log('\nApp is running on the phone. Edit files to reload; Ctrl+C to stop.');
    console.log('Afterwards, install a normal build again (npm run build, npx cap sync android, assembleDebug).\n');
  })
  .catch((error) => {
    console.error(`\n${error.message}`);
    if (/install/i.test(error.message)) {
      console.error('Is the phone connected and authorized? Check: adb devices (use -- --target <id> with several devices)');
    }
    stop(1);
  });

function targetArg(args) {
  const index = args.indexOf('--target');
  return index >= 0 ? args[index + 1] : process.env.LIVE_TARGET;
}

/** What `cap run --live-reload` does: make the installed app load from the dev server. */
function pointAtDevServer(url) {
  const file = path.join(root, 'android', 'app', 'src', 'main', 'assets', 'capacitor.config.json');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  config.server = { ...(config.server || {}), url, cleartext: true };
  fs.writeFileSync(file, `${JSON.stringify(config, null, '\t')}\n`);
  console.log(`\n> App will load from ${url}`);
}

function run(label, command, args, cwd, quiet = false) {
  console.log(`\n> ${label}`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: quiet ? 'ignore' : 'inherit' });
    children.push(child);
    child.on('error', (error) => reject(new Error(`${label} failed: ${error.message}`)));
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${label} failed (exit ${code}).`))));
  });
}

function lanAddress() {
  const candidates = [];
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family !== 'IPv4' || address.internal) {
        continue;
      }
      // Skip VPN / virtual adapters (Tailscale 100.x, WSL, Hyper-V, VirtualBox, Docker).
      if (/vEthernet|VirtualBox|VMware|WSL|Docker|Tailscale|Loopback/i.test(name) || address.address.startsWith('100.')) {
        continue;
      }
      const privateLan = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address.address);
      candidates.push({ address: address.address, score: privateLan ? (/wi-?fi|wlan/i.test(name) ? 2 : 1) : 0 });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.address;
}

function waitForServer(url, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      http
        .get(url, (response) => {
          response.resume();
          resolve();
        })
        .on('error', () => {
          if (Date.now() - started > timeoutMs) {
            reject(new Error(`Dev server did not start on port ${port}.`));
            return;
          }
          setTimeout(attempt, 1000);
        });
    };
    attempt();
  });
}
