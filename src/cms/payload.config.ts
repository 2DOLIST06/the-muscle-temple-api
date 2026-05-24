import path from 'node:path';
import { createRequire } from 'node:module';
import { buildConfig } from 'payload';
import { fileURLToPath } from 'node:url';
import { Posts } from './collections/posts.js';
import { Categories } from './collections/categories.js';
import { Authors } from './collections/authors.js';

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);
const require = createRequire(import.meta.url);

const getDbAdapter = () => {
  try {
    const { postgresAdapter } = require('@payloadcms/db-postgres') as {
      postgresAdapter: (args: { pool: { connectionString: string } }) => unknown;
    };

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('Missing DATABASE_URL for Payload Postgres adapter.');
    }

    return postgresAdapter({
      pool: { connectionString }
    });
  } catch (error) {
    throw new Error(
      'Payload Postgres adapter not available. Install "@payloadcms/db-postgres" and set DATABASE_URL. ' +
        `Original error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

export default buildConfig({
  secret: process.env.PAYLOAD_SECRET || 'change-me-in-production',
  db: getDbAdapter() as any,
  collections: [Posts, Categories, Authors],
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts')
  }
});
