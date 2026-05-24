import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";

// Ensure AI is initialized with a check for the key
let aiInstance: GoogleGenAI | null = null;

function getAI(): GoogleGenAI {
  if (aiInstance) {
    // If the instance exists but the key might have been invalid, we re-verify
    const currentKey = getAPIKey();
    if (currentKey && !currentKey.includes('MY_GEMINI_API_KEY')) {
      return aiInstance;
    }
  }
  
  let key = getAPIKey();

  if (!key) {
    throw new Error("GEMINI_API_KEYが未設定または無効です。AI StudioのSettings（設定）メニューのSecretsから有効なAPIキーを設定してください。既に設定済みの場合は、APIキーが正しいか確認してください。 (キーが見つかりません)");
  }
  
  // Log a safe hint about the key
  const hint = key.length > 8 ? `${key.substring(0, 4)}...${key.substring(key.length - 4)}` : "TOO_SHORT";
  log(`AI: Initializing with key hint: ${hint}`);

  aiInstance = new GoogleGenAI({ apiKey: key });
  return aiInstance;
}

/**
 * Robustly retrieves the Gemini API key from various potential environment sources.
 */
function getAPIKey(): string | undefined {
  const g = (typeof window !== 'undefined' ? window : {}) as any;
  
  const sources = [
    () => g.process?.env?.GEMINI_API_KEY,
    () => g.process?.env?.VITE_GEMINI_API_KEY,
    () => (import.meta as any).env?.VITE_GEMINI_API_KEY,
    () => (import.meta as any).env?.GEMINI_API_KEY,
    // Note: literal process.env.X might be replaced by Vite define, so we keep it last
    () => process.env.GEMINI_API_KEY
  ];

  for (const s of sources) {
    try {
      const val = s();
      if (typeof val === 'string' && val.trim() !== '' && val !== 'undefined' && val !== 'null' && !val.includes('MY_GEMINI_API_KEY')) {
        return val.trim();
      }
    } catch (e) {}
  }

  return undefined;
}

export interface ExtractedCard {
  front: string;
  back: string;
}

const cardSchema = {
  type: Type.OBJECT,
  properties: {
    cards: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          front: { type: Type.STRING },
          back: { type: Type.STRING },
        },
        required: ["front", "back"],
      },
    },
  },
  required: ["cards"],
};

// Helper to log both to console and the app UI
function log(msg: string) {
  console.log(msg);
  if (typeof window !== "undefined" && (window as any).addAppLog) {
    (window as any).addAppLog(msg);
  }
}

/**
 * Transcribes all text from an image for manual card creation.
 */
export async function transcribeImage(base64: string): Promise<string> {
  const mimeMatch = base64.match(/^data:([^;]+);base64,/);
  const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";
  const data = base64.split(",")[1] || base64;

  log(`OCR: Transcribing image (${(data.length / 1024 / 1024).toFixed(2)} MB)...`);

  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-flash-latest",
      contents: {
        parts: [
          { inlineData: { mimeType, data } },
          { text: "この画像に含まれるテキストをすべて正確に書き出してください。数式、記号、表の構造なども可能な限り再現してください。学習用カード作成の素材として使用します。" },
        ],
      },
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
      }
    });
    
    const text = response.text || "";
    log(`OCR: Success. Read ${text.length} chars.`);
    return text;
  } catch (e: any) {
    log(`OCR: FAILED. Error: ${e?.message || "Unknown"}`);
    throw e;
  }
}

/**
 * Transcribes audio for manual card creation.
 */
export async function transcribeAudio(base64: string, mimeType: string): Promise<string> {
  const data = base64.split(",")[1] || base64;

  log(`AI: Transcribing audio (${(data.length / 1024 / 1024).toFixed(2)} MB)...`);

  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-flash-latest",
      contents: {
        parts: [
          { inlineData: { mimeType, data } },
          { text: "この音声を正確に文字起こししてください。英語と日本語が含まれる場合は両方を書き出してください。学習用カード作成の素材として使用します。" },
        ],
      },
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
      }
    });
    
    const text = response.text || "";
    log(`AI: Transcription success. Read ${text.length} chars.`);
    return text;
  } catch (e: any) {
    log(`AI: Audio transcription FAILED. Error: ${e?.message || "Unknown"}`);
    throw e;
  }
}

/**
 * Extracts cards from a batch of transcribed text.
 */
async function parseTextToCards(text: string): Promise<ExtractedCard[]> {
  if (!text.trim()) return [];

  log("AI: Structuring text into flashcard pairs...");

  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-flash-latest",
      contents: {
        parts: [
          { text: `以下のテキストから「英語」と「それに対応する和訳」のペアをすべて抽出し、JSON形式 {'cards': [{'front': '...', 'back': '...'}]} で出力してください。漏れがないように！\n\nテキスト:\n${text}` },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: cardSchema,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
      },
    });

    const resultText = response.text;
    if (!resultText) {
      log("AI: Empty response during parsing.");
      return [];
    }

    const parsed = JSON.parse(resultText);
    const cards = parsed.cards || [];
    log(`AI: Successfully extracted ${cards.length} cards.`);
    return cards;
  } catch (e: any) {
    log(`AI: Parsing failed. ${e?.message}`);
    
    // Fallback: try without schema
    try {
      log("AI: Fallback mode engaged...");
      const ai = getAI();
      const fallbackResponse = await ai.models.generateContent({
        model: "gemini-flash-latest",
        contents: {
          parts: [
            { text: `Extract flashcard pairs from the following text and return as a JSON list [{'front': '...', 'back': '...'}] ONLY.\n\nText:\n${text}` },
          ],
        },
        config: {
          responseMimeType: "application/json",
        }
      });
      const fallbackText = fallbackResponse.text;
      if (fallbackText) {
        const fallbackCards = JSON.parse(fallbackText);
        log(`AI: Fallback succeeded with ${fallbackCards.length} cards.`);
        return fallbackCards;
      }
    } catch (fallbackError: any) {
      log(`AI: Fallback also failed. ${fallbackError?.message}`);
    }
    
    throw e;
  }
}

export async function extractCardsFromImages(base64Images: string[]): Promise<ExtractedCard[]> {
  log(`Service: Starting extraction for ${base64Images.length} images.`);

  let allResults: ExtractedCard[] = [];

  for (let i = 0; i < base64Images.length; i++) {
    log(`--- Processing Image ${i + 1}/${base64Images.length} ---`);
    try {
      const transcription = await transcribeImage(base64Images[i]);
      if (transcription) {
        const batchCards = await parseTextToCards(transcription);
        allResults = [...allResults, ...batchCards];
      }
    } catch (e: any) {
      log(`Error at index ${i}: ${e?.message}`);
      // Only throw if we have 0 results so far to allow partial success in batches
      if (allResults.length === 0 && i === base64Images.length - 1) {
        throw e;
      }
    }
  }

  log(`Service: Completed. Total cards: ${allResults.length}`);
  return allResults;
}

export async function extractCardsFromAudio(audioFiles: { base64: string, mimeType: string }[]): Promise<ExtractedCard[]> {
  log(`Service: Starting audio extraction for ${audioFiles.length} files.`);

  let allResults: ExtractedCard[] = [];

  for (let i = 0; i < audioFiles.length; i++) {
    log(`--- Processing Audio ${i + 1}/${audioFiles.length} ---`);
    try {
      const transcription = await transcribeAudio(audioFiles[i].base64, audioFiles[i].mimeType);
      if (transcription) {
        const batchCards = await parseTextToCards(transcription);
        allResults = [...allResults, ...batchCards];
      }
    } catch (e: any) {
      log(`Audio Error at index ${i}: ${e?.message}`);
      if (allResults.length === 0 && i === audioFiles.length - 1) {
        throw e;
      }
    }
  }

  log(`Service: Completed. Total cards: ${allResults.length}`);
  return allResults;
}

export async function extractCardsFromText(text: string): Promise<ExtractedCard[]> {
  try {
    log("AI: Extracting cards from text...");
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-flash-latest",
      contents: {
        parts: [
          { text: `与えられたテキストから、学習用カード（単語帳）の「表（front）」と「裏（back）」のペアを可能な限りすべて抽出してください。
単語リスト、文章、定義文など、どのような形式でも対応してください。
特に言語学習の場合は「外国語: 意味」を優先してください。
出力は必ず以下のJSON形式にしてください。

JSON形式:
{"cards": [{"front": "...", "back": "..."}]}

テキスト:
${text}` },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: cardSchema,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
      },
    });

    const parsed = JSON.parse(response.text);
    const cards = parsed.cards || [];
    log(`AI: Text extraction successful. Found ${cards.length} cards.`);
    return cards;
  } catch (e: any) {
    console.error("Failed to extract cards from text", e);
    log(`AI: Text extraction failed. ${e?.message}`);
    return [];
  }
}

/**
 * Extracts sentence memorization cards (Japanese Front -> English Back)
 */
export async function extractSentenceCardsFromText(text: string): Promise<ExtractedCard[]> {
  try {
    log("AI: Extracting sentence memorization cards (L1 -> L2)...");
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-flash-latest",
      contents: {
        parts: [
          { text: `与えられたテキストから例文暗記用のカードを作成してください。
表（front）に「日本語訳（意味）」、裏（back）に「元の英文」が来るように抽出してください。
単なる単語ではなく、完全な文章やフレーズを優先してください。
出力は必ず以下のJSON形式にしてください。

JSON形式:
{"cards": [{"front": "日本語の例文や訳", "back": "English sentence"}]}

テキスト:
${text}` },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: cardSchema,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
      },
    });

    const parsed = JSON.parse(response.text);
    const cards = parsed.cards || [];
    log(`AI: Sentence extraction successful. Found ${cards.length} cards.`);
    return cards;
  } catch (e: any) {
    console.error("Failed to extract sentence cards from text", e);
    log(`AI: Sentence extraction failed. ${e?.message}`);
    return [];
  }
}

/**
 * Extracts paraphrase or synonym vocabulary cards based on input text structure
 */
export async function extractParaphraseCardsFromText(text: string): Promise<ExtractedCard[]> {
  try {
    log("AI: Extracting paraphrase/vocabulary cards...");
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-flash-latest",
      contents: {
        parts: [
          { text: `与えられたテキストから、単語や表現の言い換えを暗記するための学習用カードを作成してください。
文脈からユーザーが意図しているペア（例: 「日本語（表）→ 英単語と類語（裏）」や「英語表現（表）→ 別の英語表現や解説（裏）」など）を推測し、適切に抽出してください。
テキストの書き方に基づいて「表(front)」と「裏(back)」を柔軟に分けてください。
出力は必ず以下のJSON形式にしてください。

JSON形式:
{"cards": [{"front": "表側のテキスト (例: 日本語の意味や対象の英語表現)", "back": "裏側のテキスト (例: 対応する英単語・類語、または別の英語表現)"}]}

テキスト:
${text}` },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: cardSchema,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
      },
    });

    const parsed = JSON.parse(response.text);
    const cards = parsed.cards || [];
    log(`AI: Paraphrase extraction successful. Found ${cards.length} cards.`);
    return cards;
  } catch (e: any) {
    console.error("Failed to extract paraphrase cards from text", e);
    log(`AI: Paraphrase extraction failed. ${e?.message}`);
    return [];
  }
}

/**
 * Gets a detailed explanation of a card's content.
 */
export async function getCardExplanation(front: string, back: string): Promise<string> {
  try {
    log("AI: Getting card explanation...");
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-flash-latest", // Use a fast model for explanation
      contents: {
        parts: [
          { text: `あなたは学習・知識構築のエキスパートです。以下のフラッシュカードの表と裏の内容について、ユーザーがより深く理解し、記憶に定着しやすくなるように詳細な解説を提供してください。

カードの内容が「英単語や語学」に関連する場合は、語源、細かいニュアンス、類義語との違い、実際の使い方の例文などを解説してください。
カードの内容が「IT用語、プログラミング、その他の専門知識」に関連する場合は、その仕組み、なぜ使われるのか（メリット）、具体的な用例やユースケース、関連する技術との繋がりなどを詳しく解説してください。

5〜6段落程度のマークダウン形式で、周辺知識も含めてしっかりとボリュームのある説明をしてください。

[表]
${front}

[裏]
${back}` }
        ]
      }
    });

    return response.text || "解析結果がありませんでした。";
  } catch (error) {
    const err = error as Error;
    log(`AI Error: ${err.message}`);
    throw error;
  }
}
