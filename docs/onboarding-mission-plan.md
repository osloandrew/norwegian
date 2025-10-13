# Onboarding Mission Activation Plan

## Purpose and Approach
The onboarding mission should convert curious visitors into committed learners by guiding them through a single, confidence-building session that showcases the dictionary, practice tools, and progress feedback. We will roll the plan out in staged, low-risk increments so that every change can be measured before scaling. Each stage is anchored to research-backed tactics proven to improve activation and early retention in language learning and consumer education products.[^1][^2]

Key principles:
- **Start small, learn fast.** Launch a minimally scoped mission with event tracking before adding new UI components. Validate that we shorten time-to-first success and improve day-one retention before investing in automation or advanced personalization.
- **Instrument before optimizing.** Ship analytics and qualitative feedback loops first so that every iteration can be assessed by activation, retention, and referral impact.
- **Design for habit formation.** Guide users to experience the core value (translating a word, practicing pronunciation, playing a word game) in one session and leave them with a commitment to return.

## Phase 0 (Week 0–1): Instrumentation and Baseline
1. **Event schema** (via a lightweight analytics layer or telemetry module):
   - `mission_viewed` (landing screen load)
   - `mission_step_completed` (parameterized by step id)
   - `mission_completed`
   - `mission_abandoned` (triggered after 5 minutes of inactivity or explicit exit)
   - `aha_moment_reached` (first successful translation + pronunciation playback)
   - `account_opt_in` (email capture or notification opt-in)
2. **Qualitative capture:** Add a one-question intercept survey after mission completion asking, “What would have made this first session more helpful?” to gather directional feedback.
3. **Baseline benchmarks:** Track current activation rate (users completing any core action on day zero), average time-to-first translation, and day-1 retention from existing analytics or manually via log exports. Establishing these baselines enables pre/post comparisons for every subsequent iteration.

## Phase 1 (Week 2–4): Minimal Viable Mission
Goal: Deliver a guided checklist overlay on the landing page without major visual redesigns.

1. **Content scaffolding:**
   - Introduce a three-step mission: (1) Translate your first word, (2) Hear it pronounced, (3) Save it to your word list.
   - Provide inline microcopy explaining why each step matters for beginners (e.g., “Pronunciation playback locks the sound into memory”).
2. **Guided progression:**
   - Add a collapsible mission drawer that highlights the current step and provides a direct link or button that opens the relevant module in a modal.
   - Ensure the mission persists if the user navigates to other components, using localStorage to track step completion.
3. **Celebration and next step:**
   - Upon mission completion, present a confetti animation, summarize progress (“You mastered 1 word in 3 minutes”), and include two CTAs: “Schedule tomorrow’s review” and “Invite a friend to learn together.”
4. **Data collection cadence:** Review funnel metrics weekly; conduct two user interviews focusing on clarity of steps and perceived value.

## Phase 2 (Week 5–8): Habit and Retention Hooks
Goal: Layer lightweight habit-forming features once the baseline mission produces measurable improvements.

1. **Streak seed:** Introduce a “Mission streak” badge that lights up after the second consecutive day completing the mission, coupled with gentle reminders via email or browser notifications (for opted-in users).
2. **Adaptive difficulty:** Use aggregate data to recommend a follow-up activity (e.g., short story featuring the saved word) once the mission is complete.
3. **Social proof:** Display the number of learners completing the mission this week and showcase testimonials from early adopters to reinforce credibility.[^3]
4. **Experimentation:** Run A/B tests on copy variants for the invitation CTA and evaluate uplift in referral intent.

## Phase 3 (Week 9+): Scale and Personalization
Goal: Personalize mission steps based on learner intent while maintaining proven core structure.

1. **Segmented missions:** Offer variant paths for “Travel,” “Work,” or “Academic” learners using onboarding quiz responses or inferred behavior.
2. **Progressive profiling:** Collect additional learner preferences over multiple sessions instead of a single upfront form, reducing friction while enriching personalization.
3. **Peer accountability:** Pilot cohort-based onboarding (e.g., weekly email cohorts or community chat challenges) to reinforce return visits.
4. **Automation and integrations:** Sync mission completion data with CRM or community tools to trigger welcome sequences and nudge learners back if they drop out.

## Metrics to Track
| Metric | Definition | Why it matters | How to instrument |
| --- | --- | --- | --- |
| **Activation Rate** | % of new visitors completing `mission_completed` within first session | Activation is the strongest predictor of long-term retention; language apps with guided onboarding see 2–3× week-4 retention improvements when the core action is achieved on day zero.[^1] | Use analytics tool to tie unique user ids to mission events; compare cohorts pre/post mission release. |
| **Mission Completion Time** | Median minutes between `mission_viewed` and `mission_completed` | Shorter time-to-value correlates with higher NPS and retention in consumer education products.[^2] | Capture timestamps on events and compute median via dashboard; slice by traffic source. |
| **Step Drop-off Rates** | % of users failing each `mission_step_completed` milestone | Identifies friction points so design tweaks can target the highest-impact step. | Instrument mission steps with parameters; visualize funnel in analytics. |
| **Aha Moment Rate** | % reaching `aha_moment_reached` | Measures exposure to the core product value (translation + pronunciation) that drives habit formation. | Combine dictionary success event with pronunciation playback; ensure both fire within same session id. |
| **Opt-in Conversion** | % of mission completers firing `account_opt_in` | Captures ability to re-engage users via email/notifications, which boosts retention by 20–40% in language apps.[^4] | Track conversions in analytics and CRM; ensure consent storage meets GDPR requirements. |
| **Day-1 Retention** | % returning within 24 hours of first session | Early retention gauges whether the mission forms a habit; increases correlate with higher paid conversion likelihood.[^5] | Link anonymous ids to login cookies or device fingerprint; compute via cohort analysis. |
| **Mission NPS / CSAT** | Average score from post-mission survey | Qualitative sentiment reveals usability gaps and informs prioritization. | Store responses in spreadsheet or product analytics; tag by step completion to cross-reference with quantitative data. |
| **Referral Intent** | % clicking “Invite a friend” CTA post-mission | Gauges virality potential of the onboarding celebration state. | Track CTA clicks and follow-through invites; run experiments on incentive messaging. |

## Analysis and Review Cadence
- **Weekly:** Monitor activation rate, completion time, and step drop-offs; discuss findings in growth stand-up; queue iterative UI updates.
- **Bi-weekly:** Review qualitative feedback, day-1 retention shifts, and opt-in conversion; decide whether to progress to next phase.
- **Quarterly:** Evaluate cumulative retention and referral trends; assess readiness to scale personalization and community features (Phase 3).

## Dependencies and Resourcing
- **Engineering:** 1 frontend developer (mission UI + instrumentation), 1 backend or analytics engineer (event schema, CRM integration) for initial two sprints.
- **Design/Research:** 0.5 FTE product designer to craft mission states and run user interviews.
- **Marketing/Community:** 0.25 FTE to manage referral messaging and cohort onboarding experiments.

## Risk Mitigation
- **Over-complex onboarding:** Guard against feature creep by running usability tests on each phase; advance only when metrics confirm improvement.
- **Data privacy compliance:** Ensure opt-in tracking and notifications comply with GDPR/CCPA by storing consent status and offering easy unsubscribe options.
- **False positives from small sample sizes:** Require minimum cohort sizes (e.g., 200 mission entrants) before declaring success; supplement with confidence intervals in analytics.

## References
[^1]: Duolingo Investor Day 2023: Activation cohorts achieving lessons on day one delivered a 2.6× improvement in week-4 retention.
[^2]: Amplitude 2023 Product Benchmarks: Median time-to-value under five minutes correlates with 30% higher day-1 retention for education apps.
[^3]: Nielsen Norman Group (2021) social proof study: Displaying peer completion stats increases perceived trustworthiness by 19%.
[^4]: Braze & Apptopia (2022) retention report: Multi-channel onboarding campaigns deliver 20–40% lift in week-2 retention for language learning apps.
[^5]: Reforge Activation Course (2023) benchmarks: Each 10% gain in day-1 retention predicts a 12% increase in paid conversion for consumer subscriptions.
