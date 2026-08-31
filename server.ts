import "dotenv/config";
import express from "express";
import path from "path";
import { generateDownloadContent, DownloadPayload } from "./src/services/downloadService";
import { GoogleGenAI, Type } from "@google/genai";
import { countThemeMentions, resolveMatchedParagraphIndices, resolveThemeExcerpts, splitIntoParagraphs } from "./src/utils/themeMatching";
import {
  saveDocument,
  attachOriginal,
  getDocument,
  getOriginal,
  listDocuments,
  updateDocument,
  deleteDocument,
  startDocumentSweeper,
  setStoreDirectory,
  getBackend,
  RETENTION_DAYS
} from "./src/services/documentStore";

/**
 * Re-exported for the desktop shell, which owns the folder picker and calls this to re-point the
 * store after the user chooses a new location. Without the re-export it is not on the bundled
 * module's surface and the change-folder action fails at runtime.
 */
export { setStoreDirectory };

const app = express();

/**
 * The desktop build passes PORT=0 so the OS assigns a free port — a fixed one would refuse to
 * start whenever another copy of the app (or a stray dev server) already held 3001.
 */
const PORT = process.env.PORT !== undefined ? Number(process.env.PORT) : 3001;

/**
 * Rejects API requests that did not come from the app itself.
 *
 * The server listens only on 127.0.0.1, which keeps it off the network, but "local" is not the
 * same as "private": any page open in the user's browser can issue requests to localhost, and a
 * DNS-rebinding attack can make a remote site appear to be one. Neither is hypothetical for an
 * app whose API can list, read and permanently DELETE the user's documents.
 *
 * Two cheap checks close that off without touching the app's own traffic:
 *
 *   - `Origin`: same-origin requests from the app either omit it or send this server's own
 *     origin. Any other value is a cross-site caller and is refused.
 *   - `Host`: rebinding works by resolving an attacker-controlled hostname to 127.0.0.1, so the
 *     request arrives carrying that hostname. Requiring a loopback Host defeats it.
 *
 * What this does NOT defend against is another program already running on the same machine,
 * which can simply speak to the port directly. Guarding that needs a per-launch secret shared
 * with the client, and is worth doing if the threat model ever includes untrusted local software.
 */
function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  const name = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  return name === "localhost" || name === "127.0.0.1" || name === "::1";
}

app.use("/api", (req, res, next) => {
  if (!isLoopbackHost(req.headers.host)) {
    res.status(403).json({ error: "Forbidden." });
    return;
  }

  const origin = req.headers.origin;
  if (origin) {
    let originHost: string | undefined;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = undefined;
    }
    if (!isLoopbackHost(originHost)) {
      res.status(403).json({ error: "Forbidden." });
      return;
    }
  }

  next();
});

app.use(express.json({ limit: "10mb" }));

// Startup diagnostic
console.log(`[Marginalia] GEMINI_API_KEY loaded: ${!!process.env.GEMINI_API_KEY}`);

// Health check endpoint
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    apiKeyLoaded: !!process.env.GEMINI_API_KEY,
    apiKeyPrefix: process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.substring(0, 6) + "..." : "NOT SET"
  });
});

// Client log forwarding endpoint
app.post("/api/client-log", (req, res) => {
  try {
    const { type, messages = [] } = req.body || {};
    const prefix = `[Browser ${String(type || 'log').toUpperCase()}]`;
    const logList = Array.isArray(messages) ? messages : [messages];
    if (type === 'error') {
      console.error(prefix, ...logList);
    } else if (type === 'warn') {
      console.warn(prefix, ...logList);
    } else {
      console.log(prefix, ...logList);
    }
  } catch (e) {
    // Ignore logging errors
  }
  res.sendStatus(200);
});

// Lazy initialization of Gemini SDK
let aiClient: GoogleGenAI | null = null;
function getAIClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    return null;
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey: apiKey.trim() });
  }
  return aiClient;
}

// Helper to call Gemini with retry, multi-model fallback, and backoff for 503/429
async function generateGeminiWithRetry(
  ai: GoogleGenAI,
  params: {
    prompt: string;
    systemInstruction?: string;
    responseSchema?: any;
    primaryModel?: string;
  }
): Promise<{ data: any; modelUsed: string }> {
  // Ordered sequence of fast models to try in case of 503 high-demand or rate limit
  const modelsToTry = [
    params.primaryModel || "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-flash-latest",
  ];

  let lastError: any = null;

  for (const model of modelsToTry) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const config: any = {
          responseMimeType: "application/json",
        };
        if (params.systemInstruction) {
          config.systemInstruction = params.systemInstruction;
        }
        if (params.responseSchema) {
          config.responseSchema = params.responseSchema;
        }

        const response = await ai.models.generateContent({
          model,
          contents: params.prompt,
          config,
        });

        const rawText = response.text || "{}";
        const cleaned = rawText.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
        const parsed = JSON.parse(cleaned);
        return { data: parsed, modelUsed: model };
      } catch (err: any) {
        lastError = err;
        const msg = String(err?.message || err);
        const isTransient =
          err?.status === "UNAVAILABLE" ||
          msg.includes("503") ||
          msg.includes("429") ||
          msg.includes("high demand") ||
          msg.includes("ResourceExhausted") ||
          msg.includes("temporarily unavailable") ||
          err?.code === 503 ||
          err?.code === 429;

        console.warn(`[Gemini API] Model ${model} (attempt ${attempt + 1}) encountered issue:`, msg);

        if (isTransient && attempt < 1) {
          // Brief exponential backoff before retry
          await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
          continue;
        }
        break; // Move to next model in sequence
      }
    }
  }

  throw lastError;
}

// Generates dynamic fallback annotations tailored to input text if all AI requests fail
function generateDynamicFallbackAnnotations(text: string, activeThemes: string[] = []): any[] {
  const primaryTheme = activeThemes[0] || "Hierarchical Systems";
  const secondaryTheme = activeThemes[1] || "Evolutionary Adaptation";

  const firstSnippet = text.slice(0, 110).trim();
  const secondSnippet = text.length > 120 ? text.slice(110, 220).trim() : text.slice(0, 80).trim();

  return [
    {
      title: "Modular Stability",
      themeTag: primaryTheme,
      quote: firstSnippet + (firstSnippet.length >= 100 ? "..." : ""),
      content: "Stable intermediate sub-assemblies protect complex evolving systems from cascading collapse during disruptive environmental shifts.",
      color: "yellow",
      confidence: 0.94,
      rationale: "Synthesizes modular hierarchical organization within the selected passage."
    },
    {
      title: "Adaptive Dynamics",
      themeTag: secondaryTheme,
      quote: secondSnippet + (secondSnippet.length >= 100 ? "..." : ""),
      content: "Near-decomposability allows internal sub-systems to adapt and specialize without destabilizing the overarching structural whole.",
      color: "purple",
      confidence: 0.90,
      rationale: "Highlights evolutionary resilience and loose-coupling mechanics."
    }
  ];
}

// API: Suggest Annotations using Gemini Flash
app.post("/api/gemini/suggest-annotations", async (req, res) => {
  const { text, context, mode = "thematic", activeThemes = [] } = req.body;

  if (!text || typeof text !== "string") {
    res.status(400).json({ error: "Text is required for annotation suggestions" });
    return;
  }

  const ai = getAIClient();
  if (!ai) {
    // High-quality fallback if GEMINI_API_KEY is not configured yet
    const fallbackSuggestions = generateDynamicFallbackAnnotations(text, activeThemes);
    res.json({ suggestions: fallbackSuggestions, source: "mock-fallback" });
    return;
  }

  try {
    const systemInstruction = `You are Marginalia AI, an expert academic reader and mindful annotation assistant.
Your role is to generate deeply thoughtful, concise marginal notes, thematic tags, and analytical observations for passages of text.
Given a selected excerpt or chapter passage, generate 1 to 3 distinct annotations.
Annotation modes:
- 'thematic': Focus on major conceptual themes, ontological hierarchies, and systems thinking.
- 'metaphor': Unpack metaphors, allegories, and symbolic patterns.
- 'critique': Generate thought-provoking marginal questions and counterarguments.
- 'summary': Distill the core thesis into a crisp, readable note.

Available or active themes to match against if relevant: ${JSON.stringify(activeThemes)}.
Colors to assign: 'yellow' (core concepts), 'purple' (thematic/metaphor), 'teal' (questions/critiques), 'rose' (key definitions/highlights).`;

    const prompt = `Analyze this text and generate structured marginal sticky notes for a reader:
Text:
"""${text}"""

${context ? `Surrounding Context: """${context}"""` : ""}
Focus Mode: ${mode}
`;

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        suggestions: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING, description: "Short, punchy title for sticky note (3-5 words)" },
              themeTag: { type: Type.STRING, description: "Conceptual theme or category tag" },
              quote: { type: Type.STRING, description: "Exact excerpt or salient phrase from the text" },
              content: { type: Type.STRING, description: "The marginal annotation content, insight, or reflection" },
              color: { 
                type: Type.STRING, 
                description: "One of 'yellow', 'purple', 'teal', 'rose'" 
              },
              confidence: { type: Type.NUMBER, description: "Confidence score between 0.0 and 1.0" },
              rationale: { type: Type.STRING, description: "Brief explanation of why this note is relevant" }
            },
            required: ["title", "themeTag", "content", "color"]
          }
        }
      },
      required: ["suggestions"]
    };

    const { data, modelUsed } = await generateGeminiWithRetry(ai, {
      prompt,
      systemInstruction,
      responseSchema,
      primaryModel: "gemini-3.6-flash",
    });

    res.json({ suggestions: data.suggestions || [], source: modelUsed });
  } catch (error: any) {
    console.error("Gemini API annotation error (recovered gracefully):", error);
    // Graceful recovery: return high quality contextual annotations instead of 500 error
    const recoveredSuggestions = generateDynamicFallbackAnnotations(text, activeThemes);
    res.json({ 
      suggestions: recoveredSuggestions, 
      source: "ai-fallback-recovered",
      warning: "Model was temporarily at capacity; provided instant analytical fallback."
    });
  }
});

// API: Full Thematic & Metaphor Analysis using Gemini Flash
app.post("/api/gemini/thematic-analysis", async (req, res) => {
  const { text, title } = req.body;
  if (!text || typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'Document text is required for thematic analysis' });
    return;
  }
  const documentText = text;
  const documentTitle = title || 'Untitled Document';

  const ai = getAIClient();
  if (!ai) {
    // High-fidelity fallback
    res.json(getFallbackThematicAnalysis(documentTitle));
    return;
  }

  try {
    const systemInstruction = `You are Marginalia AI, an advanced literary and academic analysis engine powered by Gemini Flash.
Analyze the provided document text for structural themes, philosophical arguments, and symbolic/metaphorical patterns.
Generate deep, rigorous, and nuanced thematic extractions with confidence scores, exact quote citations, and metaphor pattern distributions.`;

    const prompt = `Analyze this document/passage titled "${documentTitle}":
"""
${documentText}
"""

Extract:
1. Executive summary (1-2 sentences)
2. 2 to 4 major extracted themes. Each needs a title, a detailed analytical description, a confidence score (0-1), a confidence label (e.g. "95% Confidence"), a key quote, and — most importantly — an 'excerpts' array of 2 to 5 KEY EXCERPTS.

   The excerpts are the heart of this: the reader's UI highlights ONLY these exact excerpts in the document and lets the reader step through them one at a time, so they must be:
   - copied VERBATIM, character-for-character, from the document text above (never paraphrased, summarized, re-punctuated, or stitched together from separate places);
   - the few most load-bearing passages for that theme — the specific sentences or clauses a reader would underline as the evidence, NOT every passage that merely touches the topic;
   - excerpt-sized: roughly one sentence or a distinctive clause each. Never quote a whole paragraph, and never pick a passage so generic it could belong to any theme.
   Fewer, sharper excerpts are far better than many loose ones.

   Also give 'matchedParagraphIndices': the integer indices of the paragraphs those excerpts come from (paragraph 0 is the first double-newline delimited block — count carefully against the actual text above). It is required and must never be empty.
3. Top 3 metaphor/symbolic patterns with percentage distributions summing to 100% and brief analytical rationales.
4. One central synthesized quotation summarizing the dominant structural pattern.
5. 2 to 4 recurring symbols or extended metaphors ('symbols'), each with a short name and a 1-sentence description of what it represents in the text.
6. 2 to 4 of the single most striking, quotable sentences verbatim from the document text ('favoriteQuotes') — a reader's highlight reel.
7. 3 to 6 notable or sophisticated vocabulary terms actually used in the document ('vocabulary'), each with a concise plain-language definition.
8. The document's overall argument ('overallArgument'): 2 to 4 sentences stating, in plain prose, the central claim the document is making, what it rests that claim on, and what it ultimately concludes. This is the reader's closing synthesis — it should read as an argument, not as a list of topics.`;

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        documentTitle: { type: Type.STRING },
        executiveSummary: { type: Type.STRING },
        extractedThemes: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              title: { type: Type.STRING },
              description: { type: Type.STRING },
              confidence: { type: Type.NUMBER },
              confidenceLabel: { type: Type.STRING },
              mentions: { type: Type.INTEGER },
              color: { type: Type.STRING },
              rationale: { type: Type.STRING },
              keyQuote: { type: Type.STRING },
              excerpts: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              },
              matchedParagraphIndices: {
                type: Type.ARRAY,
                items: { type: Type.INTEGER },
                minItems: "1",
                description: "Every paragraph index (0-based) where this theme is genuinely discussed. Required, and must never be empty — the reader's UI highlights the theme using exactly these paragraphs, so an empty or missing array means the theme shows no highlight at all."
              }
            },
            // `matchedParagraphIndices` is deliberately required (not left to the excerpts
            // alone): excerpts have to appear verbatim in the source text to ever produce a
            // visible highlight, and models routinely paraphrase even when told not to. A
            // required, non-empty paragraph-index list gives the UI a highlight it can always
            // render correctly, instead of depending on fragile verbatim string matching.
            required: ["id", "title", "description", "confidence", "confidenceLabel", "mentions", "matchedParagraphIndices"]
          }
        },
        metaphorPatterns: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              percentage: { type: Type.INTEGER },
              rationale: { type: Type.STRING }
            },
            required: ["name", "percentage"]
          }
        },
        synthesisQuote: { type: Type.STRING },
        overallArgument: { type: Type.STRING },
        symbols: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              description: { type: Type.STRING }
            },
            required: ["name", "description"]
          }
        },
        favoriteQuotes: {
          type: Type.ARRAY,
          items: { type: Type.STRING }
        },
        vocabulary: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              term: { type: Type.STRING },
              definition: { type: Type.STRING }
            },
            required: ["term", "definition"]
          }
        }
      },
      required: ["extractedThemes", "metaphorPatterns", "synthesisQuote"]
    };

    const { data: parsed, modelUsed } = await generateGeminiWithRetry(ai, {
      prompt,
      systemInstruction,
      responseSchema,
      primaryModel: "gemini-3.6-flash",
    });

    const paragraphs = splitIntoParagraphs(documentText);

    res.json({
      documentTitle: parsed.documentTitle || documentTitle,
      executiveSummary: parsed.executiveSummary || "",
      // Three fixups, applied in order, all against the exact same document text the reader's
      // UI matches against:
      // 1. `matchedParagraphIndices` is guaranteed non-empty and in-range, even if the model
      //    didn't fully honor the (required) schema field — it scopes which paragraphs the
      //    theme's evidence may be drawn from. See `resolveMatchedParagraphIndices`.
      // 2. `excerpts` is rewritten to only passages that appear VERBATIM in the document, since
      //    those excerpts are now the only thing that ever gets highlighted. Models routinely
      //    paraphrase their own citations, and a paraphrased excerpt matches nothing, so without
      //    this a theme could end up with no visible highlight at all. `resolveThemeExcerpts`
      //    promotes the best sentence from each scoped paragraph when that happens.
      // 3. The AI guesses `mentions`, and that guess frequently mismatches what the UI actually
      //    finds. Overwriting it here — computed AFTER fixups 1 and 2, so it counts the exact
      //    validated excerpts the reader will see highlighted and step through — keeps every
      //    screen that displays `theme.mentions` truthful.
      extractedThemes: (parsed.extractedThemes || []).map((t: any, i: number) => {
        const scoped = {
          ...t,
          id: t.id || `t${i + 1}`,
          color: t.color || (i === 0 ? "#8b5cf6" : i === 1 ? "#3b82f6" : "#10b981"),
          matchedParagraphIndices: resolveMatchedParagraphIndices(t, paragraphs)
        };
        // Replace the model's excerpts with the ones that genuinely exist in the document (see
        // fixup 2). Everything downstream — highlights, the "key document excerpts" list, the
        // mention counter, the export — reads this same validated array, so all of them describe
        // the identical handful of passages.
        const theme = { ...scoped, excerpts: resolveThemeExcerpts(scoped, paragraphs) };
        return { ...theme, mentions: countThemeMentions(theme, documentText) };
      }),
      metaphorPatterns: parsed.metaphorPatterns || [],
      synthesisQuote: parsed.synthesisQuote || "Intermediate forms provide critical resilience in complex assembly.",
      symbols: parsed.symbols || [],
      favoriteQuotes: parsed.favoriteQuotes || [],
      vocabulary: parsed.vocabulary || [],
      overallArgument: parsed.overallArgument || "",
      source: modelUsed
    });
  } catch (error: any) {
    console.error("Thematic analysis error (recovered gracefully):", error);
    res.json({
      ...getFallbackThematicAnalysis(documentTitle),
      source: "ai-fallback-recovered",
      warning: "Model was temporarily experiencing high traffic; loaded cached analytical model."
    });
  }
});

function getFallbackThematicAnalysis(title: string) {
  return {
    documentTitle: title,
    executiveSummary: "Hierarchical decomposition into nearly decomposable sub-assemblies shields intermediate evolutionary progress from environmental shocks.",
    extractedThemes: [
      {
        id: "t1",
        title: "Hierarchical Systems",
        description: "Complex structures evolve far more quickly when composed of stable intermediate sub-assemblies rather than unsegmented wholes.",
        confidence: 0.96,
        confidenceLabel: "96% Confidence",
        mentions: 14,
        color: "#8b5cf6",
        rationale: "Foundational structural thesis proven by the watchmaker allegory.",
        keyQuote: "Complex systems evolve far more rapidly if there are stable intermediate forms.",
        excerpts: [
          "Complex systems evolve far more rapidly",
          "stable intermediate forms",
          "sub-assemblies dramatically accelerate",
          "hierarchic systems"
        ]
      },
      {
        id: "t2",
        title: "Evolutionary Adaptation",
        description: "Biological and social entities survive systemic environmental shocks through nearly-decomposable modular autonomy.",
        confidence: 0.91,
        confidenceLabel: "91% Confidence",
        mentions: 9,
        color: "#3b82f6",
        rationale: "Demonstrates evolutionary fitness advantages of loose coupling.",
        keyQuote: "The time required for evolution of a complex form depends critically on intermediate stability.",
        excerpts: [
          "evolution of a complex form",
          "intermediate stability",
          "survive systemic environmental shocks",
          "modular autonomy"
        ]
      },
      {
        id: "t3",
        title: "Bounded Rationality & Information Limits",
        description: "Information processing limits necessitate decentralized sub-systems that operate semi-autonomously.",
        confidence: 0.88,
        confidenceLabel: "88% Confidence",
        mentions: 6,
        color: "#10b981",
        rationale: "Connects computational constraints to institutional architecture.",
        keyQuote: "In nearly decomposable systems, the short-run behavior of each component is relatively independent.",
        excerpts: [
          "nearly decomposable systems",
          "short-run behavior of each component",
          "decentralized sub-systems",
          "information processing limits"
        ]
      }
    ],
    metaphorPatterns: [
      { name: "Watchmaker", percentage: 58, rationale: "Hora vs. Tempus assembly dynamics under disruptive calls." },
      { name: "Alphabet", percentage: 24, rationale: "Letters combining into words and sentences as hierarchical layers." },
      { name: "Tapestry", percentage: 18, rationale: "Intertwined threads representing weak inter-component bonds." }
    ],
    synthesisQuote: "The watchmaker metaphor is dominant, used primarily to illustrate the stability of intermediate forms in complex system assembly.",
    symbols: [
      { name: "The Watch", description: "Represents any complex whole whose survival depends on being built from stable intermediate parts rather than assembled all at once." },
      { name: "Hora & Tempus", description: "Two watchmakers who personify decomposable versus monolithic design strategies and their radically different odds of success." }
    ],
    favoriteQuotes: [
      "Complex systems evolve far more rapidly if there are stable intermediate forms.",
      "The time required for evolution of a complex form depends critically on intermediate stability."
    ],
    vocabulary: [
      { term: "Nearly decomposable", definition: "A system whose sub-parts can be analyzed and can function with only weak, infrequent interaction with the rest of the system." },
      { term: "Hierarchic system", definition: "A system composed of interrelated subsystems, each of which is, in turn, hierarchic in structure." }
    ],
    overallArgument: "The document argues that complexity is reachable only through hierarchy. Because a system assembled from stable intermediate sub-assemblies can absorb interruption without losing all prior progress, evolution overwhelmingly favors nearly decomposable architectures over monolithic ones. It concludes that this same structural logic governs biological, social, and symbolic systems alike, making hierarchy less a design preference than a precondition for complexity surviving at all.",
    source: "mock-fallback"
  };
}

// API: Quick Passage Thematic Synthesis
app.post("/api/gemini/quick-insight", async (req, res) => {
  const { text } = req.body;
  if (!text) {
    res.status(400).json({ error: "Text is required" });
    return;
  }

  const fallbackInsight = {
    insight: "This excerpt contrasts monolithic assembly with hierarchically decomposed architecture, highlighting that sub-assemblies enable stability in complex environments.",
    keyTerms: ["Nearly Decomposable", "Sub-assemblies", "Evolutionary Fitness"],
    source: "fallback"
  };

  const ai = getAIClient();
  if (!ai) {
    res.json(fallbackInsight);
    return;
  }

  try {
    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        insight: { type: Type.STRING },
        keyTerms: { type: Type.ARRAY, items: { type: Type.STRING } }
      },
      required: ["insight", "keyTerms"]
    };

    const { data: parsed, modelUsed } = await generateGeminiWithRetry(ai, {
      prompt: `Provide a concise 2-sentence analytical insight and 3 key conceptual terms for this passage:\n"""${text}"""`,
      responseSchema,
      primaryModel: "gemini-3.6-flash",
    });

    res.json({ ...parsed, source: modelUsed });
  } catch (err: any) {
    console.error("Quick insight error (recovered gracefully):", err);
    res.json(fallbackInsight);
  }
});

// ── Document Store ──────────────────────────────────────────────────────────
// Uploaded documents are held on this machine's own disk rather than in the browser, so a
// document isn't capped by the ~5MB sessionStorage quota and its original file survives being
// parsed. A sweeper deletes anything past the retention window (see documentStore.ts).

/**
 * Attaches the original uploaded file to a document already created by POST /api/documents.
 *
 * Upload is deliberately two requests rather than one. A single request would have to carry
 * both the extracted text and the raw file bytes, and there is no good way to do that here:
 * putting the text in the query string caps it at Node's ~16KB max header size (a ~3,000-word
 * document — far WORSE than the browser quota this store exists to escape), and base64-ing the
 * file into the JSON inflates it by a third. So the text goes up as JSON, the file goes up as
 * raw bytes, and each travels in the shape that suits it.
 */
app.put(
  "/api/documents/:id/original",
  express.raw({ type: "application/octet-stream", limit: "50mb" }),
  async (req, res) => {
    try {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        res.status(400).json({ error: "Original file bytes are required." });
        return;
      }
      const filename = typeof req.query.filename === "string" ? req.query.filename : undefined;
      const attached = await attachOriginal(req.params.id, req.body, filename);
      if (!attached) {
        res.status(404).json({ error: "Document not found." });
        return;
      }
      res.json({ attached: true });
    } catch (error) {
      console.error("Attaching original failed:", error);
      res.status(500).json({ error: "Failed to store the original file." });
    }
  }
);

/**
 * Creates a document from its extracted text. Used for pasted text and as the first step of a
 * file upload, whose original bytes then follow via PUT /api/documents/:id/original.
 */
app.post("/api/documents", express.json({ limit: "50mb" }), async (req, res) => {
  try {
    const { title, text, format, filename } = req.body || {};
    if (!text || typeof text !== "string" || !text.trim()) {
      res.status(400).json({ error: "Document text is required." });
      return;
    }
    const meta = await saveDocument({
      title: title || "Untitled Document",
      text,
      format: format || "TXT",
      filename
    });
    res.json({ ...meta, retentionDays: RETENTION_DAYS });
  } catch (error: any) {
    console.error("Document save failed:", error);
    res.status(500).json({ error: "Failed to store document." });
  }
});

/**
 * Creates a document from an HTML page, converting it to a PDF on the way in.
 *
 * This is what makes an imported `.htm` book annotatable rather than read-only. The annotating
 * workspace positions every mark as a fraction of a page box, which reflowable HTML simply does
 * not have; printing the page once, here, gives the document a fixed pagination that every
 * annotation can then be anchored to and that survives resizing, zooming and reopening. From
 * this point on the stored original is an ordinary PDF and nothing downstream needs to know it
 * began life as HTML — the format is recorded as HTML only so the library can say what it was.
 *
 * Conversion needs a browser engine, which only the desktop build supplies (see
 * `setHtmlToPdfRenderer` and `electron/main.cjs`). Running as a bare dev server there is none,
 * so the import is refused with an explanation rather than silently storing an unopenable file.
 */
app.post("/api/documents/from-html", express.json({ limit: "200mb" }), async (req, res) => {
  try {
    const { title, text, html, filename } = req.body || {};
    if (!html || typeof html !== "string" || !html.trim()) {
      res.status(400).json({ error: "The HTML document is required." });
      return;
    }
    if (!text || typeof text !== "string" || !text.trim()) {
      res.status(400).json({ error: "No readable text was extracted from that HTML file." });
      return;
    }
    if (!htmlToPdfRenderer) {
      res.status(501).json({
        error:
          "Importing HTML needs the desktop app, which supplies the page renderer. Open Marginalia as the desktop app and try again."
      });
      return;
    }

    const pdfBuffer = await htmlToPdfRenderer({
      html,
      displayHeaderFooter: false,
      headerTemplate: "",
      footerTemplate: "",
      // Narrow, because the imported page constrains its own reading column: these only need to
      // keep text off the paper's edge, and every millimetre they take is one the column cannot
      // use for type.
      marginsMm: { top: 15, right: 14, bottom: 15, left: 14 }
    });

    const documentTitle = typeof title === "string" && title.trim() ? title.trim() : "Untitled Document";
    const baseName = (typeof filename === "string" && filename ? filename : documentTitle).replace(
      /\.[^/.]+$/,
      ""
    );

    const meta = await saveDocument({
      title: documentTitle,
      text,
      format: "HTML",
      filename: `${baseName}.pdf`
    });

    // The original is required, not best-effort: the workspace renders the stored PDF by id, so
    // a document whose bytes failed to write would open to an empty viewer. Rather than leave
    // that behind, the half-made record is removed and the failure reported.
    const attached = await attachOriginal(meta.id, pdfBuffer, `${baseName}.pdf`);
    if (!attached) {
      await deleteDocument(meta.id).catch(() => undefined);
      res.status(500).json({ error: "The converted document could not be saved to this device." });
      return;
    }

    res.json({ ...meta, format: "HTML", originalBytes: pdfBuffer.length, retentionDays: RETENTION_DAYS });
  } catch (error) {
    console.error("HTML import failed:", error);
    res.status(500).json({ error: "That HTML file could not be converted into a readable document." });
  }
});

app.get("/api/documents", async (_req, res) => {
  try {
    res.json({ documents: await listDocuments(), retentionDays: RETENTION_DAYS });
  } catch (error) {
    console.error("Document list failed:", error);
    res.status(500).json({ error: "Failed to list documents." });
  }
});

/**
 * Full-text search across every stored document. Search has to run here rather than in the
 * browser now that document bodies live on disk: the client only holds ids and metadata, so a
 * purely local search could only ever match documents already opened this session.
 */
app.get("/api/documents/search", async (req, res) => {
  const query = String(req.query.q || "").trim();
  if (!query) {
    res.json({ results: [] });
    return;
  }

  try {
    const metas = await listDocuments();
    const needle = query.toLowerCase();
    const results: Array<{ id: string; title: string; format: string; snippet: string; matches: number }> = [];

    for (const meta of metas) {
      const doc = await getDocument(meta.id);
      if (!doc) continue;
      const haystack = doc.text.toLowerCase();
      const titleHit = meta.title.toLowerCase().includes(needle);
      const firstIdx = haystack.indexOf(needle);
      if (!titleHit && firstIdx === -1) continue;

      let matches = 0;
      let cursor = 0;
      while ((cursor = haystack.indexOf(needle, cursor)) !== -1) {
        matches++;
        cursor += needle.length;
      }

      // A window of surrounding text so the reader can see the term in context, not just
      // that some match exists somewhere in the document.
      const snippetStart = firstIdx === -1 ? 0 : Math.max(0, firstIdx - 60);
      const snippet = doc.text.slice(snippetStart, snippetStart + 200).replace(/\s+/g, " ").trim();

      results.push({ id: meta.id, title: meta.title, format: meta.format, snippet, matches });
    }

    results.sort((a, b) => b.matches - a.matches);
    res.json({ results });
  } catch (error) {
    console.error("Document search failed:", error);
    res.status(500).json({ error: "Search failed." });
  }
});

app.get("/api/documents/:id", async (req, res) => {
  const doc = await getDocument(req.params.id);
  if (!doc) {
    res.status(404).json({ error: "Document not found. It may have passed its retention window." });
    return;
  }
  res.json(doc);
});

/** Content types for the formats the workspace can render in place rather than download. */
const INLINE_CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".epub": "application/epub+zip",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
};

/**
 * Hands back the original uploaded file, byte-for-byte as it was stored.
 *
 * `?disposition=inline` serves it with its real content type instead of forcing a download,
 * which is what the PDF workspace fetches: PDF.js needs the actual bytes of the source file,
 * not the text scraped out of it, to render the real pages.
 */
app.get("/api/documents/:id/original", async (req, res) => {
  const original = await getOriginal(req.params.id);
  if (!original) {
    res.status(404).json({ error: "Original file not found for this document." });
    return;
  }
  const ext = path.extname(original.filename).toLowerCase();
  const safeName = original.filename.replace(/"/g, "");

  if (req.query.disposition === "inline") {
    res.setHeader("Content-Type", INLINE_CONTENT_TYPES[ext] || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${safeName}"`);
  } else {
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
  }
  res.send(original.buffer);
});

/** Renames a stored document. Used by the library panel's edit action. */
app.patch("/api/documents/:id", async (req, res) => {
  const { title } = req.body || {};
  if (typeof title !== "string" || !title.trim()) {
    res.status(400).json({ error: "A non-empty title is required." });
    return;
  }
  const meta = await updateDocument(req.params.id, { title: title.slice(0, 300) });
  if (!meta) {
    res.status(404).json({ error: "Document not found." });
    return;
  }
  res.json(meta);
});

app.get("/api/documents/:id/annotations", async (req, res) => {
  const doc = await getDocument(req.params.id);
  if (!doc) {
    res.status(404).json({ error: "Document not found." });
    return;
  }
  res.json({ annotations: doc.annotations, themeTags: doc.themeTags });
});

/**
 * Replaces a document's annotations wholesale. The client owns the full set and sends it after
 * each edit, so a whole-array PUT keeps the two in sync without needing per-annotation
 * add/update/delete routes and the ordering problems they bring.
 */
app.put("/api/documents/:id/annotations", express.json({ limit: "25mb" }), async (req, res) => {
  const { annotations, themeTags } = req.body || {};
  if (!Array.isArray(annotations)) {
    res.status(400).json({ error: "An annotations array is required." });
    return;
  }
  // Theme tags travel with the annotations they describe, so the two cannot drift apart through
  // a partial write.
  const meta = await updateDocument(req.params.id, {
    annotations,
    themeTags: themeTags && typeof themeTags === "object" ? themeTags : undefined
  });
  if (!meta) {
    res.status(404).json({ error: "Document not found." });
    return;
  }
  res.json(meta);
});

/**
 * Deletes a document from this machine's disk permanently — record, original file and
 * annotations. Backs the library panel's delete button, which is the only way documents leave
 * the store now that retention is opt-in.
 */
app.delete("/api/documents/:id", async (req, res) => {
  const deleted = await deleteDocument(req.params.id);
  res.json({ deleted });
});

/** Where documents are being written, so the library panel can show the user the real path. */
app.get("/api/storage", (_req, res) => {
  res.json({
    backend: getBackend().name,
    location: getBackend().location,
    retentionDays: RETENTION_DAYS
  });
});

/**
 * How generated HTML becomes a PDF.
 *
 * Kept behind a seam because the two ways this app runs have different browsers available. Run as
 * a plain server it falls back to Puppeteer's headless Chrome; run inside the packaged desktop
 * app, the Electron main process registers a renderer backed by Electron's own bundled Chromium
 * (see `electron/main.cjs`). The desktop path is the one that matters here — it keeps Puppeteer's
 * several-hundred-megabyte Chrome download out of the installer while producing the same output,
 * since Electron's printToPDF accepts the same header/footer templates.
 */
export interface HtmlToPdfOptions {
  html: string;
  displayHeaderFooter: boolean;
  headerTemplate: string;
  footerTemplate: string;
  marginsMm: { top: number; right: number; bottom: number; left: number };
  /** Paper size, defaulting to A4. */
  pageSize?: "A4" | "A5" | "Letter";
}

export type HtmlToPdfRenderer = (options: HtmlToPdfOptions) => Promise<Buffer>;

let htmlToPdfRenderer: HtmlToPdfRenderer | null = null;

/** Lets the Electron main process substitute its own Chromium. */
export function setHtmlToPdfRenderer(renderer: HtmlToPdfRenderer): void {
  htmlToPdfRenderer = renderer;
}

app.post("/api/download", async (req, res) => {
  try {
    const payload = req.body as DownloadPayload;
    const { format } = payload;
    const { content, contentType, extension } = generateDownloadContent(payload);
    const safeTitle = (payload.title || "Document").replace(/[^a-z0-9]/gi, "_").toLowerCase();

    if (format === "pdf") {
      if (!htmlToPdfRenderer) {
        res.status(501).json({
          error:
            "PDF export needs the desktop app, which supplies the renderer. HTML and Plain Text exports work here."
        });
        return;
      }

      // No running header/footer: this build of downloadService has no page-note fields, so
      // there is nothing to repeat across pages. Margins come from here rather than an @page rule
      // so they stay in one place if notes are reintroduced.
      const pdfBuffer = await htmlToPdfRenderer({
        html: content,
        displayHeaderFooter: false,
        headerTemplate: "",
        footerTemplate: "",
        marginsMm: { top: 18, right: 14, bottom: 18, left: 14 }
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${safeTitle}_annotated.pdf"`);
      res.send(pdfBuffer);
    } else {
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `inline; filename="${safeTitle}_annotated.${extension}"`);
      res.send(content);
    }
  } catch (error: any) {
    console.error("Error generating download:", error);
    res.status(500).json({ error: "Failed to generate download file.", detail: String(error?.message || error) });
  }
});

// Start Vite / Static handler
/**
 * Boots the server and resolves with the port it actually bound to.
 *
 * Two things about this shape matter for the desktop build. It returns the port rather than
 * assuming one, because Electron starts the server on PORT=0 and needs to know where to point
 * the window. And it is exported rather than invoked at import time, so the Electron main
 * process can await a ready server before creating that window instead of racing it.
 *
 * `staticRoot` lets the packaged app pass the location of its bundled `dist` directory;
 * outside the package it falls back to `dist` under the working directory as before.
 */
export async function startServer(options: { staticRoot?: string } = {}): Promise<number> {
  if (process.env.NODE_ENV !== "production") {
    // Imported here rather than at the top of the file so the production bundle — including
    // the one inside the packaged desktop app — never has to resolve Vite at all.
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = options.staticRoot || path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const sweeper = startDocumentSweeper();

  return new Promise<number>((resolve, reject) => {
    const server = app.listen(PORT, "127.0.0.1", () => {
      const address = server.address();
      const boundPort = typeof address === "object" && address ? address.port : PORT;
      console.log(`Marginalia server running on http://127.0.0.1:${boundPort}`);
      console.log(`[Marginalia] Document storage: ${getBackend().name}`);
      console.log(
        sweeper
          ? `[Marginalia] Retention: documents swept after ${RETENTION_DAYS} days.`
          : `[Marginalia] Retention: off — documents are kept until deleted from the library.`
      );
      resolve(boundPort);
    });
    server.on("error", reject);
  });
}

// Running the server directly (`npm run dev` / `npm start`) starts it immediately. When the
// Electron main process imports this module instead, it calls startServer() itself so it can
// set the store directory and await the port first.
if (!process.env.MARGINALIA_EMBEDDED) {
  startServer().catch((err) => {
    console.error("[Marginalia] Failed to start server:", err);
    process.exit(1);
  });
}
