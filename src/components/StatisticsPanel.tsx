import React, { useMemo } from 'react';
import { Card, Deck, UserStats } from '../types';
import { motion } from 'motion/react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { Trophy, TrendingUp, Brain, Star } from 'lucide-react';
import { isDue } from '../lib/srs';

export function StatisticsPanel({ decks, cards, userStats }: { decks: Deck[], cards: Card[], userStats: UserStats | null }) {
  // Aggregate data
  const statsByDeck = useMemo(() => {
    return decks.map(deck => {
      const deckCards = cards.filter(c => c.deckId === deck.id && !c.isArchived);
      
      const total = deckCards.length;
      const dueCount = deckCards.filter(isDue).length;
      
      // Mastered: e.g. interval > 21 days
      const masteredCount = deckCards.filter(c => c.interval > 21).length;
      
      // Learning: reviewed at least once (repetition > 0) but not mastered
      const learningCount = deckCards.filter(c => c.repetition > 0 && c.interval <= 21).length;
      
      // New: repetition == 0
      const newCount = deckCards.filter(c => c.repetition === 0).length;

      return {
        name: deck.name,
        due: dueCount,
        mastered: masteredCount,
        learning: learningCount,
        new: newCount,
        total
      };
    });
  }, [decks, cards]);

  const level = userStats?.level || 1;
  const xp = userStats?.xp || 0;
  const xpForNextLevel = level * 100;
  const xpProgress = (xp % 100) / 100 * 100; // Assuming each level takes 100 XP from previous level

  const totalCardsMastered = statsByDeck.reduce((acc, curr) => acc + curr.mastered, 0);

  return (
    <div className="space-y-12">
      {/* User Stats Section */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="border border-[#1a1a1a]/10 bg-white p-6 academic-shadow flex flex-col justify-between">
          <div className="flex items-center gap-3 mb-4">
            <Trophy className="text-yellow-600" size={24} />
            <h3 className="font-serif italic text-lg">Level {level}</h3>
          </div>
          <div>
            <div className="flex justify-between text-xs uppercase tracking-widest text-black/40 mb-2">
              <span>{xp} XP</span>
              <span>{xpForNextLevel} XP</span>
            </div>
            <div className="h-1 bg-black/10 w-full overflow-hidden">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${xpProgress}%` }}
                className="h-full bg-black"
                transition={{ duration: 1, ease: 'easeOut' }}
              />
            </div>
          </div>
        </div>

        <div className="border border-[#1a1a1a]/10 bg-white p-6 academic-shadow">
          <div className="flex items-center gap-3 mb-2 text-black/50">
            <TrendingUp size={20} />
            <span className="uppercase text-xs tracking-widest">Total Reviews</span>
          </div>
          <p className="text-4xl font-serif">{userStats?.totalReviews || 0}</p>
        </div>

        <div className="border border-[#1a1a1a]/10 bg-white p-6 academic-shadow">
          <div className="flex items-center gap-3 mb-2 text-black/50">
            <Brain size={20} />
            <span className="uppercase text-xs tracking-widest">Cards Mastered</span>
          </div>
          <p className="text-4xl font-serif">{totalCardsMastered}</p>
        </div>
        
        <div className="border border-[#1a1a1a]/10 bg-white p-6 academic-shadow">
          <div className="flex items-center gap-3 mb-2 text-black/50">
            <Star size={20} />
            <span className="uppercase text-xs tracking-widest">Decks</span>
          </div>
          <p className="text-4xl font-serif">{decks.length}</p>
        </div>
      </div>

      {/* Graphs Section */}
      <div className="border border-[#1a1a1a]/10 bg-white p-8 academic-shadow">
        <h3 className="text-2xl font-serif italic mb-8">Registry Progress</h3>
        
        {statsByDeck.length > 0 ? (
          <div className="h-80 w-full text-xs">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={statsByDeck} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1a1a1a10" />
                <XAxis dataKey="name" tick={{ fontFamily: 'Inter', fontSize: 10, fill: '#1a1a1a' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontFamily: 'Inter', fontSize: 10, fill: '#1a1a1a' }} axisLine={false} tickLine={false} />
                <Tooltip 
                  cursor={{ fill: 'transparent' }}
                  contentStyle={{ 
                    backgroundColor: '#fff', 
                    border: '1px solid #1a1a1a20',
                    fontFamily: 'Inter',
                    fontSize: '12px'
                  }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }} />
                <Bar dataKey="due" stackId="a" fill="#ef4444" name="Due" animationDuration={1000} />
                <Bar dataKey="new" stackId="a" fill="#3b82f6" name="New" animationDuration={1000} />
                <Bar dataKey="learning" stackId="a" fill="#eab308" name="Learning" animationDuration={1000} />
                <Bar dataKey="mastered" stackId="a" fill="#22c55e" name="Mastered" animationDuration={1000} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-sm italic opacity-50">No data available to display.</p>
        )}
      </div>
    </div>
  );
}
