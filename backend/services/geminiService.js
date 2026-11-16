import { GoogleGenAI } from "@google/genai";
import { readFile } from "node:fs/promises";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { cityConfig } from "./cityConfig.js";
import { metrics } from "./observability.js";

// Load the backend-local environment file before reading the API key.
dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey && apiKey !== "your_gemini_api_key_here"
  ? new GoogleGenAI({ apiKey })
  : null;

const model = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";

const categories = cityConfig.categories;
const urgencyLevels = ["Low", "Medium", "High", "Critical"];

const responseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    category: {
      type: "string",
      enum: categories,
      description: "The best matching municipal issue category.",
    },
    severityScore: {
      type: "number",
      minimum: 1,
      maximum: 5,
      description: "Issue severity from 1 (minor) to 5 (most severe).",
    },
    urgencyLevel: {
      type: "string",
      enum: urgencyLevels,
      description: "How urgently municipal staff should respond.",
    },
    summary: {
      type: "string",
      description: "A concise, factual summary of the reported issue.",
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description: "Short keywords describing the issue.",
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "Your confidence in the category and severity classification.",
    },
    detectedLanguage: {
      type: "string",
      description: "The language used in the resident's original description.",
    },
    translatedDescription: {
      type: "string",
      description: "A faithful English translation of the original description.",
    },
    photoQuality: {
      type: "string",
      enum: ["ok", "blurry", "unrelated", "inappropriate"],
      description: "Photo quality and relevance. Use ok when no photo was attached.",
    },
    photoMatchesCategory: {
      type: "boolean",
      description: "Whether the attached photo matches the resident-selected category; true when no photo was attached.",
    },
    riskToVulnerable: {
      type: "boolean",
      description: "Whether the issue creates a credible safety risk to children, older adults, or people with disabilities.",
    },
    riskReason: {
      type: "string",
      description: "A concise, evidence-based reason for the vulnerable-user risk assessment, or an empty string when false.",
    },
  },
  required: [
    "category",
    "severityScore",
    "urgencyLevel",
    "summary",
    "tags",
    "confidence",
    "detectedLanguage",
    "translatedDescription",
    "photoQuality",
    "photoMatchesCategory",
    "riskToVulnerable",
    "riskReason",
  ],
};

/**
 * Analyze a civic issue report and return its structured triage result.
 * @param {string} description
 * @param {{ buffer?: Buffer, path?: string, mimetype: string } | null} [imageFile]
 * @param {string | null} [selectedCategory]
 * @returns {Promise<{ category: string, severityScore: number, urgencyLevel: string, summary: string, tags: string[], confidence: number, detectedLanguage: string, translatedDescription: string, photoQuality: string, photoMatchesCategory: boolean, riskToVulnerable: boolean, riskReason: string }>}
 */
export async function analyzeIssueReport(description, imageFile = null, selectedCategory = null) {
  if (!apiKey || !ai) {
    throw new Error("GEMINI_API_KEY is not configured. Set it in backend/.env.");
  }

  if (typeof description !== "string" || description.trim().length === 0) {
    throw new TypeError("A non-empty issue description is required for analysis.");
  }

  if (
    imageFile &&
    ((!Buffer.isBuffer(imageFile.buffer) && typeof imageFile.path !== "string") ||
      !imageFile.mimetype)
  ) {
    throw new TypeError("The optional image must include a file path or buffer and MIME type.");
  }

  const input = [
    {
      type: "text",
      text: [
        "You are CivicGuard's municipal issue triage assistant.",
        "Analyze the resident's report and return only the requested structured JSON.",
        `Choose exactly one category from: ${categories.join(", ")}.`,
        "Assign a numeric severityScore from 1 (minor) to 5 (most severe).",
        `Choose exactly one urgencyLevel from: ${urgencyLevels.join(", ")}.`,
        "Keep the summary concise and factual. Return a short array of relevant tags.",
        "Detect the report's language and provide a faithful English translation of its description.",
        "Return confidence from 0 to 1 for the category and severity classification.",
        `The resident selected category: ${selectedCategory || "not provided"}.`,
        "Assess any attached photo as ok, blurry, unrelated, or inappropriate, and say whether it matches the resident-selected category. If there is no photo, use ok and true.",
        "Assess whether the described issue presents a credible safety risk to children, older adults, or people with disabilities. Return riskToVulnerable and a concise evidence-based riskReason; use an empty reason when false.",
        "Do not infer personal information or facts not supported by the report or image.",
        `Report description: ${description.trim()}`,
      ].join("\n"),
    },
  ];

  if (imageFile) {
    const imageBuffer = imageFile.buffer ?? await readFile(imageFile.path);
    input.push({
      type: "image",
      mime_type: imageFile.mimetype,
      data: imageBuffer.toString("base64"),
    });
  }

  let interaction;
  try {
    interaction = await ai.interactions.create({
      model,
      input,
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: responseSchema,
      },
      generation_config: {
        temperature: 0.2,
        // Triage is a short classification task; extended thinking only adds latency.
        thinking_level: "low",
      },
      store: false,
    });
    metrics.recordGeminiCall(true);
  } catch (apiError) {
    metrics.recordGeminiCall(false, apiError.code || "api_error");
    throw apiError;
  }

  const responseText = interaction.output_text;
  if (!responseText) {
    throw new Error("Gemini returned an empty issue analysis.");
  }

  let analysis;
  try {
    analysis = JSON.parse(responseText);
  } catch (error) {
    throw new Error("Gemini returned invalid JSON for the issue analysis.", {
      cause: error,
    });
  }

  if (
    !analysis ||
    !categories.includes(analysis.category) ||
    typeof analysis.severityScore !== "number" ||
    !Number.isFinite(analysis.severityScore) ||
    analysis.severityScore < 1 ||
    analysis.severityScore > 5 ||
    !urgencyLevels.includes(analysis.urgencyLevel) ||
    typeof analysis.summary !== "string" ||
    !Array.isArray(analysis.tags) ||
    !analysis.tags.every((tag) => typeof tag === "string")
    || typeof analysis.confidence !== "number"
    || !Number.isFinite(analysis.confidence)
    || analysis.confidence < 0
    || analysis.confidence > 1
    || typeof analysis.detectedLanguage !== "string"
    || typeof analysis.translatedDescription !== "string"
    || !["ok", "blurry", "unrelated", "inappropriate"].includes(analysis.photoQuality)
    || typeof analysis.photoMatchesCategory !== "boolean"
    || typeof analysis.riskToVulnerable !== "boolean"
    || typeof analysis.riskReason !== "string"
    || analysis.riskReason.length > 300
  ) {
    throw new Error("Gemini returned issue analysis outside the expected schema.");
  }

  return {
    category: analysis.category,
    severityScore: analysis.severityScore,
    urgencyLevel: analysis.urgencyLevel,
    summary: analysis.summary,
    tags: analysis.tags,
    confidence: analysis.confidence,
    detectedLanguage: analysis.detectedLanguage,
    translatedDescription: analysis.translatedDescription,
    photoQuality: analysis.photoQuality,
    photoMatchesCategory: analysis.photoMatchesCategory,
    riskToVulnerable: analysis.riskToVulnerable,
    riskReason: analysis.riskReason,
  };
}
