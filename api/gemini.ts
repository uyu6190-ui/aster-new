import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";

type GeminiAction =
  | "status"
  | "transcribeImage"
  | "transcribeAudio"
  | "parseTextToCards"
  | "extractCardsFromText"
  | "extractSentenceCardsFromText"
  | "extractParaphraseCardsFromText"
  | "getCardExplanation";

interface ExtractedCard {
  front: string;
  back: string;
}

interface GeminiRequestBody {
  action?: GeminiAction;
  text?: string;
  base64?: string;
  mimeType?: string;
  front?: string;
  back?: string;
}

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

class GeminiHttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
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

function getAI() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || apiKey.trim() === "" || apiKey.includes("MY_GEMINI_API_KEY")) {
    throw new GeminiHttpError(500, "GEMINI_API_KEY is not configured on the server.");
  }

  return new GoogleGenAI({ apiKey });
}

function hasServerApiKey() {
  const apiKey = process.env.GEMINI_API_KEY;
  return Boolean(apiKey && apiKey.trim() !== "" && !apiKey.includes("MY_GEMINI_API_KEY"));
}

function parseRequestBody(req: any): GeminiRequestBody {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      throw new GeminiHttpError(400, "Request body must be valid JSON.");
    }
  }
  return req.body;
}

function extractInlineData(base64: string, fallbackMimeType: string) {
  const mimeMatch = base64.match(/^data:([^;]+);base64,/);
  const mimeType = mimeMatch ? mimeMatch[1] : fallbackMimeType;
  const data = base64.split(",")[1] || base64;

  return { mimeType, data };
}

function normalizeCards(value: unknown): ExtractedCard[] {
  const cards = Array.isArray(value) ? value : (value as any)?.cards;
  if (!Array.isArray(cards)) return [];

  return cards
    .filter((card) => typeof card?.front === "string" && typeof card?.back === "string")
    .map((card) => ({
      front: card.front.trim(),
      back: card.back.trim(),
    }))
    .filter((card) => card.front !== "" && card.back !== "");
}

function parseJsonResponse(text: string): unknown {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(withoutFence);
  } catch {
    const objectStart = withoutFence.indexOf("{");
    const objectEnd = withoutFence.lastIndexOf("}");
    if (objectStart >= 0 && objectEnd > objectStart) {
      return JSON.parse(withoutFence.slice(objectStart, objectEnd + 1));
    }

    const arrayStart = withoutFence.indexOf("[");
    const arrayEnd = withoutFence.lastIndexOf("]");
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      return JSON.parse(withoutFence.slice(arrayStart, arrayEnd + 1));
    }

    throw new GeminiHttpError(502, "Gemini returned invalid card JSON.");
  }
}

function parseCardsResponse(text?: string): ExtractedCard[] {
  if (!text) return [];
  return normalizeCards(parseJsonResponse(text));
}

async function generateCardJson(prompt: string): Promise<ExtractedCard[]> {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: {
      parts: [{ text: prompt }],
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: cardSchema,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
  });

  return parseCardsResponse(response.text);
}

async function parseTextToCards(text: string): Promise<ExtractedCard[]> {
  try {
    return await generateCardJson(`以下のテキストから「英語」と「それに対応する和訳」のペアをすべて抽出し、JSON形式 {'cards': [{'front': '...', 'back': '...'}]} で出力してください。漏れがないように！\n\nテキスト:\n${text}`);
  } catch (error) {
    const ai = getAI();
    const fallbackResponse = await ai.models.generateContent({
      model: MODEL,
      contents: {
        parts: [
          {
            text: `Extract flashcard pairs from the following text and return as a JSON list [{'front': '...', 'back': '...'}] ONLY.\n\nText:\n${text}`,
          },
        ],
      },
      config: {
        responseMimeType: "application/json",
      },
    });

    return parseCardsResponse(fallbackResponse.text);
  }
}

async function transcribeImage(base64: string): Promise<string> {
  const ai = getAI();
  const { mimeType, data } = extractInlineData(base64, "image/jpeg");
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: {
      parts: [
        { inlineData: { mimeType, data } },
        {
          text: "この画像に含まれるテキストをすべて正確に書き出してください。数式、記号、表の構造なども可能な限り再現してください。学習用カード作成の素材として使用します。",
        },
      ],
    },
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
  });

  return response.text || "";
}

async function transcribeAudio(base64: string, mimeType: string): Promise<string> {
  const ai = getAI();
  const inlineData = extractInlineData(base64, mimeType || "audio/mpeg");
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: {
      parts: [
        { inlineData },
        {
          text: "この音声を正確に文字起こししてください。英語と日本語が含まれる場合は両方を書き出してください。学習用カード作成の素材として使用します。",
        },
      ],
    },
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
  });

  return response.text || "";
}

async function getCardExplanation(front: string, back: string): Promise<string> {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: {
      parts: [
        {
          text: `あなたは学習・知識構築のエキスパートです。以下のフラッシュカードの表と裏の内容について、ユーザーがより深く理解し、記憶に定着しやすくなるように詳細な解説を提供してください。

カードの内容が「英単語や語学」に関連する場合は、語源、細かいニュアンス、類義語との違い、実際の使い方の例文などを解説してください。
カードの内容が「IT用語、プログラミング、その他の専門知識」に関連する場合は、その仕組み、なぜ使われるのか（メリット）、具体的な用例やユースケース、関連する技術との繋がりなどを詳しく解説してください。

5〜6段落程度のマークダウン形式で、周辺知識も含めてしっかりとボリュームのある説明をしてください。

[表]
${front}

[裏]
${back}`,
        },
      ],
    },
  });

  return response.text || "解析結果がありませんでした。";
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new GeminiHttpError(400, `${name} is required.`);
  }
  return value.trim();
}

async function handleAction(body: GeminiRequestBody) {
  switch (body.action) {
    case "status":
      return { configured: hasServerApiKey(), model: MODEL };
    case "transcribeImage":
      return transcribeImage(requireString(body.base64, "base64"));
    case "transcribeAudio":
      return transcribeAudio(requireString(body.base64, "base64"), requireString(body.mimeType, "mimeType"));
    case "parseTextToCards":
      return parseTextToCards(requireString(body.text, "text"));
    case "extractCardsFromText":
      return generateCardJson(`与えられたテキストから、学習用カード（単語帳）の「表（front）」と「裏（back）」のペアを可能な限りすべて抽出してください。
単語リスト、文章、定義文など、どのような形式でも対応してください。
特に言語学習の場合は「外国語: 意味」を優先してください。
出力は必ず以下のJSON形式にしてください。

JSON形式:
{"cards": [{"front": "...", "back": "..."}]}

テキスト:
${requireString(body.text, "text")}`);
    case "extractSentenceCardsFromText":
      return generateCardJson(`与えられたテキストから例文暗記用のカードを作成してください。
表（front）に「日本語訳（意味）」、裏（back）に「元の英文」が来るように抽出してください。
単なる単語ではなく、完全な文章やフレーズを優先してください。
出力は必ず以下のJSON形式にしてください。

JSON形式:
{"cards": [{"front": "日本語の例文や訳", "back": "English sentence"}]}

テキスト:
${requireString(body.text, "text")}`);
    case "extractParaphraseCardsFromText":
      return generateCardJson(`与えられたテキストから、単語や表現の言い換えを暗記するための学習用カードを作成してください。
文脈からユーザーが意図しているペア（例: 「日本語（表）→ 英単語と類語（裏）」や「英語表現（表）→ 別の英語表現や解説（裏）」など）を推測し、適切に抽出してください。
テキストの書き方に基づいて「表(front)」と「裏(back)」を柔軟に分けてください。
出力は必ず以下のJSON形式にしてください。

JSON形式:
{"cards": [{"front": "表側のテキスト (例: 日本語の意味や対象の英語表現)", "back": "裏側のテキスト (例: 対応する英単語・類語、または別の英語表現)"}]}

テキスト:
${requireString(body.text, "text")}`);
    case "getCardExplanation":
      return getCardExplanation(requireString(body.front, "front"), requireString(body.back, "back"));
    default:
      throw new GeminiHttpError(400, "Unsupported Gemini action.");
  }
}

function sanitizeErrorMessage(message: string) {
  return message.replace(/AIza[0-9A-Za-z_-]{20,}/g, "AIza...REDACTED");
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const body = parseRequestBody(req);
    const data = await handleAction(body);
    return res.status(200).json({ data });
  } catch (error) {
    const status = error instanceof GeminiHttpError ? error.status : 500;
    const rawMessage = error instanceof Error ? error.message : "Unknown Gemini server error.";
    const message = sanitizeErrorMessage(rawMessage);
    console.error("Gemini API route failed:", message);
    return res.status(status).json({ error: message });
  }
}
