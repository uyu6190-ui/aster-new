export type Difficulty = 'again' | 'hard' | 'good' | 'easy';

export interface Card {
  id: string;
  front: string;
  back: string;
  deckId: string;
  
  // SRS data
  interval: number; // in days
  repetition: number;
  efactor: number;
  nextReview: string; // ISO string
  lastReview?: string;
  lastDifficulty?: Difficulty;
  isArchived?: boolean;
  isFavorite?: boolean;
  order?: number;
  createdAt: string;
}

export interface Deck {
  id: string;
  name: string;
  userId: string;
  description: string;
  createdAt: string;
  icon?: string;
  coverImage?: string;
  order?: number;
  cardsPerGroup?: number;
  language?: string;
}

export interface AppState {
  decks: Deck[];
  cards: Card[];
}

export interface UserStats {
  userId: string;
  xp: number;
  level: number;
  totalReviews: number;
  lastActive: string;
}
