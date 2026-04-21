import bcrypt from 'bcryptjs';
import { PrismaClient, PostStatus, UserRole, SeoEntityType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@muscletemple.com';
  const adminPassword = process.env.ADMIN_PASSWORD ?? 'ChangeMeStrongPassword123!';
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { passwordHash, role: UserRole.ADMIN, displayName: 'Admin' },
    create: { email: adminEmail, passwordHash, role: UserRole.ADMIN, displayName: 'Admin' }
  });

  const media = await prisma.media.create({
    data: { url: 'https://images.unsplash.com/photo-1517836357463-d25dfeac3438', altText: 'Athlete training' }
  });

  const author = await prisma.author.upsert({
    where: { slug: 'coach-alex' },
    update: {},
    create: { name: 'Coach Alex', slug: 'coach-alex', bio: 'Coach et expert nutrition.', avatarMediaId: media.id }
  });

  const category = await prisma.category.upsert({
    where: { slug: 'entrainement' },
    update: {},
    create: { name: 'Entraînement', slug: 'entrainement', description: 'Conseils d’entraînement efficaces.' }
  });

  const tag = await prisma.tag.upsert({
    where: { slug: 'hypertrophie' },
    update: {},
    create: { name: 'Hypertrophie', slug: 'hypertrophie' }
  });

  const post = await prisma.post.upsert({
    where: { slug: 'programme-prise-de-masse-4-jours' },
    update: {},
    create: {
      title: 'Programme prise de masse sur 4 jours',
      slug: 'programme-prise-de-masse-4-jours',
      excerpt: 'Un plan structuré pour progresser durablement.',
      contentMarkdown: '# Programme prise de masse\n\nContenu initial pour démarrer le blog.',
      status: PostStatus.PUBLISHED,
      publishedAt: new Date(),
      readingTimeMinutes: 7,
      authorId: author.id,
      categoryId: category.id,
      coverImageId: media.id
    }
  });

  await prisma.postTag.upsert({
    where: { postId_tagId: { postId: post.id, tagId: tag.id } },
    update: {},
    create: { postId: post.id, tagId: tag.id }
  });

  await prisma.seoMetadata.upsert({
    where: { postId: post.id },
    update: {},
    create: {
      entityType: SeoEntityType.POST,
      postId: post.id,
      title: 'Programme prise de masse 4 jours | The Muscle Temple',
      description: 'Routine complète pour développer la masse musculaire.',
      noIndex: false,
      openGraphImageId: media.id
    }
  });

  await prisma.seoMetadata.upsert({
    where: { categoryId: category.id },
    update: {},
    create: {
      entityType: SeoEntityType.CATEGORY,
      categoryId: category.id,
      title: 'Articles entraînement',
      description: 'Tous les articles d’entraînement du blog.'
    }
  });
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
