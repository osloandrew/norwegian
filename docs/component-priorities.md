# Component Prioritization Roadmap

The list below ranks each major surface of the Norwegian learning app by the order it should receive product investment. Rankings balance expected impact on activation, retention, and referral growth against estimated engineering effort, leveraging the user journey analysis captured in the UX Growth Review and the refactoring guidance in the Deep-Dive Recommendations.【F:docs/user-retention-virality-review.md†L12-L64】【F:docs/deep-dive-recommendations.md†L6-L41】

1. **Landing hub & onboarding mission (index.html)**  
   - **Why now:** First impressions decide activation. The current six-button hub offers no suggested path, leaving newcomers without an "aha" moment.【F:docs/user-retention-virality-review.md†L4-L24】 Replacing it with a guided checklist that auto-launches key actions, captures contact info, and culminates in a celebratory share screen will shorten time-to-value while lighting up referral hooks.【F:docs/user-retention-virality-review.md†L17-L29】
   - **Growth lever:** A stronger day-zero mission yields the largest week-4 retention gains (2.6× when users reach a core action on day one) and unlocks remarketing channels, giving the rest of the product more chances to prove its value.【F:docs/user-retention-virality-review.md†L24-L33】

2. **Word game progression & persistence (wordGame.js)**  
   - **Why now:** The game already delivers satisfying feedback, but progress is session-bound. Persisting streaks, scheduling spaced reviews, and surfacing "Today’s review" cards will transform isolated play into a habit loop.【F:docs/user-retention-virality-review.md†L26-L42】
   - **Growth lever:** Spaced repetition and habit tracking boost long-term recall by 30–50% and increase day-30 retention by ~23%, making this the highest-leverage retention investment once onboarding is solved.【F:docs/user-retention-virality-review.md†L33-L35】

3. **Dictionary & sentence search flow (scripts.js)**  
   - **Why now:** Search is the default re-engagement channel, yet the current UI requires manual configuration and shares tightly coupled state, slowing iteration.【F:docs/user-retention-virality-review.md†L7-L16】【F:docs/deep-dive-recommendations.md†L7-L18】 Modularizing the data pipeline and layering contextual next steps (e.g., "Read a story with this word") will improve relevance while reducing engineering drag for future experiments.
   - **Growth lever:** Search is the primary daily use case; making it faster and cross-linking to richer content feeds the engagement loop described in the growth review.【F:docs/user-retention-virality-review.md†L42-L47】

4. **Referral-ready celebration surfaces (wordGame.js & index.html)**  
   - **Why now:** Once activation and retention scaffolding exist, reworking streak/level banners into shareable cards and tying them to "Support the Project" unlocks a low-cost acquisition channel.【F:docs/user-retention-virality-review.md†L36-L41】
   - **Growth lever:** Referral programs anchored in social proof routinely lift sign-ups by 10–30%, compounding the impact of each engaged learner.【F:docs/user-retention-virality-review.md†L39-L41】

5. **Pronunciation practice module (pronunciation.js)**  
   - **Why now:** The pronunciation tool is powerful but architecture-heavy, making improvements expensive. After stabilizing core growth loops, extracting reusable audio analysis helpers and deferring heavy work to workers will unlock smoother experimentation.【F:docs/deep-dive-recommendations.md†L19-L33】
   - **Growth lever:** Better pronunciation feedback increases perceived value for intermediate learners and differentiates the product, but returns depend on steady weekly usage driven by earlier priorities.

6. **Story library enhancements (stories.js)**  
   - **Why now:** Stories deepen engagement for committed users. Streamlining filters and templates should follow once foundational retention tactics mature.【F:docs/deep-dive-recommendations.md†L12-L18】
   - **Growth lever:** Cross-linking stories from dictionary results supports the engagement loop but requires prior work on search modularization (Priority 3) to execute efficiently.

7. **Support & contribution flow (index.html)**  
   - **Why now:** Monetization and community support benefit from a larger, more engaged audience. Revisit once activation, retention, and referral loops have demonstrably improved.
   - **Growth lever:** Integrating support asks into referral celebrations (Priority 4) will compound revenue opportunities without derailing core product work.

## How to Use This List
- Ship in sequence: unlock activation (1) → deepen retention (2–3) → layer acquisition multipliers (4) → harden advanced modules (5–7).
- Keep measurement aligned with the KPI dashboard in the growth review to verify each step’s impact before moving on.【F:docs/user-retention-virality-review.md†L48-L57】
