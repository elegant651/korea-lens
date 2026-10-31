# KoreaLens — Point at Korea. Understand everything.

A mobile-first visual AI travel companion. Photograph a Korean convenience-store
shelf, restaurant menu, or sign; the app segments the objects in it with Meta's
Segment Anything Model (SAM); you tap one object and a Meta vision-capable model
explains it in your language.

Core interaction: **select an object visually, then understand it conversationally.**

See [PROPOSAL.md](./PROPOSAL.md) for the full product and technical proposal.

## Architecture

```text
Mobile Browser (Next.js UI)
  ├── Image capture / upload            app/page.tsx + components/image-uploader.tsx
  ├── Segmentation overlay + selection  components/segmentation-canvas.tsx
  ├── Question input + result card      components/question-input.tsx, explanation-card.tsx
  │
  └── Next.js Route Handlers (server only — API keys never reach the client)
        ├── POST /api/segment    -> Meta SAM API        lib/meta/sam.ts
        ├── POST /api/explain    -> Meta vision model   lib/meta/muse-spark.ts
        ├── POST /api/answer     -> Grounded follow-ups lib/meta/answer.ts
        └── POST /api/transcribe -> Muse Voice Transcribe lib/meta/transcribe.ts
```

Supporting modules:

- `lib/meta/sam.ts` — documented SAM 3.1 Responses API request plus conversion
  of the `<0f>id<|box;..|><|mask;..|>` output grammar into `Segment`s using the
  official `@meta-sam/parser` package.
- `lib/segmentation/mask-decoder.ts` — base64/base85 bitmap, byte-mask, and RLE
  decoding into 0/1 masks, plus bitmask packing for transport.
- `lib/segmentation/coordinate-mapping.ts` — original-pixel / mask / CSS-pixel
  transforms for `object-fit: contain`, tap hit-testing (including box-cropped
  SAM masks), smallest-region selection rule.
- `lib/validation/schemas.ts` — Zod schemas for API input/output.
- `lib/client/sample.ts` — clearly-labeled offline sample shelf for trying the
  full tap-to-select flow without credentials. Sample surfaces always show a
  "Sample" badge and are never presented as live results.

## Prerequisites

- Node.js 20+
- Meta API credentials (see below). Without them the app still runs: upload and
  parser flows work, live routes return an actionable `not_configured` error,
  and the labeled sample mode demonstrates the full interaction.

## Setup

```bash
npm install
cp .env.example .env.local
# Edit .env.local with your values (see Environment variables below)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in a mobile browser (or a
desktop browser with a mobile viewport) and upload a photo.

### Environment variables

| Variable | Purpose |
|---|---|
| `MODEL_API_KEY` | Meta Model API key (required for live segmentation + answers) |
| `META_API_BASE_URL` | API base URL (default `https://api.meta.ai/v1`) |
| `META_SAM_MODEL_ID` | SAM model ID (default `sam-3.1`) |
| `META_VISION_MODEL_ID` | Vision model ID (default `muse-spark-1.3`) |
| `META_TRANSCRIBE_MODEL_ID` | Transcribe model ID (default `muse-voice-transcribe-1.0`) |

Both features call the Meta Model API Responses endpoint (`POST /responses`)
with Bearer auth — see the [official docs](https://dev.meta.ai/docs/overview),
[SAM segmenting guide](https://dev.meta.ai/docs/sam/segmenting), and
[image understanding](https://dev.meta.ai/docs/image-understanding). Never
commit real credentials.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run typecheck` | Strict TypeScript check (`tsc --noEmit`) |
| `npm test` | Unit tests (`vitest run`) |
| `npm run test:watch` | Unit tests in watch mode |

## Demo script (90 seconds)

1. **Problem (0–15s):** "I'm visiting Seoul but can't read Korean product labels."
2. **Segment (15–35s):** Upload a convenience-store shelf photo, type or say
   what to find ("snack package"), show the live SAM masks, and tap one
   package to highlight only that region.
3. **Understand (35–60s):** Ask "What is this? Is it sweet?" Show the selected
   crop and the grounded explanation with uncertainties.
4. **Travel help (60–75s):** Show the Korean phrase to use with store staff.
5. **Why it matters (75–90s):** The same select-and-understand flow extends to
   menus, signs, and everyday objects.

If a prerecorded or sample fallback is used at any point, label it as such —
never claim an object was segmented unless the live SAM result was used.

## Known limitations

- Live segmentation and explanations require a `MODEL_API_KEY` with access to
  `sam-3.1` and `muse-spark-1.3`; without it the app runs in labeled sample
  mode only.
- SAM takes one concept noun phrase per request ("snack package", not
  "find the snacks"); edit the "What should I find?" field or use the retry
  chips for other object types.
- Voice follow-ups record up to 30s, convert to 16 kHz mono WAV in the
  browser, and transcribe via Muse Voice Transcribe; the transcript lands in
  the follow-up field for review before sending. Spoken answers use the
  browser's built-in speech synthesis (no extra service).
- No user accounts, persistent history, voice input, or video segmentation
  (explicit non-goals for the MVP; see proposal §3 and §10).
- AI descriptions can be wrong: the app never presents guesses as verified
  product facts and never makes ingredient/allergy/safety claims from
  appearance alone.
