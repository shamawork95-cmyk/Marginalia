/**
 * The Gemini key settings: whether a key is configured, and setting or clearing it.
 *
 * Thematic analysis, the only feature that called Gemini, was removed in 2.5.0, so nothing here
 * sends anything off the machine. The routes stay behind the AI opt-in (`requireAi`, off by
 * default) for any AI feature that is added later. Stored analyses stay on disk untouched.
 */

import { Router } from 'express';
import { catchAsyncErrors } from './asyncRoutes';
import { getSettings, saveSettings } from './documentStore';
import { requireAi } from './aiGate';

const router = catchAsyncErrors(Router());

/**
 * Overridable so a newer Flash model can be adopted by editing `.env`; the default is the moving
 * `-latest` alias because Google retires pinned models quickly.
 */
const DEFAULT_MODEL = 'gemini-flash-latest';

/**
 * Where the API key comes from: the app's own settings first (a packaged build has no `.env`),
 * then `GEMINI_API_KEY` in the environment. Read fresh, so a key pasted in Settings counts at once.
 */
export async function geminiCredentials(): Promise<{ apiKey: string | null; model: string }> {
  const stored = (await getSettings()) ?? {};
  const fromSettings = typeof stored.geminiApiKey === 'string' ? stored.geminiApiKey.trim() : '';
  const storedModel = typeof stored.geminiModel === 'string' ? stored.geminiModel.trim() : '';
  return {
    apiKey: fromSettings || process.env.GEMINI_API_KEY?.trim() || null,
    model: storedModel || process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL
  };
}

/** Whether a key is configured, and which model will be used — never the key itself. */
router.get('/gemini-config', requireAi, async (_req, res) => {
  const { apiKey, model } = await geminiCredentials();
  const stored = (await getSettings()) ?? {};
  res.json({
    configured: Boolean(apiKey),
    // Worth distinguishing: a key from the environment cannot be changed from inside the app.
    source: typeof stored.geminiApiKey === 'string' && stored.geminiApiKey.trim() ? 'settings' : apiKey ? 'environment' : null,
    model
  });
});

/** Sets or clears the stored key and model. An empty key removes it. */
router.put('/gemini-config', requireAi, async (req, res) => {
  const apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : undefined;
  const model = typeof req.body?.model === 'string' ? req.body.model.trim() : undefined;
  // Only the gemini fields, merged under the settings lock (a corrupt file is backed up first).
  const patch: Record<string, unknown> = {};
  if (apiKey !== undefined) patch.geminiApiKey = apiKey;
  if (model !== undefined) patch.geminiModel = model;
  await saveSettings(patch);
  const after = await geminiCredentials();
  console.log(`[Marginalia] Gemini key ${apiKey ? 'set' : 'cleared'} from Settings.`);
  res.json({ configured: Boolean(after.apiKey), model: after.model });
});

export default router;
