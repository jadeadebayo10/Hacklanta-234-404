# 7 Days

Snap your eviction paper. See your real deadline, hear what it means, check your options, start your answer. Nothing is saved.

Team 404 + 234 — Hacklanta 2026 (Cox Social Good · Zero Data · ElevenLabs).

## Run the frontend
```bash
cd frontend
npm install
NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev   # leave unset for demo mode (sample data)
```
In Vercel, set `NEXT_PUBLIC_API_URL` to the Render URL. Screens: `frontend/app/page.js`. All text: `frontend/lib/strings.js` (EN / ES / Pidgin). All backend calls: `frontend/lib/api.js`.

## Run the backend
```bash
cd backend
pip install -r requirements.txt
export GEMINI_API_KEY=...        # reads the photo
# export DEMO_MODE=1             # stage backup: /read-notice returns the sample notice
uvicorn main:app --reload --port 8000
pytest -q                        # all backend tests
```
`/speak` (ElevenLabs) is unchanged and now also accepts `lang: "spanish"` (set `VOICE_ID_SPANISH`, or it falls back to the English voice).

## Known gaps
- Cards and answer options are translated on screen (`lib/strings.js` → `cards`, `defenses`), but the downloaded answer PDF is in English on purpose, because it is filed with the court. The screen says so in Spanish mode.
- Holidays are only verified for 2026 (`deadline.py` flags later dates).
- Lagos notice periods, Spanish and Pidgin wording, and legal aid contacts still need human verification (see "Before the pitch").


## Privacy: what happens to your data

7 Days has no accounts, no database, no cookies, no analytics and no saved files. Refreshing the page erases everything. This is every place your information goes:

| Step | What is sent | Where it goes | Kept? |
| --- | --- | --- | --- |
| Photo of the paper | The photo, resized on your phone | Our server, then Google Gemini, once | Not saved by us. Held in memory only while it is read. Google processes it under its Gemini API terms. |
| Deadline, checks | The fields you confirmed on screen | Our server | Not saved or logged. Calculated and returned. |
| Answer draft, reply letter, legal aid summary | The confirmed fields and anything you typed (name, address, phone) | Our server | The PDF is built in memory and returned to you. Not stored. |
| Listen | A spoken script with names and the amount removed. The landlord becomes "your landlord", the court becomes "the magistrate court", and the amount is left out. The deadline and days left stay. | Our server, then ElevenLabs | Not saved by us. The captions on screen show the full text. |
| Add to my calendar | Nothing | Built on your own device | Not applicable |

The server writes no logs of what you upload or type. Our hosts (Vercel and Render) keep their usual network logs, such as IP address and page address, and we do not add anything to them. If the photo cannot be read, the app asks you to type the details instead.

## How we use Gemini

Gemini only reads the photo. It does not decide anything.

- It returns structured JSON with fixed fields (dates, names, court, case number, amount) at temperature zero.
- It lists the fields it was unsure about, and those get a "Check this" tag on screen.
- The tenant must confirm every field before anything is calculated, and the three dates are always flagged for a check.
- Two models are tried in order, Gemini 3.5 Flash Lite first and Gemini 3.8 Flash as backup, each with a timeout. If both fail, the app falls back to typing the details.
- The deadline and the Lagos notice check are plain Python rules, not AI.

## How we use ElevenLabs

Listen reads a short, fixed, human reviewed script out loud so someone who is stressed or reads slowly can still understand their paper.

- Scripts are written templates, not generated text, in English and Spanish for Atlanta, and English and Pidgin for Lagos.
- Lagos uses a Nigerian voice for both English and Pidgin.
- The legal words (such as dispossessory or writ of possession) each have a short spoken meaning too.
- Only the scrubbed script is sent. Names and amounts never leave our server for ElevenLabs.

## Files
| File | What it does | Owner |
|---|---|---|
| `backend/deadline.py` | 7-day countdown, weekend + Georgia holiday rule. Plain Python. | Jade |
| `backend/checks.py` | "Things to check" cards. Plain rules, information only. | Jade |
| `backend/lagos.py` | Lagos notice-period check. **Unverified — Olu must confirm.** | Olu |
| `backend/notice_reader.py` | Gemini reads the photo into fields; falls back to manual entry. | Travis |
| `backend/explain.py` | Fixed plain-language scripts in en / es / pcm. **Native speakers review.** | Olu |
| `backend/answer_pdf.py` | Answer draft (tenant ticks own defenses) / Lagos reply letter. | Jade |
| `backend/main.py` | FastAPI endpoints. Stateless. | Travis |
| `backend/data/legal_aid.json` | Where to go. **Fill in phones/addresses after checking.** | Mo |
| `CONTRACT.md` | Request/response shapes for the frontend. | Mo |
| `demo/` | Printable SAMPLE notices + example output PDFs. | everyone |
| `tools/make_sample_notices.py` | Regenerates the demo notices. | — |

## Before the pitch — must check
1. Deadline: rule from Georgia magistrate courts (7 days incl. weekends/holidays; if day 7 is a weekend/holiday → next business day, 5 PM). Holidays: georgia.gov 2026 list. Ask a clerk to confirm.
2. Lagos notice periods in `lagos.py` against the Lagos State Tenancy Law 2011, then set `VERIFIED = True`.
3. Pidgin and Spanish scripts in `explain.py` read by native speakers.
4. Legal aid contacts in `legal_aid.json`.
5. Claim wording: "read once, never saved by us" (the photo does go to Gemini).

## Facts used in the pitch (sources)
- ~144,000 metro Atlanta filings in 2025; more than NYC — Eviction Lab via Capital B / Rough Draft Atlanta
- ~1 filing per 4 renter households inside the City of Atlanta — Rough Draft Atlanta
- ~65% of filings dismissed after payment — Rough Draft Atlanta
- Georgia bars Atlanta from guaranteeing right to counsel — Rough Draft Atlanta
- Black renters ~53% of renters, ~70% of filings — Eviction Lab via Capital B / WABE
