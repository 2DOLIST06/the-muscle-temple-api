import { spawnSync } from 'node:child_process';

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  return result.status ?? 1;
}

const migrateStatus = run('prisma', ['migrate', 'deploy']);

if (migrateStatus === 0) {
  process.exit(0);
}

console.warn('\n[prisma-deploy] prisma migrate deploy failed.');
console.warn('[prisma-deploy] Trying prisma db push as fallback (existing non-empty schema / baseline case).\n');

const pushStatus = run('prisma', ['db', 'push']);
process.exit(pushStatus);
