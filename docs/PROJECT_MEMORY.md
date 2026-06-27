# PROJECT MEMORY
Version: 2026-06-01

---

# Project Overview

Project Name: Content Pipeline

Goal:

Automatically generate, render and publish high-quality Vietnamese spiritual / Buddhist / self-improvement content across multiple social media platforms.

Target:

- YouTube Shorts
- Facebook Reels
- TikTok
- Long-form YouTube videos

Infrastructure:

- MacBook M4
- 16GB RAM
- Local execution
- No cloud render farm

---

# Current Stack

LLM:

- OpenRouter
- GPT models
- Gemini models
- Claude models (for development assistance)

TTS:

- VieNeu-TTS

Images:

- Fal.ai

Video:

- FFmpeg

Publishing:

- Multi-platform publishing pipeline

---

# Primary Business Goal

DO NOT optimize for code elegance.

DO NOT optimize for architecture purity.

DO NOT optimize for unnecessary refactors.

Optimize for:

1. Better content quality
2. Higher viewer retention
3. Higher CTR
4. Faster content generation
5. Lower generation cost
6. More videos published per day
7. Better reliability

Every recommendation must be justified by one of these goals.

---

# Current Priorities

Priority Order:

P0:
- Reliability
- Automation stability
- Failure recovery

P1:
- Generation speed
- Content quality

P2:
- Cost optimization

P3:
- Code cleanup

---

# Known High-ROI Improvements

Already identified.

Do NOT re-investigate unless evidence changes.

1. Retry wrapper for all external providers
2. Telegram alerting
3. Upload queue race-condition fixes
4. Zod schema validation
5. TTS caching
6. Image caching
7. FFmpeg VideoToolbox acceleration
8. Immediate stage chaining
9. Analytics database
10. CTR tracking
11. Retention tracking
12. Feedback loop from published videos

---

# Feedback Loop Vision

Current State:

generate -> publish -> forget

Target State:

generate
→ publish
→ collect analytics
→ learn from analytics
→ improve future content

This is considered one of the most important long-term advantages of the project.

---

# Prompt Philosophy

Avoid:

- Generic AI writing
- Empty motivation language
- Repetitive spiritual clichés
- Overly poetic filler

Prefer:

- Concrete scenes
- Human observations
- Emotional realism
- Curiosity gaps
- Retention-driven storytelling

---

# Thumbnail Philosophy

CTR matters more than image generation cost.

Do not downgrade thumbnail quality without A/B testing.

Use analytics before making quality reductions.

---

# Content Quality Philosophy

Quality > Small speed gains.

A 5-10% retention improvement is more valuable than saving a few seconds of generation time.

Do not sacrifice narrative coherence solely for parallelization.

---

# Performance Philosophy

Parallelize where quality is unaffected.

Examples:

Good candidates:
- Image generation
- TTS generation
- Metadata generation

Be careful with:
- Script generation
- Narrative section generation

---

# Before Making Any Major Change

Answer:

1. Does this increase retention?
2. Does this increase CTR?
3. Does this increase publishing throughput?
4. Does this improve reliability?
5. Does this reduce cost without hurting quality?

If all answers are NO:

Do not implement.

---

# Current Roadmap

Phase 1:

- Retry wrapper
- Telegram alerts
- Upload queue stabilization
- Schema validation

Phase 2:

- TTS cache
- Image cache
- VideoToolbox
- Pipeline acceleration

Phase 3:

- Analytics storage
- CTR tracking
- Retention tracking

Phase 4:

- Feedback loop
- Topic ranking system
- Thumbnail intelligence
- Self-improving content selection

---

# Instructions For Future AI Agents

You are not starting a new project.

You are continuing an existing project.

Read this file first.

Respect all priorities.

Prefer practical business impact over engineering perfection.

When proposing work:

- Rank by ROI
- Estimate effort
- Estimate impact
- Avoid unnecessary rewrites

Always explain why the proposed work helps:
- retention
- CTR
- throughput
- reliability
- profitability