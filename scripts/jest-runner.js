// scripts/jest-runner.js
const fs = require('fs');
const path = require('path');

const pkgPath = path.join(__dirname, '..', 'package.json');
const original = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const hadType = Object.prototype.hasOwnProperty.call(original, 'type');
const originalType = original.type;
original.type = 'module';
fs.writeFileSync(pkgPath, JSON.stringify(original, null, 2), 'utf8');

const { spawn } = require('child_process');
const jestBin = path.join(__dirname, '..', 'node_modules', 'jest', 'bin', 'jest.js');

// Pass command-line arguments to Jest
const args = process.argv.slice(2);

const child = spawn(process.execPath, ['--experimental-vm-modules', jestBin, ...args], {
  stdio: 'inherit',
});

child.on('exit', (code) => {
  const restored = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (hadType) {
    restored.type = originalType;
  } else {
    delete restored.type;
  }
  fs.writeFileSync(pkgPath, JSON.stringify(restored, null, 2), 'utf8');
  process.exit(code);
});