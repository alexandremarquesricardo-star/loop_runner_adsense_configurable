
# Loop Runner — Configurable AdSense + CMP

This build lets you paste your AdSense IDs and Funding Choices (CMP) ID **inside the app** (no file editing).

## How to use
1) Open `index.html` (preferably via VS Code Live Server or any static host).
2) Click **⚙️ Settings** (top-right).
3) Paste:
   - **AdSense Publisher**: `ca-pub-...`
   - **Top Slot ID**: numeric ID for the top banner
   - **Modal Slot ID**: numeric ID for the leaderboard modal
   - (Optional) **Funding Choices ID**: `pub-...` to enable Google’s certified CMP.
   - **Ad test mode**: keep **on** while testing.
4) Click **Save & Initialize**. Ads and CMP will load, consent will be handled, and units will render.

## Notes
- Ads require **HTTPS** hosting and valid AdSense IDs. They won’t render on `file://`.
- In the **UK/EU/EEA**, a **certified CMP** is required. This build supports Google **Funding Choices** when you provide the `pub-...` ID.
- `ads.txt` is included — place it at your domain root and replace `pub-...` with your own publisher ID.
- Performance: keep ad count low (we use 2 responsive units) to protect game FPS.
