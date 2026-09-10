# sd-webui-chatgpt — Forge-Neo build notes

This copy of the extension was rewritten to run on **Forge-Neo 2.29 / Python 3.13 /
torch 2.10 / openai 2.x**. Upstream targeted Python 3.10, A1111 1.x and the removed
`openai.ChatCompletion` API, so it could not load here at all.

## What changed and why

| Area | Before | Now |
| --- | --- | --- |
| `install.py` | Installed `langchain<0.3`, `llama-cpp-python` (cp310 wheels), `openai==0.28`, `gpt-stream-json-parser` | Installs nothing. `langchain<0.3` pins `numpy<2`, which would downgrade numpy under torch and break the whole WebUI |
| OpenAI client | `openai.ChatCompletion.create` + deprecated `functions=` | `openai.OpenAI(...).chat.completions.create` + `tools=` |
| Streaming JSON | `gpt_stream_parser` package (unmaintained, never installed) | `scripts/chat_common.py::force_parse_json` |
| Local models | langchain `ChatOllama` / `LlamaCpp` / `GPT4All` | `scripts/localapi.py` talks to Ollama's HTTP API directly (only needs `requests`) |
| Infotext buttons | `modules.generation_parameters_copypaste` | `modules.infotext_utils` (renamed in Forge), with a fallback |
| txt2img call | Reflection over the `txt2img()` signature, which differs in every fork | Builds `StableDiffusionProcessingTxt2Img` directly and runs it through `modules_forge.main_thread` |

Original files are kept in `scripts.orig-backup/` and `install.py.orig-backup`.

## Backends

### OpenAI API tab

Three fields, each with its own *Save And Reflect* button:

* **API Key** — stored in `settings/chatgpt_api.txt`
* **ChatGPT Model Name** — e.g. `gpt-4o-mini`, `gpt-4o`
* **Base URL** — any OpenAI-compatible server, default `https://api.openai.com/v1`

Because of the Base URL field, this tab also drives local servers:

| Server | Base URL | Model name |
| --- | --- | --- |
| Ollama | `http://localhost:11434/v1` | `qwen3:8b`, `llama3.1:8b`, … |
| LM Studio | `http://localhost:1234/v1` | whatever LM Studio reports |
| llama.cpp server | `http://localhost:8080/v1` | any |
| OpenRouter | `https://openrouter.ai/api/v1` | `openai/gpt-4o-mini`, … |

The API key may be left empty for local servers.

Image generation is requested through OpenAI **tool calling**. If the endpoint
rejects tools, the backend automatically retries without them and falls back to a
text convention (`![sd-prompt: 1girl, red ribbon](sd:// "result")`), so models
without tool support still work.

### Ollama tab

Native Ollama protocol (`/api/chat`), which exposes options the OpenAI-compatible
endpoint does not:

* **Model Name** — e.g. `qwen3:8b`
* **Server URL** — default `http://localhost:11434`, also read from `$OLLAMA_HOST`
* **num_gpu**, **n_ctx**, **keep_alive**
* **System Message Language** — English or Japanese

This tab always uses the text convention, so any model works.

### LlamaCpp and GPT4All tabs

Not available on this build and they say so in the chat instead of crashing:

* `llama-cpp-python` has no prebuilt wheel for Python 3.13 + CUDA 13 here
* `gpt4all` does not support Python 3.13

Use the Ollama tab, or point the OpenAI tab's Base URL at a local server.

## txt2img settings

The **txt2img** JSON box at the bottom of the tab is the preset every generated
image uses. Keys are matched against `StableDiffusionProcessingTxt2Img` fields, so
Forge-specific ones work too — for example `distilled_cfg_scale`, `scheduler`,
`hr_cfg`. Unknown keys are reported once in the console and ignored rather than
raising. Legacy `sampler_index` / `hr_sampler_index` strings are still accepted and
mapped to `sampler_name` / `hr_sampler_name`.

`prompt` in that JSON is a prefix: the model's prompt is appended to it, so you can
keep quality tags or a LoRA trigger there.

Generated images are written to `outputs/chatgpt/`, chat logs to
`outputs/chatgpt/chat/`.

## Troubleshooting

Network and API failures are reported inside the chat as **Request failed** with the
exception text, and the failed turn is dropped from the history so the next attempt
starts clean. The same text is printed to the console prefixed with
`[sd-webui-chatgpt]`.
