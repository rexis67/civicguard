import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

// Load the backend-local environment file before reading the API key.
dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey && apiKey !== "your_gemini_api_key_here"
  ? new GoogleGenAI({ apiKey })
  : null;

const categories = ["Pothole", "Streetlight", "Accessibility", "Garbage"];
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
  },
  required: ["category", "severityScore", "urgencyLevel", "summary", "tags"],
};

/**
 * Analyze a civic issue report and return its structured triage result.
 * @param {string} description
 * @param {{ buffer: Buffer, mimetype: string } | null} [imageFile]
 * @returns {Promise<{ category: string, severityScore: number, urgencyLevel: string, summary: string, tags: string[] }>}
 */
export async function analyzeIssueReport(description, imageFile = null) {
  if (!apiKey || !ai) {
    throw new Error("GEMINI_API_KEY is not configured. Set it in backend/.env.");
  }

  if (typeof description !== "string" || description.trim().length === 0) {
    throw new TypeError("A non-empty issue description is required for analysis.");
  }

  if (imageFile && (!Buffer.isBuffer(imageFile.buffer) || !imageFile.mimetype)) {
    throw new TypeError("The optional image must include a buffer and MIME type.");
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
        "Do not infer personal information or facts not supported by the report or image.",
        `Report description: ${description.trim()}`,
      ].join("\n"),
    },
  ];

  if (imageFile) {
    input.push({
      type: "image",
      mime_type: imageFile.mimetype,
      data: imageFile.buffer.toString("base64"),
    });
  }

  const interaction = await ai.interactions.create({
    model: "gemini-3.8-flash",
    input,
    response_format: {
      type: "text",
      mime_type: "application/json",
      schema: responseSchema,
    },
    generation_config: {
      temperature: 0.2,
    },
    store: false,
  });

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
  ) {
    throw new Error("Gemini returned issue analysis outside the expected schema.");
  }

  return {
    category: analysis.category,
    severityScore: analysis.severityScore,
    urgencyLevel: analysis.urgencyLevel,
    summary: analysis.summary,
    tags: analysis.tags,
  };
}
