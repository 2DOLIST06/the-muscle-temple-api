import type { CollectionConfig } from 'payload';
import { lexicalEditor } from '@payloadcms/richtext-lexical';

export const Posts: CollectionConfig = {
  slug: 'posts',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'status', 'publishedAt', 'updatedAt']
  },
  access: {
    read: () => true
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, unique: true },
    { name: 'excerpt', type: 'textarea' },
    {
      name: 'content',
      type: 'richText',
      editor: lexicalEditor()
    },
    {
      name: 'status',
      type: 'select',
      options: ['draft', 'published'],
      defaultValue: 'draft',
      required: true
    },
    { name: 'publishedAt', type: 'date' }
  ],
  timestamps: true
};
