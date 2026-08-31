---
task: Improve UI design following apple-design and design-taste-frontend, hide navbar on desktop, fix thematic analysis grid, fix text formatting reset
completion_criteria:
  - HomeScreen and ThematicAnalysisScreen clearly reflect high-end Apple/Frontend design standards (better typography, motion, spacing, card layouts)
  - Navbar hidden on desktop, BottomNav correctly positioned and styled
  - Thematic analysis is a responsive grid that fluidly becomes split-view on card tap
  - Text formatting in DocumentInspectionPanel does not reset on tap
max_iterations: 10
---

## Requirements
User reported: "u changed nothing. everything is still the same as it was before". 
The previous implementation plan merely tweaked some Tailwind classes (adding md:hidden, backdrop-blur) but failed to deliver the structural, high-end design revamp expected from `apple-design` and `design-taste-frontend`.

Action needed: Deep rewrite of HomeScreen and ThematicAnalysisScreen to apply:
- Better bento-grid layouts with varied composition
- Apple-style springs (motion/react) for layout transitions
- Stronger typography hierarchy (optical sizing, leading)
- Proper translucent layers and depth
