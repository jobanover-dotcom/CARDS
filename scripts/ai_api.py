#!/usr/bin/env python3
"""
AI API Integration for CARDS using LiteLLM
Model sequence: Gemini 1.5 Flash → Groq Llama 3.1 70B → Nemotron 3 Ultra (OpenRouter)
Direct calls without Router to avoid fallback recursion issues.
"""
import os
import sys
import argparse
from pathlib import Path
from typing import Optional

import litellm
from litellm import completion
from dotenv import load_dotenv

# Load .env file if exists
load_dotenv(Path(__file__).parent.parent / ".env")

# LiteLLM config
litellm.drop_params = True
litellm.set_verbose = False

# Model configurations - sequence: Gemini (via OpenRouter) → Groq → Nemotron (via OpenRouter)
MODELS = {
    # 1. Gemini 2.5 Flash via OpenRouter - free tier
    "gemini": {
        "model": "openrouter/google/gemini-2.5-flash",
        "api_key_env": "OPENROUTER_API_KEY",
        "api_base": "https://openrouter.ai/api/v1",
        "max_tokens": 8192,
        "temperature": 0.3,
    },
    # 2. Groq - Llama 3.3 70B, fast and free (1,000 req/day)
    "groq": {
        "model": "groq/llama-3.3-70b-versatile",
        "api_key_env": "GROQ_API_KEY",
        "max_tokens": 8192,
        "temperature": 0.3,
    },
    # 3. Nemotron 3.5 Lightning FREE via OpenRouter (fallback)
    "nemotron": {
        "model": "openrouter/nvidia/nemotron-3.5-lightning",
        "api_key_env": "OPENROUTER_API_KEY",
        "api_base": "https://openrouter.ai/api/v1",
        "max_tokens": 4096,
        "temperature": 0.3,
    },
}

# Fallback sequence
FALLBACK_SEQUENCE = ["gemini", "groq", "nemotron"]


def check_api_keys() -> dict:
    """Check which API keys are configured (non-placeholder)"""
    def is_valid(key: str) -> bool:
        if not key:
            return False
        key = key.strip()
        if key in ("your_gemini_key_here", "your_groq_key_here", "your_openrouter_key_here"):
            return False
        return len(key) > 10
    
    return {
        "OPENROUTER_API_KEY": is_valid(os.getenv("OPENROUTER_API_KEY", "")),
        "GROQ_API_KEY": is_valid(os.getenv("GROQ_API_KEY", "")),
    }


def get_available_models() -> list:
    """Get list of models with configured API keys in priority order"""
    keys = check_api_keys()
    available = []
    if keys["OPENROUTER_API_KEY"]:
        available.extend(["gemini", "nemotron"])
    if keys["GROQ_API_KEY"]:
        available.append("groq")
    return available


def call_model(model_name: str, message: str, stream: bool = True) -> Optional[str]:
    """Call a specific model directly via LiteLLM completion"""
    config = MODELS[model_name]
    api_key = os.getenv(config["api_key_env"])
    
    kwargs = {
        "model": config["model"],
        "messages": [{"role": "user", "content": message}],
        "max_tokens": config["max_tokens"],
        "temperature": config["temperature"],
        "stream": stream,
    }
    
    if api_key:
        kwargs["api_key"] = api_key
    if "api_base" in config:
        kwargs["api_base"] = config["api_base"]
    
    try:
        if stream:
            response = completion(**kwargs)
            full_response = ""
            for chunk in response:
                if chunk.choices[0].delta.content:
                    content = chunk.choices[0].delta.content
                    print(content, end="", flush=True)
                    full_response += content
            print()
            return full_response
        else:
            response = completion(**kwargs)
            content = response.choices[0].message.content
            print(content)
            return content
    except Exception as e:
        print(f"Error with {model_name}: {e}")
        return None


def chat_with_fallback(model: str, message: str, stream: bool = True) -> Optional[str]:
    """Chat with automatic fallback through the sequence"""
    available = get_available_models()
    if not available:
        print("Error: No API keys configured. Set at least one in .env:")
        print("  GEMINI_API_KEY - for Gemini 1.5 Flash (1.5B tokens/mo free)")
        print("  GROQ_API_KEY - for Llama 3.1 70B (1,000 req/day free)")
        print("  OPENROUTER_API_KEY - for Nemotron 3 Ultra (free via OpenRouter)")
        return None
    
    # Determine starting model
    if model == "auto":
        model = available[0]
    elif model not in available:
        print(f"Model '{model}' not available (missing API key). Available: {available}")
        model = available[0]
        print(f"Using '{model}' instead.")
    
    # Find starting index in fallback sequence
    try:
        start_idx = FALLBACK_SEQUENCE.index(model)
    except ValueError:
        start_idx = 0
    
    # Try models in sequence
    for i in range(start_idx, len(FALLBACK_SEQUENCE)):
        current_model = FALLBACK_SEQUENCE[i]
        if current_model not in available:
            continue
        
        print(f"\n--- {current_model.upper()} Response ---\n")
        result = call_model(current_model, message, stream)
        if result is not None:
            return result
        print(f"  → {current_model} failed, trying next fallback...")
    
    print("All models failed!")
    return None


def review_code(model: str, file_path: str) -> Optional[str]:
    """Ask AI to review a file"""
    path = Path(file_path)
    if not path.exists():
        print(f"File not found: {file_path}")
        return None
    
    code = path.read_text()
    max_chars = 15000
    if len(code) > max_chars:
        code = code[:max_chars] + "\n\n... [truncated]"
    
    message = f"""You are a senior software engineer reviewing a Next.js/TypeScript/Prisma codebase for a construction material management system (CARDS).

Please review this file for:
1. Type safety and TypeScript best practices
2. Next.js 15 App Router patterns (Server Components, Server Actions, caching)
3. Prisma schema/queries - type safety, N+1 prevention, proper indexes
4. Security - SQL injection, XSS, authentication/authorization
5. Performance - N+1 queries, unnecessary re-renders, bundle size
6. Error handling - proper try/catch, user-facing messages
7. Code style - consistency, naming, DRY principles

File: {file_path}
```typescript
{code}
```"""
    return chat_with_fallback(model, message, stream=True)


def list_models():
    """Show available models and their status"""
    keys = check_api_keys()
    available = get_available_models()
    
    print("\n=== AI Models Status (Priority Order) ===\n")
    
    key_map = {
        "gemini": "OPENROUTER_API_KEY",
        "groq": "GROQ_API_KEY",
        "nemotron": "OPENROUTER_API_KEY",
    }
    
    priority_names = {
        "gemini": "1. Gemini 2.5 Flash (OpenRouter)",
        "groq": "2. Groq Llama 3.3 70B",
        "nemotron": "3. Nemotron 3.5 Lightning (OpenRouter)",
    }
    
    for name in ["gemini", "groq", "nemotron"]:
        config = MODELS[name]
        needs_key = key_map[name]
        has_key = keys.get(needs_key, False)
        status = "✓ READY" if has_key else "✗ MISSING KEY"
        free_note = " (FREE)" if ":free" in config["model"] else ""
        print(f"  {priority_names[name]:35} {status}{free_note}")
        print(f"    Model: {config['model']}")
        print(f"    Needs: {needs_key}")
        print()


def main():
    parser = argparse.ArgumentParser(description="AI API Assistant for CARDS (LiteLLM)")
    subparsers = parser.add_subparsers(dest="command", required=True)

    list_parser = subparsers.add_parser("list", help="Show available models and API key status")

    chat_parser = subparsers.add_parser("chat", help="Send a message to AI")
    chat_parser.add_argument("model", choices=["auto", "gemini", "groq", "nemotron"], 
                            default="auto", nargs="?", help="Model to use (auto = first available)")
    chat_parser.add_argument("message", nargs="+", help="Message to send")
    chat_parser.add_argument("--no-stream", action="store_true", help="Don't stream response")

    review_parser = subparsers.add_parser("review", help="Ask AI to review a file")
    review_parser.add_argument("model", choices=["auto", "gemini", "groq", "nemotron"],
                              default="auto", nargs="?", help="Model to use")
    review_parser.add_argument("file", help="File path to review")

    args = parser.parse_args()

    if args.command == "list":
        list_models()

    elif args.command == "chat":
        message = " ".join(args.message)
        chat_with_fallback(args.model, message, stream=not args.no_stream)

    elif args.command == "review":
        review_code(args.model, args.file)


if __name__ == "__main__":
    main()