# KM/CIF Curve Digitizer - Project Notes

## Overview
A web-based tool for digitizing Kaplan-Meier and Cumulative Incidence Function curves from published images. Built for HTA/HEOR work.

## Status
This browser-first prototype is now parked for experimental/manual use only. The experimental semantic extractor and batch flow are not reliable enough for production KM/CAM extraction. New production-facing automation is moving to a separate hosted `SurvdigitizeR` workflow: https://github.com/rphilip90/km-survdigitizer-oracle

## Live URL
https://rphilip90.github.io/km-digitizer/

## GitHub Repo
https://github.com/rphilip90/km-digitizer

## Tech Stack
- Pure JavaScript (no frameworks)
- HTML5 Canvas for image display and annotation
- Hosted on GitHub Pages (free)

## Current Features
- [x] Image loading: drag & drop, paste (Ctrl+V), file browse
- [x] 4-point axis calibration (X min/max, Y min/max)
- [x] Multiple curve support with color coding
- [x] Click to add points on curves
- [x] Point editing: drag to move, right-click to delete
- [x] Grid overlay for precise placement
- [x] Zoom controls (+/-, mouse wheel, fit button)
- [x] Pan when zoomed (Shift + drag)
- [x] Live coordinate display
- [x] Undo/redo (Ctrl+Z, Ctrl+Y)
- [x] Export to CSV
- [x] Copy to clipboard

## Known Issues / TODO
- [x] Prototype parked due to unreliable browser-side semantic extraction
- [ ] Manual point placement remains usable, but auto curve detection is not production-ready
- [ ] Axis inference and OCR-style heuristics remain unreliable on mixed-quality figures
- [ ] Batch processing in this repo should be treated as experimental only
- [ ] Production automation is moving to a separate Oracle-hosted `SurvdigitizeR` pipeline

## File Structure
```
km-digitizer/
├── index.html          # Main HTML
├── css/
│   └── style.css       # All styling
├── js/
│   ├── app.js          # Main app logic, event handlers
│   ├── canvas.js       # Canvas drawing, zoom, pan
│   ├── calibration.js  # Axis calibration logic
│   ├── curves.js       # Multi-curve management
│   └── export.js       # CSV export functions
└── PROJECT_NOTES.md    # This file
```

## How to Continue Development
1. Open terminal in: `C:\Users\RobinPhilip\km-digitizer`
2. Make changes to files
3. Test locally by opening `index.html` in browser
4. Push to GitHub:
   ```
   git add -A
   git commit -m "Description of changes"
   git push
   ```
5. Changes go live automatically on GitHub Pages

## Created
January 2026 - Built with Claude Code for Robin Philip (Evimed Solutions)
