export interface ExtractedCard {
  front: string;
  back: string;
}

type GeminiAction =
  | "transcribeImage"
  | "transcribeAudio"
  | "parseTextToCards"
  | "extractCardsFromText"
  | "extractSentenceCardsFromText"
  | "extractParaphraseCardsFromText"
  | "getCardExplanation";

interface GeminiApiResponse<T> {
  data?: T;
  error?: string;
}

function log(msg: string) {
  console.log(msg);
  if (typeof window !== "undefined" && (window as any).addAppLog) {
    (window as any).addAppLog(msg);
  }
}

async function callGeminiApi<T>(action: GeminiAction, payload: Record<string, unknown>): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api/gemini", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action, ...payload }),
    });
  } catch {
    throw new Error("GeminiサーバーAPIに接続できません。Vercel環境または `vercel dev` で起動しているか確認してください。");
  }

  let body: GeminiApiResponse<T> = {};
  try {
    body = await response.json();
  } catch (error) {
    throw new Error("Gemini APIから不正なレスポンスが返されました。");
  }

  if (!response.ok) {
    throw new Error(body.error || `Gemini API request failed with status ${response.status}`);
  }

  if (!("data" in body)) {
    throw new Error("Gemini APIからdataフィールドのないレスポンスが返されました。");
  }

  return body.data as T;
}

function normalizeCards(value: unknown): ExtractedCard[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((card) => typeof card?.front === "string" && typeof card?.back === "string")
    .map((card) => ({
      front: card.front.trim(),
      back: card.back.trim(),
    }))
    .filter((card) => card.front !== "" && card.back !== "");
}

/**
 * Transcribes all text from an image for manual card creation.
 */
export async function transcribeImage(base64: string): Promise<string> {
  const data = base64.split(",")[1] || base64;
  log(`OCR: Transcribing image (${(data.length / 1024 / 1024).toFixed(2)} MB)...`);

  try {
    const text = await callGeminiApi<string>("transcribeImage", { base64 });
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
    const text = await callGeminiApi<string>("transcribeAudio", { base64, mimeType });
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
    const cards = normalizeCards(await callGeminiApi<ExtractedCard[]>("parseTextToCards", { text }));
    log(`AI: Successfully extracted ${cards.length} cards.`);
    return cards;
  } catch (e: any) {
    log(`AI: Parsing failed. ${e?.message}`);
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
    const cards = normalizeCards(await callGeminiApi<ExtractedCard[]>("extractCardsFromText", { text }));
    log(`AI: Text extraction successful. Found ${cards.length} cards.`);
    return cards;
  } catch (e: any) {
    console.error("Failed to extract cards from text", e);
    log(`AI: Text extraction failed. ${e?.message}`);
    throw e;
  }
}

/**
 * Extracts sentence memorization cards (Japanese Front -> English Back)
 */
export async function extractSentenceCardsFromText(text: string): Promise<ExtractedCard[]> {
  try {
    log("AI: Extracting sentence memorization cards (L1 -> L2)...");
    const cards = normalizeCards(await callGeminiApi<ExtractedCard[]>("extractSentenceCardsFromText", { text }));
    log(`AI: Sentence extraction successful. Found ${cards.length} cards.`);
    return cards;
  } catch (e: any) {
    console.error("Failed to extract sentence cards from text", e);
    log(`AI: Sentence extraction failed. ${e?.message}`);
    throw e;
  }
}

/**
 * Extracts paraphrase or synonym vocabulary cards based on input text structure.
 */
export async function extractParaphraseCardsFromText(text: string): Promise<ExtractedCard[]> {
  try {
    log("AI: Extracting paraphrase/vocabulary cards...");
    const cards = normalizeCards(await callGeminiApi<ExtractedCard[]>("extractParaphraseCardsFromText", { text }));
    log(`AI: Paraphrase extraction successful. Found ${cards.length} cards.`);
    return cards;
  } catch (e: any) {
    console.error("Failed to extract paraphrase cards from text", e);
    log(`AI: Paraphrase extraction failed. ${e?.message}`);
    throw e;
  }
}

/**
 * Gets a detailed explanation of a card's content.
 */
export async function getCardExplanation(front: string, back: string): Promise<string> {
  try {
    log("AI: Getting card explanation...");
    return await callGeminiApi<string>("getCardExplanation", { front, back });
  } catch (error) {
    const err = error as Error;
    log(`AI Error: ${err.message}`);
    throw error;
  }
}
