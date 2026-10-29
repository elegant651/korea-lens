# KoreaLens — Product and Technical Proposal

## 1. Project Overview

**Working name:** KoreaLens  
**Tagline:** Point at Korea. Understand everything.  
**Platform:** Mobile-first web application built with Next.js and TypeScript  
**Target users:** International visitors to South Korea  
**Primary use case:** Help travelers understand unfamiliar objects in real-world Korean scenes by selecting a specific object in a photo and asking questions in their preferred language.

KoreaLens is a visual AI travel companion. A traveler uploads or captures a photo of a Korean convenience-store shelf, restaurant menu, or sign. The app uses Meta's Segment Anything Model (SAM) to segment relevant objects and renders the segmentation masks as interactive overlays. The user taps an object, and the app uses Meta Muse Spark (or the currently supported Meta vision-capable model/API) to explain the selected object in the user's language.

The core interaction is **select an object visually, then understand it conversationally**. This is not intended to be another generic travel chatbot or a simple OCR translator.

## 2. Problem Statement

International visitors often encounter situations where they cannot easily identify or understand the specific thing in front of them:

- A traveler cannot distinguish unfamiliar Korean snack or drink packages on a crowded shelf.
- A restaurant menu contains Korean names, unfamiliar dishes, or photos that are difficult to map to the printed menu.
- A sign contains several symbols or directions, and the traveler needs to identify only one relevant item.
- Translation tools may translate visible text but do not always connect a user's question to a particular object in a complex image.

KoreaLens lets users select the exact visual region they care about and receive context-aware explanations.

## 3. Product Goals

### MVP goals

1. Let users capture or upload an image from a mobile browser.
2. Send the image to Meta's SAM API using a supported prompt or segmentation workflow.
3. Parse the SAM response and display segmentation masks aligned with the source image.
4. Let users tap a segmented object to select it.
5. Send the selected crop (and relevant context) to a Meta vision-capable model, such as Muse Spark where supported, for a grounded explanation.
6. Present a clear result card with the object's likely identity, an explanation in the selected language, and useful travel context.
7. Handle API errors, empty segmentation results, uncertain answers, and slow responses gracefully.

### Non-goals for the initial MVP

- Full turn-by-turn navigation or map routing.
- Booking, payments, shopping checkout, or inventory integrations.
- Guaranteed ingredient, allergen, or medical safety determinations.
- Real-time continuous video segmentation.
- Support for every object category and every language.
- A production-grade user account system.
- Voice interaction before the image segmentation and selection flow is reliable.

## 4. Target Users and Initial Scenarios

### Primary scenario: Convenience-store shelf

A traveler uploads a photo of a shelf and asks, “Find the snacks.” The app segments candidate packages. The traveler taps one package and asks, “What is this? Is it sweet?” KoreaLens explains what can be inferred from the image and clearly states when ingredients or product details cannot be verified.

### Secondary scenario: Restaurant menu

A traveler uploads a menu photo, selects a dish photo or a relevant menu region, and asks what the dish is, whether it is likely spicy, or how to order it in Korean. OCR or a vision model may be used as a supporting capability, but the selected visual region remains central to the experience.

### Future scenario: Signs and everyday objects

A traveler selects a subway sign, exit number, ticket machine area, or store product and receives an explanation. These scenarios should be treated as future extensions, not requirements for the first demo.

## 5. User Experience

### Main flow

1. **Landing / upload**
   - Show a concise explanation of the product.
   - Provide “Take a photo” and “Upload image” actions.
   - Explain that images are processed to provide visual assistance.

2. **Image analysis**
   - Show the source image with a clear loading state.
   - Submit the image to the SAM segmentation endpoint through a server-side route.
   - Display segmentation masks or supported object overlays as soon as they are ready.
   - If the initial prompt produces no useful candidates, allow a small set of fallback prompts such as `snack package`, `drink bottle`, `food item`, or `sign`. Avoid unbounded retries.

3. **Object selection**
   - Make each detected region selectable.
   - Clearly highlight the selected mask and dim other regions where practical.
   - Provide an accessible alternative list of detected candidates if mask tapping is difficult.
   - Allow the user to clear the selection or retry segmentation.

4. **Ask / explain**
   - Offer example questions such as “What is this?”, “How is it used?”, and “Is it spicy?”
   - Let the user choose a response language. English should be the default.
   - Send the selected image crop and a concise prompt to the vision-capable model.
   - Do not present model-generated guesses as verified product facts.

5. **Result card**
   - Show a short likely identity, an explanation, and useful travel context.
   - When relevant, provide a Korean phrase the user can show to a local person.
   - Include uncertainty wording when the image is insufficient.
   - Let the user ask a follow-up question about the same selected object.

6. **Failure states**
   - If segmentation fails, show a clear error and a retry action.
   - If no masks are returned, suggest a different photo or a narrower prompt.
   - If the model cannot identify the object confidently, say so instead of inventing details.
   - Preserve the uploaded image locally in the current session where feasible, so retrying does not require another upload.

## 6. Technology Stack

Use the following stack unless repository constraints require an equivalent:

- **Framework:** Next.js with App Router
- **Language:** TypeScript with strict mode
- **UI:** React, Tailwind CSS, and accessible reusable components
- **Image interaction:** HTML Canvas or SVG overlay for masks and selection
- **Validation:** Zod for API input and output validation
- **Testing:** Vitest or the repository's existing test framework; Playwright for a small end-to-end smoke test if time allows
- **Deployment:** Vercel or another platform that supports Next.js route handlers and required request sizes/timeouts
- **Meta models:** Meta SAM API for segmentation; Muse Spark or the currently supported Meta vision-capable API for object explanation; Meta Voice Transcribe as a later enhancement

Do not introduce a database or authentication unless the existing repository already requires one. The MVP should be usable without an account.

## 7. High-Level Architecture

```text
Mobile Browser (Next.js UI)
  ├── Image capture / upload
  ├── Segmentation overlay and object selection
  ├── Question input and result card
  │
  └── Next.js Route Handlers
        ├── POST /api/segment
        │     └── Meta SAM API
        ├── POST /api/explain
        │     └── Meta vision-capable model API
        └── (Later) POST /api/transcribe
              └── Meta Voice Transcribe API
```

All Meta API calls must happen on the server. Never expose API keys or secret credentials in client-side JavaScript.

### Suggested routes

- `POST /api/segment`
  - Input: image file or supported encoded image, optional prompt/category, and image metadata.
  - Output: normalized segment objects, image dimensions, and any rendering metadata needed by the client.

- `POST /api/explain`
  - Input: selected object crop, user question, response language, and optional non-sensitive scene context.
  - Output: validated structured explanation.

- `POST /api/transcribe` — Phase 2 only
  - Input: recorded audio in a format supported by the current Meta Transcribe API.
  - Output: recognized text and any supported language metadata.

Use the official current Meta documentation for exact endpoint URLs, model identifiers, authentication headers, request schemas, and supported image/audio formats. Do not guess undocumented endpoint names or assume that APIs use a common schema.

## 8. SAM Segmentation and Mask Rendering

This is the most technically important part of the MVP and should be validated before building the full UI.

### Requirements

1. Create a small SAM integration module on the server.
2. Use a supported SAM workflow to segment relevant objects. Prefer a text/category prompt if available in the current API, but verify the actual supported request format.
3. Parse the official response format exactly as documented.
4. Normalize the result into an internal `Segment` type.
5. Render masks aligned to the source image in the browser.
6. Support object selection by pointer/touch.
7. Handle missing masks, malformed data, empty responses, and image resizing.

### Important response-format requirement

The SAM reading-segmentation documentation may describe a structured text stream containing special tokens, bounding boxes, and encoded masks. If the current API returns this format, implement a dedicated parser for it. Do not assume the response is a plain JSON array of polygons.

If mask data is Base85-encoded, decode it according to the official specification and reconstruct the mask at its documented dimensions. Verify any packing, run-length, thresholding, or resizing rules against the current documentation rather than guessing.

### Coordinate mapping

Keep these coordinate spaces distinct:

- Original image pixel coordinates
- Mask coordinates
- Rendered image coordinates in CSS pixels
- Pointer/touch coordinates in the displayed image

Account for `object-fit: contain`, responsive resizing, device pixel ratio, and letterboxing. A tap should select the intended segment even when the image is displayed smaller than its original dimensions.

### Mask interaction

- Render masks in a Canvas or SVG layer over the image.
- Give each segment a stable ID for the current analysis result.
- Determine which mask contains the user's tap point.
- When masks overlap, use a consistent selection rule, such as the smallest containing region or the topmost visible candidate.
- Highlight the selected mask distinctly.
- Provide a candidate list as a fallback for difficult selections.
- Avoid creating a large number of DOM nodes for individual mask pixels.

### Fallback strategy

If automatic category-based segmentation is unsupported or returns no useful results:

1. Show a retry option with a limited set of relevant prompts.
2. If supported by the current SAM API, provide a point/region selection fallback.
3. Clearly indicate when no segmentation result is available.
4. Do not silently substitute fabricated masks or claim that an unsegmented object was segmented.

## 9. Explaining the Selected Object

After selection, create a crop of the original image using the selected object's bounding box, with a small padding margin. If the API supports masks as input or additional context, include them only when the documented interface supports that use case.

Send the crop to the supported Meta vision-capable model with a concise instruction that prioritizes grounded observations.

### Example system instruction

```text
You are KoreaLens, a visual assistant for international visitors in South Korea.
Describe only what is reasonably supported by the supplied image.
Answer in the requested language using concise, practical wording.
Distinguish visible facts from uncertain inferences.
Do not invent product names, ingredients, prices, opening hours, or safety claims.
If the image does not provide enough evidence, say what cannot be confirmed.
For food allergies or dietary restrictions, never claim a product is safe based
only on appearance. Recommend checking the package or asking staff.
```

### Suggested structured response

```json
{
  "likelyName": "string",
  "shortDescription": "string",
  "travelContext": "string",
  "koreanPhrase": "string or null",
  "uncertainties": ["string"]
}
```

Validate model output with Zod. If structured output is not supported by the selected model/API, request JSON in the prompt and validate the returned text; handle invalid output safely.

## 10. Voice: Phase 2

Voice is a stretch goal, not a blocker for the SAM demo.

After the core image flow works:

1. Add a microphone control with explicit user permission.
2. Record a short utterance in a browser-supported format.
3. Send the audio to a server route.
4. Use Meta Voice Transcribe according to the current official API contract.
5. Put the transcript into the question field so the user can review or edit it before submission.
6. Reuse the same `/api/explain` route for the answer.

Keep a text-input fallback. Do not implement live streaming transcription unless the documented API and the remaining schedule make it feasible.

For spoken answers, browser speech synthesis may be used as an optional enhancement; do not add another paid service unless required.

## 11. Suggested Project Structure

Adapt to the existing repository instead of restructuring it unnecessarily.

```text
app/
  page.tsx
  layout.tsx
  api/
    segment/route.ts
    explain/route.ts
    transcribe/route.ts          # Phase 2
components/
  image-uploader.tsx
  segmentation-canvas.tsx
  segment-list.tsx
  question-input.tsx
  explanation-card.tsx
  language-selector.tsx
lib/
  meta/
    client.ts
    sam.ts
    muse-spark.ts
    transcribe.ts                # Phase 2
  segmentation/
    parser.ts
    mask-decoder.ts
    coordinate-mapping.ts
    types.ts
  validation/
    segment.ts
    explanation.ts
tests/
  segmentation-parser.test.ts
  mask-decoder.test.ts
  coordinate-mapping.test.ts
  api-validation.test.ts
```

Do not create placeholder files for every item if they are not needed. Keep modules small and introduce abstractions only where they simplify testing or isolate API-specific behavior.

## 12. Security, Privacy, and Reliability

- Store Meta API credentials in server-only environment variables.
- Provide `.env.example` with variable names and non-secret placeholders.
- Never log API keys, raw audio, or full uploaded images unnecessarily.
- Validate file type, size, image dimensions, prompt length, and question length.
- Restrict accepted image formats to those supported by the selected API and image-processing implementation.
- Return safe, actionable errors to the client; keep provider diagnostics in server logs without secrets.
- Do not persist user images by default. Process them for the current request and release temporary resources.
- Clearly explain that AI-generated descriptions can be wrong.
- Do not make definitive medical, allergy, ingredient, or safety claims based only on visual appearance.
- Add reasonable request timeouts and avoid unbounded model retries.
- Check the current Meta API's rate limits, data handling, and usage terms before deployment.

## 13. Environment Variables

Use only the actual variable names needed by the chosen API integration. Suggested placeholders:

```bash
META_API_KEY=
META_SAM_MODEL_ID=
META_VISION_MODEL_ID=
META_TRANSCRIBE_MODEL_ID=
```

Confirm the exact authentication method and model identifiers in the current Meta documentation. If the API uses a different credential or configuration format, update this template accordingly. Never commit real credentials.

## 14. Implementation Plan

### Day 1 — API feasibility spike

- Read the latest official SAM segmentation and reading-segmentation docs.
- Verify authentication and one successful segmentation request.
- Save a sanitized sample response for local parser tests.
- Confirm whether the required segmentation workflow and mask data are available to the hackathon account.
- **Exit criterion:** One real image produces a response whose structure is understood.

### Day 2 — Parser and mask decoder

- Implement response parsing and mask decoding.
- Add unit tests for valid, empty, malformed, and unsupported responses.
- Validate mask dimensions and coordinate conventions.
- **Exit criterion:** A local test can reconstruct and display a mask over a sample image.

### Day 3 — Mobile-first image UI

- Implement image upload/capture and loading/error states.
- Display the image and mask overlays.
- Implement tap selection and the accessible segment list.
- **Exit criterion:** A user can select the correct visible segment on a mobile viewport.

### Day 4 — Vision explanation

- Verify the current supported Meta vision model/API.
- Implement the server-side explanation route.
- Crop the selected object and request a grounded explanation.
- Validate the response and display a useful result card.
- **Exit criterion:** Selecting a real object produces a relevant, appropriately qualified explanation.

### Day 5 — Reliability and optional voice

- Improve prompt fallback and empty-result handling.
- Add image and request validation.
- If the core experience is stable, add short-utterance Transcribe input.
- **Exit criterion:** The demo works with the expected sample photos and fails gracefully for unsupported cases.

### Day 6 — Real-world testing

- Test at least five images across convenience-store shelves and restaurant menus.
- Record segmentation success rate, selection accuracy, response latency, and failure cases.
- Fix the highest-impact problems.
- **Exit criterion:** The main demo path works repeatedly without manual server intervention.

### Day 7 — Submission polish

- Deploy the application.
- Prepare a concise README, architecture diagram, setup instructions, and a short demo recording.
- Explain what SAM does, how the masks are decoded, and how selecting a region changes the model input.
- Disclose limitations and any precomputed demo assets.
- **Exit criterion:** A reviewer can open the app and understand the key interaction without developer assistance.

## 15. Acceptance Criteria

The MVP is complete when all P0 criteria pass:

- [ ] A user can upload or capture a supported image on a mobile browser.
- [ ] The server can call the real supported SAM API.
- [ ] The app parses the actual response format without hardcoded sample masks.
- [ ] At least one real segmentation mask is rendered at the correct location on the source image.
- [ ] A user can select a mask by tapping it.
- [ ] The selected crop is sent to the supported Meta vision-capable model through the server.
- [ ] The user receives a relevant explanation in the chosen language.
- [ ] Loading, empty results, provider errors, and invalid inputs have useful UI states.
- [ ] API keys are not exposed in client bundles.
- [ ] The README explains setup, required credentials, known limitations, and how to run tests.

Voice transcription, spoken answers, user accounts, persistent history, and broad object coverage are not required to pass the MVP.

## 16. Demo Script

**0–15 seconds — Problem**  
“I am visiting Seoul, but I cannot read Korean product labels.”

**15–35 seconds — SAM segmentation**  
Upload a real convenience-store photo. Ask to find snack packages and show the actual segmentation masks. Tap one package and highlight only that region.

**35–60 seconds — Contextual understanding**  
Ask, “What is this? Is it sweet?” Show the selected crop and the generated explanation, including any uncertainty.

**60–75 seconds — Korean travel assistance**  
Show a useful Korean phrase the traveler could use with store staff.

**75–90 seconds — Why this matters**  
Explain that the same select-and-understand interaction can later support menus, signs, and everyday objects without requiring users to know Korean or write complex prompts.

Do not claim that an object was segmented unless the live SAM result was actually used. If a prerecorded fallback is used, label it clearly.

## 17. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| SAM API access or model identifier differs from expectations | Validate credentials, current model availability, and one real request on Day 1. |
| Mask response parsing is more complex than expected | Isolate the parser and decoder; test against sanitized real responses before building the UI. |
| Segmentation is weak on crowded shelves | Use category prompts, bounded retries, and a candidate list; choose suitable demo images. |
| Tap coordinates do not align with masks | Test original-image, mask, CSS, and device-pixel coordinate transformations independently. |
| Vision model hallucinates product details | Use grounded prompts, uncertainty language, and no definitive ingredient or allergy claims. |
| API latency disrupts the demo | Show loading states, use a small set of validated demo images, and avoid unbounded retries. |
| Scope grows too large for one developer | Make voice, persistent history, and extra object categories explicit stretch goals. |

## 18. Instructions for the Coding Agent

Before writing code:

1. Inspect the existing repository and report its framework, package manager, and current conventions.
2. Read the latest official documentation for SAM segmentation, reading segmentation, Muse Spark or the currently available Meta vision API, and Voice Transcribe if needed.
3. Verify the exact request/response schemas, authentication, supported input formats, and model availability. Do not invent SDK methods, endpoint URLs, model IDs, or response fields.
4. Implement the smallest end-to-end vertical slice first: image upload → real SAM request → parse and render one mask → tap selection.
5. Only after that path works, add the vision explanation flow.
6. Keep provider-specific parsing behind small modules and add tests for the response format actually returned by the API.
7. If credentials are missing, build the UI and parser tests using clearly labeled fixtures, but do not claim live integration works. Document exactly what is blocked and how to verify it when credentials are supplied.
8. Avoid unnecessary dependencies, database setup, authentication, or architectural complexity.
9. Run lint, type checking, and tests available in the repository. Fix errors introduced by the implementation.
10. Update the README with setup instructions, environment variables, limitations, and demo steps.

## 19. Final Deliverables

- A working, mobile-first Next.js application.
- Real SAM-powered segmentation and interactive mask selection.
- A server-side integration with a supported Meta vision-capable model for explanations.
- Unit tests for mask parsing, decoding, coordinate mapping, and validation.
- `.env.example` with placeholders only.
- README with architecture, setup, test commands, and known limitations.
- A concise demo script and a deployed URL if deployment credentials and platform access are available.

**Product principle:** Make the mask interaction excellent before adding more AI features. KoreaLens succeeds when a traveler can point to a specific thing in a complex Korean scene, select it reliably, and understand it immediately.
