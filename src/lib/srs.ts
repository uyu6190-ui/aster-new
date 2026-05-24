import { addMinutes, addDays, isBefore } from 'date-fns';
import { Card, Difficulty } from '../types';

/**
 * Custom Anki-like SRS logic
 * 
 * Intervals as requested:
 * Again: 1 minute
 * Hard: 6 minutes
 * Good: 15 minutes
 * Easy: 4 days
 */
export function calculateNextReview(card: Card, difficulty: Difficulty): Partial<Card> {
  let { efactor, repetition } = card;
  let nextReviewDate: Date;
  let interval = card.interval || 0;

  if (difficulty === 'again') {
    nextReviewDate = addMinutes(new Date(), 1);
    repetition = 0; // Reset learning phase
    interval = 0;
  } else if (difficulty === 'hard') {
    nextReviewDate = addMinutes(new Date(), 6);
    efactor = Math.max(1.3, efactor - 0.2);
    interval = 0;
  } else if (difficulty === 'good') {
    nextReviewDate = addMinutes(new Date(), 15);
    // After "Good" in learning phase, Anki usually graduates it.
    // However, to keep it simple as requested:
    repetition += 1;
    interval = 0;
  } else { // easy
    nextReviewDate = addDays(new Date(), 4);
    efactor = efactor + 0.15;
    repetition += 1;
    interval = 4;
  }

  return {
    interval,
    repetition,
    efactor,
    nextReview: nextReviewDate.toISOString(),
    lastReview: new Date().toISOString(),
  };
}

export function isDue(card: Card): boolean {
  if (!card.nextReview) return true; // Default to due if metadata is missing
  try {
    const nextDate = new Date(card.nextReview);
    if (isNaN(nextDate.getTime())) return true;
    return isBefore(nextDate, new Date());
  } catch (e) {
    console.error("SRS Due Check Error:", e);
    return true; 
  }
}

export function createNewCard(front: string, back: string, deckId: string): Card {
  const safeId = (typeof crypto !== 'undefined' && crypto.randomUUID) 
    ? crypto.randomUUID() 
    : Math.random().toString(36).substring(2, 9) + Date.now().toString(36);

  return {
    id: safeId,
    front,
    back,
    deckId,
    interval: 0,
    repetition: 0,
    efactor: 2.5,
    nextReview: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    isArchived: false,
    isFavorite: false,
  };
}
