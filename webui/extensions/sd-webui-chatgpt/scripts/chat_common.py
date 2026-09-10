#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""Shared helpers for the sd-webui-chatgpt backends.

This module replaces two dead dependencies of the original extension:

* ``gpt_stream_parser.force_parse_json`` -> :func:`force_parse_json`
* the langchain prompt/parsing machinery -> :data:`SYSTEM_MESSAGE_EN` and
  :func:`parse_sd_message`

It has no third-party imports on purpose, so loading it can never break WebUI
startup.
"""

import json
import re

TXT2IMG_TOOL = {
    "type": "function",
    "function": {
        "name": "txt2img",
        "description": (
            "Generate an image from a prompt using Stable Diffusion. "
            "(Sentences cannot be generated.) There is no memory function, so "
            "please carry over the relevant prompt parts from past conversations."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "message": {
                    "type": "string",
                    "description": "Chat message. Displayed before the image.",
                },
                "prompt": {
                    "type": "string",
                    "description": (
                        'Prompt for generating the image. The prompt is a list of '
                        'comma separated keywords such as "1girl, school uniform, '
                        'red ribbon". If it is not in English, translate it into '
                        "English (lang:en)."
                    ),
                },
            },
            "required": ["prompt"],
        },
    },
}

SYSTEM_MESSAGE_EN = """You are a chatbot having a conversation with a human.

You also have the function to generate image with Stable Diffusion.
If you want to use this function, please add the following to your message.

![sd-prompt: PROMPT](sd:// "result")

PROMPT contains the prompt to generate the image.
Prompt is comma separated keywords.
If it is not in English, please translate it into English (lang:en).
For example, if you want to output "a school girl wearing a red ribbon", it would be as follows.

![sd-prompt: 1girl, school uniform, red ribbon](sd:// "result")

The image is always output at the end, not at the location where it is added.
If there are multiple entries, only the first one will be reflected.
There is no memory function, so please carry over the prompts from past conversations.
"""

SYSTEM_MESSAGE_JA = """あなたは人間と会話するチャットボットです。

また、あなたはStable Diffusionで画像を生成する機能があります。
その機能を実行する場合は、以下をあなたの返信内容に加えてください。

![sd-prompt: PROMPT](sd:// "result")

PROMPTは画像生成に使用するプロンプトに置き換えてください。
このプロンプトはカンマ区切りの英語のキーワードの羅列です。
プロンプトが英語でない場合は、英語(lang:en)に翻訳してください。
例えば、「赤いリボンを付けた学生の女の子」を生成したい場合は、以下のようにしてください。

![sd-prompt: 1girl, school uniform, red ribbon](sd:// "result")

この画像は返信メッセージの後に表示されます。
このプロンプトが複数存在する場合は、最初のプロンプトの画像のみが生成されます。
この画像生成機能に、記憶する機能は無いので、過去の会話内容も反映させてください。
"""


def system_message(language=None):
    """System prompt teaching the model the ``![sd-prompt: ...]`` convention."""
    if language == "Japanese":
        return SYSTEM_MESSAGE_JA
    return SYSTEM_MESSAGE_EN


def force_parse_json(partial: str):
    """Parse a JSON document that is still being streamed.

    Returns the parsed object, or ``None`` when not even a partial object can be
    recovered yet. Drop-in replacement for ``gpt_stream_parser.force_parse_json``.
    """
    if not partial:
        return None

    try:
        return json.loads(partial)
    except ValueError:
        pass

    stack = []
    in_string = False
    escaped = False
    for char in partial:
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            stack.append("}")
        elif char == "[":
            stack.append("]")
        elif char in "}]":
            if stack:
                stack.pop()

    head = partial
    if escaped:
        head = head[:-1]
    if in_string:
        head += '"'

    closing = "".join(reversed(stack))

    # A stream can stop anywhere, including right after a comma, a colon or a
    # bare key. Try the cheap repairs in order of likelihood.
    # A stream can also stop right after a key, before its colon.
    dangling_key = re.sub(r',\s*"[^"]*"\s*$', "", head)

    for candidate in (
        head + closing,
        head.rstrip().rstrip(",") + closing,
        head.rstrip() + "null" + closing,
        head.rstrip().rstrip(":").rstrip().rstrip(",") + closing,
        dangling_key + closing,
    ):
        try:
            return json.loads(candidate)
        except ValueError:
            continue
    return None


_TAG_RE = re.compile(r'!\[.*?\]\(.*?\)')
_TAG_PREFIX = '![sd-prompt: '
_TAG_SUFFIX = '](sd:// "result")'


def parse_sd_message(full_message: str, is_finished: bool = False):
    """Split a reply into (display text, txt2img prompt).

    Understands the ``![sd-prompt: ...](sd:// "result")`` marker, including the
    half-written forms that show up while the reply is still streaming.
    """
    if full_message is None:
        return None, None
    if "![" not in full_message:
        return full_message, None

    parted_prompt = None
    prompt_tags = _TAG_RE.findall(full_message)

    if not prompt_tags:
        # The tag is still being written.
        if _TAG_PREFIX in full_message:
            parted_prompt = full_message.split(_TAG_PREFIX)[1]
            full_message = full_message.replace(_TAG_PREFIX, "_").split("]")[0] + "_"
        end_index = full_message.rfind("![")
        if end_index >= 0:
            return full_message[:end_index], None
        if is_finished:
            return full_message, parted_prompt
        return full_message, None

    ret_message = full_message
    prompt = None
    for tag in prompt_tags:
        if tag.startswith(_TAG_PREFIX) and tag.endswith(_TAG_SUFFIX):
            if prompt is None:
                prompt = tag[len(_TAG_PREFIX):-len(_TAG_SUFFIX)]
            ret_message = ret_message.replace(tag, "_" + prompt + "_")

    if ret_message.isspace():
        return None, prompt
    if _TAG_PREFIX in ret_message:
        ret_message = ret_message.replace(_TAG_PREFIX, "_").split("]")[0] + "_"
    end_index = ret_message.rfind("![")
    if end_index >= 0:
        return ret_message[:end_index], prompt
    return ret_message, prompt


def log_to_messages(log_string: str):
    """Load a saved chat log into plain ``[{role, content}, ...]`` form."""
    loaded = json.loads(log_string)
    if isinstance(loaded, dict):
        # log_version 2 was langchain's own serialisation; keep what we can.
        loaded = loaded.get("messages", [])
        messages = []
        for entry in loaded:
            data = entry.get("data", {}) if isinstance(entry, dict) else {}
            role = {"human": "user", "ai": "assistant"}.get(entry.get("type"))
            if role and "content" in data:
                messages.append({"role": role, "content": data["content"]})
        return messages
    return [m for m in loaded if isinstance(m, dict) and "role" in m and "content" in m]


_GENERATED_RE = re.compile(r"\(Generated image by the following prompt: (.*)\)")
_MARKER_RE = re.compile(r'!\[sd-prompt: (.*?)\]\(sd:// "result"\)')


def marker_to_note(content: str) -> str:
    """``![sd-prompt: x](...)`` -> ``(Generated image by the following prompt: x)``"""
    return _MARKER_RE.sub(r"(Generated image by the following prompt: \1)", content)


def note_to_marker(content: str) -> str:
    """Inverse of :func:`marker_to_note`."""
    return _GENERATED_RE.sub(r'![sd-prompt: \1](sd:// "result")', content)
