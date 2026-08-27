# Sahayak · सरकारी सहायक

**English** — Sahayak is a free, offline-first, bilingual reference and productivity tool for Indian central
government officers and for people about to join government service. It converts sections between the old and
new criminal codes (IPC↔BNS, CrPC↔BNSS, Evidence Act↔BSA), calculates pay and allowances on the 7th CPC
matrix, drafts every CSMOP 2022 document type, and drills the conduct, leave, pension and financial rules by
spaced repetition. Hindi and English are on equal footing everywhere — not a translation layer over an
English app.

**हिन्दी** — सहायक भारतीय केंद्रीय सरकारी अधिकारियों तथा सरकारी सेवा में आने वाले उम्मीदवारों के लिए एक
निःशुल्क, ऑफ़लाइन-प्रथम, द्विभाषी संदर्भ एवं कार्य-सहायक उपकरण है। यह पुरानी और नई दंड संहिताओं के बीच धाराओं
का मिलान करता है, 7वें वेतन आयोग के अनुसार वेतन एवं भत्तों की गणना करता है, सीएसएमओपी 2022 के सभी दस्तावेज़
प्रारूपित करता है, तथा आचरण, अवकाश, पेंशन एवं वित्तीय नियमों का अभ्यास कराता है। हिंदी और अंग्रेज़ी दोनों को
समान स्थान प्राप्त है।

> **Status:** early development. Session 1 built the application shell; no module carries real data yet.

## Privacy

Everything you enter stays in your browser, on your device, in IndexedDB.

- **No accounts.** There is nothing to sign up for.
- **No backend for user data.** The app is a static bundle; there is no server to send anything to.
- **No analytics, no ads, no trackers** — not even privacy-preserving ones.
- **No third-party requests at runtime.** Fonts are self-hosted. This is enforced by a test that fails the
  build if any external URL reaches the production output.

Clearing your browser's site data will erase your saved settings and progress. There is no backup yet.

## Public data only

Sahayak uses **public, non-departmental data only** — NCRB Sankalan tables, India Code, published DoPT /
DoE / DoPPW / PFRDA orders and gazette notifications, and data.gov.in datasets. It holds no departmental
data and has no feature that collects, profiles, monitors or investigates anyone.

**This project is not affiliated with, endorsed by, or connected to any government department, ministry or
agency.** Every figure it shows is a reference. Verify with the official gazette, the relevant order, or
your DDO before you act on it.

Datasets carry their source URL and version in the interface. Fonts are used under the SIL Open Font
License 1.1 (see `public/fonts/OFL.txt`). data.gov.in material, where used, is under GODL-India with
attribution.

## Running it

```bash
corepack enable
pnpm install
pnpm fonts:fetch   # once; downloads the self-hosted WOFF2 files
pnpm dev
```

See [CLAUDE.md](CLAUDE.md) for the full script list, project context and current status, and
[docs/DECISIONS.md](docs/DECISIONS.md) for architectural decisions.

## Licence

MIT — see [LICENSE](LICENSE).
