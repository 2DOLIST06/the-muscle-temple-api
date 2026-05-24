import path from 'node:path';
import { buildConfig } from 'payload';
import { fileURLToPath } from 'node:url';
import { Posts } from './collections/posts.js';
import { Categories } from './collections/categories.js';
import { Authors } from './collections/authors.js';

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

export default buildConfig({
  secret: process.env.PAYLOAD_SECRET || 'change-me-in-production',
  // NOTE: Payload v3 requires a DB adapter in config (`db`).
  // In this environment, installing `@payloadcms/db-postgres` is blocked (npm 403),
  // so we keep a typed placeholder to make the backend status explicit.
  // Replace with:
  // db: postgresAdapter({ pool: { connectionString: process.env.DATABASE_URL } })
  // once package installation is allowed.
  db: {} as any,
  collections: [Posts, Categories, Authors],
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts')
  }
});
