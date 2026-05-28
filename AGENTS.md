# Codex Local Notes

- Keep normal Codex chat, code editing, and completions on the provider configured in `~/.codex/config.toml`.
- When the user asks to use image2 for image generation or editing, read `~/.codex/image2.toml` and call base_url + endpoint with OpenAI-style Bearer auth.
- Do not route normal Codex requests through image2, and do not print the full image2 API key.
- 复合标准时，以小程序的最终展示效果为准，而不是以简单 HTML 页面为标准。
