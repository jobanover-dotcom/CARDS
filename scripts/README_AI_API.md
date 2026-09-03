# AI Orchestration Scripts

## Overview
This folder contains the AI orchestration layer for the CARDS project using LiteLLM with automatic fallback.

## Models (Priority Order)
1. **Gemini 2.5 Flash** — via OpenRouter (free tier, generous)
2. **Groq Llama 3.3 70B** — via Groq (fast, 1,000 req/day free)
3. **Nemotron 3.5 Lightning** — via OpenRouter (free fallback)

## Usage

### Chat
```bash
# Auto-select best available model
python3 scripts/ai_api.py chat auto "Your question here"

# Specific model
python3 scripts/ai_api.py chat gemini "Explain this code"
python3 scripts/ai_api.py chat groq "Quick answer"
python3 scripts/ai_api.py chat nemotron "Complex reasoning"

# Non-streaming
python3 scripts/ai_api.py chat auto "Question" --no-stream
```

### Code Review
```bash
# Review a file with auto model selection
python3 scripts/ai_api.py review auto prisma/schema.prisma

# Specific model
python3 scripts/ai_api.py review gemini src/components/Button.tsx
```

### Check Model Status
```bash
python3 scripts/ai_api.py list
```

## Configuration

### Environment Variables (.env)
```env
OPENROUTER_API_KEY=sk-or-xxxxxxxxxxxx
GROQ_API_KEY=gsk_xxxxxxxxxxxx
```

Get keys at:
- OpenRouter: https://openrouter.ai/keys (includes free models)
- Groq: https://console.groq.com/keys

### Fallback Behavior
1. Try requested model (or first available if `auto`)
2. On failure (rate limit, auth error, 404), try next in sequence
3. Sequence: Gemini → Groq → Nemotron
4. All models fail → error message

## GitHub Actions Integration

The workflows in `.github/workflows/` use this script for:
- **PR Review**: Automated review of changed `.ts`, `.tsx`, `.prisma` files
- **Issue Comments**: Respond to `@ai-review <query>` mentions
- **Manual Trigger**: Workflow dispatch for ad-hoc reviews

## Requirements
- Python 3.10+
- `litellm` (`pip install litellm`)
- `python-dotenv` (`pip install python-dotenv`)

## Extending

### Add New Model
1. Add to `MODELS` dict in `ai_api.py`
2. Add to `FALLBACK_SEQUENCE`
3. Add API key env var to `check_api_keys()`
4. Update `key_map` in `list_models()`

### Custom Prompts
Modify `review_code()` function for specialized review prompts per file type.