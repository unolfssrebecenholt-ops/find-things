# AI Endpoint Test - 2026-05-28

## Setup

- Base URL: `https://api.ssstoken.net/`
- API key: configured for the test, redacted here
- Model: `gpt-5.5`
- Prompt: project inventory-analysis prompt from `cloudfunctions/ftAnalyzeImage/index.js`, `maxItems=12`
- Image: `/Users/zhanglongsheng/Desktop/抽屉2.jpg`
- Image payload: JPEG data URL, about 5.9 MB after base64 encoding

## Real Image Results

| Endpoint | HTTP status | Usable | Duration | JSON parsed | Items | Notes |
| --- | ---: | --- | ---: | --- | ---: | --- |
| `/v1/chat/completions` | none | no | 180s | no | - | Client-side timeout, no server response body |
| `/v1/responses` | none | no | 180s | no | - | Client-side timeout, no server response body |

## Short Text Compatibility Probe

| Endpoint | HTTP status | Duration | JSON parsed |
| --- | ---: | ---: | --- |
| `/v1/chat/completions` | 200 | 4.6s | yes |
| `/v1/responses` | 200 | 4.1s | yes |

## Conclusion

Both endpoint routes are reachable through this relay, and `gpt-5.5` is not rejected by the relay for a short text JSON request. With the project prompt and the original drawer photo, both Chat Completions and Responses exceeded a 180 second client timeout.

For the current mini program, keep `/v1/chat/completions` as the stable default because the code already targets that response shape and this test did not show a real-image speed advantage from `/v1/responses`. The next practical optimization should be image compression before upload, for example resizing the long edge to 1280-1600 pixels and encoding JPEG around 0.75-0.85 quality, then retesting the same endpoints.
