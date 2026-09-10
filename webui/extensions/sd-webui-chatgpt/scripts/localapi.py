#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""Local model backends.

Replaces the old ``langchainapi.py``. langchain<0.3 cannot be installed on this
build (it pins numpy<2, which would downgrade numpy under torch and break the
whole WebUI), so Ollama is driven directly over its HTTP API instead - no extra
dependencies beyond ``requests``, which the WebUI already ships.

llama-cpp-python and gpt4all have no working wheels for Python 3.13 here, so
those two tabs report that clearly instead of crashing the extension.
"""

import json
import os

import requests

try:
    from scripts import chat_common
except ImportError:  # pragma: no cover - direct import fallback
    import chat_common

DEFAULT_OLLAMA_URL = "http://localhost:11434"


def _ollama_base_url(settings):
    url = (settings.get("ollama_url") or "").strip()
    if not url:
        url = (os.environ.get("OLLAMA_HOST") or "").strip()
    if not url:
        url = DEFAULT_OLLAMA_URL
    if not url.startswith("http://") and not url.startswith("https://"):
        url = "http://" + url
    return url.rstrip("/")


def _int_setting(settings, key, default):
    try:
        return int(settings.get(key, default))
    except (TypeError, ValueError):
        return default


class LocalChatApi:
    """Ollama backend with the same interface the old LangChainApi exposed."""

    def __init__(self, **kwargs):
        self.messages = []
        self.log_file_name = None
        self.recieved_message = ""
        self.is_abort = False
        self._response = None
        self._busy = False
        self.settings = {}
        self.backend = None
        self.load_settings(**kwargs)

    # ------------------------------------------------------------------ setup

    def load_settings(self, **kwargs):
        self.settings = kwargs
        self.backend = self.settings.get("backend")

    @property
    def model(self):
        return (self.settings.get("ollama_model") or "").strip()

    # ------------------------------------------------------------------- log

    def set_log(self, log_string):
        self.messages = [
            {"role": m["role"], "content": chat_common.note_to_marker(m["content"])}
            if m["role"] == "assistant" else m
            for m in chat_common.log_to_messages(log_string)
        ]

    def get_log(self):
        out = []
        for message in self.messages:
            content = message["content"]
            if message["role"] == "assistant":
                content = chat_common.marker_to_note(content)
            out.append({"role": message["role"], "content": content})
        return json.dumps(out)

    # ---------------------------------------------------------------- sending

    def send(self, content):
        if self._busy:
            return None, None
        if not self.model:
            return "**Ollama is not configured**\n\nSet a model name in the Ollama tab (for example `qwen3:8b`) and press *Save And Reflect*.", None

        self._busy = True
        self.is_abort = False
        self.recieved_message = ""
        self.messages.append({"role": "user", "content": content})

        try:
            aborted = self._run_stream()
        except Exception as error:  # noqa: BLE001 - must never escape into the UI thread
            return self._fail(error)
        finally:
            self._response = None
            self._busy = False

        if aborted:
            self.messages = self.messages[:-1]
            return None, None

        message, prompt = chat_common.parse_sd_message(self.recieved_message, True)
        self.messages.append({"role": "assistant", "content": self.recieved_message})
        return message, prompt

    def _run_stream(self):
        language = self.settings.get("llama_cpp_system_message_language")
        payload = {
            "model": self.model,
            "messages": [{"role": "system", "content": chat_common.system_message(language)}] + self.messages,
            "stream": True,
            "keep_alive": self.settings.get("ollama_keep_alive") or "5m",
            "options": {
                "num_gpu": _int_setting(self.settings, "ollama_num_gpu", 1),
                "num_ctx": _int_setting(self.settings, "llama_cpp_n_ctx", 2048),
            },
        }

        url = _ollama_base_url(self.settings) + "/api/chat"
        response = requests.post(url, json=payload, stream=True, timeout=(10, 900))
        self._response = response
        try:
            response.raise_for_status()
            for line in response.iter_lines():
                if self.is_abort:
                    self.is_abort = False
                    return True
                if not line:
                    continue
                try:
                    data = json.loads(line.decode("utf-8"))
                except ValueError:
                    continue
                if data.get("error"):
                    raise RuntimeError(data["error"])
                self.recieved_message += (data.get("message") or {}).get("content", "")
                if data.get("done"):
                    break
        finally:
            try:
                response.close()
            except Exception:  # noqa: BLE001
                pass
        return False

    def _fail(self, error):
        if self.messages and self.messages[-1]["role"] == "user":
            self.messages = self.messages[:-1]
        message = f"{type(error).__name__}: {error}"
        print("[sd-webui-chatgpt] Ollama request failed: " + message)
        hint = ""
        if isinstance(error, requests.exceptions.ConnectionError):
            hint = "\n\nIs the Ollama server running? Default address is " + _ollama_base_url(self.settings) + "."
        return "**Request failed**\n\n`" + message + "`" + hint, None

    # -------------------------------------------------------------- streaming

    def get_stream(self):
        if not self.recieved_message:
            return None, None
        message, prompt = chat_common.parse_sd_message(self.recieved_message)
        if message is not None and message.endswith("!"):
            message = message[:-1]
        if message is not None and message.isspace():
            message = None
        return message, prompt

    # ----------------------------------------------------------------- misc

    def remove_last_conversation(self, result=None):
        if not self.messages:
            return
        if result is None or self.messages[-1]["content"] == result:
            self.messages = self.messages[:-2] if len(self.messages) > 2 else []

    def clear(self):
        self.messages = []
        self.log_file_name = None
        self.recieved_message = ""

    def abort(self):
        self.is_abort = True
        response = self._response
        if response is not None:
            try:
                response.close()
            except Exception:  # noqa: BLE001
                pass


class UnavailableApi:
    """Placeholder for backends that cannot run on this build."""

    REASONS = {
        "LlamaCpp": (
            "llama-cpp-python has no prebuilt wheel for Python 3.13 + CUDA 13 in this "
            "package, so the LlamaCpp backend is unavailable."
        ),
        "GPT4All": (
            "The gpt4all package does not support Python 3.13, so the GPT4All backend "
            "is unavailable."
        ),
    }

    def __init__(self, **kwargs):
        self.messages = []
        self.log_file_name = None
        self.load_settings(**kwargs)

    def load_settings(self, **kwargs):
        self.settings = kwargs
        self.backend = self.settings.get("backend")

    def _notice(self):
        reason = self.REASONS.get(self.backend, "This backend is unavailable on this build.")
        return (
            "**" + str(self.backend) + " is not available**\n\n" + reason +
            "\n\nUse the **Ollama** tab for local models, or the **OpenAI API** tab - its "
            "*Base URL* field also accepts any OpenAI-compatible server "
            "(`http://localhost:11434/v1` for Ollama, `http://localhost:1234/v1` for LM Studio)."
        )

    def set_log(self, log_string):
        self.messages = chat_common.log_to_messages(log_string)

    def get_log(self):
        return json.dumps(self.messages)

    def send(self, content):
        return self._notice(), None

    def get_stream(self):
        return None, None

    def remove_last_conversation(self, result=None):
        self.messages = self.messages[:-2] if len(self.messages) > 2 else []

    def clear(self):
        self.messages = []
        self.log_file_name = None

    def abort(self):
        pass
