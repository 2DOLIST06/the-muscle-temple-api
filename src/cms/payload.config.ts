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
  collections: [Posts, Categories, Authors],
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts')
  }
});
