#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""OpenAI-compatible chat backend.

Rewritten for the ``openai`` >= 1.0 SDK (this build ships 2.x). The original
version used the removed ``openai.ChatCompletion`` module-level API, the
deprecated ``functions`` parameter, and the unmaintained ``gpt_stream_parser``
package.

Because it talks plain OpenAI protocol, ``base_url`` lets the same backend drive
OpenAI itself, Ollama (http://localhost:11434/v1), LM Studio
(http://localhost:1234/v1), llama.cpp's server, OpenRouter, or any other
compatible endpoint.
"""

import json

import openai

try:
    from scripts import chat_common
except ImportError:  # pragma: no cover - direct import fallback
    import chat_common

DEFAULT_BASE_URL = "https://api.openai.com/v1"

_TOOL_ERROR_HINTS = (
    "tool", "function", "not supported", "unsupported", "unrecognized",
    "invalid_request_error", "does not support",
)


class ChatGptApi:
    def __init__(self, model=None, apikey=None, base_url=None):
        self.chatgpt_messages = []
        self.log_file_name = None
        self.model = model or "gpt-4o-mini"
        self.apikey = apikey or ""
        self.base_url = (base_url or "").strip() or DEFAULT_BASE_URL
        self.recieved_json = ""
        self.recieved_message = ""
        self.is_abort = False
        self.use_tools = True
        self._client = None
        self._stream_handle = None
        self._busy = False

    # ------------------------------------------------------------------ setup

    def change_apikey(self, apikey):
        self.apikey = (apikey or "").strip()
        self._client = None

    def change_model(self, model):
        if model:
            self.model = model
        # A different model may well support tools again.
        self.use_tools = True

    def change_base_url(self, base_url):
        self.base_url = (base_url or "").strip() or DEFAULT_BASE_URL
        self._client = None
        self.use_tools = True

    def get_client(self):
        if self._client is None:
            # Local servers ignore the key but the SDK insists on a non-empty one.
            key = self.apikey or "sk-no-key-required"
            self._client = openai.OpenAI(api_key=key, base_url=self.base_url)
        return self._client

    # ------------------------------------------------------------------- log

    def set_log(self, log_string):
        self.chatgpt_messages = chat_common.log_to_messages(log_string)

    def get_log(self):
        return json.dumps(self.chatgpt_messages)

    # ---------------------------------------------------------------- sending

    def send(self, content):
        if self._busy:
            return None, None
        self._busy = True
        self.is_abort = False
        self.recieved_json = ""
        self.recieved_message = ""
        self.chatgpt_messages.append({"role": "user", "content": content})

        try:
            aborted = self._run_stream(self.use_tools)
            if not aborted and self.use_tools and not self.recieved_json and not self.recieved_message:
                # Some compatible servers silently ignore tools and return nothing.
                self.use_tools = False
                aborted = self._run_stream(False)
        except Exception as error:  # noqa: BLE001 - must never escape into the UI thread
            if self.use_tools and self._looks_like_tool_error(error):
                self.use_tools = False
                try:
                    aborted = self._run_stream(False)
                except Exception as retry_error:  # noqa: BLE001
                    return self._fail(retry_error)
            else:
                return self._fail(error)
        finally:
            self._stream_handle = None
            self._busy = False

        if aborted:
            self.chatgpt_messages = self.chatgpt_messages[:-1]
            return None, None

        return self._finish()

    def _run_stream(self, use_tools):
        """Consume one streamed completion. Returns True when aborted."""
        messages = list(self.chatgpt_messages)
        kwargs = {"model": self.model, "messages": messages, "stream": True}
        if use_tools:
            kwargs["tools"] = [chat_common.TXT2IMG_TOOL]
        else:
            messages.insert(0, {"role": "system", "content": chat_common.system_message()})

        self.recieved_json = ""
        self.recieved_message = ""

        stream = self.get_client().chat.completions.create(**kwargs)
        self._stream_handle = stream
        try:
            for chunk in stream:
                if self.is_abort:
                    self.is_abort = False
                    return True
                if not getattr(chunk, "choices", None):
                    continue
                delta = chunk.choices[0].delta
                if delta is None:
                    continue
                for tool_call in (getattr(delta, "tool_calls", None) or []):
                    function = getattr(tool_call, "function", None)
                    if function is not None and function.arguments:
                        self.recieved_json += function.arguments
                if getattr(delta, "content", None):
                    self.recieved_message += delta.content
        finally:
            close = getattr(stream, "close", None)
            if close is not None:
                try:
                    close()
                except Exception:  # noqa: BLE001
                    pass
        return False

    def _finish(self):
        result = self.recieved_message
        prompt = None
        ignore_result = False
        # The text convention already renders the prompt inside the reply.
        inline_prompt = False

        if self.recieved_json:
            func_args = chat_common.force_parse_json(self.recieved_json)
            if isinstance(func_args, dict) and func_args.get("prompt"):
                prompt = func_args["prompt"]
                if func_args.get("message"):
                    result = func_args["message"]
                else:
                    ignore_result = True
        elif not self.use_tools:
            result, prompt = chat_common.parse_sd_message(self.recieved_message, True)
            inline_prompt = True

        result = result or ""

        if prompt is None:
            self.chatgpt_messages.append({"role": "assistant", "content": result})
        else:
            self.chatgpt_messages.append({
                "role": "assistant",
                "content": result + "\n(Generated image by the following prompt: " + prompt + ")",
            })
            if not inline_prompt:
                result += "\n_" + prompt + "_"

        if ignore_result:
            result = "_" + prompt + "_"

        return result, prompt

    def _fail(self, error):
        # Drop the user turn so the next attempt starts from a clean history.
        if self.chatgpt_messages and self.chatgpt_messages[-1]["role"] == "user":
            self.chatgpt_messages = self.chatgpt_messages[:-1]
        message = f"{type(error).__name__}: {error}"
        print("[sd-webui-chatgpt] request failed: " + message)
        return "**Request failed**\n\n`" + message + "`", None

    @staticmethod
    def _looks_like_tool_error(error):
        text = str(error).lower()
        return any(hint in text for hint in _TOOL_ERROR_HINTS)

    # -------------------------------------------------------------- streaming

    def get_stream(self):
        if self.recieved_json:
            func_args = chat_common.force_parse_json(self.recieved_json)
            if isinstance(func_args, dict):
                return func_args.get("message"), func_args.get("prompt")
            return None, None
        if not self.recieved_message:
            return None, None
        if self.use_tools:
            return self.recieved_message, None
        message, prompt = chat_common.parse_sd_message(self.recieved_message)
        if message is not None and message.endswith("!"):
            message = message[:-1]
        if message is not None and message.isspace():
            message = None
        return message, prompt

    # ----------------------------------------------------------------- misc

    def remove_last_conversation(self, result=None):
        if not self.chatgpt_messages:
            return
        if result is None or self.chatgpt_messages[-1]["content"] == result:
            self.chatgpt_messages = self.chatgpt_messages[:-2]

    def clear(self):
        self.chatgpt_messages = []
        self.log_file_name = None
        self.recieved_json = ""
        self.recieved_message = ""

    def abort(self):
        self.is_abort = True
        stream = self._stream_handle
        if stream is not None:
            close = getattr(stream, "close", None)
            if close is not None:
                try:
                    close()
                except Exception:  # noqa: BLE001
                    pass
