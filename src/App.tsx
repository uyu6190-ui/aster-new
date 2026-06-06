import React, { useState, useEffect, useRef, useMemo, ChangeEvent, Component } from 'react';
import { 
  Plus, 
  BookOpen, 
  Copy,
  Check,
  Settings, 
  ArrowLeft, 
  Trash2, 
  Edit2, 
  X, 
  RotateCcw, 
  Dog, 
  GraduationCap, 
  Sparkles, 
  Image as ImageIcon, 
  Type as TypeIcon,
  Loader2,
  FileText,
  Upload,
  LogOut,
  LogIn,
  User as UserIcon,
  Heart,
  Archive,
  Star,
  Atom,
  Globe,
  PenTool,
  Coffee,
  Code,
  Music,
  Map as MapIcon,
  Microscope,
  Languages,
  Crop,
  Headphones,
  Play,
  Mic,
  Camera,
  Filter,
  Layers,
  Zap,
  AlignLeft,
  Shuffle,
  ArrowRightLeft,
  MessageSquare,
  CloudOff,
  Wifi,
  ChevronUp,
  ChevronDown,
  Server,
  CheckCircle2
} from 'lucide-react';
import Cropper, { Point, Area } from 'react-easy-crop';
import { getCroppedImg, shrinkImage } from './lib/imageUtils';
import { motion, AnimatePresence } from 'motion/react';
import { formatDistanceToNow } from 'date-fns';
import { Card, Deck, Difficulty, UserStats } from './types';
import { isDue, calculateNextReview, createNewCard } from './lib/srs';
import { 
  extractCardsFromImages, 
  extractCardsFromText, 
  extractSentenceCardsFromText,
  extractParaphraseCardsFromText,
  transcribeImage, 
  extractCardsFromAudio, 
  transcribeAudio, 
  ExtractedCard,
  getCardExplanation
} from './services/geminiService';
import { soundService } from './services/soundService';
import { StatisticsPanel } from './components/StatisticsPanel';
import { 
  auth, 
  db, 
  signInWithGooglePopup, 
  signInWithGoogleRedirect,
  logout, 
  collection, 
  doc, 
  setDoc, 
  getDoc,
  query, 
  where, 
  onSnapshot, 
  updateDoc, 
  deleteDoc, 
  writeBatch,
  getDocsFromServer
} from './lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { Volume2, VolumeX, PawPrint, AlertTriangle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

// --- Error Boundary ---
export class ErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    const { hasError, error } = this.state as any;
    if (hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#fdfbf7] p-12 text-center">
          <div className="max-w-md w-full bg-white border border-red-200 p-12 academic-shadow">
            <AlertTriangle className="mx-auto mb-6 text-red-500" size={48} />
            <h2 className="text-3xl font-serif italic mb-4">System Anomaly</h2>
            <p className="text-sm text-red-600/60 italic mb-8">
              A critical failure has occurred within the knowledge registrar.
            </p>
            <pre className="text-[10px] bg-red-50 p-4 border border-red-100 mb-8 overflow-auto text-left max-h-40 font-mono">
              {error?.message || "Unknown error"}
            </pre>
            <button 
              onClick={() => window.location.reload()}
              className="w-full bg-black text-white p-4 text-[10px] uppercase tracking-widest hover:opacity-80 transition-all font-medium"
            >
              Restart Repository
            </button>
          </div>
        </div>
      );
    }
    return (this as any).props.children;
  }
}

// --- Types Fix for local dev if missing ---
type View = 'dashboard' | 'review' | 'edit-deck' | 'create-deck' | 'edit-deck-settings' | 'ai-import' | 'auth' | 'settings' | 'listening' | 'prepare-review';
type ReviewOrientation = 'normal' | 'swapped';
type CardCategory = 'all' | 'word' | 'sentence' | 'image';
const CARD_LIST_PAGE_SIZE = 50;

// --- Error Handling ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  if (typeof window !== 'undefined' && (window as any).addAppLog) {
     (window as any).addAppLog(`FATAL: ${operationType} on ${path} failed. ${errInfo.error}`);
  }
  if (typeof window !== 'undefined') {
    window.alert(`Cloud operation failed: ${errInfo.error}`);
  }
}

// --- Global Helpers ---
const isImageContent = (text: any) => {
  if (typeof text !== 'string') return false;
  return text.length > 50 && text.startsWith('data:image/');
};

const parseContent = (content: any): string[] => {
  if (!content || typeof content !== 'string') return [];
  try {
    if (content.includes('|||')) {
      return content.split('|||').filter(p => p && p.length > 0);
    }
    return [content];
  } catch (e) {
    console.error("Parse Content Error:", e);
    return [];
  }
};

const hasTextContent = (content: string) => 
  parseContent(content).some(p => !isImageContent(p));

const hasAnyImage = (content: string) => 
  parseContent(content).some(p => isImageContent(p));

const generateId = () => {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
  } catch (e) {
    // Fallback to random string
  }
  return Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
};

// --- Resilient Image Component ---
const SafeImage = ({ src, className, alt = "Content" }: { src: string, className?: string, alt?: string }) => {
  const [hasError, setHasError] = useState(false);
  
  if (hasError) {
    return (
      <div className={`flex items-center justify-center bg-black/5 rounded border border-black/5 opacity-40 py-4 ${className}`}>
        <span className="text-[8px] uppercase tracking-tighter">Image Unavailable</span>
      </div>
    );
  }
  
  return (
    <img 
      src={src} 
      alt={alt}
      className={className}
      onError={() => setHasError(true)}
      referrerPolicy="no-referrer"
      loading="lazy"
    />
  );
};

function CardContent({ content, className = "" }: { content: string, className?: string }) {
  if (!content) return null;
  const parts = parseContent(content);
  
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {parts.map((p, i) => {
        if (isImageContent(p)) {
          return (
            <div key={i} className="relative group/img">
              <SafeImage 
                src={p} 
                className="max-h-[300px] object-contain rounded academic-shadow"
              />
            </div>
          );
        }
        const displayContent = p.length > 5000 ? p.slice(0, 5000) + "..." : p;
        return <p key={i} className="truncate select-text">{displayContent}</p>;
      })}
    </div>
  );
}

function CardContentPreview({ content, className = "" }: { content: string, className?: string }) {
  if (!content) return <span className="text-black/20 italic">Empty</span>;
  const parts = parseContent(content);
  const textParts = parts.filter(p => !isImageContent(p));
  const imageCount = parts.length - textParts.length;
  const previewText = textParts.join(' ').trim();
  
  return (
    <div className={`flex flex-col gap-1 min-w-0 ${className}`}>
      {imageCount > 0 && (
        <div className="inline-flex w-fit items-center gap-2 border border-black/10 bg-black/[0.03] px-2 py-1 text-[8px] uppercase tracking-widest text-black/40">
          <ImageIcon size={12} />
          <span>{imageCount} image{imageCount > 1 ? 's' : ''}</span>
        </div>
      )}
      {previewText ? (
        <p className="truncate select-text">{previewText.length > 500 ? previewText.slice(0, 500) + "..." : previewText}</p>
      ) : imageCount === 0 ? (
        <span className="text-black/20 italic">Empty</span>
      ) : null}
    </div>
  );
}

function CardContentLarge({ content, className = "" }: { content: string, className?: string }) {
  if (!content) return null;
  const parts = parseContent(content);
  
  return (
    <div className={`w-full flex flex-col items-center gap-6 ${className}`}>
      {parts.map((p, i) => {
        if (isImageContent(p)) {
          return (
            <div key={i} className="w-full flex justify-center">
              <SafeImage 
                src={p} 
                className="max-h-[500px] w-auto object-contain rounded-lg academic-shadow"
              />
            </div>
          );
        }
        const displayContent = p.length > 10000 ? p.slice(0, 10000) + "..." : p;
        return <h4 key={i} className="text-4xl font-serif italic leading-tight tracking-tight select-text text-center">{displayContent}</h4>;
      })}
    </div>
  );
}

// --- Shared Components for Deck Editing ---

const InputSection = ({ 
  label, 
  value, 
  onChange, 
  fileInputRef, 
  onImageUpload 
}: { 
  label: string, 
  value: string, 
  onChange: (v: string) => void, 
  fileInputRef: React.RefObject<HTMLInputElement | null>,
  onImageUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
}) => {
  const parts = (!value || typeof value !== 'string') ? [''] : value.split('|||');

  const removePart = (index: number) => {
    const next = parts.filter((_, i) => i !== index);
    onChange(next.join('|||'));
  };

  const updatePart = (index: number, newVal: string) => {
    const next = [...parts];
    next[index] = newVal;
    onChange(next.join('|||'));
  };

  const addTextPart = () => {
    onChange([...parts, ''].join('|||'));
  };

  return (
    <div className="space-y-2">
      <label className="block text-[8px] font-medium uppercase tracking-[0.2em] text-black/30">{label}</label>
      <div className="flex flex-col gap-3">
        {parts.map((p, i) => {
          const isImg = isImageContent(p);
          return (
            <div key={i} className="group relative">
              {isImg ? (
                <div className="relative aspect-video border border-black/10 flex items-center justify-center bg-black/5 rounded overflow-hidden">
                  <SafeImage 
                    src={p} 
                    className="max-h-full max-w-full object-contain" 
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all">
                    <button 
                      onClick={() => removePart(i)} 
                      className="p-2 bg-white rounded-full hover:scale-110 transition-all text-red-500" 
                      title="Remove Image"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="relative">
                  <textarea 
                    placeholder={`${label} part`}
                    value={p}
                    onChange={e => updatePart(i, e.target.value)}
                    className="w-full text-sm p-4 border border-black/10 focus:border-black outline-none transition-all min-h-[80px] resize-none pr-10"
                  />
                  {parts.length > 1 && (
                    <button 
                      onClick={() => removePart(i)}
                      className="absolute top-4 right-4 p-1 text-black/20 hover:text-red-500 transition-all"
                      title="Remove text section"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        
        <div className="flex gap-2">
          <button 
            onClick={addTextPart}
            className="flex-1 py-2 border border-dashed border-black/10 text-[9px] uppercase tracking-widest text-black/40 hover:border-black/30 hover:text-black/60 transition-all"
          >
            + Add Text
          </button>
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 border border-dashed border-black/10 text-black/40 hover:border-black/30 hover:text-black/60 transition-all"
            title="Add Image"
          >
            <ImageIcon size={14} />
          </button>
        </div>
        
        <input 
          type="file" 
          accept="image/*" 
          multiple 
          className="hidden" 
          ref={fileInputRef} 
          onChange={onImageUpload} 
        />
      </div>
    </div>
  );
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [userStats, setUserStats] = useState<UserStats | null>(null);
  const [view, setView] = useState<View>('dashboard');
  const [reviewFilter, setReviewFilter] = useState<string>('due');
  const [isMasteryMode, setIsMasteryMode] = useState<boolean>(false);
  const [reviewOrientation, setReviewOrientation] = useState<ReviewOrientation>('normal');
  const [reviewCategory, setReviewCategory] = useState<CardCategory>('all');
  const [shouldShuffle, setShouldShuffle] = useState(true);
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [preferredVoice, setPreferredVoice] = useState<string>('en-GB');
  
    

  const toggleSound = () => {
    setSoundEnabled(!soundEnabled);
    if (!soundEnabled) {
      soundService.playTap(); // Test sound which also initializes context
    }
  };

  const addLog = (msg: string) => {
    setLogs(prev => [...prev.slice(-49), `${new Date().toLocaleTimeString()} - ${msg}`]);
  };

  useEffect(() => {
    // Expose log function to window for the service to use
    (window as any).addAppLog = addLog;
    
    // Global listener to unlock audio on first interaction
    const unlockAudio = () => {
      soundService.resume();
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
    };
    window.addEventListener('click', unlockAudio);
    window.addEventListener('touchstart', unlockAudio);
    
    return () => {
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
    };
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
      if (!u) {
        setView((currentView) => currentView === 'auth' ? currentView : 'auth');
      } else {
        // Only redirect to dashboard if we are at the login screen
        setView((currentView) => currentView === 'auth' ? 'dashboard' : currentView);
      }
    });

    // Safety timeout: if auth hasn't responded in 10 seconds, force show login view
    const timer = setTimeout(() => {
      if (authLoading) {
        console.warn("Auth initialization timed out. Forcing UI state.");
        setAuthLoading(false);
        if (!user) setView('auth');
      }
    }, 10000);

    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  // Sync UserStats
  useEffect(() => {
    if (!user) {
      setUserStats(null);
      return;
    }
    const loadStats = async () => {
      try {
        const statsRef = doc(db, 'userStats', user.uid);
        const snap = await getDoc(statsRef);
        if (snap.exists()) {
          setUserStats(snap.data() as UserStats);
        } else {
          const newStats: UserStats = {
            userId: user.uid,
            xp: 0,
            level: 1,
            totalReviews: 0,
            lastActive: new Date().toISOString()
          };
          await setDoc(statsRef, newStats);
          setUserStats(newStats);
        }
      } catch (e) {
        addLog(`Stats sync failed: ${e instanceof Error ? e.message : 'Unknown'}`);
      }
    };
    loadStats();
  }, [user]);

  // Sync Decks
  useEffect(() => {
    if (!user) {
      setDecks([]);
      return;
    }
    const q = query(collection(db, 'decks'), where('userId', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const deckData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Deck));
      setDecks(deckData);
    }, (e) => {
      addLog(`Deck sync failed: ${e.message}`);
    });
    return () => unsubscribe();
  }, [user]);

  // Sync Cards
  useEffect(() => {
    if (!user) {
      setCards([]);
      return;
    }
    const q = query(collection(db, 'cards'), where('userId', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const cardData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Card));
      setCards(cardData);
    }, (e) => {
      addLog(`Card sync failed: ${e.message}`);
    });
    return () => unsubscribe();
  }, [user]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white text-black uppercase text-xs tracking-widest flex-col gap-6 p-8 text-center">
        <Loader2 className="animate-spin text-black/20" size={40} strokeWidth={1} />
        <div className="space-y-2">
          <span className="block font-medium animate-pulse">Initializing Knowledge Registry...</span>
          <span className="block text-[10px] opacity-30 italic normal-case">Establishing secure link with neural database</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <ErrorBoundary>
        <AuthView onPopupLogin={signInWithGooglePopup} onRedirectLogin={signInWithGoogleRedirect} />
      </ErrorBoundary>
    );
  }

  // --- Handlers ---
  const addDeck = async (name: string, description: string, icon?: string, coverImage?: string, language?: string) => {
    if (!user) return;
    try {
      const deckId = generateId();
      const newDeck = {
        name,
        description,
        icon: icon || 'BookOpen',
        coverImage: coverImage || '',
        language: language || '',
        createdAt: new Date().toISOString(),
        userId: user.uid,
        order: decks.length,
      };
      await setDoc(doc(db, 'decks', deckId), newDeck);
      setSelectedDeckId(deckId);
      setView('edit-deck');
      addLog(`Created deck: ${name}`);
    } catch (e) {
      console.error(e);
      addLog(`Error creating deck: ${e instanceof Error ? e.message : 'Unknown'}`);
    }
  };

  const updateDeck = async (deckId: string, name: string, description: string, icon?: string, coverImage?: string, language?: string) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'decks', deckId), { 
        name, 
        description, 
        icon, 
        coverImage,
        language
      });
      setView('dashboard');
      addLog(`Updated deck: ${name}`);
    } catch (e) {
      console.error(e);
      addLog(`Error updating deck: ${e instanceof Error ? e.message : 'Unknown'}`);
    }
  };

  const deleteDeck = async (id: string) => {
    if (!user) return;
    await deleteDoc(doc(db, 'decks', id));
    // Also delete associated cards
    const deckCards = cards.filter(c => c.deckId === id);
    const batch = writeBatch(db);
    deckCards.forEach(c => {
      batch.delete(doc(db, 'cards', c.id));
    });
    await batch.commit();
  };

  const reorderDeck = async (deckId: string, direction: 'up' | 'down') => {
    if (!user) return;
    const sortedDecks = [...decks].sort((a, b) => {
    const orderA = a.order ?? 0;
    const orderB = b.order ?? 0;
    if (orderA !== orderB) return orderA - orderB;
    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return timeA - timeB;
  });
    const index = sortedDecks.findIndex(d => d.id === deckId);
    if (index === -1) return;

    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= sortedDecks.length) return;

    const deckA = sortedDecks[index];
    const deckB = sortedDecks[newIndex];

    const batch = writeBatch(db);
    batch.update(doc(db, 'decks', deckA.id), { order: newIndex });
    batch.update(doc(db, 'decks', deckB.id), { order: index });
    await batch.commit();
  };

  const reorderCard = async (cardId: string, direction: 'up' | 'down') => {
    if (!user || !selectedDeckId) return;
    const deckCards = [...cards]
      .filter(c => c.deckId === selectedDeckId && !c.isArchived)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
    
    const index = deckCards.findIndex(c => c.id === cardId);
    if (index === -1) return;

    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= deckCards.length) return;

    // Swap items in our local sorted array
    const newDeckCards = [...deckCards];
    const [movedElement] = newDeckCards.splice(index, 1);
    newDeckCards.splice(newIndex, 0, movedElement);

    const batch = writeBatch(db);
    // Update ALL cards in this deck with their new explicit order
    newDeckCards.forEach((c, idx) => {
      batch.update(doc(db, 'cards', c.id), { order: idx });
    });
    await batch.commit();
  };

  const syncLocalDataToCloud = async () => {
    if (!user) return;
    addLog('Starting diagnostic sync of local data to cloud...');
    try {
      let updatedCount = 0;
      for (const card of cards) {
        let needsUpdate = false;
        let newFrontData = card.front;
        let newBackData = card.back;

        const shrinkIfLarge = async (data: string) => {
          if (data && data.startsWith('data:image/')) {
             if (data.length > 500000) { // If larger than ~500kb base64
                addLog(`Shrinking large image data...`);
                try {
                  const shrunk = await shrinkImage(data, 600);
                  if (shrunk.length < data.length) {
                    return shrunk;
                  }
                } catch(e) {
                  addLog('Shrinking inner error handled softly.');
                }
             }
          }
          return data;
        };

        const newFront = await shrinkIfLarge(card.front);
        if (newFront !== card.front) { needsUpdate = true; newFrontData = newFront; }
        
        const newBack = await shrinkIfLarge(card.back);
        if (newBack !== card.back) { needsUpdate = true; newBackData = newBack; }

        try {
          addLog(`Checking cloud status of card: ${card.id}`);
          // Wait to give indexeddb a tiny breather between heavy queries
          await new Promise(r => setTimeout(r, 50));
          
          try {
             // First try to update it gently (this assumes it already exists on server)
             if (needsUpdate) {
                addLog(`Syncing shrunk image to server for: ${card.id}`);
                await updateDoc(doc(db, 'cards', card.id), {
                  front: newFrontData || "",
                  back: newBackData || "",
                  isArchived: card.isArchived || false
                });
             } else {
                // Just tapping it
                await updateDoc(doc(db, 'cards', card.id), { isArchived: card.isArchived || false });
             }
             updatedCount++;
          } catch(updateErr: any) {
             // If we get permission denied, or not-found, it's likely never reached the server!
             if (updateErr && (updateErr.code === 'permission-denied' || updateErr.code === 'not-found' || updateErr.message?.includes('permission'))) {
               addLog(`Card ${card.id} rejected update (likely missing from server). Creating it now.`);
               const payload = {
                  ...card,
                  front: newFrontData || "",
                  back: newBackData || "",
               };
               if (!payload.lastDifficulty) delete payload.lastDifficulty;
               
               await setDoc(doc(db, 'cards', card.id), {
                   ...payload,
                   userId: user.uid,
                   deckId: card.deckId || ''
               });
               updatedCount++;
             } else {
               throw updateErr;
             }
          }
        } catch(e) {
          console.error('Failed to sync card', card.id, e);
          addLog(`Error syncing card ${card.id}: ${e instanceof Error ? e.message : 'Unknown'}`);
          // We don't throw because we want to keep trying the other cards!
        }
      }
      addLog(`Sync complete. Repaired/Pushed ${updatedCount} overgrown/stuck cards and tapped all others.`);
      alert(`Cloud sync complete! Pushed or repaired ${updatedCount} cards.`);
    } catch(e) {
      addLog(`Sync error: ${e instanceof Error ? e.message : 'Unknown'}`);
      alert(`Sync failed entirely. Error: ${e instanceof Error ? e.message : 'Unknown'}`);
    }
  };

  const addCard = async (deckId: string, front: string, back: string) => {
    if (!user) return;
    try {
      // Relaxed safety limit for Firestore (1MB is absolute max, so we allow up to 800k chars)
      if (front.length > 850000 || back.length > 850000) {
        const errorMsg = "Card data is too large. Please resize the image or shorten the text.";
        addLog(`SAVE_ABORT: ${errorMsg}`);
        alert(errorMsg);
        return;
      }
      
      const cardId = generateId();
      const newCardData = createNewCard(front, back, deckId);
      
      const deckCards = cards.filter(c => c.deckId === deckId && !c.isArchived);
      const maxOrder = deckCards.reduce((max, c) => Math.max(max, c.order ?? 0), -1);
      
      const payload = { 
        ...newCardData, 
        id: cardId, 
        userId: user.uid,
        order: maxOrder + 1 
      };
      
      await setDoc(doc(db, 'cards', cardId), payload);
      addLog(`Created card in ${deckId}`);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `cards/${deckId}`);
    }
  };

  const batchAddCards = async (deckId: string, extracted: ExtractedCard[]) => {
    if (!user) return;
    try {
      addLog(`Batch: Processing ${extracted.length} new nodes...`);
      const deckCards = cards.filter(c => c.deckId === deckId && !c.isArchived);
      let maxOrder = deckCards.reduce((max, c) => Math.max(max, c.order ?? 0), -1);

      const batch = writeBatch(db);
      extracted.forEach(e => {
        const cardId = generateId();
        const newCardData = createNewCard(e.front, e.back, deckId);
        maxOrder++;
        batch.set(doc(db, 'cards', cardId), { 
          ...newCardData, 
          id: cardId, 
          userId: user.uid,
          order: maxOrder
        });
      });
      await batch.commit();
      addLog(`Batch: Successfully committed ${extracted.length} cards.`);
    } catch (e: any) {
      addLog(`Batch: FAILED to commit. ${e?.message}`);
      throw e;
    }
  };

  const updateCard = async (cardId: string, difficulty: Difficulty) => {
    if (!user) return;
    const card = cards.find(c => c.id === cardId);
    if (!card) return;
    const updates = calculateNextReview(card, difficulty);
    await updateDoc(doc(db, 'cards', cardId), { ...updates, lastDifficulty: difficulty });

    if (userStats) {
      const xpGains = { again: 5, hard: 10, good: 15, easy: 20 };
      const gainedXp = xpGains[difficulty] || 10;
      const newXp = userStats.xp + gainedXp;
      const newLevel = Math.floor(newXp / 100) + 1;
      const nextStats = {
        ...userStats,
        xp: newXp,
        level: newLevel,
        totalReviews: userStats.totalReviews + 1,
        lastActive: new Date().toISOString()
      };
      await updateDoc(doc(db, 'userStats', user.uid), {
         xp: newXp,
         level: newLevel,
         totalReviews: userStats.totalReviews + 1,
         lastActive: nextStats.lastActive
      });
      setUserStats(nextStats);
    }
  };

  const updateCardContent = async (cardId: string, front: string, back: string) => {
    if (!user) return;
    try {
      if (front.length > 800000 || back.length > 800000) {
        throw new Error("Content too large for database update.");
      }
      await updateDoc(doc(db, 'cards', cardId), { front, back });
      addLog(`Updated node: ${cardId}`);
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `cards/${cardId}`);
    }
  };

  const swapCards = async (cardIds: string[]) => {
    if (!user) return;
    try {
      addLog(`Swapping front and back for ${cardIds.length} cards...`);
      const chunkSize = 400;
      let chunkBatch = writeBatch(db);
      let operationsCount = 0;
      
      for (let i = 0; i < cardIds.length; i++) {
        const card = cards.find(c => c.id === cardIds[i]);
        if (!card) continue;
        
        chunkBatch.update(doc(db, 'cards', card.id), { front: card.back, back: card.front });
        operationsCount++;
        
        if (operationsCount === chunkSize) {
          await chunkBatch.commit();
          chunkBatch = writeBatch(db);
          operationsCount = 0;
        }
      }
      
      if (operationsCount > 0) {
        await chunkBatch.commit();
      }
      addLog(`Successfully swapped ${cardIds.length} cards.`);
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `cards (batch swap)`);
    }
  };

  const forceSyncCards = async (cardIds: string[]) => {
    if (!user) return;
    try {
      addLog(`Force Syncing ${cardIds.length} cards...`);
      for (const id of cardIds) {
        const card = cards.find(c => c.id === id);
        if (!card) continue;
        
        let safeFront = card.front;
        let safeBack = card.back;
        
        if (safeFront && safeFront.startsWith('data:image/') && safeFront.length > 500000) {
            try { safeFront = await shrinkImage(safeFront, 600) || safeFront; } catch(e) {}
        }
        if (safeBack && safeBack.startsWith('data:image/') && safeBack.length > 500000) {
            try { safeBack = await shrinkImage(safeBack, 600) || safeBack; } catch(e) {}
        }

        const totalSize = (safeFront?.length || 0) + (safeBack?.length || 0);

        if (totalSize > 850000) {
            const fSize = safeFront?.length || 0;
            const bSize = safeBack?.length || 0;
            if (fSize > 400000) safeFront = "[Image removed: too large for cloud sync]";
            if (bSize > 400000) safeBack = "[Image removed: too large for cloud sync]";
            
            if (safeFront === card.front && safeBack === card.back) {
                if (fSize > 400000) safeFront = safeFront?.substring(0, 50000) + "...";
                if (bSize > 400000) safeBack = safeBack?.substring(0, 50000) + "...";
            }
        }
        
        const payload = {
           ...card,
           front: safeFront,
           back: safeBack,
           userId: user.uid,
           deckId: card.deckId || ''
        };
        await setDoc(doc(db, 'cards', card.id), payload, { merge: true });
        addLog(`Force synced card: ${card.id}`);
      }
      alert(`${cardIds.length} cards manually synced to cloud successfully.`);
    } catch (e: any) {
      addLog(`Force Sync failed: ${e.message}`);
      alert(`Force Sync failed: ${e.message}`);
    }
  };

  const pullDataFromServer = async () => {
    if (!user) return;
    try {
      addLog(`Fetching missing data from server...`);
      const decksQ = query(collection(db, 'decks'), where('userId', '==', user.uid));
      const decksSnap = await getDocsFromServer(decksQ);
      const serverDecks = decksSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Deck));
      
      setDecks(prevDecks => {
        const map = new Map(prevDecks.map(d => [d.id, d]));
        serverDecks.forEach(sd => map.set(sd.id, sd));
        return Array.from(map.values());
      });

      const cardsQ = query(collection(db, 'cards'), where('userId', '==', user.uid));
      const cardsSnap = await getDocsFromServer(cardsQ);
      const serverCards = cardsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Card));
      
      setCards(prevCards => {
        const newCardsMap = new Map(prevCards.map(c => [c.id, c]));
        serverCards.forEach(sc => newCardsMap.set(sc.id, sc));
        return Array.from(newCardsMap.values());
      });
      
      addLog(`Fetched ${serverDecks.length} decks and ${serverCards.length} cards from server.`);
      alert(`同期完了: ${serverDecks.length} デッキ、${serverCards.length} 枚のカードを取得しました。`);
    } catch (e: any) {
      addLog(`Fetch from server failed: ${e.message}`);
      alert(`Fetch from server failed: ${e.message}`);
    }
  };

  const deleteCard = async (cardId: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'cards', cardId));
      addLog(`Deleted node: ${cardId}`);
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `cards/${cardId}`);
    }
  };

  const toggleFavorite = async (cardId: string) => {
    if (!user) return;
    const card = cards.find(c => c.id === cardId);
    if (!card) return;
    try {
      await updateDoc(doc(db, 'cards', cardId), { isFavorite: !card.isFavorite });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `cards/${cardId}`);
    }
  };

  const toggleArchive = async (cardId: string) => {
    if (!user) return;
    const card = cards.find(c => c.id === cardId);
    if (!card) return;
    try {
      await updateDoc(doc(db, 'cards', cardId), { isArchived: !card.isArchived });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `cards/${cardId}`);
    }
  };

  // --- Layout ---
  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-white text-black font-sans selection:bg-black selection:text-white pb-20">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-black/5">
        <div className="max-w-4xl mx-auto px-6 h-20 flex items-center justify-between">
          <button 
            onClick={() => { setView('dashboard'); setSelectedDeckId(null); soundService.playTap(); }}
            className="flex items-center gap-3 group cursor-pointer"
          >
            <div className="w-10 h-10 border border-[#1a1a1a] flex items-center justify-center text-[#1a1a1a] transition-transform group-hover:scale-95">
              <BookOpen size={24} strokeWidth={1} />
            </div>
            <span className="font-serif text-3xl tracking-tighter italic">Aster</span>
          </button>
          
          <div className="flex items-center gap-4">
            <button 
              onClick={toggleSound}
              className={`p-2 transition-all rounded-full ${soundEnabled ? 'text-black hover:bg-black/5' : 'text-black/20 hover:text-black/40'}`}
              title={soundEnabled ? "Mute" : "Unmute"}
            >
              {soundEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
            </button>
            <button 
              onClick={() => setShowLogs(!showLogs)}
              className="p-2 hover:bg-black hover:text-white rounded-full transition-all flex items-center gap-2 px-3"
            >
              <FileText size={18} strokeWidth={1.5} />
            </button>
            <button 
              onClick={() => logout()}
              className="p-2 hover:bg-black hover:text-white rounded-full transition-all flex items-center gap-2 px-3"
            >
              <span className="text-[10px] font-medium uppercase hidden md:inline">Sign Out</span>
              <LogOut size={18} strokeWidth={1.5} />
            </button>
            <button 
              onClick={() => setView('settings')}
              className="p-2 hover:bg-black hover:text-white rounded-full transition-all"
            >
              <Settings size={22} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </nav>

        <main className="max-w-4xl mx-auto px-6 py-12">
          <AnimatePresence>
            {view === 'dashboard' && (
              <motion.div
                key="dashboard"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                <Dashboard 
                  userStats={userStats}
                  decks={decks}
                  cards={cards} 
                  onStudy={(id) => { setSelectedDeckId(id); setView('prepare-review'); }}
                  onEdit={(id) => { setSelectedDeckId(id); setView('edit-deck'); }}
                  onOpenSettings={(id) => { setSelectedDeckId(id); setView('edit-deck-settings'); }}
                  onCreateDeck={() => setView('create-deck')}
                  onFetchFromCloud={pullDataFromServer}
                  onReorder={reorderDeck}
                />
              </motion.div>
            )}

            {view === 'prepare-review' && selectedDeckId && (
              <motion.div
                key="prepare-review"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                {(() => {
                  const deck = decks.find(d => d.id === selectedDeckId);
                  if (!deck) {
                    return (
                      <div className="text-center py-20 opacity-30 italic">
                        Locating Deck...
                        <button onClick={() => setView('dashboard')} className="block mx-auto mt-4 underline">Return to Dashboard</button>
                      </div>
                    );
                  }
                  return (
                    <SessionPreparation 
                      deck={deck}
                      cards={cards.filter(c => c.deckId === selectedDeckId && !c.isArchived)}
                      orientation={reviewOrientation}
                      category={reviewCategory}
                      shuffle={shouldShuffle}
                      onConfigChange={(orient, cat, shuf) => {
                        setReviewOrientation(orient);
                        setReviewCategory(cat);
                        setShouldShuffle(shuf);
                      }}
                      onStart={(filterType, masteryMode) => {
                        setReviewFilter(filterType);
                        setIsMasteryMode(masteryMode);
                        setView('review');
                      }}
                      onCancel={() => setView('dashboard')}
                      onUpdateDeckGroupSize={async (size) => {
                        try {
                          await updateDoc(doc(db, 'decks', deck.id), { cardsPerGroup: size });
                          addLog(`Updated group size to ${size} for deck ${deck.id}`);
                        } catch (e) {
                          handleFirestoreError(e, OperationType.UPDATE, `decks/${deck.id}`);
                        }
                      }}
                      onShuffleGroups={async () => {
                        const deckCards = cards.filter(c => c.deckId === selectedDeckId && !c.isArchived);
                        const shuffled = [...deckCards].sort(() => Math.random() - 0.5);
                        
                        try {
                          const chunkSize = 400; // writeBatch limit is 500
                          let chunkBatch = writeBatch(db);
                          let operationsCount = 0;
                          
                          for (let i = 0; i < shuffled.length; i++) {
                            chunkBatch.update(doc(db, 'cards', shuffled[i].id), { order: i });
                            operationsCount++;
                            if (operationsCount === chunkSize) {
                              await chunkBatch.commit();
                              chunkBatch = writeBatch(db);
                              operationsCount = 0;
                            }
                          }
                          
                          if (operationsCount > 0) {
                            await chunkBatch.commit();
                          }
                          addLog(`Shuffled ${shuffled.length} cards across groups for deck ${deck.id}`);
                        } catch (e) {
                          handleFirestoreError(e, OperationType.UPDATE, `decks/${deck.id}/cards`);
                        }
                      }}
                    />
                  );
                })()}
              </motion.div>
            )}

            {view === 'review' && selectedDeckId && (
              <motion.div
                key={`review-${reviewFilter}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                {(() => {
                  const deck = decks.find(d => d.id === selectedDeckId);
                  if (!deck) {
                    return (
                      <div className="text-center py-20 opacity-30 italic flex flex-col gap-4 items-center">
                        <Loader2 className="animate-spin text-black/20" size={24} />
                        <span>Locating Neural Stack...</span>
                        <button onClick={() => setView('dashboard')} className="text-[10px] uppercase underline tracking-widest mt-4">Abort and Return</button>
                      </div>
                    );
                  }
                  let filteredCards = cards.filter(c => c.deckId === selectedDeckId && !c.isArchived);
                  if (reviewFilter === 'again') {
                    filteredCards = filteredCards.filter(c => c.lastDifficulty === 'again');
                  } else if (reviewFilter === 'favorites') {
                    filteredCards = filteredCards.filter(c => c.isFavorite && isReviewableNow(c));
                  } else if (reviewFilter === 'due') {
                    filteredCards = filteredCards.filter(isDue);
                  } else if (reviewFilter.startsWith('group-')) {
                    const groupIndex = parseInt(reviewFilter.split('-')[1], 10) - 1;
                    const deckInfo = decks.find(d => d.id === selectedDeckId);
                    const cardsPerGroup = deckInfo?.cardsPerGroup || DEFAULT_CARDS_PER_GROUP;
                    const sortedAllCards = [...filteredCards].sort((a,b) => (a.order ?? 0) - (b.order ?? 0) || new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
                    filteredCards = sortedAllCards.slice(groupIndex * cardsPerGroup, (groupIndex + 1) * cardsPerGroup).filter(isReviewableNow);
                  } else if (reviewFilter === 'all') {
                    filteredCards = filteredCards.filter(isReviewableNow);
                  } else {
                    filteredCards = filteredCards.filter(c => c.lastDifficulty === reviewFilter && isReviewableNow(c));
                  }

                  if (reviewOrientation === 'swapped') {
                    filteredCards = filteredCards.map(c => ({ ...c, front: c.back, back: c.front }));
                  }

                  if (reviewCategory === 'image') {
                    filteredCards = filteredCards.filter(c => hasAnyImage(c.front) || hasAnyImage(c.back));
                  } else if (reviewCategory === 'word') {
                    filteredCards = filteredCards.filter(c => !hasAnyImage(c.front) && c.front.length <= 30);
                  } else if (reviewCategory === 'sentence') {
                    filteredCards = filteredCards.filter(c => !hasAnyImage(c.front) && c.front.length > 30);
                  }

                  if (shouldShuffle) {
                    filteredCards = filteredCards.sort(() => Math.random() - 0.5);
                  } else {
                    filteredCards = filteredCards.sort((a,b) => {
                      const timeA = a.nextReview ? new Date(a.nextReview).getTime() : 0;
                      const timeB = b.nextReview ? new Date(b.nextReview).getTime() : 0;
                      return timeA - timeB;
                    });
                  }

                  filteredCards = filteredCards.slice(0, 500);

                  return (
                    <ReviewSession 
                      key={`${selectedDeckId}-${reviewFilter}`}
                      deck={deck} 
                      cards={filteredCards}
                      reviewFilter={reviewFilter}
                      onFinish={() => { setSelectedDeckId(null); setView('dashboard'); }}
                      onReview={updateCard}
                      onToggleFavorite={toggleFavorite}
                      isMasteryMode={isMasteryMode}
                      soundEnabled={soundEnabled}
                    />
                  );
                })()}
              </motion.div>
            )}

            {view === 'create-deck' && (
              <motion.div
                key="create-deck"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                <DeckForm
                  onSave={addDeck}
                  onCancel={() => setView('dashboard')}
                />
              </motion.div>
            )}

            {view === 'edit-deck' && selectedDeckId && (
              <motion.div
                key="edit-deck"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                {(() => {
                  const deck = decks.find(d => d.id === selectedDeckId);
                  if (!deck) return <div className="text-center py-20 opacity-30 italic">Locating Deck...</div>;
                  return (
                    <DeckEditor
                      deck={deck}
                      cards={cards.filter(c => c.deckId === selectedDeckId)}
                      onAddCard={(f, b) => addCard(selectedDeckId, f, b)}
                      onDeleteCard={deleteCard}
                      onUpdateCardContent={updateCardContent}
                      onSwapCards={swapCards}
                      onForceSyncCards={forceSyncCards}
                      onFetchFromCloud={pullDataFromServer}
                      onToggleArchive={toggleArchive}
                      onToggleFavorite={toggleFavorite}
                      onDeleteDeck={() => { deleteDeck(selectedDeckId); setView('dashboard'); }}
                      onBack={() => setView('dashboard')}
                      onOpenAIImport={() => setView('ai-import')}
                      onEditSettings={() => setView('edit-deck-settings')}
                      onOpenListening={() => setView('listening')}
                      onReorderCard={reorderCard}
                      addLog={addLog}
                    />
                  );
                })()}
              </motion.div>
            )}

            {view === 'listening' && selectedDeckId && (
              <motion.div
                key="listening"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                {(() => {
                  const deck = decks.find(d => d.id === selectedDeckId);
                  if (!deck) return <div className="text-center py-20 opacity-30 italic">Locating Deck...</div>;
                  return (
                    <ListeningView 
                      deck={deck}
                      cards={cards.filter(c => c.deckId === selectedDeckId && c.repetition < 3 && !c.isArchived)}
                      onBack={() => { soundService.stopSpeaking(); setView('edit-deck'); }}
                    />
                  );
                })()}
              </motion.div>
            )}

            {view === 'edit-deck-settings' && selectedDeckId && (
              <motion.div
                key="edit-deck-settings"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                {(() => {
                  const deck = decks.find(d => d.id === selectedDeckId);
                  if (!deck) return <div className="text-center py-20 opacity-30 italic">Locating Deck...</div>;
                  return (
                    <DeckForm
                      initialData={deck}
                      onSave={(n, d, i, ci, lang) => updateDeck(selectedDeckId, n, d, i, ci, lang)}
                      onCancel={() => setView('edit-deck')}
                    />
                  );
                })()}
              </motion.div>
            )}

            {view === 'settings' && (
              <motion.div
                key="settings"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                <GeneralSettings 
                  onBack={() => setView('dashboard')} 
                  soundEnabled={soundEnabled} 
                  setSoundEnabled={setSoundEnabled}
                  preferredVoice={preferredVoice}
                  setPreferredVoice={setPreferredVoice}
                  onLogout={logout}
                  user={user}
                />
              </motion.div>
            )}

            {view === 'ai-import' && selectedDeckId && (
              <motion.div
                key="ai-import"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                {(() => {
                  const deck = decks.find(d => d.id === selectedDeckId);
                  if (!deck) return <div className="text-center py-20 opacity-30 italic">Locating Deck...</div>;
                  return (
                    <AIImport 
                      deck={deck}
                      onImport={async (extracted) => { 
                        await batchAddCards(selectedDeckId, extracted); 
                        setView('edit-deck'); 
                      }}
                      onCancel={() => setView('edit-deck')}
                      
                    />
                  );
                })()}
              </motion.div>
            )}

            {/* Fallback View to prevent white screens */}
            {(!['dashboard', 'prepare-review', 'review', 'create-deck', 'edit-deck', 'listening', 'edit-deck-settings', 'settings', 'ai-import'].includes(view)) && (
              <motion.div key="fallback" className="text-center py-20 opacity-30 italic">
                Registry is reorganizing...
                <button onClick={() => setView('dashboard')} className="block mx-auto mt-4 underline text-xs uppercase tracking-widest">Return to Dashboard</button>
              </motion.div>
            )}
          </AnimatePresence>
        </main>

      {/* Diagnostic Tool / Gemini Server Check */}
      {showLogs && (
        <div className="fixed bottom-4 left-4 z-[210]">
          <button 
              onClick={async () => {
                try {
                  addLog("DEBUG: Checking Gemini server endpoint...");
                  const response = await fetch('/api/gemini', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'status' })
                  });
                  const result = await response.json();
                  addLog(`Gemini endpoint: ${response.ok ? 'OK' : 'FAIL'} (${response.status})`);
                  addLog(`Server API key configured: ${result?.data?.configured ? 'YES' : 'NO'}`);
                } catch (e) {
                  addLog(`DEBUG: Diagnostics failed: ${e}`);
                }
              }}
             className="bg-white border border-black/10 px-4 py-2 text-[8px] uppercase tracking-widest academic-shadow hover:bg-black hover:text-white transition-all"
          >
            Run Diagnostics
          </button>
        </div>
      )}

      {/* Internal Log Viewer for Debugging (especially on mobile) */}
      <AnimatePresence>
        {showLogs && (
          <motion.div 
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            className="fixed inset-x-0 bottom-0 z-[200] bg-black text-white p-6 h-[40vh] border-t-2 border-white/20 overflow-y-auto text-[10px]"
          >
            <div className="flex justify-between items-center mb-4 sticky top-0 bg-black py-2">
              <span className="font-medium uppercase tracking-widest">Diagnostic Logs</span>
              <button onClick={() => setShowLogs(false)}><X size={20} /></button>
            </div>
            <div className="space-y-1">
              {logs.map((log, i) => <div key={i}>{log}</div>)}
              {logs.length === 0 && <div className="opacity-30 italic">No logs generated yet.</div>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    </ErrorBoundary>
  );
}

// --- Auth View ---

function AuthView({ onPopupLogin, onRedirectLogin }: { onPopupLogin: () => Promise<any> | void, onRedirectLogin: () => Promise<any> | void }) {
  const [errorStatus, setErrorStatus] = useState<string | null>(null);

  const handleLogin = (method: 'popup' | 'redirect') => {
    // Call directly so iOS Safari doesn't block the popup
    const result = method === 'popup' ? onPopupLogin() : onRedirectLogin();
    if (result instanceof Promise) {
      result.catch((e: any) => {
        console.error(e);
        setErrorStatus(e.message || "An error occurred during authentication.");
      });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#fdfbf7] p-6">
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-white border border-[#1a1a1a]/10 p-12 text-center academic-shadow"
      >
        <div className="w-16 h-16 border border-[#1a1a1a] flex items-center justify-center text-[#1a1a1a] mx-auto mb-8">
          <GraduationCap size={32} strokeWidth={1} />
        </div>
        <h1 className="text-5xl mb-2 italic">Aster</h1>
        <p className="text-[#1a1a1a]/40 text-[10px] uppercase tracking-[0.3em] mb-12">Academic Spaced-Repetition Registrar</p>
        
        <div className="space-y-4">
            {errorStatus && (
              <div className="text-[10px] text-red-500 bg-red-50 p-3 italic border border-red-200 text-left">
                [Auth Error] {errorStatus} <br /><br />
                {errorStatus.includes('popup-blocked') ? (
                  <b>⚠️【重要】スマホのブラウザでエラーになる場合、画面右上にある「新しいタブで開く」アイコン（四角から矢印が出ているマーク）を押して、アプリを全画面で開いてから再度ログインしてください。それでもダメな場合は、Safari等の設定で「サイト越えトラッキングを防ぐ（Prevent Cross-Site Tracking）」やポップアップブロックを一時的にオフにしてください。</b>
                ) : (
                  <span>※エラーが発生しました。画面右上にある「新しいタブで開く」アイコンからアプリを別タブで開いてみてください。</span>
                )}
              </div>
            )}
          <div className="flex flex-col sm:flex-row gap-4">
            <button 
              onClick={() => handleLogin('popup')}
              className="w-full flex items-center justify-center gap-4 bg-[#1a1a1a] text-[#fdfbf7] p-4 font-medium hover:bg-transparent hover:text-[#1a1a1a] border border-[#1a1a1a] transition-all group"
            >
              <LogIn size={20} className="group-hover:translate-x-1 transition-transform" />
              <span className="tracking-widest uppercase text-xs">Login</span>
            </button>
            <button 
              onClick={() => handleLogin('redirect')}
              className="w-full flex items-center justify-center gap-4 bg-transparent text-[#1a1a1a] p-4 font-medium border border-[#1a1a1a] hover:bg-[#1a1a1a] hover:text-[#fdfbf7] transition-all group"
            >
              <span className="tracking-widest uppercase text-xs">Mobile Login</span>
            </button>
          </div>
          <p className="text-[9px] text-[#1a1a1a]/40 uppercase leading-relaxed tracking-wider mt-4 block">
            * If Popup Login fails on mobile, please use Mobile Login (Redirect).
          </p>
        </div>
      </motion.div>
    </div>
  );
}

// --- Dashboard Component ---

function Dashboard({ userStats, decks, cards, onStudy, onEdit, onOpenSettings, onCreateDeck, onFetchFromCloud, onReorder }: { 
  userStats: UserStats | null,
  decks: Deck[], 
  cards: Card[], 
  onStudy: (id: string) => void, 
  onEdit: (id: string) => void,
  onOpenSettings: (id: string) => void,
  onCreateDeck: () => void,
  onFetchFromCloud: () => void,
  onReorder: (id: string, direction: 'up' | 'down') => void
}) {
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const [tab, setTab] = useState<'registries' | 'statistics'>('registries');

  const sortedDecks = [...decks].sort((a, b) => {
    const orderA = a.order ?? 0;
    const orderB = b.order ?? 0;
    if (orderA !== orderB) return orderA - orderB;
    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return timeA - timeB;
  });

  const DeckIconMap: Record<string, React.ReactNode> = {
    'BookOpen': <BookOpen size={24} strokeWidth={1} />,
    'GraduationCap': <GraduationCap size={24} strokeWidth={1} />,
    'Star': <Star size={24} strokeWidth={1} />,
    'Atom': <Atom size={24} strokeWidth={1} />,
    'Globe': <Globe size={24} strokeWidth={1} />,
    'PenTool': <PenTool size={24} strokeWidth={1} />,
    'Coffee': <Coffee size={24} strokeWidth={1} />,
    'Code': <Code size={24} strokeWidth={1} />,
    'Music': <Music size={24} strokeWidth={1} />,
    'Map': <MapIcon size={24} strokeWidth={1} />,
    'Microscope': <Microscope size={24} strokeWidth={1} />,
    'Languages': <Languages size={24} strokeWidth={1} />,
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="space-y-12"
    >
      <div className="flex justify-center">
        <div className="flex border border-[#1a1a1a]/10 p-1 text-[#1a1a1a] bg-[#1a1a1a]/5 academic-shadow">
          {(['registries', 'statistics'] as const).map((t) => (
            <button 
              key={t}
              onClick={() => setTab(t)}
              className={`px-8 py-2 text-[10px] uppercase tracking-widest font-medium transition-all ${tab === t ? 'bg-[#1a1a1a] text-[#fdfbf7]' : 'text-[#1a1a1a]/40 hover:text-[#1a1a1a]'}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
        <div>
          <h1 className="text-6xl font-serif italic mb-2">
            {tab === 'registries' ? 'Registries' : 'Statistics'}
          </h1>
        </div>
        <div className="flex flex-col md:flex-row items-center gap-6">
          <button 
            onClick={onFetchFromCloud}
            className="flex items-center justify-center gap-2 px-8 py-3.5 font-medium transition-all text-[#1a1a1a] bg-white border border-[#1a1a1a]/20 hover:bg-[#1a1a1a]/5 uppercase text-xs tracking-widest"
          >
            クラウドから取得
          </button>
          
          {tab === 'registries' && (
            <div className="flex border border-[#1a1a1a]/10 p-1 text-[#1a1a1a] bg-[#1a1a1a]/5">
              {(['grid', 'list'] as const).map((l) => (
                <button 
                  key={l}
                  onClick={() => setLayout(l)}
                  className={`px-4 py-1 text-[9px] uppercase tracking-widest font-medium transition-all ${layout === l ? 'bg-[#1a1a1a] text-[#fdfbf7]' : 'text-[#1a1a1a]/40 hover:text-[#1a1a1a]'}`}
                >
                  {l}
                </button>
              ))}
            </div>
          )}

          <button 
            onClick={onCreateDeck}
            className="flex items-center justify-center gap-2 bg-[#1a1a1a] text-[#fdfbf7] px-8 py-3.5 font-medium transition-all hover:bg-transparent hover:text-[#1a1a1a] border border-[#1a1a1a]"
          >
            <Plus size={18} strokeWidth={2} />
            <span className="uppercase text-xs tracking-widest">Construct Stack</span>
          </button>
        </div>
      </div>

      {tab === 'statistics' ? (
        <StatisticsPanel userStats={userStats} decks={decks} cards={cards} />
      ) : (
        <div className={layout === 'grid' ? "grid grid-cols-1 md:grid-cols-2 gap-8" : "flex flex-col gap-4"}>
        {sortedDecks.map((deck, idx) => {
          const deckCards = cards.filter(c => c.deckId === deck.id);
          const dueCount = deckCards.filter(isDue).length;
          
          if (layout === 'list') {
            return (
              <div 
                key={deck.id}
                className="bg-white p-8 border border-[#1a1a1a]/10 flex flex-col md:flex-row items-stretch md:items-center justify-between group academic-shadow hover:border-[#1a1a1a]/30 transition-all gap-8"
              >
                <div className="flex items-center gap-8 flex-1 min-w-0">
                  <div className="flex flex-col gap-1 mr-2 invisible group-hover:visible">
                    <button 
                      disabled={idx === 0}
                      onClick={(e) => { e.stopPropagation(); onReorder(deck.id, 'up'); }}
                      className="p-1 hover:bg-black/5 disabled:opacity-10"
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button 
                      disabled={idx === sortedDecks.length - 1}
                      onClick={(e) => { e.stopPropagation(); onReorder(deck.id, 'down'); }}
                      className="p-1 hover:bg-black/5 disabled:opacity-10"
                    >
                      <ChevronDown size={14} />
                    </button>
                  </div>
                  <div className="w-16 h-16 border border-[#1a1a1a]/10 flex-shrink-0 flex items-center justify-center text-[#1a1a1a] overflow-hidden">
                    {deck.coverImage ? (
                      <img src={deck.coverImage} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      DeckIconMap[deck.icon || ''] || <BookOpen size={20} strokeWidth={1} />
                    )}
                  </div>
                  <div className="min-w-0 max-w-[200px] sm:max-w-none">
                    <h3 className="text-2xl font-serif italic tracking-tight truncate border-b border-transparent">{deck.name}</h3>
                    <div className="flex items-center gap-6 text-[9px] uppercase font-medium tracking-[0.2em] text-[#1a1a1a]/30 mt-1">
                      <span>{deckCards.length} Nodes</span>
                      <span className={dueCount > 0 ? "text-[#1a1a1a]/60" : ""}>{dueCount} Pending</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => onOpenSettings(deck.id)}
                    className="p-2 text-[#1a1a1a]/40 hover:text-[#1a1a1a] transition-all"
                    title="Deck Settings"
                  >
                    <Settings size={16} />
                  </button>
                  <button 
                    onClick={() => onEdit(deck.id)}
                    className="px-6 py-2.5 text-[10px] uppercase tracking-widest font-medium border border-[#1a1a1a]/10 hover:border-[#1a1a1a] transition-all"
                  >
                    Edit Cards
                  </button>
                  <button 
                    onClick={() => onStudy(deck.id)}
                    className={`px-8 py-2.5 text-[10px] uppercase tracking-widest font-medium border border-[#1a1a1a] transition-all ${
                      dueCount > 0 
                        ? "bg-[#1a1a1a] text-[#fdfbf7] hover:bg-transparent hover:text-[#1a1a1a]" 
                        : "bg-transparent text-[#1a1a1a]/20 border-[#1a1a1a]/10 hover:border-[#1a1a1a] hover:text-[#1a1a1a]"
                    }`}
                  >
                    Recall
                  </button>
                </div>
              </div>
            );
          }

          return (
            <div 
              key={deck.id}
              className="bg-white flex flex-col h-full academic-shadow group border border-[#1a1a1a]/10 hover:border-[#1a1a1a]/30 transition-all overflow-hidden relative"
            >
              <div className="absolute top-4 left-4 z-10 flex flex-col gap-1 invisible group-hover:visible bg-white/80 p-1 academic-shadow">
                <button 
                  disabled={idx === 0}
                  onClick={(e) => { e.stopPropagation(); onReorder(deck.id, 'up'); }}
                  className="p-1 hover:bg-black/5 disabled:opacity-10"
                >
                  <ChevronUp size={16} />
                </button>
                <button 
                  disabled={sortedDecks.length > 0 && idx === sortedDecks.length - 1}
                  onClick={(e) => { e.stopPropagation(); onReorder(deck.id, 'down'); }}
                  className="p-1 hover:bg-black/5 disabled:opacity-10"
                >
                  <ChevronDown size={16} />
                </button>
              </div>
              {deck.coverImage && (
                <div className="aspect-square w-full overflow-hidden border-b border-[#1a1a1a]/5">
                  <img 
                    src={deck.coverImage} 
                    alt={deck.name} 
                    className="w-full h-full object-cover transition-transform group-hover:scale-105 duration-700"
                    referrerPolicy="no-referrer"
                  />
                </div>
              )}
              <div className="p-10 flex flex-col flex-grow">
                <div className="flex justify-between items-start mb-8">
                  <div className="w-12 h-12 border border-[#1a1a1a]/10 flex items-center justify-center text-[#1a1a1a]">
                    {DeckIconMap[deck.icon || ''] || <BookOpen size={24} strokeWidth={1} />}
                  </div>
                  <button 
                    onClick={() => onEdit(deck.id)}
                    className="flex items-center gap-2 px-3 py-1.5 text-[#1a1a1a]/40 hover:text-[#1a1a1a] transition-all text-[9px] uppercase font-medium tracking-widest"
                    title="Deck Settings"
                  >
                    <Settings size={14} />
                  </button>
                </div>
                
                <h3 className="text-3xl font-serif italic mb-3 tracking-tight">{deck.name}</h3>
                <p className="text-[#1a1a1a]/50 text-sm line-clamp-2 mb-12 flex-grow italic leading-relaxed">
                  {deck.description || "No description provided."}
                </p>

                <div className="flex items-center justify-between pt-8 border-t border-[#1a1a1a]/5">
                  <div className="flex gap-8 text-[9px] font-medium tracking-[0.2em] uppercase text-[#1a1a1a]/40">
                    <div className="flex flex-col gap-1">
                      <span>Total</span>
                      <span className="text-[#1a1a1a]">{deckCards.length}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span>Due</span>
                      <span className={dueCount > 0 ? "text-[#1a1a1a]" : "text-[#1a1a1a]/20"}>
                        {dueCount}
                      </span>
                    </div>
                  </div>
                  
                  <div className="flex gap-2">
                    <button 
                      onClick={() => onEdit(deck.id)}
                      className="px-6 py-2.5 text-[10px] uppercase tracking-widest font-medium border border-[#1a1a1a]/10 hover:border-[#1a1a1a] transition-all"
                    >
                      Edit Cards
                    </button>
                    <button 
                      onClick={() => onStudy(deck.id)}
                      className={`px-8 py-2.5 text-[10px] uppercase tracking-widest font-medium border border-[#1a1a1a] transition-all ${
                        dueCount > 0 
                          ? "bg-[#1a1a1a] text-[#fdfbf7] hover:bg-transparent hover:text-[#1a1a1a]" 
                          : "bg-transparent text-[#1a1a1a]/20 border-[#1a1a1a]/10 hover:border-[#1a1a1a] hover:text-[#1a1a1a]"
                      }`}
                    >
                      Recall
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      )}

      {decks.length === 0 && tab === 'registries' && (
        <div className="py-24 text-center border-2 border-black border-dashed">
          <RotateCcw size={40} className="mx-auto mb-6 text-black/20" />
          <h3 className="text-2xl font-medium mb-2">zero data</h3>
          <p className="text-black/40 mb-8 text-sm">initialize your first memory stack.</p>
          <button 
            onClick={onCreateDeck}
            className="text-black font-medium border-b-2 border-black hover:pb-1 transition-all"
          >
            create deck
          </button>
        </div>
      )}
    </motion.div>
  );
}

// --- Session Preparation Component ---

const DEFAULT_CARDS_PER_GROUP = 45;
const isReviewableNow = (card: Card) => card.lastDifficulty === 'again' || isDue(card);

function SessionPreparation({ deck, cards, orientation, category, shuffle, onConfigChange, onStart, onCancel, onUpdateDeckGroupSize, onShuffleGroups }: { 
  deck: Deck, 
  cards: Card[], 
  orientation: ReviewOrientation,
  category: CardCategory,
  shuffle: boolean,
  onConfigChange: (orient: ReviewOrientation, cat: CardCategory, shuf: boolean) => void,
  onStart: (filter: string, masteryMode: boolean) => void,
  onCancel: () => void,
  onUpdateDeckGroupSize: (size: number) => void,
  onShuffleGroups: () => void
}) {
  const [masteryMode, setMasteryMode] = useState(false);
  const [isEditingGroupSize, setIsEditingGroupSize] = useState(false);
  const [tempGroupSize, setTempGroupSize] = useState(deck.cardsPerGroup?.toString() || DEFAULT_CARDS_PER_GROUP.toString());
  const reviewableCards = cards.filter(isReviewableNow);
  
  const stats = {
    due: cards.filter(isDue).length,
    all: reviewableCards.length,
    favorites: reviewableCards.filter(c => c.isFavorite).length,
    again: cards.filter(c => c.lastDifficulty === 'again').length,
    hard: reviewableCards.filter(c => c.lastDifficulty === 'hard').length,
    good: reviewableCards.filter(c => c.lastDifficulty === 'good').length,
    easy: reviewableCards.filter(c => c.lastDifficulty === 'easy').length,
  };

  const Option = ({ id, label, count, icon: Icon, color }: any) => (
    <button 
      onClick={() => onStart(id, masteryMode)}
      disabled={count === 0}
      className={`group relative p-8 border border-black/10 transition-all hover:border-black flex flex-col items-center justify-center gap-4 bg-white disabled:opacity-20 disabled:grayscale overflow-hidden`}
    >
      <div className={`absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity`}>
        <Icon size={64} />
      </div>
      <Icon size={32} strokeWidth={1} className={color} />
      <div className="text-center z-10">
        <span className="block font-bold text-[10px] uppercase tracking-widest">{label}</span>
        <span className="block text-[18px] font-serif italic mt-1">{count} cards</span>
      </div>
    </button>
  );

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-4xl mx-auto space-y-16"
    >
      <div className="flex items-center justify-between">
        <button onClick={onCancel} className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-widest text-black/40 hover:text-black">
          <ArrowLeft size={14} /> Back to dashboard
        </button>
      </div>

      <header className="border-l-4 border-black pl-8 py-2">
        <h1 className="text-5xl font-serif italic mb-2">Recall Preparation</h1>
        <p className="text-black/40 text-[10px] uppercase tracking-widest">Configure your session for {deck.name}</p>
      </header>

      {/* Logic Overrides */}
      <div className="bg-black/5 p-12 space-y-10 border border-black/5">
        <h3 className="text-[10px] uppercase tracking-[0.4em] font-bold text-black/30 border-b border-black/5 pb-4">Global Modifiers</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="space-y-4">
            <span className="text-[9px] uppercase tracking-widest text-black/40 flex items-center gap-2"><ArrowRightLeft size={12}/> Orientation</span>
            <div className="flex bg-white border border-black/10 p-1 flex-col sm:flex-row gap-1">
              <button 
                onClick={() => onConfigChange('normal', category, shuffle)}
                className={`flex-1 py-3 px-2 text-[9px] uppercase tracking-widest font-bold transition-all ${orientation === 'normal' ? 'bg-black text-white' : 'text-black/30 hover:text-black hover:bg-black/5'}`}
              >Front → Back</button>
              <button 
                onClick={() => onConfigChange('swapped', category, shuffle)}
                className={`flex-1 py-3 px-2 text-[9px] uppercase tracking-widest font-bold transition-all ${orientation === 'swapped' ? 'bg-black text-white' : 'text-black/30 hover:text-black hover:bg-black/5'}`}
              >Back → Front</button>
            </div>
          </div>

          <div className="space-y-4">
            <span className="text-[9px] uppercase tracking-widest text-black/40 flex items-center gap-2"><AlignLeft size={12}/> Taxonomy</span>
            <div className="flex bg-white border border-black/10 p-1">
              {(['all', 'word', 'sentence', 'image'] as const).map(cat => (
                <button 
                  key={cat}
                  onClick={() => onConfigChange(orientation, cat, shuffle)}
                  className={`flex-1 py-3 text-[9px] uppercase tracking-widest font-bold transition-all ${category === cat ? 'bg-black text-white' : 'text-black/30 hover:text-black'}`}
                >{cat}</button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <span className="text-[9px] uppercase tracking-widest text-black/40 flex items-center gap-2"><Shuffle size={12}/> Shuffle</span>
            <div className="flex bg-white border border-black/10 p-1">
              <button 
                onClick={() => onConfigChange(orientation, category, true)}
                className={`flex-1 py-3 text-[9px] uppercase tracking-widest font-bold transition-all ${shuffle ? 'bg-black text-white' : 'text-black/30 hover:text-black'}`}
              >On</button>
              <button 
                onClick={() => onConfigChange(orientation, category, false)}
                className={`flex-1 py-3 text-[9px] uppercase tracking-widest font-bold transition-all ${!shuffle ? 'bg-black text-white' : 'text-black/30 hover:text-black'}`}
              >Off</button>
            </div>
          </div>

          <div className="space-y-4">
            <span className="text-[9px] uppercase tracking-widest text-black/40 flex items-center gap-2"><Layers size={12}/> Review Mode</span>
            <button 
              onClick={() => setMasteryMode(!masteryMode)}
              className={`w-full py-4 text-[9px] uppercase tracking-widest font-bold border transition-all flex items-center justify-center gap-3 ${masteryMode ? 'bg-amber-100 text-amber-900 border-amber-300' : 'bg-white border-black/10 text-black/30 hover:border-black hover:text-black'}`}
              title="If active, session only finishes when ALL cards are marked as 'Easy'."
            >
              <CheckCircle2 size={14} />
              {masteryMode ? 'Mastery Mode (Until All Easy)' : 'Standard SRS Mode'}
            </button>
          </div>
        </div>
      </div>

      {/* Target Focus Group Section */}
      <div className="space-y-6">
        <div className="border-b border-black/5 pb-4 flex items-center justify-between flex-wrap gap-4">
          <h3 className="text-[10px] uppercase tracking-[0.4em] font-bold text-black/30">
            Daily Checkpoint Groups ({deck.cardsPerGroup || DEFAULT_CARDS_PER_GROUP} cards/group)
          </h3>
          
          <div className="flex items-center gap-2 flex-wrap">
            <button
               onClick={() => {
                 if(window.confirm('Are you sure you want to shuffle all cards across groups? This will reassign cards to different groups.')) {
                   onShuffleGroups();
                 }
               }}
               className="text-[10px] font-bold uppercase tracking-widest text-black/40 hover:text-black border border-black/10 px-3 py-1 bg-white transition-all flex items-center gap-1"
               title="Shuffle cards across groups permanently"
            >
               <Shuffle size={12} />
               Cross-Shuffle
            </button>
            {isEditingGroupSize ? (
            <div className="flex items-center gap-2">
              <input 
                type="number" 
                value={tempGroupSize}
                onChange={(e) => setTempGroupSize(e.target.value)}
                className="w-16 px-2 py-1 text-xs border border-black/10 bg-white"
                min="1"
                max="1000"
              />
              <button 
                onClick={() => {
                  const val = parseInt(tempGroupSize, 10);
                  if (!isNaN(val) && val > 0) {
                    onUpdateDeckGroupSize(val);
                  }
                  setIsEditingGroupSize(false);
                }}
                className="text-[10px] font-bold uppercase tracking-widest px-3 py-1 bg-black text-white"
              >
                Save
              </button>
            </div>
          ) : (
            <button 
              onClick={() => setIsEditingGroupSize(true)}
              className="text-[10px] font-bold uppercase tracking-widest text-black/40 hover:text-black border border-black/10 px-3 py-1 bg-white transition-all"
            >
              Edit Size
            </button>
          )}
          </div>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {(() => {
            const cardsPerGroup = deck.cardsPerGroup || DEFAULT_CARDS_PER_GROUP;
            const sortedAllCards = [...cards].sort((a,b) => (a.order ?? 0) - (b.order ?? 0) || new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
            const groups = [];
            for (let i = 0; i < sortedAllCards.length; i += cardsPerGroup) {
              groups.push({
                index: i / cardsPerGroup + 1,
                cards: sortedAllCards.slice(i, i + cardsPerGroup)
              });
            }
            return groups.map(g => {
              const masterCount = g.cards.filter(c => c.lastDifficulty === 'easy' || (c.repetition && c.repetition > 1)).length;
              const reviewableCount = g.cards.filter(isReviewableNow).length;
              const rate = Math.round((masterCount / g.cards.length) * 100);
              return (
                <button
                  key={g.index}
                  onClick={() => onStart(`group-${g.index}`, masteryMode)}
                  disabled={reviewableCount === 0}
                  className="bg-white border border-black/10 p-6 flex flex-col items-center justify-center hover:border-black transition-all hover:bg-black/5 active:scale-95 group disabled:opacity-20 disabled:grayscale"
                >
                  <span className="text-xl font-serif italic font-bold">Group {g.index}</span>
                  <span className="text-[10px] uppercase tracking-widest text-black/40 mt-1">{reviewableCount}/{g.cards.length} ready</span>
                  <div className="w-full mt-4 h-1 bg-black/10 rounded overflow-hidden">
                    <div className="h-full bg-green-500" style={{ width: `${rate}%` }} />
                  </div>
                  <span className="text-[9px] font-bold mt-2 uppercase tracking-widest flex items-center justify-between w-full">
                    <span>定着率 (Retention)</span>
                    <span className={rate === 100 ? "text-green-600" : ""}>{rate}%</span>
                  </span>
                </button>
              );
            });
          })()}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Option id="due" label="Due for Review" count={stats.due} icon={Zap} color="text-amber-500" />
        <Option id="favorites" label="Favorites Only" count={stats.favorites} icon={Heart} color="text-red-500" />
        <Option id="all" label="Full Deck (Cram)" count={stats.all} icon={Layers} color="text-blue-500" />
      </div>

      <div className="space-y-6">
        <h3 className="text-[10px] uppercase tracking-[0.2em] font-medium text-black/30">Difficulty Divisions</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <button onClick={() => onStart('again', masteryMode)} disabled={stats.again === 0} className="flex flex-col items-center p-6 border border-black/5 bg-white hover:border-black transition-all disabled:opacity-10">
            <span className="text-[10px] uppercase tracking-widest font-bold block">Again</span>
            <span className="text-lg font-serif italic">{stats.again}</span>
          </button>
          <button onClick={() => onStart('hard', masteryMode)} disabled={stats.hard === 0} className="flex flex-col items-center p-6 border border-black/5 bg-white hover:border-black transition-all disabled:opacity-10">
            <span className="text-[10px] uppercase tracking-widest font-bold block">Hard</span>
            <span className="text-lg font-serif italic">{stats.hard}</span>
          </button>
          <button onClick={() => onStart('good', masteryMode)} disabled={stats.good === 0} className="flex flex-col items-center p-6 border border-black/5 bg-white hover:border-black transition-all disabled:opacity-10">
            <span className="text-[10px] uppercase tracking-widest font-bold block">Good</span>
            <span className="text-lg font-serif italic">{stats.good}</span>
          </button>
          <button onClick={() => onStart('easy', masteryMode)} disabled={stats.easy === 0} className="flex flex-col items-center p-6 border border-black/5 bg-white hover:border-black transition-all disabled:opacity-10">
            <span className="text-[10px] uppercase tracking-widest font-bold block">Easy</span>
            <span className="text-lg font-serif italic">{stats.easy}</span>
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// --- Review Session Component ---

interface ReviewSessionProps {
  key?: string | number;
  deck: Deck;
  cards: Card[];
  onFinish: () => void;
  onReview: (id: string, diff: Difficulty) => void;
  onToggleFavorite: (id: string) => void;
  soundEnabled: boolean;
  reviewFilter: string;
  isMasteryMode?: boolean;
}

function ReviewSession({ 
  deck, 
  cards: initialCards, 
  onFinish, 
  onReview, 
  onToggleFavorite, 
  soundEnabled, 
  reviewFilter,
  isMasteryMode 
}: ReviewSessionProps) {
  const [sessionCards, setSessionCards] = useState<Card[]>([]);
  const [session, setSession] = useState<{
    queue: string[];
    activeBatch: string[];
    learningIds: Set<string>;
    isFinished: boolean;
    totalInitialCount: number;
  }>({
    queue: [],
    activeBatch: [],
    learningIds: new Set(),
    isFinished: false,
    totalInitialCount: 0
  });

  const [showBack, setShowBack] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [isExplaining, setIsExplaining] = useState(false);

  const isAgainBatchMode = reviewFilter === 'again';
  const BATCH_SIZE = 5;
  const AGAIN_REINSERT_SPACING = 5;

  // Initialize once
  useEffect(() => {
    if (initialCards.length > 0 && sessionCards.length === 0 && !session.isFinished) {
      setSessionCards(initialCards);
      const ids = initialCards.map(c => c.id);
      
      setSession({
        queue: ids,
        totalInitialCount: ids.length,
        learningIds: new Set(),
        isFinished: false,
        activeBatch: isAgainBatchMode ? ids.slice(0, BATCH_SIZE) : []
      });
    }
  }, [initialCards, session.isFinished, isAgainBatchMode]);

  // Support favorites toggle by syncing sessionCards with the prop (for local UI state only)
  useEffect(() => {
    setSessionCards(prev => prev.map(sc => {
      const updated = initialCards.find(ic => ic.id === sc.id);
      return updated ? { ...sc, isFavorite: updated.isFavorite } : sc;
    }));
  }, [initialCards]);

  // Drive current card from sessionCards (stable)
  const backlogCount = session.learningIds.size;
  const isBottlenecked = backlogCount >= AGAIN_REINSERT_SPACING && !isAgainBatchMode;
  const currentCardId = isAgainBatchMode 
    ? (session.activeBatch.length > 0 ? session.activeBatch[0] : null) 
    : (session.queue.length > 0 ? session.queue[0] : null);
  
  // Use a display card state to bridge transitions and avoid white flashes
  const [displayCard, setDisplayCard] = useState<Card | null>(null);
  
  useEffect(() => {
    const card = sessionCards.find(c => c.id === currentCardId);
    if (card) setDisplayCard(card);
  }, [currentCardId, sessionCards]);

  const currentCard = sessionCards.find(c => c.id === currentCardId) || displayCard;

  // Derive finished state accurately
  const effectiveIsFinished = session.isFinished || (session.queue.length === 0 && sessionCards.length > 0);

  // Pre-calculate progress
  const progressPercent = session.totalInitialCount > 0 ? Math.round(((session.totalInitialCount - session.queue.length) / session.totalInitialCount) * 100) : 0;

  // Render mastered screen if finished
  if (effectiveIsFinished) {
    return (
      <motion.div 
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className="text-center py-20 border-2 border-black flex flex-col items-center bg-white"
      >
        <GraduationCap size={64} strokeWidth={1} className="mb-8" />
        <h2 className="text-4xl font-medium mb-4">mastered</h2>
        <p className="text-black/50 mb-12 text-sm max-w-xs">
          review cycle completed for <span className="text-black font-medium">{deck.name}</span>.
        </p>
        <button 
          onClick={onFinish}
          className="bg-black text-white px-12 py-4 font-medium tracking-widest hover:bg-white hover:text-black border-2 border-black transition-all"
        >
          return to registry
        </button>
      </motion.div>
    );
  }

  // Handle the 'no card found' case gracefully. Show skeleton instead of white screen.
  if (!currentCard) {
    return (
      <div className="max-w-2xl mx-auto space-y-12">
        <div className="flex items-center justify-between opacity-10">
          <div className="h-8 w-32 bg-black rounded" />
          <div className="h-8 w-48 bg-black rounded" />
        </div>
        <div className="h-[400px] border-2 border-black/5 rounded-[40px] bg-black/[0.02] flex items-center justify-center">
           <Loader2 className="animate-spin text-black/5" size={40} />
        </div>
      </div>
    );
  }

  const handleCopy = (e: React.MouseEvent, text: string) => {
    e.stopPropagation();
    try {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
      }
    } catch (err) {
      console.warn("Clipboard access failed:", err);
    }
  };

  const handleReview = (diff: Difficulty) => {
    if (!currentCard) return;

    if (soundEnabled) {
      soundService.playReview(diff);
    }
    
    // Sync with backend/parent state
    onReview(currentCard.id, diff);

    const nextQueue = [...session.queue];
    const nextLearningIds = new Set(session.learningIds);
    let nextActiveBatch = [...session.activeBatch];

    // Ensure stateful navigation by checking current ID
    const cardIdToProcess = currentCard.id;

    // Reset view immediately
    setShowBack(false);
    setExplanation(null);
    setIsExplaining(false);

    if (isAgainBatchMode) {
      if (diff === 'again') {
        // Move to the back of the current active 5-card batch
        const [moved] = nextActiveBatch.splice(0, 1);
        nextActiveBatch.push(moved);
      } else {
        // Correct - remove from batch and overall queue
        nextActiveBatch.splice(0, 1);
        const qIdx = nextQueue.indexOf(cardIdToProcess);
        if (qIdx !== -1) nextQueue.splice(qIdx, 1);

        // Refill from global queue if batch empty
        if (nextActiveBatch.length === 0 && nextQueue.length > 0) {
          nextActiveBatch = nextQueue.slice(0, BATCH_SIZE);
        }
      }
    } else {
      // Configurable mastery logic
      const isMasteredThisTurn = isMasteryMode ? diff === 'easy' : diff !== 'again';
      
      if (!isMasteredThisTurn) {
        nextLearningIds.add(cardIdToProcess);
        const idx = nextQueue.indexOf(cardIdToProcess);
        if (idx !== -1) {
          nextQueue.splice(idx, 1);
          // Standard SRS intensive mode: insert shortly. Mastery mode: insert further back or end
          const reinsertPos = diff === 'again' ? Math.min(nextQueue.length, AGAIN_REINSERT_SPACING) : Math.min(nextQueue.length, 5);
          nextQueue.splice(reinsertPos, 0, cardIdToProcess);
        }
      } else {
        nextLearningIds.delete(cardIdToProcess);
        const idx = nextQueue.indexOf(cardIdToProcess);
        if (idx !== -1) nextQueue.splice(idx, 1);
      }
    }

    // Atomic update
    setSession({
      queue: nextQueue,
      learningIds: nextLearningIds,
      activeBatch: nextActiveBatch,
      isFinished: nextQueue.length === 0,
      totalInitialCount: session.totalInitialCount
    });
  };

  const toggleBack = () => {
    if (soundEnabled) {
      soundService.playTap();
    }
    setShowBack(!showBack);
  };

  const handleExplain = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentCard) return;
    setIsExplaining(true);
    try {
      const result = await getCardExplanation(currentCard.front, currentCard.back);
      setExplanation(result);
    } catch (err) {
      setExplanation("エラーが発生しました。もう一度お試しください。");
    } finally {
      setIsExplaining(false);
    }
  };

  const playSpeech = (e: React.MouseEvent, text: string) => {
    e.stopPropagation();
    const lang = deck.language || 'en-GB';
    soundService.speak(text, lang, 0.9).catch(err => {
      console.warn("Speech synthesis failed:", err);
    });
  };

  return (
    <div className="max-w-2xl mx-auto space-y-12">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={onFinish} className="group flex items-center gap-2 text-xs font-medium bg-black text-white px-4 py-2 hover:bg-white hover:text-black border border-black transition-all">
            <ArrowLeft size={16} />
            <span>exit session</span>
          </button>
          
          <button 
            onClick={() => {
              const lang = prompt("Select Audio Language (default: en-GB, or use ja-JP):", "en-GB");
              if (lang) {
                // We'll store this in local storage for this applet or just for this session?
                // For now, let's just make soundService aware of global preference if we can.
                // Actually, the simplest is to update a local state and pass it to play speech.
              }
            }}
            className="p-2 hover:bg-black/5 rounded-full transition-all text-black/40 hover:text-black"
            title="Audio Settings"
          >
            <Settings size={18} strokeWidth={1.5} />
          </button>
        </div>
        
        <div className="flex flex-col items-end gap-3 flex-1 px-8">
           <div className="w-full h-1 bg-black/5 rounded-full overflow-hidden">
             <motion.div 
                className="h-full bg-black" 
                initial={{ width: 0 }}
                animate={{ width: `${progressPercent}%` }}
             />
           </div>
           <div className="flex items-center gap-4">
              {isMasteryMode && (
                <div className="flex items-center gap-2 text-[9px] font-bold text-amber-900 bg-amber-100 px-2 py-0.5 border border-amber-300">
                  <CheckCircle2 size={10} className="fill-current text-white" />
                  MASTERY MODE: UNTIL ALL "EASY"
                </div>
              )}
              {isAgainBatchMode && (
                <div className="flex items-center gap-2 text-[9px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 border border-blue-200">
                  <Layers size={10} className="fill-current" />
                  INTENSIVE BATCH MODE: {session.activeBatch.length} ACTIVE
                </div>
              )}
              {isBottlenecked && (
                <div className="flex items-center gap-2 text-[9px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 border border-amber-200">
                  <Zap size={10} className="fill-current" />
                  KNOWLEDGE BOTTLENECK: CLEAR BACKLOG ({backlogCount})
                </div>
              )}
              <span className="text-[10px] font-medium text-black/40 uppercase tracking-widest">
                {session.queue.length} REMAINING
              </span>
           </div>
        </div>
      </div>

      <div 
        key={currentCard.id}
        className="relative min-h-[500px] w-full touch-none"
        onClick={toggleBack}
      >
        <div className={`absolute inset-0 transition-all duration-500 transform ${!showBack ? 'opacity-100 z-10 translate-y-0 scale-100' : 'opacity-0 z-0 translate-y-12 scale-95 pointer-events-none'}`}>
          <div className="absolute inset-0 bg-white border border-[#1a1a1a]/10 p-8 md:p-12 flex flex-col items-center justify-center text-center academic-shadow overflow-y-auto">
            <div className="absolute top-6 right-6 md:top-12 md:right-12 flex items-center gap-6" onClick={(e) => e.stopPropagation()}>
              {currentCard && session.learningIds.has(currentCard.id) && (
                <div className="bg-red-50 text-red-500 text-[8px] font-bold px-2 py-1 border border-red-100 rounded uppercase tracking-tighter">
                  Relearning
                </div>
              )}
              <button 
                onClick={(e) => { 
                  e.stopPropagation(); 
                  if (currentCard) onToggleFavorite(currentCard.id); 
                }}
                className={`${currentCard?.isFavorite ? 'text-[#1a1a1a]' : 'text-[#1a1a1a]/10'} hover:scale-110 transition-all`}
              >
                <Heart size={24} strokeWidth={1.5} fill={currentCard?.isFavorite ? "currentColor" : "none"} />
              </button>
            </div>
            <span className="text-[9px] font-medium text-[#1a1a1a]/30 uppercase tracking-[0.4em] mb-12">Inquiry / Stimulus</span>
            <div className="flex flex-col items-center gap-10">
              <CardContentLarge content={currentCard.front} />
              {hasTextContent(currentCard.front) && (
                <div className="flex items-center gap-4">
                  <button 
                    onClick={async (e) => {
                      e.stopPropagation();
                      const parts = parseContent(currentCard.front);
                      const lang = deck.language || 'en-GB';
                      for (const p of parts) {
                        if (!isImageContent(p)) {
                          await soundService.speak(p, lang);
                        }
                      }
                    }}
                    className="w-14 h-14 rounded-full border border-[#1a1a1a]/10 hover:bg-[#1a1a1a]/5 transition-colors flex items-center justify-center group"
                  >
                    <Volume2 size={20} className="text-[#1a1a1a]" />
                  </button>
                </div>
              )}
            </div>
            <div className="mt-20 flex flex-col items-center gap-2">
              <span className="text-[8px] uppercase tracking-[0.3em] text-[#1a1a1a]/30">Reveal Solution</span>
              <div className="h-[1px] w-8 bg-[#1a1a1a]/10" />
            </div>
          </div>
        </div>

        <div className={`absolute inset-0 transition-all duration-500 transform ${showBack ? 'opacity-100 z-10 translate-y-0 scale-100' : 'opacity-0 z-0 -translate-y-12 scale-95 pointer-events-none'}`}>
          <div className="absolute inset-0 bg-[#1a1a1a] text-[#fdfbf7] p-8 md:p-12 flex flex-col items-center academic-shadow overflow-y-auto">
            <div className="absolute top-6 right-6 md:top-12 md:right-12" onClick={(e) => e.stopPropagation()}>
               <button 
                onClick={(e) => { 
                  e.stopPropagation(); 
                  if (currentCard) onToggleFavorite(currentCard.id); 
                }}
                className={`${currentCard?.isFavorite ? 'text-[#fdfbf7]' : 'text-[#fdfbf7]/20'} hover:scale-110 transition-all`}
              >
                <Heart size={24} strokeWidth={1.5} fill={currentCard?.isFavorite ? "currentColor" : "none"} />
              </button>
            </div>
            <div className="flex-grow flex flex-col items-center justify-center text-center">
              <span className="text-[9px] font-medium text-[#fdfbf7]/30 uppercase tracking-[0.4em] mb-10">Resolution / Output</span>
              <CardContentLarge content={currentCard.back} className="mb-12" />
              <div className="flex items-center gap-4">
                {hasTextContent(currentCard.back) && (
                  <button 
                    onClick={async (e) => {
                      e.stopPropagation();
                      const parts = parseContent(currentCard.back);
                      const lang = deck.language || 'en-GB';
                      for (const p of parts) {
                        if (!isImageContent(p)) {
                          await soundService.speak(p, lang);
                        }
                      }
                    }}
                    className="w-14 h-14 rounded-full border border-[#fdfbf7]/10 hover:bg-[#fdfbf7]/5 transition-colors flex items-center justify-center"
                    title="Speak"
                  >
                    <Volume2 size={20} className="text-[#fdfbf7]" />
                  </button>
                )}
                <button 
                  onClick={handleExplain}
                  disabled={isExplaining}
                  className="w-14 h-14 rounded-full border border-[#fdfbf7]/30 text-[#fdfbf7] hover:bg-[#fdfbf7]/10 transition-colors flex items-center justify-center disabled:opacity-50"
                  title="AI Explain"
                >
                  {isExplaining ? <Loader2 size={20} className="animate-spin" /> : <Sparkles size={20} />}
                </button>
              </div>

              {explanation && (
                <div 
                  className="mt-8 text-left w-full max-w-lg bg-[#fdfbf7]/5 p-6 border border-[#fdfbf7]/10 text-sm leading-relaxed overflow-y-auto markdown-body"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ReactMarkdown>{explanation}</ReactMarkdown>
                </div>
              )}
            </div>
            
            <div className="w-full grid grid-cols-4 gap-px bg-[#fdfbf7]/10 border border-[#fdfbf7]/10 mt-auto" onClick={(e) => e.stopPropagation()}>
              {[
                { id: 'again', label: 'Again', desc: '5 cards' },
                { id: 'hard', label: 'Hard', desc: '6m' },
                { id: 'good', label: 'Good', desc: '15m' },
                { id: 'easy', label: 'Easy', desc: '4d' },
              ].map((btn) => (
                <button 
                  key={btn.id}
                  onClick={(e) => { e.stopPropagation(); handleReview(btn.id as Difficulty); }}
                  className={`py-6 flex flex-col items-center justify-center gap-1.5 transition-all hover:bg-[#fdfbf7]/5 active:bg-[#fdfbf7]/10`}
                >
                  <span className="font-medium text-[10px] tracking-widest uppercase text-[#fdfbf7]/60">{btn.label}</span>
                  <span className="text-[8px] opacity-30 uppercase tracking-tighter">{btn.desc}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Deck Editor Component ---

function DeckEditor({ deck, cards, onAddCard, onDeleteCard, onUpdateCardContent, onSwapCards, onForceSyncCards, onFetchFromCloud, onToggleArchive, onToggleFavorite, onDeleteDeck, onBack, onOpenAIImport, onEditSettings, onOpenListening, onReorderCard, addLog }: { 
  deck: Deck, 
  cards: Card[], 
  onAddCard: (f: string, b: string) => void,
  onDeleteCard: (id: string) => void,
  onUpdateCardContent: (id: string, f: string, b: string) => void,
  onSwapCards: (ids: string[]) => void,
  onForceSyncCards: (ids: string[]) => void,
  onFetchFromCloud: () => void,
  onToggleArchive: (id: string) => void,
  onToggleFavorite: (id: string) => void,
  onDeleteDeck: () => void,
  onBack: () => void,
  onOpenAIImport: () => void,
  onEditSettings: () => void,
  onOpenListening: () => void,
  onReorderCard: (id: string, direction: 'up' | 'down') => void,
  addLog: (msg: string) => void
}) {
  const [newFront, setNewFront] = useState('');
  const [newBack, setNewBack] = useState('');
  const [isPhotoMode, setIsPhotoMode] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editingCard, setEditingCard] = useState<Card | null>(null);
  const [editFront, setEditFront] = useState('');
  const [editBack, setEditBack] = useState('');
  const [filter, setFilter] = useState<'all' | Difficulty | 'archived' | 'favorite'>('all');
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [page, setPage] = useState(1);

  const fileInputRefFront = useRef<HTMLInputElement>(null);
  const fileInputRefBack = useRef<HTMLInputElement>(null);
  const editFileInputRefFront = useRef<HTMLInputElement>(null);
  const editFileInputRefBack = useRef<HTMLInputElement>(null);

  const bulkImportRef = useRef<HTMLInputElement>(null);

  const handleBulkImageImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !deck) return;

    const count = files.length;
    addLog(`Batch: Starting atomic import of ${count} images...`);
    
    try {
      const batch = writeBatch(db);
      const deckCards = cards.filter(c => c.deckId === deck.id && !c.isArchived);
      let nextOrder = deckCards.reduce((max, c) => Math.max(max, c.order ?? 0), -1) + 1;

      // Process in pairs: Front / Back
      for (let i = 0; i < files.length; i += 2) {
        const frontResized = await shrinkImage(files[i], 800);
        let backResized = '...';
        
        if (files[i + 1]) {
          backResized = await shrinkImage(files[i + 1], 800);
          addLog(`Batch: Pairing image ${i+1} and ${i+2}`);
        } else {
          addLog(`Batch: Image ${i+1} has no pair, setting lone outcome`);
        }
        
        const cardId = generateId();
        const newCardData = createNewCard(frontResized, backResized, deck.id);
        batch.set(doc(db, 'cards', cardId), { 
          ...newCardData, 
          id: cardId, 
          userId: deck.userId,
          order: nextOrder++
        });
      }
      
      await batch.commit();
      addLog(`Batch: Successfully processed ${count} images into collection.`);
    } catch (err) {
      console.error('Bulk import failed:', err);
      addLog(`Batch Error: ${err instanceof Error ? err.message : 'Unknown'}`);
      alert('Failed during bulk import. Check connections.');
    }
    e.target.value = '';
  };

  const handleImageUpload = async (e: ChangeEvent<HTMLInputElement>, target: 'front' | 'back') => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    try {
      const resizedFiles = await Promise.all(
        Array.from(files).map((f: File) => shrinkImage(f, 640))
      );
      
      const newContent = resizedFiles.join('|||');
      
      if (target === 'front') {
        setNewFront(prev => prev ? `${prev}|||${newContent}` : newContent);
      } else {
        setNewBack(prev => prev ? `${prev}|||${newContent}` : newContent);
      }
    } catch (err) {
      console.error('Image processing failed:', err);
      alert('Failed to process image(s).');
    }
    
    e.target.value = '';
  };

  const handleEditImageUpload = async (e: ChangeEvent<HTMLInputElement>, target: 'front' | 'back') => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    try {
      const resizedFiles = await Promise.all(
        Array.from(files).map((f: File) => shrinkImage(f, 640))
      );
      
      const newContent = resizedFiles.join('|||');
      
      if (target === 'front') {
        setEditFront(prev => prev ? `${prev}|||${newContent}` : newContent);
      } else {
        setEditBack(prev => prev ? `${prev}|||${newContent}` : newContent);
      }
    } catch (err) {
      console.error('Image processing failed:', err);
      alert('Failed to process image(s).');
    }
    e.target.value = '';
  };

  const filteredCards = useMemo(() => cards.filter(c => {
    if (filter === 'archived') return c.isArchived;
    if (c.isArchived) return false; // Hide archived in other views
    if (filter === 'all') return true;
    if (filter === 'favorite') return c.isFavorite;
    return c.lastDifficulty === filter;
  }).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()), [cards, filter]);

  const totalPages = Math.max(1, Math.ceil(filteredCards.length / CARD_LIST_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginatedCards = filteredCards.slice((safePage - 1) * CARD_LIST_PAGE_SIZE, safePage * CARD_LIST_PAGE_SIZE);

  useEffect(() => {
    setPage(1);
    setSelectedCards([]);
  }, [filter, deck.id]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const handleStartEdit = (card: Card) => {
    setEditingCard(card);
    setEditFront(card.front || '');
    setEditBack(card.back || '');
  };

  const handleSaveEdit = () => {
    if (editingCard) {
      if (editFront.length > 900000 || editBack.length > 900000) {
        alert("Image or text is too large to update.");
        return;
      }
      onUpdateCardContent(editingCard.id, editFront, editBack);
      setEditingCard(null);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-16"
    >
      <div className="border-t border-black/5 bg-white p-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-widest transition-colors hover:border-b border-[#1a1a1a]">
            <ArrowLeft size={14} />
            <span>Dashboard</span>
          </button>
        </div>
        <button 
          onClick={() => setIsDeleting(true)}
          className="text-[#1a1a1a]/30 hover:text-[#1a1a1a] text-[10px] font-medium uppercase tracking-[0.2em] transition-colors"
        >
          Destruct Registry
        </button>
      </div>

      <header className="border-l-8 border-[#1a1a1a] pl-8 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-6 mb-2">
            <h1 className="text-6xl font-serif italic mb-0">{deck.name}</h1>
            <button 
              onClick={onEditSettings}
              className="flex items-center gap-2 px-4 py-2 bg-[#1a1a1a]/5 hover:bg-[#1a1a1a] hover:text-[#fdfbf7] rounded-full transition-all text-[#1a1a1a]/60 text-[10px] uppercase font-medium tracking-widest border border-[#1a1a1a]/10"
              title="Edit Registry Information"
            >
              <Settings size={14} />
              <span>Registry Settings</span>
            </button>
          </div>
          <div className="flex items-center gap-6">
            <p className="text-[#1a1a1a]/40 text-xs font-medium uppercase tracking-[0.2em] italic">Knowledge Stack: {cards.length} cards</p>
            <div className="h-[1px] w-4 bg-[#1a1a1a]/10" />
            <p className="text-[#1a1a1a]/40 text-xs font-medium uppercase tracking-[0.2em] italic">Pending Review: {cards.filter(isDue).length} cards</p>
          </div>
        </div>
      </header>

      {/* AI Intelligence Toggle */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-[10px] uppercase tracking-[0.2em] text-black/30">Manual Input</h3>
            <div className="flex items-center gap-4">
              <button 
                onClick={() => bulkImportRef.current?.click()}
                className="flex items-center gap-2 px-3 py-1 text-[8px] font-bold uppercase tracking-widest text-black/40 hover:text-black transition-all"
                title="Create multiple cards from multiple images at once"
              >
                <Layers size={10} />
                <span>Batch Import</span>
              </button>
              <input type="file" multiple accept="image/*" className="hidden" ref={bulkImportRef} onChange={handleBulkImageImport} />
              
              <button 
                onClick={() => { setIsPhotoMode(!isPhotoMode); setNewFront(''); setNewBack(''); }}
                className={`flex items-center gap-2 px-3 py-1 text-[8px] font-bold uppercase tracking-widest border transition-all ${isPhotoMode ? 'bg-black text-white border-black' : 'text-black/30 bg-black/5 border-transparent'}`}
              >
                {isPhotoMode ? <ImageIcon size={10} /> : <ImageIcon size={10} className="opacity-40" />}
                <span>Photo Mode {isPhotoMode ? 'ON' : 'OFF'}</span>
              </button>
            </div>
          </div>
          
          <div className="space-y-6">
             <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <InputSection 
                  label="Front Node"
                  value={newFront}
                  onChange={setNewFront}
                  fileInputRef={fileInputRefFront}
                  onImageUpload={(e) => handleImageUpload(e, 'front')}
                />
                <InputSection 
                  label="Back Node"
                  value={newBack}
                  onChange={setNewBack}
                  fileInputRef={fileInputRefBack}
                  onImageUpload={(e) => handleImageUpload(e, 'back')}
                />
             </div>
            <button 
              disabled={!newFront.trim() && !newBack.trim()}
              onClick={() => { 
                if (!newFront.trim() && !newBack.trim()) return;
                onAddCard(newFront, newBack); 
                setNewFront(''); 
                setNewBack(''); 
                soundService.playTap();
              }}
              className="w-full bg-black text-white font-medium py-4 uppercase tracking-widest disabled:opacity-20 transition-all hover:bg-black/90 active:scale-[0.98] flex items-center justify-center gap-2 relative z-10"
            >
              <Plus size={14} />
              Add Card to Stack
            </button>
          </div>
        </section>

        <section className="space-y-6">
          <h3 className="font-medium text-[10px] uppercase tracking-[0.2em] text-black/30">Intelligence Extraction</h3>
          <div className="flex flex-col gap-4">
            <button 
              onClick={onOpenAIImport}
              className="w-full h-48 border-2 border-black border-dashed flex flex-col items-center justify-center gap-4 group hover:bg-black transition-all"
            >
              <Sparkles size={32} className="group-hover:text-white transition-all transform group-hover:scale-110" />
              <div className="text-center group-hover:text-white">
                <span className="block font-medium uppercase tracking-widest text-xs">AI Extraction</span>
              </div>
            </button>
            <button 
              onClick={onOpenListening}
              className="w-full h-48 border-2 border-black flex flex-col items-center justify-center gap-4 group hover:bg-black transition-all"
            >
              <Headphones size={32} className="group-hover:text-white transition-all transform group-hover:scale-110" />
              <div className="text-center group-hover:text-white">
                <span className="block font-medium uppercase tracking-widest text-xs">Listening Mode</span>
                <span className="block text-[8px] opacity-40 uppercase pt-2">Focus on low mastery nodes</span>
              </div>
            </button>
          </div>
        </section>
      </div>

      {/* Card List with Sorting/Filtering */}
      <section className="space-y-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-black/10 pb-4">
          <h3 className="font-medium text-[10px] uppercase tracking-[0.3em] text-black/30">Sequential Cards</h3>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {(['all', 'again', 'hard', 'good', 'easy', 'favorite', 'archived'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-[10px] uppercase tracking-widest font-medium transition-all ${filter === f ? 'text-black border-b border-black' : 'text-black/30 hover:text-black'}`}
              >
                {f === 'all' ? 'All' : 
                 f === 'again' ? 'もう一度' :
                 f === 'hard' ? '難しい' :
                 f === 'good' ? '正解' : 
                 f === 'favorite' ? 'Favorite' :
                 f === 'archived' ? 'Archive' : '簡単'} ({
                  f === 'all' ? cards.filter(c => !c.isArchived).length : 
                  f === 'archived' ? cards.filter(c => c.isArchived).length :
                  f === 'favorite' ? cards.filter(c => c.isFavorite && !c.isArchived).length :
                  cards.filter(c => c.lastDifficulty === f && !c.isArchived).length
                })
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => {
                  if (selectedCards.length === filteredCards.length) setSelectedCards([]);
                  else setSelectedCards(filteredCards.map(c => c.id));
                }}
                className="text-[9px] uppercase tracking-widest font-bold text-[#1a1a1a]/60 hover:text-[#1a1a1a] transition-colors"
              >
                {selectedCards.length === filteredCards.length && filteredCards.length > 0 ? 'Deselect All' : 'Select All'}
              </button>
              <div className="h-3 w-px bg-black/20" />
              <button
                onClick={() => onFetchFromCloud()}
                className="text-[9px] uppercase tracking-widest font-bold text-[#1a1a1a]/60 hover:text-[#1a1a1a] transition-colors flex items-center gap-1"
              >
                クラウドから取得
              </button>
            </div>
            {filteredCards.length > CARD_LIST_PAGE_SIZE && (
              <div className="flex items-center gap-3 text-[9px] uppercase tracking-widest text-black/40">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  className="px-3 py-1 border border-black/10 hover:border-black disabled:opacity-20 disabled:hover:border-black/10"
                >
                  Prev
                </button>
                <span>
                  {safePage} / {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={safePage === totalPages}
                  className="px-3 py-1 border border-black/10 hover:border-black disabled:opacity-20 disabled:hover:border-black/10"
                >
                  Next
                </button>
              </div>
            )}
          </div>
          {selectedCards.length > 0 && (
            <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 bg-white/90 backdrop-blur-sm border-2 border-black p-4 academic-shadow flex items-center gap-6 rounded-lg">
              <span className="text-[10px] uppercase tracking-widest font-bold text-[#1a1a1a]">
                {selectedCards.length} cards selected
              </span>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => onSwapCards(selectedCards)}
                  className="px-6 py-3 bg-white border border-[#1a1a1a]/20 text-[#1a1a1a] hover:bg-[#1a1a1a] hover:text-white transition-colors text-[10px] font-bold uppercase tracking-widest rounded-sm flex items-center gap-2"
                >
                  <ArrowRightLeft size={12} />
                  Swap F/B
                </button>
                <button
                  onClick={() => onForceSyncCards(selectedCards)}
                  className="px-6 py-3 bg-white border border-[#1a1a1a]/20 text-[#1a1a1a] hover:bg-[#1a1a1a] hover:text-white transition-colors text-[10px] font-bold uppercase tracking-widest rounded-sm"
                >
                  クラウドに保存
                </button>
                <button
                  onClick={() => setSelectedCards([])}
                  className="text-[10px] uppercase tracking-widest font-bold text-gray-500 hover:text-black transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {paginatedCards.map(card => (
            <div key={card.id} className="bg-white border-2 border-black p-6 flex flex-col md:flex-row md:items-center justify-between group transition-all">
              <div className="flex-1 flex flex-col md:flex-row md:items-center gap-6">
                <div className="pt-2 md:pt-0">
                  <input
                    type="checkbox"
                    checked={selectedCards.includes(card.id)}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedCards(prev => [...prev, card.id]);
                      else setSelectedCards(prev => prev.filter(id => id !== card.id));
                    }}
                    className="w-4 h-4 cursor-pointer accent-[#1a1a1a]"
                  />
                </div>
                <div className="flex-1 min-w-0 group/front">
                  <span className="text-[8px] font-medium uppercase opacity-30 block mb-1">Front</span>
                  <div className="flex items-center gap-2">
                    {card.isFavorite && <Heart size={12} fill="currentColor" className="text-black" />}
                    <CardContentPreview content={card.front} />
                    <button 
                      onClick={() => {
                        try {
                          navigator.clipboard.writeText(card.front);
                        } catch (e) {}
                      }}
                      className={`p-1 opacity-0 group-hover/front:opacity-100 hover:bg-black/5 rounded transition-all ${hasAnyImage(card.front) ? 'hidden' : ''}`}
                      title="Copy Front Text"
                    >
                      <Copy size={12} />
                    </button>
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-[8px] font-medium uppercase opacity-30 block mb-1">Back</span>
                  <CardContentPreview content={card.back} />
                </div>
                <div className="w-40 hidden lg:block">
                  <span className="text-[8px] font-medium uppercase opacity-30 block mb-1">Schedule</span>
                  <p className="text-[9px] font-medium uppercase">
                    {(() => {
                      try {
                        return formatDistanceToNow(new Date(card.nextReview), { addSuffix: true });
                      } catch (e) {
                        return 'Pending';
                      }
                    })()}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-4 md:mt-0">
                <div className="flex flex-col gap-1 mr-2 transition-opacity opacity-40 hover:opacity-100">
                  <button 
                    disabled={filteredCards.findIndex(c => c.id === card.id) === 0}
                    onClick={() => onReorderCard(card.id, 'up')}
                    className="p-1 hover:bg-black/5 disabled:opacity-10 transition-all"
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button 
                    disabled={filteredCards.findIndex(c => c.id === card.id) === filteredCards.length - 1}
                    onClick={() => onReorderCard(card.id, 'down')}
                    className="p-1 hover:bg-black/5 disabled:opacity-10 transition-all"
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>
                <button 
                  onClick={() => onToggleFavorite(card.id)}
                  className={`p-2 border border-black/10 transition-colors rounded-full ${card.isFavorite ? 'bg-black text-white' : 'hover:bg-black/5'}`}
                  title="Favorite"
                >
                  <Heart size={14} fill={card.isFavorite ? "currentColor" : "none"} />
                </button>
                <button 
                  onClick={() => onSwapCards([card.id])}
                  className="p-2 border border-black/10 transition-colors rounded-full hover:bg-black/5"
                  title="Swap Front & Back"
                >
                  <ArrowRightLeft size={14} />
                </button>
                <button 
                  onClick={() => handleStartEdit(card)}
                  className="px-3 py-1.5 border border-black text-[10px] font-medium uppercase hover:bg-black hover:text-white transition-all"
                >
                  Edit
                </button>
                <button 
                  onClick={() => onToggleArchive(card.id)}
                  className={`px-3 py-1.5 border border-black text-[10px] font-medium uppercase transition-all ${card.isArchived ? 'bg-black text-white' : 'hover:bg-black hover:text-white'}`}
                >
                  {card.isArchived ? 'Restore' : 'Archive'}
                </button>
                <button 
                  onClick={() => onDeleteCard(card.id)}
                  className="p-2 border border-black/10 text-black/20 hover:text-black hover:border-black transition-colors"
                  title="Delete Card"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
          {filteredCards.length === 0 && (
            <div className="text-center py-20 text-black/20 text-sm uppercase">Empty Memory Registry</div>
          )}
          {filteredCards.length > CARD_LIST_PAGE_SIZE && (
            <div className="flex items-center justify-center gap-4 pt-4 text-[10px] uppercase tracking-widest text-black/50">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={safePage === 1}
                className="px-4 py-2 border border-black/10 hover:border-black disabled:opacity-20 disabled:hover:border-black/10"
              >
                Previous
              </button>
              <span>
                Showing {(safePage - 1) * CARD_LIST_PAGE_SIZE + 1}-{Math.min(safePage * CARD_LIST_PAGE_SIZE, filteredCards.length)} of {filteredCards.length}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
                className="px-4 py-2 border border-black/10 hover:border-black disabled:opacity-20 disabled:hover:border-black/10"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Edit Card Modal */}
      <AnimatePresence>
        {editingCard && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-md">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white text-black p-10 max-w-lg w-full border-4 border-black shadow-2xl space-y-8 overflow-y-auto max-h-[90vh]"
            >
              <h3 className="text-2xl font-serif italic tracking-tighter">Modify Node</h3>
              <div className="space-y-6">
                <InputSection 
                  label="Front Perspective"
                  value={editFront}
                  onChange={setEditFront}
                  fileInputRef={editFileInputRefFront}
                  onImageUpload={(e) => handleEditImageUpload(e, 'front')}
                />
                <InputSection 
                  label="Back Outcome"
                  value={editBack}
                  onChange={setEditBack}
                  fileInputRef={editFileInputRefBack}
                  onImageUpload={(e) => handleEditImageUpload(e, 'back')}
                />
              </div>
              <div className="flex flex-col md:flex-row gap-4 pt-4 border-t border-black/5">
                <button 
                  onClick={handleSaveEdit}
                  className="flex-1 p-4 bg-black text-white font-medium uppercase tracking-widest hover:scale-[1.02] active:scale-95 transition-all shadow-lg"
                >
                  Confirm Registry Change
                </button>
                <button 
                  onClick={() => setEditingCard(null)}
                  className="flex-1 p-4 font-medium text-black/30 bg-black/5 uppercase tracking-widest hover:text-black transition-all"
                >
                  Discard
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      {isDeleting && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-[#fdfbf7]/80 backdrop-blur-md" onClick={() => setIsDeleting(false)} />
          <div className="relative bg-white text-[#1a1a1a] w-full max-w-sm p-12 border border-[#1a1a1a]/10 academic-shadow">
            <h3 className="text-3xl font-serif italic mb-4">Purge Registry?</h3>
            <p className="text-[#1a1a1a]/50 mb-10 text-xs italic leading-relaxed">System warning: All associated knowledge nodes will be permanently deconstructed from the repository.</p>
            <div className="flex flex-col gap-4">
               <button 
                onClick={onDeleteDeck}
                className="w-full p-4 bg-[#1a1a1a] text-[#fdfbf7] font-medium uppercase tracking-widest text-[10px] hover:bg-transparent hover:text-[#1a1a1a] border border-[#1a1a1a] transition-all"
              >
                Execute Purge
              </button>
              <button 
                onClick={() => setIsDeleting(false)}
                className="w-full p-4 font-medium text-[#1a1a1a]/30 uppercase tracking-widest text-[10px] hover:text-[#1a1a1a]"
              >
                Abort
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function ListeningView({ deck, cards, onBack }: { deck: Deck, cards: Card[], onBack: () => void }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [mode, setMode] = useState<'primary-only' | 'primary-secondary' | 'secondary-primary'>('primary-secondary');
  const [speed, setSpeed] = useState(1.0);
  const timerRef = useRef<any>(null);

  const startListening = async (index: number) => {
    if (index >= cards.length) {
      setIsPlaying(false);
      return;
    }
    setCurrentIndex(index);
    setIsPlaying(true);

    const card = cards[index];
    const lang = deck.language || 'en-GB';

    const playPrimary = async () => {
      const frontParts = parseContent(card.front);
      for (const part of frontParts) {
        if (!isImageContent(part)) {
          await soundService.speak(part, lang, speed);
        }
      }
    };

    const playSecondary = async () => {
      const backParts = parseContent(card.back);
      for (const part of backParts) {
        if (!isImageContent(part)) {
          await soundService.speak(part, 'ja-JP', speed);
        }
      }
    };

    if (mode === 'primary-only') {
      await playPrimary();
    } else if (mode === 'primary-secondary') {
      await playPrimary();
      await new Promise(r => setTimeout(r, 1000));
      await playSecondary();
    } else if (mode === 'secondary-primary') {
      await playSecondary();
      await new Promise(r => setTimeout(r, 1000));
      await playPrimary();
    }

    // Interval between cards
    timerRef.current = setTimeout(() => {
      startListening(index + 1);
    }, 2000);
  };

  const stopListening = () => {
    setIsPlaying(false);
    soundService.stopSpeaking();
    if (timerRef.current) clearTimeout(timerRef.current);
  };

  const togglePlay = () => {
    if (isPlaying) stopListening();
    else startListening(currentIndex);
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="max-w-xl mx-auto space-y-12"
    >
      <button onClick={onBack} className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-widest transition-colors hover:border-b border-[#1a1a1a]">
        <ArrowLeft size={14} /> Back
      </button>

      <div className="bg-white p-12 border border-[#1a1a1a]/10 academic-shadow text-center space-y-12">
        <h2 className="text-4xl font-serif italic mb-2">{deck.name}</h2>
        <p className="text-[10px] uppercase tracking-widest text-[#1a1a1a]/40">Listening Logic: {cards.length} targeted nodes</p>
        
        <div className="py-12 border-y border-[#1a1a1a]/5">
          {cards.length > 0 ? (
            <div className="space-y-4">
              <div className="text-sm opacity-30 uppercase tracking-[0.2em]">Node {currentIndex + 1} / {cards.length}</div>
              <div className="text-3xl font-medium min-h-[4rem] flex items-center justify-center px-4">
                <CardContent content={cards[currentIndex].front} />
              </div>
            </div>
          ) : (
            <div className="text-sm opacity-30 italic">No low-mastery nodes found.</div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-4 text-left">
            <span className="text-[9px] uppercase tracking-widest text-[#1a1a1a]/40 block">Output Mode</span>
            <div className="flex flex-col gap-2">
              <button 
                onClick={() => setMode('primary-only')}
                className={`py-3 text-[10px] uppercase tracking-widest border transition-all ${mode === 'primary-only' ? 'bg-[#1a1a1a] text-white' : 'border-[#1a1a1a]/10'}`}
              >Primary ONLY</button>
              <button 
                onClick={() => setMode('primary-secondary')}
                className={`py-3 text-[10px] uppercase tracking-widest border transition-all ${mode === 'primary-secondary' ? 'bg-[#1a1a1a] text-white' : 'border-[#1a1a1a]/10'}`}
              >Primary → JPN</button>
              <button 
                onClick={() => setMode('secondary-primary')}
                className={`py-3 text-[10px] uppercase tracking-widest border transition-all ${mode === 'secondary-primary' ? 'bg-[#1a1a1a] text-white' : 'border-[#1a1a1a]/10'}`}
              >JPN → Primary</button>
            </div>
          </div>
          <div className="space-y-4 text-left">
            <span className="text-[9px] uppercase tracking-widest text-[#1a1a1a]/40 block">Velocity ({speed}x)</span>
            <input 
              type="range" min="0.5" max="2.0" step="0.1" 
              value={speed} onChange={e => setSpeed(parseFloat(e.target.value))}
              className="w-full accent-black"
            />
            <div className="flex justify-between text-[8px] uppercase tracking-widest opacity-30">
              <span>Slow</span>
              <span>Fast</span>
            </div>
          </div>
        </div>

        <button 
          onClick={togglePlay}
          disabled={cards.length === 0}
          className="w-full h-24 bg-[#1a1a1a] text-[#fdfbf7] flex items-center justify-center gap-4 hover:bg-transparent hover:text-[#1a1a1a] border border-[#1a1a1a] transition-all disabled:opacity-30 group"
        >
          {isPlaying ? <X size={24} /> : <Play size={24} fill="currentColor" />}
          <span className="text-xl font-serif italic">{isPlaying ? 'Cease Algorithm' : 'Execute Loop'}</span>
        </button>
      </div>
    </motion.div>
  );
}

// --- GeneralSettings.tsx ---
function GeneralSettings({ onBack, soundEnabled, setSoundEnabled, preferredVoice, setPreferredVoice, onLogout, user }: { 
  onBack: () => void,
  soundEnabled: boolean,
  setSoundEnabled: (v: boolean) => void,
  preferredVoice: string,
  setPreferredVoice: (v: any) => void,
  onLogout: () => void,
  user: User | null,
}) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-xl mx-auto bg-white p-16 border border-[#1a1a1a]/10 academic-shadow relative"
    >
      <div className="flex items-center justify-between mb-10">
        <h2 className="text-5xl font-serif italic">Global Config</h2>
        <button onClick={onBack} className="p-2 hover:bg-black/5 rounded-full"><X size={20} /></button>
      </div>

      <div className="space-y-12">
        

        <section className="space-y-6">
          <div className="flex items-center gap-3 text-[#1a1a1a]">
            <Layers size={20} strokeWidth={1} />
            <h3 className="text-[10px] uppercase tracking-[0.3em] font-medium">Audio Profile</h3>
          </div>
          <div className="p-8 border border-black/5 bg-[#fdfbf7] space-y-4 text-center">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#1a1a1a]">Strict Locale: EN-GB (British English)</span>
            <p className="text-[9px] text-[#1a1a1a]/40 leading-relaxed italic">
              ※ 音声のズレを防ぐため、すべての読み上げをイギリス英語に固定しました。
            </p>
          </div>
        </section>

        <section className="space-y-6">
          <div className="flex items-center gap-3 text-[#1a1a1a]">
            <Archive size={20} strokeWidth={1} />
            <h3 className="text-[10px] uppercase tracking-[0.3em] font-medium">Export Code</h3>
          </div>
          <div className="p-8 border border-black/5 flex flex-col gap-4 text-center">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#1a1a1a]">Download Application Source</span>
            <p className="text-[9px] text-[#1a1a1a]/40 leading-relaxed italic">
              現在の環境に含まれる最新のソースコードをZIP形式でダウンロードします。（APIキー等は含まれません）
            </p>
            <a 
              href="/aster-flashcard-source.zip" 
              download="aster-flashcard-source.zip"
              className="mt-4 px-6 py-4 bg-[#1a1a1a] text-[#fdfbf7] text-[10px] font-medium uppercase tracking-[0.2em] hover:bg-black/80 transition-all border border-[#1a1a1a]"
            >
              Download Code ZIP
            </a>
          </div>
        </section>

        <section className="space-y-6">
          <div className="flex items-center gap-3 text-[#1a1a1a]">
            <LogOut size={20} strokeWidth={1} />
            <h3 className="text-[10px] uppercase tracking-[0.3em] font-medium">Session Control</h3>
          </div>
          <div className="p-8 border border-black/5 flex items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-black/5 flex items-center justify-center overflow-hidden border border-black/5">
                {user?.photoURL ? <img src={user.photoURL} alt="" /> : <UserIcon size={20} className="text-black/20" />}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-serif italic truncate">{user?.displayName || 'Knowledge Seeker'}</div>
                <div className="text-[8px] uppercase tracking-widest opacity-30 truncate">{user?.email}</div>
              </div>
            </div>
            <button 
              onClick={onLogout}
              className="px-6 py-2.5 text-[9px] uppercase tracking-widest font-bold border border-red-200 text-red-500 hover:bg-red-500 hover:text-white transition-all"
            >
              Sign Out
            </button>
          </div>
        </section>

        <button 
          onClick={onBack}
          className="w-full bg-[#1a1a1a] text-[#fdfbf7] py-6 text-[10px] font-medium uppercase tracking-[0.3em] flex items-center justify-center gap-4 hover:bg-transparent hover:text-[#1a1a1a] border border-[#1a1a1a] transition-all"
        >
          <ArrowLeft size={16} />
          <span>Exit configuration</span>
        </button>
      </div>
    </motion.div>
  );
}

// --- Deck Form Component ---

function DeckForm({ initialData, onSave, onCancel }: { 
  initialData?: Deck,
  onSave: (n: string, d: string, i: string, ci: string, lang: string) => Promise<void> | void, 
  onCancel: () => void 
}) {
  const [name, setName] = useState(initialData?.name || '');
  const [desc, setDesc] = useState(initialData?.description || '');
  const [icon, setIcon] = useState(initialData?.icon || 'BookOpen');
  const [coverImage, setCoverImage] = useState(initialData?.coverImage || '');
  const [language, setLanguage] = useState(initialData?.language || 'en-GB');
  const [isSaving, setIsSaving] = useState(false);

  // Cropping state
  const [tempImage, setTempImage] = useState<string | null>(null);
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);

  const iconOptions = [
    { name: 'BookOpen', comp: <BookOpen size={20} /> },
    { name: 'GraduationCap', comp: <GraduationCap size={20} /> },
    { name: 'Star', comp: <Star size={20} /> },
    { name: 'Atom', comp: <Atom size={20} /> },
    { name: 'Globe', comp: <Globe size={20} /> },
    { name: 'PenTool', comp: <PenTool size={20} /> },
    { name: 'Coffee', comp: <Coffee size={20} /> },
    { name: 'Code', comp: <Code size={20} /> },
    { name: 'Music', comp: <Music size={20} /> },
    { name: 'Map', comp: <MapIcon size={20} /> },
    { name: 'Microscope', comp: <Microscope size={20} /> },
    { name: 'Languages', comp: <Languages size={20} /> },
  ];

  const languageOptions = [
    { value: 'en-GB', label: 'English (British)' },
    { value: 'en-US', label: 'English (US)' },
    { value: 'ja-JP', label: 'Japanese' },
    { value: 'fi-FI', label: 'Finnish' },
  ];

  const coverInputRef = useRef<HTMLInputElement>(null);

  const handleCoverUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        setTempImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const onCropComplete = (croppedArea: Area, croppedAreaPixels: Area) => {
    setCroppedAreaPixels(croppedAreaPixels);
  };

  const handleApplyCrop = async () => {
    if (tempImage && croppedAreaPixels) {
      try {
        const cropped = await getCroppedImg(tempImage, croppedAreaPixels);
        setCoverImage(cropped);
        setTempImage(null);
      } catch (e) {
        console.error(e);
      }
    }
  };

  const handleSave = async () => {
    if (!name.trim() || isSaving) return;
    setIsSaving(true);
    try {
      await onSave(name, desc, icon, coverImage, language);
    } catch (e) {
      console.error(e);
      alert('Failed to save registry. Please ensure the image is not too large.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-xl mx-auto bg-white p-16 border border-[#1a1a1a]/10 academic-shadow relative"
    >
      {/* Cropping Modal */}
      {tempImage && (
        <div className="fixed inset-0 z-[150] bg-black flex flex-col items-center justify-center p-6">
          <div className="relative w-full max-w-lg aspect-square bg-[#1a1a1a]/20 overflow-hidden">
            <Cropper
              image={tempImage}
              crop={crop}
              zoom={zoom}
              aspect={1}
              onCropChange={setCrop}
              onCropComplete={onCropComplete}
              onZoomChange={setZoom}
            />
          </div>
          <div className="w-full max-w-2xl mt-8 flex flex-col gap-6">
            <div className="flex items-center gap-4">
              <span className="text-white/40 text-[9px] uppercase tracking-widest">Zoom</span>
              <input
                type="range"
                value={zoom}
                min={1}
                max={3}
                step={0.1}
                aria-labelledby="Zoom"
                onChange={(e) => setZoom(Number(e.target.value))}
                className="flex-1 accent-white"
              />
            </div>
            <div className="flex gap-4">
              <button 
                onClick={handleApplyCrop}
                className="flex-1 bg-white text-black p-4 text-[10px] font-medium uppercase tracking-widest hover:bg-[#fdfbf7] transition-all flex items-center justify-center gap-2"
              >
                <Crop size={16} />
                <span>Apply Crop</span>
              </button>
              <button 
                onClick={() => setTempImage(null)}
                className="flex-1 border border-white/20 text-white p-4 text-[10px] font-medium uppercase tracking-widest hover:bg-white/5 transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <h2 className="text-5xl font-serif italic mb-10">{initialData ? 'Refine Registry' : 'New Stack'}</h2>
      <div className="space-y-10">
        <div>
          <label className="block text-[9px] font-medium uppercase tracking-[0.3em] text-[#1a1a1a]/40 mb-3">Identity / Label</label>
          <input 
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="KNOWLEDGE_DOMAIN_01"
            className="w-full text-xl p-4 border border-[#1a1a1a]/10 focus:border-[#1a1a1a] focus:outline-none placeholder:text-[#1a1a1a]/10 font-serif italic"
          />
        </div>
        <div>
          <label className="block text-[9px] font-medium uppercase tracking-[0.3em] text-[#1a1a1a]/40 mb-3">Context / Meta-Description</label>
          <textarea 
            value={desc}
            onChange={e => setDesc(e.target.value)}
            placeholder="Define registry purpose and scholarly scope..."
            className="w-full text-sm p-4 border border-[#1a1a1a]/10 focus:border-[#1a1a1a] focus:outline-none min-h-[140px] resize-none italic"
          />
        </div>

        <div>
           <label className="block text-[9px] font-medium uppercase tracking-[0.3em] text-[#1a1a1a]/40 mb-3">Symbol / Icon</label>
           <div className="grid grid-cols-6 gap-2">
             {iconOptions.map(opt => (
               <button
                 key={opt.name}
                 type="button"
                 onClick={() => setIcon(opt.name)}
                 className={`aspect-square flex items-center justify-center border transition-all ${icon === opt.name ? 'bg-[#1a1a1a] text-[#fdfbf7] border-[#1a1a1a]' : 'border-[#1a1a1a]/10 text-[#1a1a1a]/40 hover:border-[#1a1a1a]'}`}
               >
                 {opt.comp}
               </button>
             ))}
           </div>
        </div>

        <div>
          <label className="block text-[9px] font-medium uppercase tracking-[0.3em] text-[#1a1a1a]/40 mb-3">Deck Language</label>
          <div className="grid grid-cols-2 gap-2">
            {languageOptions.map(opt => (
              <label 
                key={opt.value} 
                className={`border p-4 text-center cursor-pointer transition-all ${language === opt.value ? 'bg-[#1a1a1a] text-[#fdfbf7] border-[#1a1a1a]' : 'border-[#1a1a1a]/10 text-[#1a1a1a]/40 hover:border-[#1a1a1a]'}`}
              >
                <input 
                  type="radio" 
                  name="language" 
                  value={opt.value} 
                  checked={language === opt.value} 
                  onChange={(e) => setLanguage(e.target.value)} 
                  className="hidden" 
                />
                <span className="text-[10px] font-bold tracking-widest">{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-[9px] font-medium uppercase tracking-[0.3em] text-[#1a1a1a]/40 mb-3">Visual / Cover Image</label>
          <input 
            type="file"
            accept="image/*"
            className="hidden"
            ref={coverInputRef}
            onChange={handleCoverUpload}
          />
          <div 
            onClick={() => coverInputRef.current?.click()}
            className="w-80 h-80 mx-auto border border-dashed border-[#1a1a1a]/20 flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-[#1a1a1a]/5 transition-all overflow-hidden relative group"
          >
            {coverImage ? (
              <>
                <img src={coverImage} alt="Cover Preview" className="absolute inset-0 w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity" />
                <div className="relative z-10 flex flex-col items-center bg-white/40 backdrop-blur-sm p-4 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                  <Upload size={20} className="text-[#1a1a1a]" />
                  <span className="text-[8px] uppercase tracking-widest mt-1">Change Media</span>
                </div>
              </>
            ) : (
              <>
                <ImageIcon size={24} className="text-[#1a1a1a]/20" />
                <span className="text-[8px] uppercase tracking-widest text-[#1a1a1a]/40">Upload Visual Source</span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-4 pt-6">
          <button 
            onClick={handleSave}
            disabled={!name.trim() || isSaving}
            className="flex-1 bg-[#1a1a1a] text-[#fdfbf7] px-8 py-4 text-[10px] uppercase font-medium tracking-widest hover:bg-transparent hover:text-[#1a1a1a] border border-[#1a1a1a] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {isSaving ? 'Synchronizing...' : (initialData ? 'Execute Update' : 'Initialize Registry')}
          </button>
          <button 
            onClick={onCancel}
            disabled={isSaving}
            className="flex-1 px-8 py-4 text-[10px] font-medium uppercase tracking-widest text-[#1a1a1a]/30 hover:text-[#1a1a1a] transition-colors disabled:opacity-10"
          >
            Cancel
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// --- AI Import Component ---

function AIImport({ deck, onImport, onCancel }: { deck: Deck, onImport: (cards: ExtractedCard[]) => void, onCancel: () => void }) {
  const [mode, setMode] = useState<'image' | 'text' | 'audio' | 'interactive' | null>(null);
  const [extractionType, setExtractionType] = useState<'general' | 'sentences' | 'paraphrase'>('general');
  const [sourceMode, setSourceMode] = useState<'image' | 'audio' | null>(null);
  const [isManual, setIsManual] = useState(false);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState('');
  const [previewFiles, setPreviewFiles] = useState<{name: string, base64: string, type?: string}[]>([]);
  const [transcription, setTranscription] = useState('');
  const [manualCards, setManualCards] = useState<ExtractedCard[]>([]);
  const [curFront, setCurFront] = useState('');
  const [curBack, setCurBack] = useState('');
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    const availableSlots = 20 - previewFiles.length;
    const filesToProcess = files.slice(0, availableSlots);

    filesToProcess.forEach((file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        setPreviewFiles(prev => [...prev, { name: file.name, base64: reader.result as string, type: file.type }]);
      };
      reader.readAsDataURL(file);
    });
  };

  const executeExtraction = async () => {
    setLoading(true);
    try {
      if ((mode === 'image' || mode === 'audio') && isManual) {
        const fullText = [];
        for (const file of previewFiles) {
          if (mode === 'image') {
            const resizedData = await shrinkImage(file.base64);
            const t = await transcribeImage(resizedData);
            fullText.push(`[MEDIA: ${file.name}]\n${t}`);
          } else {
            const t = await transcribeAudio(file.base64, (file as any).type || 'audio/mpeg');
            fullText.push(`[AUDIO: ${file.name}]\n${t}`);
          }
        }
        setTranscription(fullText.join('\n\n---\n\n'));
        setMode('interactive');
      } else {
        let results: ExtractedCard[] = [];
        if (mode === 'image') {
          const resizedImages = [];
          for (const f of previewFiles) {
            resizedImages.push(await shrinkImage(f.base64));
          }
          results = await extractCardsFromImages(resizedImages);
        } else if (mode === 'text') {
          if (extractionType === 'sentences') {
            results = await extractSentenceCardsFromText(text);
          } else if (extractionType === 'paraphrase') {
            results = await extractParaphraseCardsFromText(text);
          } else {
            results = await extractCardsFromText(text);
          }
        } else if (mode === 'audio') {
          const audioPayload = previewFiles.map(f => ({ base64: f.base64, mimeType: (f as any).type || 'audio/mpeg' }));
          results = await extractCardsFromAudio(audioPayload);
        }
        
        if (results.length === 0) {
          alert("コンテンツからカードを抽出できませんでした。入力したテキストの内容（単語とその意味が含まれているか）を確認してください。");
        } else {
          await onImport(results);
          alert(`${results.length}枚のカードを追加しました。`);
        }
      }
    } catch (error: any) {
       console.error(error);
       const errorMsg = error?.message || "";
       if (errorMsg.includes("quota")) {
         alert("AIの利用制限に達しました。しばらく時間をおいてから再度お試しください。");
       } else if (errorMsg.includes("Large")) {
         alert("画像サイズが大きすぎます。リサイズしていますが、さらに小さい画像でお試しください。");
       } else {
         alert(`AI抽出中にエラーが発生しました: ${errorMsg || "不明なエラー"}\n画像の枚数を減らすか、しばらく時間を置いて再度お試しください。`);
       }
    } finally {
      setLoading(false);
    }
  };

  const addManualCard = () => {
    if (!curFront.trim() || !curBack.trim()) return;
    setManualCards([...manualCards, { front: curFront, back: curBack }]);
    setCurFront('');
    setCurBack('');
    soundService.playTap();
  };

  const handleSelectionTo = (target: 'front' | 'back') => {
    const sel = window.getSelection()?.toString();
    if (!sel) return;
    if (target === 'front') setCurFront(prev => prev ? prev + '\n' + sel : sel);
    else setCurBack(prev => prev ? prev + '\n' + sel : sel);
  };

  if (mode === 'interactive') {
    return (
      <motion.div 
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        className="max-w-5xl mx-auto bg-white p-8 border border-[#1a1a1a]/10 academic-shadow flex flex-col md:flex-row gap-8"
      >
        <div className="flex-1 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] uppercase tracking-[0.2em] font-medium text-[#1a1a1a]/40">Transcribed Source</h3>
            <div className="flex gap-2">
              <button onClick={() => handleSelectionTo('front')} className="px-3 py-1 border border-[#1a1a1a] text-[9px] uppercase hover:bg-black hover:text-white transition-all">To Front</button>
              <button onClick={() => handleSelectionTo('back')} className="px-3 py-1 border border-[#1a1a1a] text-[9px] uppercase hover:bg-black hover:text-white transition-all">To Back</button>
            </div>
          </div>
          <div className="p-6 bg-[#fdfbf7] border border-[#1a1a1a]/5 min-h-[400px] max-h-[600px] overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap font-serif italic text-[#1a1a1a]/80">
            {transcription}
          </div>
        </div>

        <div className="w-full md:w-80 space-y-8">
          <div className="space-y-4">
            <h3 className="text-[10px] uppercase tracking-[0.2em] font-medium text-[#1a1a1a]/40">Active Card Builder</h3>
            <textarea 
              value={curFront} onChange={e => setCurFront(e.target.value)}
              placeholder="FRONT CONTENT"
              className="w-full p-4 border border-[#1a1a1a]/10 text-xs min-h-[100px] bg-[#fdfbf7] resize-none uppercase"
            />
            <textarea 
              value={curBack} onChange={e => setCurBack(e.target.value)}
              placeholder="BACK CONTENT"
              className="w-full p-4 border border-[#1a1a1a]/10 text-xs min-h-[100px] bg-[#fdfbf7] resize-none uppercase"
            />
            <button 
              onClick={addManualCard}
              disabled={!curFront.trim() && !curBack.trim()}
              className="w-full bg-[#1a1a1a] text-[#fdfbf7] py-3 text-[10px] uppercase tracking-widest disabled:opacity-20 hover:bg-transparent hover:text-[#1a1a1a] border border-[#1a1a1a] transition-all active:scale-[0.98] relative z-10"
            >
              Add Card ({manualCards.length} saved)
            </button>
          </div>

          <div className="pt-8 border-t border-[#1a1a1a]/5 flex flex-col gap-4">
            <button 
              onClick={() => onImport(manualCards)}
              disabled={manualCards.length === 0}
              className="w-full bg-black text-white py-4 text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-10"
            >
              <Check size={16} />
              <span>Import {manualCards.length} Cards</span>
            </button>
        <div className="flex flex-col gap-4 mt-8">
            <button onClick={() => setMode(sourceMode || 'image')} className="text-[10px] uppercase font-bold text-[#1a1a1a] hover:underline tracking-widest text-center py-2 px-4 border border-black/10 rounded-sm">
              ← Re-scan Source Media
            </button>
          </div>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="max-w-3xl mx-auto bg-white p-12 border border-[#1a1a1a]/10 academic-shadow"
    >
      <div className="flex flex-col md:flex-row items-center justify-between gap-6 mb-12">
        <h2 className="text-4xl font-serif italic flex items-center gap-4">
          <Sparkles className="text-[#1a1a1a]" /> Intelligence Extraction
        </h2>
        
        <button onClick={onCancel} className="p-2 hover:bg-[#1a1a1a]/5 rounded-full outline-none">
          <X size={20} />
        </button>
      </div>

      {!mode ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <button 
              onClick={() => { setMode('image'); setSourceMode('image'); }}
              className="group flex flex-col items-center justify-center p-10 border-2 border-[#1a1a1a]/10 hover:border-[#1a1a1a] transition-all space-y-6 bg-white active:scale-95"
            >
              <ImageIcon size={48} strokeWidth={1} className="opacity-40 group-hover:opacity-100 transition-opacity" />
              <span className="font-bold uppercase tracking-[0.2em] text-[10px]">Image OCR</span>
            </button>
            <button 
              onClick={() => setMode('text')}
              className="group flex flex-col items-center justify-center p-10 border-2 border-[#1a1a1a]/10 hover:border-[#1a1a1a] transition-all space-y-6 bg-white active:scale-95"
            >
              <TypeIcon size={48} strokeWidth={1} className="opacity-40 group-hover:opacity-100 transition-opacity" />
              <span className="font-bold uppercase tracking-[0.2em] text-[10px]">Synthesizer</span>
            </button>
            <button 
              onClick={() => { setMode('audio'); setSourceMode('audio'); }}
              className="group flex flex-col items-center justify-center p-10 border-2 border-[#1a1a1a]/10 hover:border-[#1a1a1a] transition-all space-y-6 bg-white active:scale-95"
            >
              <Mic size={48} strokeWidth={1} className="opacity-40 group-hover:opacity-100 transition-opacity" />
              <span className="font-bold uppercase tracking-[0.2em] text-[10px]">Audio Transcriber</span>
            </button>
          </div>
      ) : (
        <div className="space-y-8">
          <button onClick={() => setMode(null)} className="text-[9px] uppercase font-medium text-[#1a1a1a]/40 hover:text-[#1a1a1a] flex items-center gap-2 tracking-widest transition-colors mb-6">
            <ArrowLeft size={14} /> Back to selection
          </button>

          {(mode === 'image' || mode === 'audio') && (
            <div className="space-y-6">
              <input 
                type="file" 
                multiple 
                accept={mode === 'image' ? "image/*" : "audio/*,audio/mpeg,audio/wav,audio/mp4,audio/x-m4a,audio/ogg,.mp3,.wav,.m4a"} 
                className="hidden" 
                ref={fileInputRef} 
                onChange={handleFileChange}
              />
              <div 
                onClick={() => previewFiles.length < 20 && fileInputRef.current?.click()}
                className={`w-full h-48 border border-dashed flex flex-col items-center justify-center gap-4 transition-all ${previewFiles.length < 20 ? 'border-[#1a1a1a]/20 cursor-pointer hover:bg-[#1a1a1a]/5' : 'border-[#1a1a1a]/5 cursor-not-allowed'}`}
              >
                <div className="w-12 h-12 border border-[#1a1a1a]/10 rounded-full flex items-center justify-center">
                  <Upload size={20} strokeWidth={1.5} className="text-[#1a1a1a]/40" />
                </div>
                <div className="text-center">
                  <span className="block font-medium text-[10px] uppercase tracking-widest">
                    {previewFiles.length < 20 ? `Upload Media (${previewFiles.length}/20)` : 'Capacity Reached'}
                  </span>
                  <span className="text-[9px] text-[#1a1a1a]/30 uppercase tracking-tighter mt-1 block">Maximum 20 distinct nodes</span>
                </div>
              </div>

              <div className="flex items-center gap-3 p-4 border border-[#1a1a1a]/5 bg-[#fdfbf7]">
                <input 
                  type="checkbox" 
                  id="manual-chk" 
                  checked={isManual} 
                  onChange={e => setIsManual(e.target.checked)}
                  className="w-4 h-4 accent-black"
                />
                <label htmlFor="manual-chk" className="text-[10px] uppercase tracking-widest font-medium cursor-pointer select-none">
                  Manual Extraction Mode (Verify transcription & build cards manually)
                </label>
              </div>

              {previewFiles.length > 0 && (
                <div className="grid grid-cols-5 md:grid-cols-7 gap-3">
                  {previewFiles.map((f, i) => (
                    <div key={i} className="aspect-square border border-[#1a1a1a]/10 overflow-hidden relative group academic-shadow flex items-center justify-center bg-[#fdfbf7]">
                      {mode === 'image' ? (
                        <img src={f.base64} alt={f.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="flex flex-col items-center gap-1 p-2">
                          <Music size={16} className="text-black/40" />
                          <span className="text-[6px] uppercase truncate w-full text-center tracking-tighter">{f.name}</span>
                        </div>
                      )}
                      <button 
                        onClick={() => setPreviewFiles(p => p.filter((_, idx) => idx !== i))}
                        className="absolute inset-0 bg-[#1a1a1a]/80 items-center justify-center hidden group-hover:flex"
                      >
                        <X size={16} className="text-[#fdfbf7]" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {mode === 'text' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row gap-2">
                <button 
                  onClick={() => setExtractionType('general')}
                  className={`flex-1 py-3 px-2 text-[10px] uppercase tracking-widest border transition-all flex items-center justify-center gap-2 ${extractionType === 'general' ? 'bg-black text-white border-black' : 'border-black/10 text-black/40 hover:border-black'}`}
                >
                  <TypeIcon size={14} /> General
                </button>
                <button 
                  onClick={() => setExtractionType('sentences')}
                  className={`flex-1 py-3 px-2 text-[10px] uppercase tracking-widest border transition-all flex items-center justify-center gap-2 ${extractionType === 'sentences' ? 'bg-black text-white border-black' : 'border-black/10 text-black/40 hover:border-black'}`}
                >
                  <AlignLeft size={14} /> Sentences
                </button>
                <button 
                  onClick={() => setExtractionType('paraphrase')}
                  className={`flex-1 py-3 px-2 text-[10px] uppercase tracking-widest border transition-all flex items-center justify-center gap-2 ${extractionType === 'paraphrase' ? 'bg-black text-white border-black' : 'border-black/10 text-black/40 hover:border-black'}`}
                >
                  <TypeIcon size={14} /> Vocab/Paraphrase
                </button>
              </div>
              <textarea 
                autoFocus
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder={extractionType === 'general' ? "Paste raw data, scholarly articles, or linguistic excerpts here..." : extractionType === 'sentences' ? "Paste English sentences or texts you want to memorize. The AI will translate them for the card fronts." : "Paste text to extract word paraphrases or synonyms. E.g. '日本語 -> 英単語 & 類語', or 'Expression -> Paraphrase'"}
                className="w-full h-80 bg-[#fdfbf7] border border-[#1a1a1a]/10 p-8 outline-none focus:border-[#1a1a1a] transition-all text-sm italic resize-none"
              />
            </div>
          )}

          <div className="pt-8">
            <button 
              onClick={executeExtraction}
              disabled={loading || (mode === 'text' ? !text.trim() : previewFiles.length === 0) }
              className="w-full bg-[#1a1a1a] text-[#fdfbf7] py-6 text-[10px] font-medium uppercase tracking-[0.3em] flex items-center justify-center gap-4 hover:bg-transparent hover:text-[#1a1a1a] border border-[#1a1a1a] transition-all disabled:opacity-10"
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin" size={18} />
                  <span>Synthesizing Knowledge...</span>
                </>
              ) : (
                <>
                  <Sparkles size={18} />
                  <span>Execute AI Algorithm</span>
                </>
              )}
            </button>
            
            {(mode === 'text' && !text.trim()) && (
              <p className="text-[8px] text-black/20 text-center mt-2 uppercase tracking-tight">Input text required to proceed</p>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
}
