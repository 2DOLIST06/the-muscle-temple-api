import { NewsletterFrequency, NewsletterStatus, Prisma } from '@prisma/client';

const preferenceSelect = {
  newArticles: true,
  strengthTraining: true,
  workoutPrograms: true,
  nutrition: true,
  supplements: true,
  equipment: true,
  tools: true,
  guides: true,
  frequency: true,
} as const;

export const publicSubscriberSelect = {
  status: true,
  language: true,
  preferences: { select: preferenceSelect },
  goals: { select: { goal: true }, orderBy: { createdAt: 'asc' as const } },
} as const;

export function serializePreferences(
  subscriber: Prisma.NewsletterSubscriberGetPayload<{ select: typeof publicSubscriberSelect }>,
) {
  const preferences = subscriber.preferences ?? {
    newArticles: true,
    strengthTraining: true,
    workoutPrograms: true,
    nutrition: true,
    supplements: true,
    equipment: true,
    tools: true,
    guides: true,
    frequency: NewsletterFrequency.weekly,
  };

  return {
    language: subscriber.language,
    topics: {
      new_articles: preferences.newArticles,
      strength_training: preferences.strengthTraining,
      workout_programs: preferences.workoutPrograms,
      nutrition: preferences.nutrition,
      supplements: preferences.supplements,
      equipment: preferences.equipment,
      tools: preferences.tools,
      guides: preferences.guides,
    },
    goals: subscriber.goals.map(({ goal }) => goal),
    frequency: preferences.frequency,
    unsubscribed: subscriber.status === NewsletterStatus.unsubscribed,
  };
}

export function toDatabasePreferences(topics: Record<string, boolean> | undefined) {
  if (!topics) return {};
  return {
    ...(topics.new_articles === undefined ? {} : { newArticles: topics.new_articles }),
    ...(topics.strength_training === undefined ? {} : { strengthTraining: topics.strength_training }),
    ...(topics.workout_programs === undefined ? {} : { workoutPrograms: topics.workout_programs }),
    ...(topics.nutrition === undefined ? {} : { nutrition: topics.nutrition }),
    ...(topics.supplements === undefined ? {} : { supplements: topics.supplements }),
    ...(topics.equipment === undefined ? {} : { equipment: topics.equipment }),
    ...(topics.tools === undefined ? {} : { tools: topics.tools }),
    ...(topics.guides === undefined ? {} : { guides: topics.guides }),
  };
}
